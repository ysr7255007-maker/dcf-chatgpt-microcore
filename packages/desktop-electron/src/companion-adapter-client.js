/**
 * DCF Surface - Companion Adapter Command Client
 *
 * Pure Node module (no electron import) so the enqueue/wait semantics are
 * unit-testable offline. Implements the Electron side of the command queue
 * contract (ruling C3):
 *
 *   1. POST /rpc/adapter/command            -> {command_id, status:'queued'}
 *   2. GET  /rpc/adapter/command/:id        -> poll every 500ms while a
 *      command is in flight (never polls when idle)
 *   3. resolve on status done/failed/expired, or honest local timeout
 *
 * All outcomes are honest: {ok:false, error} on failure/timeout, never a
 * fake 501 placeholder. Zero npm dependencies (Node 18+ native fetch).
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;

/**
 * Client bound to a companion base URL.
 */
class CompanionAdapterClient {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.baseUrl] - companion base, default http://127.0.0.1:8472
     * @param {number} [opts.timeoutMs] - default wait timeout
     * @param {number} [opts.pollIntervalMs] - status poll interval
     * @param {Function} [opts.fetchFn] - injectable fetch for tests
     */
    constructor(opts = {}) {
        this.baseUrl = (opts.baseUrl || 'http://127.0.0.1:8472').replace(/\/$/, '');
        this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
        this.pollIntervalMs = opts.pollIntervalMs || POLL_INTERVAL_MS;
        this.fetchFn = opts.fetchFn || fetch;
    }

    /**
     * Enqueue a command. Returns {ok:true, command_id} or {ok:false, error}.
     * @param {'read-conversation'|'send-card'} kind
     * @param {Object} payload
     * @param {number} [timeoutMs] - forwarded as timeout_ms for server-side expiry
     */
    async enqueue(kind, payload, timeoutMs) {
        try {
            const res = await this.fetchFn(this.baseUrl + '/rpc/adapter/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: kind,
                    payload: payload || {},
                    timeout_ms: timeoutMs || this.timeoutMs
                })
            });
            const parsed = await res.json();
            if (!res.ok) {
                return { ok: false, error: 'enqueue rejected: http ' + res.status + ' ' + JSON.stringify(parsed.error || parsed) };
            }
            const result = parsed.result || {};
            if (!result.command_id) {
                return { ok: false, error: 'enqueue response missing command_id' };
            }
            return { ok: true, command_id: result.command_id };
        } catch (err) {
            return { ok: false, error: 'companion unreachable: ' + err.message };
        }
    }

    /**
     * Fetch a single command status. Returns the .result object or null.
     * @param {string} commandId
     */
    async getStatus(commandId) {
        const res = await this.fetchFn(this.baseUrl + '/rpc/adapter/command/' + encodeURIComponent(commandId));
        if (!res.ok) return null;
        const parsed = await res.json();
        return parsed.result || null;
    }

    /**
     * Wait for a command to reach a terminal state, polling every
     * pollIntervalMs (only while this command is in flight — no idle polling).
     *
     * @param {string} commandId
     * @param {number} [timeoutMs]
     * @returns {Promise<{ok:boolean, status?:string, result?:*, error?:string}>}
     */
    async waitForResult(commandId, timeoutMs) {
        const deadline = Date.now() + (timeoutMs || this.timeoutMs);
        while (true) {
            let status = null;
            try {
                status = await this.getStatus(commandId);
            } catch (err) {
                return { ok: false, error: 'companion unreachable while waiting: ' + err.message };
            }
            if (!status) {
                return { ok: false, error: 'command not found: ' + commandId };
            }
            if (status.status === 'done') {
                return { ok: true, status: 'done', result: status.result };
            }
            if (status.status === 'failed') {
                return {
                    ok: false,
                    status: 'failed',
                    error: (status.result && (status.result.error || JSON.stringify(status.result))) || 'adapter reported failure'
                };
            }
            if (status.status === 'expired') {
                return { ok: false, status: 'expired', error: 'command expired before the adapter completed it' };
            }
            if (Date.now() >= deadline) {
                return { ok: false, status: status.status, error: 'timed out waiting for adapter result (last status: ' + status.status + ')' };
            }
            await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        }
    }

    /**
     * Convenience: enqueue then wait. Honest {ok:false, error} on any failure.
     * @param {'read-conversation'|'send-card'} kind
     * @param {Object} payload
     * @param {number} [timeoutMs]
     */
    async execute(kind, payload, timeoutMs) {
        const enq = await this.enqueue(kind, payload, timeoutMs);
        if (!enq.ok) return enq;
        const outcome = await this.waitForResult(enq.command_id, timeoutMs);
        outcome.command_id = enq.command_id;
        return outcome;
    }
}

module.exports = { CompanionAdapterClient, DEFAULT_TIMEOUT_MS, POLL_INTERVAL_MS };
