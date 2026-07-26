/**
 * G6 Companion - Personal Software Modification Core
 * 
 * Pure reducers for personal patch lifecycle management:
 * - 6-state status machine: proposed → validated → active → (needs_revalidation/reverted/superseded)
 * - Append-only revert semantics (never delete/overwrite)
 * - Environment health monitoring integration
 * - Zero npm dependencies.
 */

const { generateULID, isValidULID } = require('../ulid');

// G6: Patch status constants (6-state progression with branches)
const PATCH_STATUSES = {
    PROPOSED: 'proposed',
    VALIDATED: 'validated',
    ACTIVE: 'active',
    NEEDS_REVALIDATION: 'needs_revalidation',
    REVERTED: 'reverted',
    SUPERSEDED: 'superseded'
};

// G6: Environment health constants (4-state monitoring)
const ENV_HEALTH_STATUSES = {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
    UNKNOWN: 'unknown'
};

// G6: All patch-related event types
const PATCH_EVENT_TYPES = [
    'patch.proposed',
    'patch.validated',
    'patch.activated',
    'patch.deactivated',
    'patch.needs_revalidation',
    'patch.reverted',
    'patch.superseded',
    'env.health_checked',
    'env.health_changed'
];

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
 * Empty patch projection initial state.
 */
function createEmptyPatchProjection(patchId) {
    return {
        patch_id: patchId,
        title: null,
        description: null,
        patch_body_json: null,
        patch_status: PATCH_STATUSES.PROPOSED,
        environment_health: ENV_HEALTH_STATUSES.HEALTHY,
        source_ref: null,
        validated_by: null,
        validated_at: null,
        activated_at: null,
        reverted_at: null,
        superseded_by: null,
        validation_notes_json: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

/**
 * Convert DB row to reducer state.
 */
function patchFromRow(row) {
    if (!row) return null;
    
    let validationNotes = [];
    if (row.validation_notes_json) {
        try { validationNotes = JSON.parse(row.validation_notes_json) || []; } catch (_) { validationNotes = []; }
    }
    
    return {
        patch_id: row.patch_id,
        title: row.title || null,
        description: row.description || null,
        patch_body_json: row.patch_body_json || null,
        patch_status: row.patch_status || PATCH_STATUSES.PROPOSED,
        environment_health: row.environment_health || ENV_HEALTH_STATUSES.HEALTHY,
        source_ref: row.source_ref || null,
        validated_by: row.validated_by || null,
        validated_at: row.validated_at || null,
        activated_at: row.activated_at || null,
        reverted_at: row.reverted_at || null,
        superseded_by: row.superseded_by || null,
        validation_notes: validationNotes,
        last_updated_at: row.last_updated_at || row.updated_at || null
    };
}

/**
 * PURE reducer: apply one patch.* event to a patch projection.
 * State transitions:
 *   proposed → validated → active → needs_revalidation → validated (or back to proposed)
 *   active → reverted (creates superseded state via append-only)
 *   active → superseded by another patch
 */
function applyPatchEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.patch_id) return projection;
    
    const proj = projection || createEmptyPatchProjection(payload.patch_id);
    
    switch (event.event_type) {
        case 'patch.proposed':
            // Create or update proposal
            proj.title = payload.title || proj.title;
            proj.description = payload.description || proj.description;
            proj.patch_body_json = payload.patch_body_json || proj.patch_body_json;
            proj.source_ref = payload.source_ref || proj.source_ref;
            proj.patch_status = PATCH_STATUSES.PROPOSED;
            proj.updated_at = event.created_at;
            
            // Reset from previous states
            proj.validated_by = null;
            proj.validated_at = null;
            proj.activated_at = null;
            proj.reverted_at = null;
            proj.superseded_by = null;
            proj.validation_notes_json = null;
            break;
            
        case 'patch.validate':
            // Transition: proposed → validated
            if (proj.patch_status !== PATCH_STATUSES.PROPOSED && proj.patch_status !== PATCH_STATUSES.NEEDS_REVALIDATION) {
                console.warn(`Invalid validation transition from ${proj.patch_status}`);
                return proj;
            }
            proj.validated_by = payload.validated_by || proj.validated_by;
            proj.validated_at = event.created_at;
            if (payload.validation_notes_json) {
                proj.validation_notes_json = typeof payload.validation_notes_json === 'string'
                    ? payload.validation_notes_json
                    : JSON.stringify(payload.validation_notes_json);
            }
            proj.patch_status = PATCH_STATUSES.VALIDATED;
            proj.updated_at = event.created_at;
            break;
            
        case 'patch.activate':
            // Transition: validated → active
            if (proj.patch_status !== PATCH_STATUSES.VALIDATED) {
                console.warn(`Invalid activation transition from ${proj.patch_status}`);
                return proj;
            }
            proj.activated_at = event.created_at;
            proj.patch_status = PATCH_STATUSES.ACTIVE;
            proj.updated_at = event.created_at;
            break;
            
        case 'patch.deactivate':
        case 'patch.needs_revalidation':
            // Transition: active → needs_revalidation
            if (proj.patch_status !== PATCH_STATUSES.ACTIVE) {
                console.warn(`Invalid deactivation/revalidation transition from ${proj.patch_status}`);
                return proj;
            }
            proj.patch_status = PATCH_STATUSES.NEEDS_REVALIDATION;
            proj.updated_at = event.created_at;
            break;
            
        case 'patch.revalidate':
            // Transition: needs_revalidation → validated OR proposed (based on result)
            if (proj.patch_status !== PATCH_STATUSES.NEEDS_REVALIDATION) {
                console.warn(`Invalid revalidation transition from ${proj.patch_status}`);
                return proj;
            }
            
            // Determine target state based on result
            const validationResult = payload.validation_result || 'valid';
            if (validationResult === 'valid') {
                proj.patch_status = PATCH_STATUSES.VALIDATED;
                proj.validated_by = payload.validated_by || proj.validated_by;
                proj.validated_at = event.created_at;
                
                // Preserve or append validation notes
                if (payload.validation_notes_json) {
                    proj.validation_notes_json = typeof payload.validation_notes_json === 'string'
                        ? payload.validation_notes_json
                        : JSON.stringify(payload.validation_notes_json);
                }
            } else {
                proj.patch_status = PATCH_STATUSES.PROPOSED;
                proj.validated_by = null;
                proj.validated_at = null;
                proj.validation_notes_json = null;
            }
            proj.updated_at = event.created_at;
            break;
            
        case 'patch.revert':
            // Append-only revert: never overwrite active state, instead create reverted state
            if (proj.patch_status !== PATCH_STATUSES.ACTIVE && proj.patch_status !== PATCH_STATUSES.VALIDATED) {
                console.warn(`Invalid revert from ${proj.patch_status}`);
                return proj;
            }
            proj.reverted_at = event.created_at;
            proj.reverted_by = payload.reverted_by || proj.reverted_by;
            proj.revert_reason = payload.revert_reason || proj.revert_reason;
            proj.patch_status = PATCH_STATUSES.REVERTED;
            proj.updated_at = event.created_at;
            break;
            
        case 'patch.supersede':
            // Mark as superseded by another patch
            if (proj.patch_status !== PATCH_STATUSES.ACTIVE && proj.patch_status !== PATCH_STATUSES.VALIDATED) {
                console.warn(`Invalid supersede from ${proj.patch_status}`);
                return proj;
            }
            proj.superseded_by = payload.superseded_by_patch_id || proj.superseded_by;
            proj.superseded_at = event.created_at;
            proj.patch_status = PATCH_STATUSES.SUPERSEDED;
            proj.updated_at = event.created_at;
            break;
            
        default:
            break;
    }
    
    return proj;
}

/**
 * PURE full reduction: patch events (log order) -> Map<patch_id, projection>.
 */
function reducePatchEvents(events) {
    const map = new Map();
    
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        if (!payload || !payload.patch_id) continue;
        
        const next = applyPatchEvent(map.get(payload.patch_id), event);
        map.set(payload.patch_id, next);
    }
    
    return map;
}

/**
 * Environment health check reducer.
 */
function applyEnvHealthEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.patch_id) return projection;
    
    const proj = projection || createEmptyPatchProjection(payload.patch_id);
    
    switch (event.event_type) {
        case 'env.health_checked':
            // Update health status based on environment scan
            proj.environment_health = payload.health_status || proj.environment_health;
            proj.health_checked_at = event.created_at;
            proj.health_check_data_json = payload.health_data_json || null;
            proj.updated_at = event.created_at;
            break;
            
        case 'env.health_changed':
            // Log degradation/unhealthy states
            if (['degraded', 'unhealthy'].includes(payload.health_status)) {
                // Preserve existing health history or create new entry
                let healthHistory = [];
                try {
                    const historyJson = proj.health_history_json || '[]';
                    healthHistory = JSON.parse(historyJson);
                } catch (_) { healthHistory = []; }
                
                healthHistory.push({
                    timestamp: event.created_at,
                    status: payload.health_status,
                    reason: payload.reason || null,
                    affected_files: payload.affected_files || []
                });
                
                proj.health_history_json = JSON.stringify(healthHistory);
            }
            proj.updated_at = event.created_at;
            break;
            
        default:
            break;
    }
    
    return proj;
}

// Export constants and functions
module.exports = {
    // Constants
    PATCH_STATUSES,
    ENV_HEALTH_STATUSES,
    PATCH_EVENT_TYPES,
    
    // Reducers
    parsePayload,
    createEmptyPatchProjection,
    patchFromRow,
    applyPatchEvent,
    applyEnvHealthEvent,
    reducePatchEvents
};
