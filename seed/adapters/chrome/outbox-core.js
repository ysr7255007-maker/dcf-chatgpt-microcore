/**
 * G1 Chrome Adapter - Durable Outbox Core (UMD, zero dependency)
 *
 * Pure logic, storage- and network-agnostic:
 *   - MV3 service worker: importScripts('outbox-core.js') -> globalThis.DCF_OUTBOX
 *   - Node tests:         require('./outbox-core')        -> module.exports
 *
 * Responsibilities (per G1 blueprint §4 浏览器 durable outbox):
 *   - Bounded outbox in injected storage (default capacity 8 events)
 *   - Bounded tombstones for evicted/rejected events (capacity 200)
 *   - Per-source monotonic sequence numbers (persisted)
 *   - Idempotent event identity (stable ULID-format id from observation key)
 *   - Non-blocking flush to companion; failures recorded honestly, never
 *     pretended as success (缺口如实性)
 *   - NOT_OBSERVE boundary => content zero residue (内容零残留)
 *   - Outbox is transport custody only, never an authority (outbox 非权威性)
 */
(function (global) {
    'use strict';

    const DEFAULT_CONFIG = {
        OUTBOX_CAPACITY: 8,
        TOMBSTONE_CAPACITY: 200,
        FAILURE_LOG_CAPACITY: 50,
        SEEN_KEYS_PER_SOURCE: 300,
        COMPANION_URL: 'http://127.0.0.1:8472'
    };

    const KEYS = {
        OUTBOX: 'events_outbox',
        TOMBSTONES: 'outbox_tombstones',
        SEQUENCES: 'sequence_numbers',
        FAILURES: 'delivery_failures',
        SOURCES: 'source_registry',
        BOUNDARIES: 'boundary_states',
        SEEN: 'seen_observation_keys'
    };

    const BOUNDARY_STATES = ['NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'];
    const DEFAULT_BOUNDARY = 'OBSERVE_CURRENT_ONLY';

    class OutboxCore {
        /**
         * @param {Object} deps
         * @param {{get:Function,set:Function}} deps.storage - async key/value store
         *        get(keys: string[]) -> Promise<Object>, set(obj) -> Promise<void>
         * @param {Function} deps.fetchFn - fetch-compatible function
         * @param {Object} deps.ulid - DCF_ULID api
         * @param {Object} [deps.config] - config overrides
         * @param {Function} [deps.log] - logger (defaults to console.log)
         */
        constructor(deps) {
            if (!deps || !deps.storage || !deps.fetchFn || !deps.ulid) {
                throw new Error('OutboxCore requires storage, fetchFn and ulid');
            }
            this.storage = deps.storage;
            this.fetchFn = deps.fetchFn;
            this.ulid = deps.ulid;
            this.config = Object.assign({}, DEFAULT_CONFIG, deps.config || {});
            this.log = deps.log || function () {};
            this._flushing = false;
        }

        // ------------------------------------------------------------------
        // Source registry: conversation key -> stable source_id (ULID format)
        // ------------------------------------------------------------------

        /**
         * Resolve (or create) the stable source_id for a conversation key.
         * Derived deterministically so the same conversation always maps to
         * the same source_id even after storage loss on another device.
         */
        async ensureSource(conversationKey) {
            if (!conversationKey || typeof conversationKey !== 'string') {
                throw new Error('conversationKey must be a non-empty string');
            }
            const data = await this.storage.get([KEYS.SOURCES]);
            const registry = data[KEYS.SOURCES] || {};
            if (registry[conversationKey]) {
                return registry[conversationKey];
            }
            const sourceId = await this.ulid.stableIdFromString('dcf.source:' + conversationKey);
            registry[conversationKey] = sourceId;
            await this.storage.set({ [KEYS.SOURCES]: registry });
            this.log('[outbox] registered source', conversationKey, '->', sourceId);
            return sourceId;
        }

        async getSourceRegistry() {
            const data = await this.storage.get([KEYS.SOURCES]);
            return data[KEYS.SOURCES] || {};
        }

        // ------------------------------------------------------------------
        // Boundary states (local enforcement mirror; companion is authority)
        // ------------------------------------------------------------------

        async getBoundary(sourceId) {
            const data = await this.storage.get([KEYS.BOUNDARIES]);
            const boundaries = data[KEYS.BOUNDARIES] || {};
            return boundaries[sourceId] || DEFAULT_BOUNDARY;
        }

        async setBoundary(sourceId, state) {
            if (!BOUNDARY_STATES.includes(state)) {
                return { success: false, error: 'Invalid boundary state: ' + state };
            }
            const data = await this.storage.get([KEYS.BOUNDARIES]);
            const boundaries = data[KEYS.BOUNDARIES] || {};
            boundaries[sourceId] = state;
            await this.storage.set({ [KEYS.BOUNDARIES]: boundaries });
            return { success: true };
        }

        /**
         * Pull latest boundary decisions from companion events so that a
         * Surface-side toggle (persisted as a boundary event in companion)
         * reaches local enforcement. Failures are tolerated silently: the
         * local mirror simply stays on its previous value.
         */
        async syncBoundariesFromCompanion() {
            const registry = await this.getSourceRegistry();
            const sourceIds = Object.values(registry);
            for (const sourceId of sourceIds) {
                try {
                    const res = await this.fetchFn(
                        this.config.COMPANION_URL +
                        '/rpc/events/query?source_id=' + encodeURIComponent(sourceId) +
                        '&limit=50&orderBy=DESC'
                    );
                    if (!res.ok) continue;
                    const body = await res.json();
                    const events = body && body.result && body.result.events;
                    if (!Array.isArray(events)) continue;
                    const boundaryEvent = events.find(function (e) {
                        return e.event_type === 'system.boundary.updated';
                    });
                    if (!boundaryEvent) continue;
                    const payload = typeof boundaryEvent.payload_json === 'string'
                        ? JSON.parse(boundaryEvent.payload_json)
                        : (boundaryEvent.payload_json || {});
                    if (BOUNDARY_STATES.includes(payload.boundary_state)) {
                        await this.setBoundary(sourceId, payload.boundary_state);
                        this.log('[outbox] boundary synced', sourceId, payload.boundary_state);
                    }
                } catch (e) {
                    // companion unreachable: keep local mirror unchanged
                }
            }
        }

        // ------------------------------------------------------------------
        // Observation intake
        // ------------------------------------------------------------------

        /**
         * Record one observation from the content script.
         * @param {Object} obs
         * @param {string} obs.conversation_key - e.g. 'chatgpt.com/c/uuid'
         * @param {string} obs.observation_key  - stable key for this observation
         * @param {string} obs.event_type       - dot-separated lowercase type
         * @param {Object|null} obs.payload     - observation payload (object)
         * @returns {Promise<{enqueued: boolean, reason?: string, event_id?: string}>}
         */
        async recordObservation(obs) {
            const sourceId = await this.ensureSource(obs.conversation_key);

            // Red line: NOT_OBSERVE => content zero residue. The observation
            // is dropped before any content touches storage.
            const boundary = await this.getBoundary(sourceId);
            if (boundary === 'NOT_OBSERVE') {
                return { enqueued: false, reason: 'boundary_not_observe' };
            }

            // Local dedup: same observation key never enqueued twice while
            // its key remains in the bounded seen-set. Even when the seen-set
            // overflows, the deterministic event_id lets companion absorb the
            // duplicate (second safety layer).
            const seenData = await this.storage.get([KEYS.SEEN]);
            const seen = seenData[KEYS.SEEN] || {};
            const seenList = seen[sourceId] || [];
            if (seenList.includes(obs.observation_key)) {
                return { enqueued: false, reason: 'duplicate_observation' };
            }

            const eventId = await this.ulid.stableIdFromString(
                'dcf.event:' + sourceId + ':' + obs.observation_key
            );

            // Per-source monotonic sequence number, persisted immediately so
            // it survives service worker termination.
            const seqData = await this.storage.get([KEYS.SEQUENCES]);
            const sequences = seqData[KEYS.SEQUENCES] || {};
            const nextSeq = (sequences[sourceId] || 0) + 1;
            sequences[sourceId] = nextSeq;
            await this.storage.set({ [KEYS.SEQUENCES]: sequences });

            const event = {
                event_id: eventId,
                source_id: sourceId,
                event_type: obs.event_type,
                payload_json: obs.payload || null,
                created_at: new Date().toISOString(),
                sequence_number: nextSeq
            };

            await this._enqueue(event);

            // Mark observation as seen (bounded FIFO per source)
            seenList.push(obs.observation_key);
            while (seenList.length > this.config.SEEN_KEYS_PER_SOURCE) {
                seenList.shift();
            }
            seen[sourceId] = seenList;
            await this.storage.set({ [KEYS.SEEN]: seen });

            return { enqueued: true, event_id: eventId, sequence_number: nextSeq };
        }

        /**
         * Append an event to the bounded outbox. When full, the OLDEST event
         * is evicted and honestly recorded as a tombstone (it becomes a
         * visible sequence gap in Surface, never silently dropped).
         */
        async _enqueue(event) {
            const data = await this.storage.get([KEYS.OUTBOX]);
            const outbox = data[KEYS.OUTBOX] || [];
            const evicted = [];
            while (outbox.length >= this.config.OUTBOX_CAPACITY) {
                evicted.push(outbox.shift());
            }
            outbox.push(event);
            await this.storage.set({ [KEYS.OUTBOX]: outbox });
            if (evicted.length > 0) {
                await this._addTombstones(evicted, 'evicted_capacity');
                this.log('[outbox] capacity eviction:', evicted.length, 'event(s) tombstoned');
            }
        }

        async _addTombstones(events, reason) {
            const data = await this.storage.get([KEYS.TOMBSTONES]);
            const tombstones = data[KEYS.TOMBSTONES] || [];
            for (const event of events) {
                tombstones.push({
                    event_id: event.event_id,
                    source_id: event.source_id,
                    sequence_number: event.sequence_number,
                    reason: reason,
                    at: new Date().toISOString()
                });
            }
            while (tombstones.length > this.config.TOMBSTONE_CAPACITY) {
                tombstones.shift();
            }
            await this.storage.set({ [KEYS.TOMBSTONES]: tombstones });
        }

        // ------------------------------------------------------------------
        // Flush to companion
        // ------------------------------------------------------------------

        /**
         * Non-blocking flush: try to deliver the whole outbox in one batch.
         * On network failure everything stays in the outbox and the failure
         * is recorded (failure_event_id semantics). On batch validation
         * failure, falls back to per-event delivery so one poison event
         * cannot block the rest; rejected events are tombstoned.
         * @returns {Promise<Object>} flush report
         */
        async flush() {
            if (this._flushing) {
                return { skipped: true, reason: 'flush_in_progress' };
            }
            this._flushing = true;
            try {
                return await this._flushInner();
            } finally {
                this._flushing = false;
            }
        }

        async _flushInner() {
            const data = await this.storage.get([KEYS.OUTBOX]);
            const outbox = data[KEYS.OUTBOX] || [];
            if (outbox.length === 0) {
                return { delivered: 0, pending: 0 };
            }

            let response;
            try {
                response = await this.fetchFn(this.config.COMPANION_URL + '/rpc/events/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ events: outbox, id: 'flush-' + Date.now() })
                });
            } catch (networkError) {
                await this._recordFailure(outbox, 'network: ' + networkError.message);
                return { delivered: 0, pending: outbox.length, failure: networkError.message };
            }

            let body = null;
            try {
                body = await response.json();
            } catch (e) {
                body = null;
            }

            if (response.ok && body && body.result) {
                // Batch accepted: companion confirmed custody of every event
                // (inserted or absorbed as duplicate). Remove local copies.
                await this._removeFromOutbox(outbox.map(function (e) { return e.event_id; }));
                this.log('[outbox] flushed', outbox.length, 'event(s):', JSON.stringify(body.result));
                return {
                    delivered: outbox.length,
                    pending: 0,
                    inserted: body.result.inserted,
                    duplicated: body.result.duplicated
                };
            }

            if (response.status >= 400 && response.status < 500) {
                // Validation-level rejection: retry per event so one bad
                // event cannot block the whole queue.
                return await this._flushPerEvent(outbox);
            }

            const errMsg = (body && body.error && body.error.message) || ('http ' + response.status);
            await this._recordFailure(outbox, errMsg);
            return { delivered: 0, pending: outbox.length, failure: errMsg };
        }

        async _flushPerEvent(events) {
            let delivered = 0;
            let rejected = 0;
            for (const event of events) {
                let res;
                try {
                    res = await this.fetchFn(this.config.COMPANION_URL + '/rpc/events/ingest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ event: event, id: 'ingest-' + event.event_id })
                    });
                } catch (networkError) {
                    const remaining = await this._pendingCount();
                    await this._recordFailure([event], 'network: ' + networkError.message);
                    return { delivered, rejected, pending: remaining, failure: networkError.message };
                }
                let body = null;
                try { body = await res.json(); } catch (e) { body = null; }

                if (res.ok && body && body.result) {
                    await this._removeFromOutbox([event.event_id]);
                    delivered++;
                } else if (res.status >= 400 && res.status < 500) {
                    // Companion refuses this event permanently: tombstone it
                    // honestly instead of retrying forever.
                    await this._removeFromOutbox([event.event_id]);
                    const reason = (body && body.error && body.error.message) || ('rejected http ' + res.status);
                    await this._addTombstones([event], 'rejected: ' + reason);
                    rejected++;
                } else {
                    const remaining = await this._pendingCount();
                    return { delivered, rejected, pending: remaining, failure: 'http ' + res.status };
                }
            }
            const pending = await this._pendingCount();
            return { delivered, rejected, pending };
        }

        async _removeFromOutbox(eventIds) {
            const data = await this.storage.get([KEYS.OUTBOX]);
            const outbox = data[KEYS.OUTBOX] || [];
            const remaining = outbox.filter(function (e) {
                return !eventIds.includes(e.event_id);
            });
            await this.storage.set({ [KEYS.OUTBOX]: remaining });
        }

        async _pendingCount() {
            const data = await this.storage.get([KEYS.OUTBOX]);
            return (data[KEYS.OUTBOX] || []).length;
        }

        /**
         * Record a delivery failure honestly: which event was at the head of
         * the queue (failure_event_id), when, and why. Never fakes success.
         */
        async _recordFailure(events, errorMessage) {
            const data = await this.storage.get([KEYS.FAILURES]);
            const failures = data[KEYS.FAILURES] || [];
            failures.push({
                at: new Date().toISOString(),
                error: errorMessage,
                failure_event_id: events.length > 0 ? events[0].event_id : null,
                pending_count: events.length
            });
            while (failures.length > this.config.FAILURE_LOG_CAPACITY) {
                failures.shift();
            }
            await this.storage.set({ [KEYS.FAILURES]: failures });
            this.log('[outbox] delivery failure recorded:', errorMessage);
        }

        // ------------------------------------------------------------------
        // Introspection
        // ------------------------------------------------------------------

        async getStats() {
            const data = await this.storage.get([
                KEYS.OUTBOX, KEYS.TOMBSTONES, KEYS.SEQUENCES, KEYS.FAILURES, KEYS.SOURCES, KEYS.BOUNDARIES
            ]);
            return {
                outbox_size: (data[KEYS.OUTBOX] || []).length,
                outbox: data[KEYS.OUTBOX] || [],
                tombstone_count: (data[KEYS.TOMBSTONES] || []).length,
                tombstones: data[KEYS.TOMBSTONES] || [],
                delivery_failures: data[KEYS.FAILURES] || [],
                sequences: data[KEYS.SEQUENCES] || {},
                sources: data[KEYS.SOURCES] || {},
                boundaries: data[KEYS.BOUNDARIES] || {},
                config: this.config
            };
        }
    }

    const api = { OutboxCore, KEYS, BOUNDARY_STATES, DEFAULT_BOUNDARY, DEFAULT_CONFIG };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.DCF_OUTBOX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
