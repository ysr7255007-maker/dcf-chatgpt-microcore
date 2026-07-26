/**
 * G3 Companion - Material Metabolism Core
 *
 * Single source of truth for the materials_projection reducer:
 * - applyMaterialEvent() is a PURE reducer used by BOTH the incremental
 *   ingest path (events.js) and the full recomputation path (db.js), so
 *   "recomputed result === incremental result" holds by construction.
 * - MaterialProcessor exposes the high-level operations behind the G3
 *   HTTP endpoints (revision candidates, attribution transitions,
 *   continuation points, sync facts).
 *
 * Attribution four-state machine (forward-only, skipping allowed):
 *   ai_proposed -> user_tentative -> user_confirmed -> reality_verified
 * Regression requests are rejected AND recorded as an independent
 * `material.attribution.transition_rejected` event (full honest chain).
 *
 * Zero npm dependencies.
 */

const crypto = require('crypto');
const { generateULID, isValidULID } = require('./ulid');
const {
    validateMaterialEventPayload,
    validateAttributionTransition,
    ATTRIBUTION_STATES
} = require('./types');

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Parse payload_json whether it arrives as string or object.
 */
function parsePayload(payloadJson) {
    if (payloadJson == null) return null;
    if (typeof payloadJson === 'object') return payloadJson;
    try {
        return JSON.parse(payloadJson);
    } catch (_) {
        return null;
    }
}

/**
 * Empty projection for an entity (reducer initial state).
 */
function createEmptyProjection(entityId) {
    return {
        entity_id: entityId,
        latest_candidate_sha256: null,
        latest_candidate_body: null,
        attribution_state: null,
        assertion_attribution: null,
        source_ref: null,
        continuation_points: []
    };
}

/**
 * Convert a materials_projection DB row into reducer state.
 */
function projectionFromRow(row) {
    if (!row) return null;
    let points = [];
    if (row.continuation_points_json) {
        try { points = JSON.parse(row.continuation_points_json) || []; } catch (_) { points = []; }
    }
    return {
        entity_id: row.entity_id,
        latest_candidate_sha256: row.latest_candidate_sha256 || null,
        latest_candidate_body: row.latest_candidate_body || null,
        attribution_state: row.attribution_state || null,
        assertion_attribution: row.assertion_attribution || null,
        source_ref: row.source_ref || null,
        continuation_points: points
    };
}

/**
 * PURE reducer: apply one material.* event to a projection.
 * Returns the (mutated) projection; unknown material events are no-ops
 * on the projection (they remain in the append-only log).
 */
function applyMaterialEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.entity_id) return projection;

    const proj = projection || createEmptyProjection(payload.entity_id);

    // First material event seeds the NOT NULL columns
    if (!proj.attribution_state && payload.assertion_attribution) {
        proj.attribution_state = payload.assertion_attribution;
    }
    if (payload.assertion_attribution) {
        proj.assertion_attribution = payload.assertion_attribution;
    }

    switch (event.event_type) {
        case 'material.revision_candidate.created':
            proj.latest_candidate_body = payload.candidate_body ?? proj.latest_candidate_body;
            proj.latest_candidate_sha256 = payload.candidate_sha256
                || (typeof payload.candidate_body === 'string' ? sha256(payload.candidate_body) : proj.latest_candidate_sha256);
            if (payload.source_ref) proj.source_ref = payload.source_ref;
            break;

        case 'material.continuation_point.created':
            proj.continuation_points.push({
                from_event_id: payload.from_event_id,
                context_ref: payload.context_ref,
                created_at: event.created_at || null
            });
            break;

        case 'material.attribution.transitioned':
            if (payload.to_state && ATTRIBUTION_STATES.includes(payload.to_state)) {
                proj.attribution_state = payload.to_state;
            }
            break;

        default:
            // sync facts, rejected transitions etc. do not alter the projection
            break;
    }

    return proj;
}

/**
 * PURE full reduction: material events (log order) -> Map<entity_id, projection>.
 * Used by db.recomputeMaterialsProjection().
 */
function reduceMaterialEvents(events) {
    const map = new Map();
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        if (!payload || !payload.entity_id) continue;
        const next = applyMaterialEvent(map.get(payload.entity_id) || null, event);
        map.set(payload.entity_id, next);
    }
    return map;
}

/**
 * Incremental path: apply one material event to the persisted projection.
 * Shares applyMaterialEvent() with the recompute path.
 */
function applyEventToDb(db, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.entity_id) return { success: true, skipped: true };

    const currentRow = db.getMaterialProjection(payload.entity_id);
    const projection = applyMaterialEvent(projectionFromRow(currentRow), event);

    if (!projection.attribution_state || !projection.assertion_attribution) {
        // Projection columns are NOT NULL; nothing usable to persist yet
        return { success: true, skipped: true };
    }

    return db.upsertMaterialProjection({
        entity_id: projection.entity_id,
        latest_candidate_sha256: projection.latest_candidate_sha256,
        latest_candidate_body: projection.latest_candidate_body,
        attribution_state: projection.attribution_state,
        continuation_points: projection.continuation_points,
        source_ref: projection.source_ref,
        assertion_attribution: projection.assertion_attribution
    });
}

/**
 * MaterialProcessor: high-level G3 operations over EventProcessor + DB.
 * All writes go through eventProcessor.ingestEvent so the append-only
 * log stays the single source of truth (ingest updates the projection
 * incrementally via applyEventToDb).
 */
class MaterialProcessor {
    constructor({ db, eventProcessor }) {
        this.db = db;
        this.eventProcessor = eventProcessor;
    }

    /**
     * Submit a revision candidate. candidate_sha256 is always computed
     * server-side from candidate_body (immutable content identity).
     */
    async submitRevisionCandidate({ entity_id, base_sha256 = null, candidate_body, source_ref, assertion_attribution, source_id = null }) {
        const payload = {
            entity_id,
            base_sha256,
            candidate_sha256: typeof candidate_body === 'string' ? sha256(candidate_body) : null,
            candidate_body,
            source_ref,
            assertion_attribution
        };

        const check = validateMaterialEventPayload('material.revision_candidate.created', payload);
        if (!check.valid) {
            return { success: false, error: check.errors.join(', ') };
        }

        const result = await this.eventProcessor.ingestEvent({
            event_id: generateULID(),
            source_id: source_id || entity_id,
            event_type: 'material.revision_candidate.created',
            payload_json: payload,
            sha256: payload.candidate_sha256
        });

        if (!result.success) return result;
        return { success: true, event_id: result.event_id, candidate_sha256: payload.candidate_sha256 };
    }

    /**
     * Attribution transition (forward-only). Regression / invalid requests
     * are rejected AND recorded as material.attribution.transition_rejected.
     */
    async transitionAttribution({ entity_id, target_ref, from_state, to_state, evidence_ref = null, source_id = null }) {
        if (!entity_id || !isValidULID(entity_id)) {
            return { success: false, error: 'entity_id must be a valid ULID' };
        }

        const currentRow = this.db.getMaterialProjection(entity_id);
        const currentState = currentRow ? currentRow.attribution_state : null;

        // from_state must truthfully match the current projection state
        if (currentState && from_state !== currentState) {
            return {
                success: false,
                error: `from_state mismatch: current attribution_state is ${currentState}, request said ${from_state}`
            };
        }

        const transitionCheck = validateAttributionTransition(from_state, to_state);
        if (!transitionCheck.valid) {
            // Reject AND record the rejected request (honest full chain)
            const rejection = await this.eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: source_id || entity_id,
                event_type: 'material.attribution.transition_rejected',
                payload_json: {
                    entity_id,
                    target_ref: target_ref || null,
                    requested_from_state: from_state,
                    requested_to_state: to_state,
                    reason: transitionCheck.error,
                    assertion_attribution: currentState || from_state || 'ai_proposed'
                }
            });
            return {
                success: false,
                error: transitionCheck.error,
                rejected: true,
                rejection_event_id: rejection.success ? rejection.event_id : null
            };
        }

        const payload = {
            entity_id,
            target_ref,
            from_state,
            to_state,
            evidence_ref,
            assertion_attribution: to_state
        };

        const check = validateMaterialEventPayload('material.attribution.transitioned', payload);
        if (!check.valid) {
            return { success: false, error: check.errors.join(', ') };
        }

        const result = await this.eventProcessor.ingestEvent({
            event_id: generateULID(),
            source_id: source_id || entity_id,
            event_type: 'material.attribution.transitioned',
            payload_json: payload
        });

        if (!result.success) return result;
        return { success: true, event_id: result.event_id, from_state, to_state };
    }

    /**
     * Continuation point ("接续点") for later resumption.
     */
    async createContinuationPoint({ entity_id, from_event_id, context_ref, assertion_attribution, source_id = null }) {
        const payload = { entity_id, from_event_id, context_ref, assertion_attribution };

        const check = validateMaterialEventPayload('material.continuation_point.created', payload);
        if (!check.valid) {
            return { success: false, error: check.errors.join(', ') };
        }

        const result = await this.eventProcessor.ingestEvent({
            event_id: generateULID(),
            source_id: source_id || entity_id,
            event_type: 'material.continuation_point.created',
            payload_json: payload
        });

        if (!result.success) return result;
        return { success: true, event_id: result.event_id };
    }

    /**
     * Record a sync fact (material.sync.pushed / material.sync.pulled_back /
     * material.sync.conflict_detected). Sync facts describe things that
     * verifiably happened, so they default to reality_verified.
     */
    async recordSyncEvent(eventType, payload, source_id = null) {
        const fullPayload = {
            assertion_attribution: 'reality_verified',
            ...payload
        };

        const check = validateMaterialEventPayload(eventType, fullPayload);
        if (!check.valid) {
            return { success: false, error: check.errors.join(', ') };
        }

        const result = await this.eventProcessor.ingestEvent({
            event_id: generateULID(),
            source_id: source_id || fullPayload.entity_id,
            event_type: eventType,
            payload_json: fullPayload
        });

        if (!result.success) return result;
        return { success: true, event_id: result.event_id };
    }

    /**
     * Query projections (single entity or all) plus the material event log.
     */
    queryMaterials(entityId = null) {
        if (entityId) {
            const projection = this.db.getMaterialProjection(entityId);
            const events = this.db.getAllRawEventsOfType('material.')
                .filter(e => {
                    const p = parsePayload(e.payload_json);
                    return p && p.entity_id === entityId;
                });
            return { success: true, projection: projection || null, events };
        }

        return {
            success: true,
            projections: this.db.getAllMaterialProjections(),
            event_count: this.db.getAllRawEventsOfType('material.').length
        };
    }
}

module.exports = {
    sha256,
    parsePayload,
    createEmptyProjection,
    projectionFromRow,
    applyMaterialEvent,
    reduceMaterialEvents,
    applyEventToDb,
    MaterialProcessor
};
