/**
 * G1 Companion - Type Validation (Zero Dependency)
 * Manual JSON Schema-like validation without external dependencies
 * G3 extension: attribution states + material event payload validation
 */

const { isValidULID } = require('./ulid');

// Boundary state constants
const BOUNDARY_STATES = ['NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'];

// G3: Attribution state constants (four-state progression, forward-only)
const ATTRIBUTION_STATES = ['ai_proposed', 'user_tentative', 'user_confirmed', 'reality_verified'];
const ATTRIBUTION_STATE_TRANSITIONS = {
    'ai_proposed': ['user_tentative', 'user_confirmed', 'reality_verified'],  // can skip levels
    'user_tentative': ['user_confirmed', 'reality_verified'],
    'user_confirmed': ['reality_verified'],
    'reality_verified': []  // terminal state
};

// G3: material event types that REQUIRE assertion_attribution in payload
const MATERIAL_EVENT_TYPES = [
    'material.revision_candidate.created',
    'material.continuation_point.created',
    'material.attribution.transitioned',
    'material.sync.pushed',
    'material.sync.pulled_back'
];

// G4: Task lifecycle states (five-state progression, forward-only, skipping allowed)
const TASK_STATES = ['proposed', 'accepted', 'in_progress', 'completed', 'failed'];
const TASK_STATE_TRANSITIONS = {
    'proposed': ['accepted', 'in_progress', 'completed', 'failed'],  // can skip levels
    'accepted': ['in_progress', 'completed', 'failed'],
    'in_progress': ['completed', 'failed'],
    'completed': [],  // terminal state
    'failed': []      // terminal state
};

// G4: Card processing states
const CARD_STATES = ['new', 'triaged', 'processed', 'archived'];

// G4: Spark validation states
const SPARK_STATES = ['emerging', 'validated', 'actionable', 'dismissed'];

// G4: Recommendation action states
const RECOMMENDATION_STATES = ['pending', 'accepted', 'dismissed', 'expired'];

// G4/G5: All task-related event types
const TASK_EVENT_TYPES = [
    'task.created',
    'task.accepted',
    'task.progressed',
    'task.completed',
    'task.failed',
    'task.checkpoint_saved',
    'task.result_recorded',
    'task.failure_recorded',
    'task.insight_changed',
    'task.rebind',
    // G5: Cross-executor collaboration audit events (pure event log, no state machine)
    'task.overreach_detected',
    'task.privilege_expansion_requested',
    'task.value_divergence_reported'
];

// G6: Personal software modification patch events
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

// G6: Patch status constants (6-state progression)
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

// G5: Severity levels for overreach detection
const OVERREACH_SEVERITIES = ['critical', 'warning'];

// G5: User decision states for privilege expansion requests
const PRIVILEGE_USER_DECISIONS = ['pending', 'approved', 'denied'];

// G5: Divergence categories for value divergence reports
const DIVERGENCE_CATEGORIES = ['scope', 'priority', 'method', 'other'];

// G4: All recommendation-related event types
const RECOMMENDATION_EVENT_TYPES = [
    'recommendation.proposed',
    'recommendation.accepted',
    'recommendation.dismissed',
    'recommendation.expired'
];

// G4: All card-related event types
const CARD_EVENT_TYPES = [
    'card.created'
];

// G4: All spark-related event types
const SPARK_EVENT_TYPES = [
    'spark.emerged'
];

/**
 * Validate SHA-256 hash format
 * @param {string} hash - SHA-256 hex string (64 characters)
 * @returns {{valid: boolean, error?: string}}
 */
function validateSHA256(hash) {
    if (typeof hash !== 'string') {
        return { valid: false, error: 'SHA-256 must be a string' };
    }
    
    if (hash.length !== 64 || !/^[a-f0-9]{64}$/.test(hash)) {
        return { valid: false, error: `Invalid SHA-256 format: ${hash}` };
    }
    
    return { valid: true };
}

/**
 * Validate event type format
 * @param {string} eventType - Event type (e.g., conversation.updated)
 * @returns {{valid: boolean, error?: string}}
 */
function validateEventType(eventType) {
    if (typeof eventType !== 'string' || eventType.trim() === '') {
        return { valid: false, error: 'Event type must be a non-empty string' };
    }
    
    // Pattern: lowercase words (underscores allowed inside a segment) separated by dots
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(eventType)) {
        return { valid: false, error: `Invalid event type format: ${eventType}` };
    }
    
    return { valid: true };
}

/**
 * Validate boundary state value
 * @param {string} state - Boundary state
 * @returns {{valid: boolean, error?: string}}
 */
function validateBoundaryState(state) {
    if (!BOUNDARY_STATES.includes(state)) {
        return {
            valid: false,
            error: `Invalid boundary state: ${state}. Must be one of: ${BOUNDARY_STATES.join(', ')}`
        };
    }
    
    return { valid: true };
}

/**
 * Validate JSON payload (basic structure check)
 * @param {*} payload - Payload to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validatePayload(payload) {
    // payload can be null for "don't read" events
    if (payload === null) {
        return { valid: true };
    }
    
    if (typeof payload !== 'object') {
        return { valid: false, error: 'Payload must be an object or null' };
    }
    
    return { valid: true };
}

/**
 * Validate ISO8601 timestamp
 * @param {string} timestamp - ISO8601 timestamp
 * @returns {{valid: boolean, error?: string}}
 */
function validateISO8601(timestamp) {
    if (typeof timestamp !== 'string') {
        return { valid: false, error: 'Timestamp must be a string' };
    }
    
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
        return { valid: false, error: `Invalid ISO8601 timestamp: ${timestamp}` };
    }
    
    return { valid: true };
}

/**
 * Validate sequence number (optional integer)
 * @param {*} seq - Sequence number
 * @returns {{valid: boolean, error?: string}}
 */
function validateSequenceNumber(seq) {
    if (seq === undefined || seq === null) {
        return { valid: true }; // Optional field
    }
    
    if (!Number.isInteger(seq) || seq < 0) {
        return { valid: false, error: 'Sequence number must be a non-negative integer' };
    }
    
    return { valid: true };
}

/**
 * Validate raw event structure
 * @param {Object} event - Raw event object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateRawEvent(event) {
    const errors = [];
    
    if (typeof event !== 'object' || event === null) {
        return { valid: false, errors: ['Event must be an object'] };
    }
    
    // Validate required fields
    if (!isValidULID(event.event_id)) {
        errors.push(`Invalid event_id: ${event.event_id}`);
    }
    
    if (!isValidULID(event.source_id)) {
        errors.push(`Invalid source_id: ${event.source_id}`);
    }
    
    const typeValidation = validateEventType(event.event_type);
    if (!typeValidation.valid) {
        errors.push(typeValidation.error);
    }
    
    const payloadValidation = validatePayload(event.payload_json);
    if (!payloadValidation.valid) {
        errors.push(payloadValidation.error);
    }
    
    // Validate optional sha256 if present
    if (event.sha256 !== undefined && event.sha256 !== null) {
        const shaValidation = validateSHA256(event.sha256);
        if (!shaValidation.valid) {
            errors.push(shaValidation.error);
        }
    }
    
    // Validate created_at if provided
    if (event.created_at !== undefined) {
        const timeValidation = validateISO8601(event.created_at);
        if (!timeValidation.valid) {
            errors.push(timeValidation.error);
        }
    }
    
    // Validate sequence_number if provided
    const seqValidation = validateSequenceNumber(event.sequence_number);
    if (!seqValidation.valid) {
        errors.push(seqValidation.error);
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate boundary relation structure
 * @param {Object} relation - Boundary relation object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateBoundaryRelation(relation) {
    const errors = [];
    
    if (typeof relation !== 'object' || relation === null) {
        return { valid: false, errors: ['Relation must be an object'] };
    }
    
    if (!isValidULID(relation.source_id)) {
        errors.push(`Invalid source_id: ${relation.source_id}`);
    }
    
    if (typeof relation.scope !== 'string' || relation.scope.trim() === '') {
        errors.push('Scope must be a non-empty string');
    }
    
    const stateValidation = validateBoundaryState(relation.boundary_state);
    if (!stateValidation.valid) {
        errors.push(stateValidation.error);
    }
    
    // Validate inherited_from_event_ids if present
    if (relation.inherited_from_event_ids !== undefined) {
        if (!Array.isArray(relation.inherited_from_event_ids)) {
            errors.push('inherited_from_event_ids must be an array');
        } else {
            for (let i = 0; i < relation.inherited_from_event_ids.length; i++) {
                if (!isValidULID(relation.inherited_from_event_ids[i])) {
                    errors.push(`Invalid ULID in inherited_from_event_ids[${i}]: ${relation.inherited_from_event_ids[i]}`);
                }
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate RPC request format
 * @param {Object} request - RPC request
 * @returns {{valid: boolean, errors: string[], method?: string, params?: Object, id?: string}}
 */
function validateRPCRequest(request) {
    const errors = [];
    
    if (typeof request !== 'object' || request === null) {
        return { valid: false, errors: ['RPC request must be an object'] };
    }
    
    // Validate JSON-RPC version
    if (request.jsonrpc !== '2.0') {
        errors.push('Invalid JSON-RPC version: must be "2.0"');
    }
    
    // Method is required for requests
    if (typeof request.method !== 'string' || request.method.trim() === '') {
        errors.push('Method must be a non-empty string');
    }
    
    // Params is optional
    let params = {};
    if (request.params !== undefined) {
        if (typeof request.params !== 'object' || request.params === null) {
            errors.push('Params must be an object or omitted');
        } else {
            params = request.params;
        }
    }
    
    // Id is required and must be string or number
    let id = null;
    if (request.id === undefined) {
        errors.push('Id is required');
    } else if (typeof request.id !== 'string' && typeof request.id !== 'number') {
        errors.push('Id must be a string or number');
    } else {
        id = request.id;
    }
    
    return {
        valid: errors.length === 0,
        errors,
        method: request.method,
        params,
        id
    };
}

/**
 * Validate attribution state value (G3)
 * @param {string} state - Attribution state
 * @returns {{valid: boolean, error?: string}}
 */
function validateAttributionState(state) {
    if (!ATTRIBUTION_STATES.includes(state)) {
        return {
            valid: false,
            error: `Invalid attribution state: ${state}. Must be one of: ${ATTRIBUTION_STATES.join(', ')}`
        };
    }
    
    return { valid: true };
}

/**
 * Validate attribution state transition (forward-only, can skip levels)
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {{valid: boolean, error?: string}}
 */
function validateAttributionTransition(fromState, toState) {
    if (!validateAttributionState(fromState).valid) {
        return { valid: false, error: `Invalid fromState: ${fromState}` };
    }
    
    if (!validateAttributionState(toState).valid) {
        return { valid: false, error: `Invalid toState: ${toState}` };
    }
    
    const allowedTransitions = ATTRIBUTION_STATE_TRANSITIONS[fromState];
    if (!allowedTransitions.includes(toState)) {
        return {
            valid: false,
            error: `Cannot transition from ${fromState} to ${toState}. Allowed: ${allowedTransitions.join(', ') || '(none, terminal state)'}`
        };
    }
    
    return { valid: true };
}

/**
 * Validate a material.* event payload (G3).
 * assertion_attribution is MANDATORY for every material event; per-type
 * required fields are checked so ingest can reject with a truthful error.
 * @param {string} eventType - material.* event type
 * @param {Object|null} payload - parsed payload object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateMaterialEventPayload(eventType, payload) {
    const errors = [];

    if (payload === null || typeof payload !== 'object') {
        return { valid: false, errors: ['Material events require a payload object'] };
    }

    // Four-state attribution is mandatory for ALL material events
    if (!payload.assertion_attribution) {
        errors.push(`Material event ${eventType} missing required field: assertion_attribution (must be one of ${ATTRIBUTION_STATES.join(', ')})`);
    } else if (!ATTRIBUTION_STATES.includes(payload.assertion_attribution)) {
        errors.push(`Invalid assertion_attribution: ${payload.assertion_attribution}. Must be one of: ${ATTRIBUTION_STATES.join(', ')}`);
    }

    if (!payload.entity_id || !isValidULID(payload.entity_id)) {
        errors.push(`Material event ${eventType} requires a valid ULID entity_id`);
    }

    switch (eventType) {
        case 'material.revision_candidate.created':
            if (typeof payload.candidate_body !== 'string') {
                errors.push('material.revision_candidate.created requires candidate_body (string)');
            }
            if (payload.candidate_sha256 !== undefined && payload.candidate_sha256 !== null) {
                const shaCheck = validateSHA256(payload.candidate_sha256);
                if (!shaCheck.valid) errors.push(shaCheck.error);
            }
            if (payload.base_sha256 !== undefined && payload.base_sha256 !== null) {
                const baseCheck = validateSHA256(payload.base_sha256);
                if (!baseCheck.valid) errors.push(baseCheck.error);
            }
            if (payload.source_ref === undefined || payload.source_ref === null || payload.source_ref === '') {
                errors.push('material.revision_candidate.created requires source_ref (provenance)');
            }
            break;

        case 'material.continuation_point.created':
            if (!payload.from_event_id || !isValidULID(payload.from_event_id)) {
                errors.push('material.continuation_point.created requires a valid ULID from_event_id');
            }
            if (payload.context_ref === undefined || payload.context_ref === null || payload.context_ref === '') {
                errors.push('material.continuation_point.created requires context_ref');
            }
            break;

        case 'material.attribution.transitioned':
            if (!payload.from_state || !ATTRIBUTION_STATES.includes(payload.from_state)) {
                errors.push('material.attribution.transitioned requires valid from_state');
            }
            if (!payload.to_state || !ATTRIBUTION_STATES.includes(payload.to_state)) {
                errors.push('material.attribution.transitioned requires valid to_state');
            }
            if (payload.target_ref === undefined || payload.target_ref === null || payload.target_ref === '') {
                errors.push('material.attribution.transitioned requires target_ref');
            }
            break;

        case 'material.sync.pushed':
        case 'material.sync.pulled_back':
            if (!payload.remote || typeof payload.remote !== 'string') {
                errors.push(`${eventType} requires remote (repository reference)`);
            }
            break;

        default:
            break;
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate task state transition (forward-only, can skip levels)
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {{valid: boolean, error?: string}}
 */
function validateTaskStateTransition(fromState, toState) {
    if (!TASK_STATES.includes(fromState)) {
        return { valid: false, error: `Invalid fromState: ${fromState}` };
    }
    
    if (!TASK_STATES.includes(toState)) {
        return { valid: false, error: `Invalid toState: ${toState}` };
    }
    
    const allowedTransitions = TASK_STATE_TRANSITIONS[fromState];
    if (!allowedTransitions.includes(toState)) {
        return {
            valid: false,
            error: `Cannot transition task from ${fromState} to ${toState}. Allowed: ${allowedTransitions.join(', ') || '(none, terminal state)'}`
        };
    }
    
    return { valid: true };
}

/**
 * Validate card state transition (sequential + archiving)
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {{valid: boolean, error?: string}}
 */
function validateCardStateTransition(fromState, toState) {
    if (!CARD_STATES.includes(fromState)) {
        return { valid: false, error: `Invalid fromState: ${fromState}` };
    }
    
    if (!CARD_STATES.includes(toState)) {
        return { valid: false, error: `Invalid toState: ${toState}` };
    }
    
    // Cards can only move forward or directly to archived
    const fromIndex = CARD_STATES.indexOf(fromState);
    const toIndex = CARD_STATES.indexOf(toState);
    
    if (toIndex < fromIndex && toState !== 'archived') {
        return {
            valid: false,
            error: `Cannot transition card from ${fromState} to ${toState}. Must progress forward or archive.`
        };
    }
    
    return { valid: true };
}

/**
 * Validate spark state transition
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {{valid: boolean, error?: string}}
 */
function validateSparkStateTransition(fromState, toState) {
    if (!SPARK_STATES.includes(fromState)) {
        return { valid: false, error: `Invalid fromState: ${fromState}` };
    }
    
    if (!SPARK_STATES.includes(toState)) {
        return { valid: false, error: `Invalid toState: ${toState}` };
    }
    
    // Sparks can only progress forward or be dismissed
    const fromIndex = SPARK_STATES.indexOf(fromState);
    const toIndex = SPARK_STATES.indexOf(toState);
    
    if (toIndex < fromIndex && toState !== 'dismissed') {
        return {
            valid: false,
            error: `Cannot transition spark from ${fromState} to ${toState}. Must progress forward or dismiss.`
        };
    }
    
    return { valid: true };
}

/**
 * Validate recommendation state transition
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {{valid: boolean, error?: string}}
 */
function validateRecommendationStateTransition(fromState, toState) {
    if (!RECOMMENDATION_STATES.includes(fromState)) {
        return { valid: false, error: `Invalid fromState: ${fromState}` };
    }
    
    if (!RECOMMENDATION_STATES.includes(toState)) {
        return { valid: false, error: `Invalid toState: ${toState}` };
    }
    
    // Recommendations can be accepted/dismissed at any time, or expire from pending
    if (fromState === 'pending') {
        if (['accepted', 'dismissed', 'expired'].includes(toState)) {
            return { valid: true };
        }
    }
    
    return { valid: true }; // Other transitions are implicitly allowed
}

/**
 * Validate task.* event payload (G4)
 * @param {string} eventType - task.* event type
 * @param {Object|null} payload - parsed payload object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateTaskEventPayload(eventType, payload) {
    const errors = [];
    
    if (payload === null || typeof payload !== 'object') {
        return { valid: false, errors: ['Task events require a payload object'] };
    }
    
    if (!payload.task_id || !isValidULID(payload.task_id)) {
        errors.push(`Task event ${eventType} requires a valid ULID task_id`);
    }
    
    // Common required fields for all task events
    if (payload.objective !== undefined && typeof payload.objective !== 'string') {
        errors.push(`Task event ${eventType} objective must be a string if provided`);
    }
    
    switch (eventType) {
        case 'task.created':
            if (!payload.objective || typeof payload.objective !== 'string') {
                errors.push('task.created requires objective (string)');
            }
            if (payload.bound_conversation_id && !isValidULID(payload.bound_conversation_id)) {
                errors.push('task.created bound_conversation_id must be a valid ULID if provided');
            }
            break;
            
        case 'task.accepted':
            // No additional required fields
            break;
            
        case 'task.progressed':
            if (!payload.progress_json || typeof payload.progress_json === 'string') {
                // Accept either JSON object or stringified JSON
                let progress;
                try {
                    progress = typeof payload.progress_json === 'string' 
                        ? JSON.parse(payload.progress_json) 
                        : payload.progress_json;
                } catch (_) {
                    errors.push('task.progressed progress_json must be valid JSON if string');
                }
            }
            break;
            
        case 'task.checkpoint_saved':
            if (!payload.checkpoint_id || !isValidULID(payload.checkpoint_id)) {
                errors.push('task.checkpoint_saved requires checkpoint_id (ULID)');
            }
            if (!payload.snapshot_json || typeof payload.snapshot_json !== 'string') {
                errors.push('task.checkpoint_saved requires snapshot_json (stringified JSON)');
            }
            break;
            
        case 'task.completed':
        case 'task.result_recorded':
            if (!payload.result_event_id || !isValidULID(payload.result_event_id)) {
                errors.push(`${eventType} requires result_event_id (ULID)`);
            }
            // feedback_to_materials field for back-propagation
            if (payload.feedback_to_materials !== undefined) {
                if (!Array.isArray(payload.feedback_to_materials)) {
                    errors.push(`${eventType} feedback_to_materials must be an array if provided`);
                }
            }
            break;
            
        case 'task.failed':
        case 'task.failure_recorded':
            if (!payload.failure_path_event_id || !isValidULID(payload.failure_path_event_id)) {
                errors.push(`${eventType} requires failure_path_event_id (ULID)`);
            }
            if (payload.feedback_to_materials !== undefined) {
                if (!Array.isArray(payload.feedback_to_materials)) {
                    errors.push(`${eventType} feedback_to_materials must be an array if provided`);
                }
            }
            break;
            
        case 'task.insight_changed':
            // No additional required fields
            break;
            
        case 'task.rebind':
            if (!payload.new_binding || typeof payload.new_binding !== 'object') {
                errors.push('task.rebind requires new_binding (object)');
            } else {
                const nb = payload.new_binding;
                if (!nb.execution_agent || typeof nb.execution_agent !== 'string') {
                    errors.push('task.rebind new_binding.execution_agent is required (string)');
                }
                if (nb.conversation_id !== null && nb.conversation_id !== undefined && !isValidULID(nb.conversation_id)) {
                    errors.push('task.rebind new_binding.conversation_id must be a valid ULID or null');
                }
                if (nb.conversation_url !== null && nb.conversation_url !== undefined && typeof nb.conversation_url !== 'string') {
                    errors.push('task.rebind new_binding.conversation_url must be a string or null');
                }
                if (!nb.user_confirmed_at || typeof nb.user_confirmed_at !== 'string') {
                    errors.push('task.rebind new_binding.user_confirmed_at is required (string)');
                }
                if (nb.reason !== undefined && nb.reason !== null && typeof nb.reason !== 'string') {
                    errors.push('task.rebind new_binding.reason must be a string if provided');
                }
            }
            break;
            
        case 'task.overreach_detected':
            if (!payload.objective || typeof payload.objective !== 'string') {
                errors.push('task.overreach_detected requires objective (string)');
            }
            if (!payload.executed_action || typeof payload.executed_action !== 'string') {
                errors.push('task.overreach_detected requires executed_action (string)');
            }
            if (payload.detection_evidence === undefined || payload.detection_evidence === null) {
                errors.push('task.overreach_detected requires detection_evidence');
            }
            if (!payload.detected_at || typeof payload.detected_at !== 'string') {
                errors.push('task.overreach_detected requires detected_at (string)');
            }
            if (!payload.detected_by || typeof payload.detected_by !== 'string') {
                errors.push('task.overreach_detected requires detected_by (string)');
            }
            if (!payload.severity || !OVERREACH_SEVERITIES.includes(payload.severity)) {
                errors.push(`task.overreach_detected severity must be one of: ${OVERREACH_SEVERITIES.join(', ')}`);
            }
            break;
            
        case 'task.privilege_expansion_requested':
            if (!payload.current_boundary || typeof payload.current_boundary !== 'string') {
                errors.push('task.privilege_expansion_requested requires current_boundary (string)');
            }
            if (!payload.requested_boundary || typeof payload.requested_boundary !== 'string') {
                errors.push('task.privilege_expansion_requested requires requested_boundary (string)');
            }
            if (!payload.justification || typeof payload.justification !== 'string') {
                errors.push('task.privilege_expansion_requested requires justification (string)');
            }
            if (!payload.requested_by || typeof payload.requested_by !== 'string') {
                errors.push('task.privilege_expansion_requested requires requested_by (string)');
            }
            if (!payload.user_decision || !PRIVILEGE_USER_DECISIONS.includes(payload.user_decision)) {
                errors.push(`task.privilege_expansion_requested user_decision must be one of: ${PRIVILEGE_USER_DECISIONS.join(', ')}`);
            }
            break;
            
        case 'task.value_divergence_reported':
            if (!payload.objective || typeof payload.objective !== 'string') {
                errors.push('task.value_divergence_reported requires objective (string)');
            }
            if (!payload.execution_divergence || typeof payload.execution_divergence !== 'string') {
                errors.push('task.value_divergence_reported requires execution_divergence (string)');
            }
            if (!payload.execution_rationale || typeof payload.execution_rationale !== 'string') {
                errors.push('task.value_divergence_reported requires execution_rationale (string)');
            }
            if (!payload.reported_by || typeof payload.reported_by !== 'string') {
                errors.push('task.value_divergence_reported requires reported_by (string)');
            }
            if (!payload.category || !DIVERGENCE_CATEGORIES.includes(payload.category)) {
                errors.push(`task.value_divergence_reported category must be one of: ${DIVERGENCE_CATEGORIES.join(', ')}`);
            }
            break;
            
        default:
            // Unknown task event type will be caught by event type validation
            break;
    }
    
    return { valid: errors.length === 0, errors };
}

/**
 * Validate patch status value (G6)
 * @param {string} status - Patch status
 * @returns {{valid: boolean, error?: string}}
 */
function validatePatchStatus(status) {
    if (!PATCH_STATUSES.PROPOSED && !PATCH_STATUSES.VALIDATED && 
        !PATCH_STATUSES.ACTIVE && !PATCH_STATUSES.NEEDS_REVALIDATION &&
        !PATCH_STATUSES.REVERTED && !PATCH_STATUSES.SUPERSEDED) {
        return {
            valid: false,
            error: `Invalid patch status: ${status}. Must be one of: ${Object.values(PATCH_STATUSES).join(', ')}`
        };
    }
    
    if (!Object.values(PATCH_STATUSES).includes(status)) {
        return {
            valid: false,
            error: `Invalid patch status: ${status}. Must be one of: ${Object.values(PATCH_STATUSES).join(', ')}`
        };
    }
    
    return { valid: true };
}

/**
 * Validate environment health status (G6)
 * @param {string} status - Environment health status
 * @returns {{valid: boolean, error?: string}}
 */
function validateEnvHealthStatus(status) {
    if (!Object.values(ENV_HEALTH_STATUSES).includes(status)) {
        return {
            valid: false,
            error: `Invalid environment health status: ${status}. Must be one of: ${Object.values(ENV_HEALTH_STATUSES).join(', ')}`
        };
    }
    
    return { valid: true };
}

/**
 * Validate patch.* event payload (G6)
 * @param {string} eventType - recommendation.* event type
 * @param {Object|null} payload - parsed payload object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePatchEventPayload(eventType, payload) {
    const errors = [];
    
    if (payload === null || typeof payload !== 'object') {
        return { valid: false, errors: ['Patch events require a payload object'] };
    }
    
    if (!payload.patch_id || !isValidULID(payload.patch_id)) {
        errors.push(`Patch event ${eventType} requires a valid ULID patch_id`);
    }
    
    switch (eventType) {
        case 'patch.proposed':
            if (!payload.title || typeof payload.title !== 'string') {
                errors.push('patch.proposed requires title (string)');
            }
            if (!payload.patch_body_json || typeof payload.patch_body_json !== 'string') {
                errors.push('patch.proposed requires patch_body_json (stringified JSON)');
            }
            if (payload.source_ref && !isValidULID(payload.source_ref)) {
                errors.push('patch.proposed source_ref must be a valid ULID if provided');
            }
            break;
            
        case 'patch.validate':
            if (!payload.validated_by || typeof payload.validated_by !== 'string') {
                errors.push('patch.validate requires validated_by (string)');
            }
            if (payload.validation_notes_json !== undefined) {
                if (typeof payload.validation_notes_json !== 'string') {
                    try {
                        JSON.parse(payload.validation_notes_json);
                    } catch (_) {
                        errors.push('patch.validate validation_notes_json must be valid JSON if string');
                    }
                }
            }
            break;
            
        case 'patch.activate':
            // No additional required fields
            break;
            
        case 'patch.deactivate':
        case 'patch.needs_revalidation':
            // No additional required fields
            break;
            
        case 'patch.revalidate':
            if (payload.validation_result && !['valid', 'invalid'].includes(payload.validation_result)) {
                errors.push('patch.revalidate validation_result must be "valid" or "invalid"');
            }
            if (payload.validation_result === 'valid' && !payload.validated_by) {
                errors.push('patch.revalidate requires validated_by when result is "valid"');
            }
            break;
            
        case 'patch.revert':
            if (!payload.reverted_by || typeof payload.reverted_by !== 'string') {
                errors.push('patch.revert requires reverted_by (string)');
            }
            if (payload.revert_reason !== undefined && payload.revert_reason !== null && typeof payload.revert_reason !== 'string') {
                errors.push('patch.revert revert_reason must be a string if provided');
            }
            break;
            
        case 'patch.supersede':
            if (!payload.superseded_by_patch_id || !isValidULID(payload.superseded_by_patch_id)) {
                errors.push('patch.supersede requires superseded_by_patch_id (valid ULID)');
            }
            break;
            
        case 'env.health_checked':
            if (!payload.health_status || !ENV_HEALTH_STATUSES[ENV_HEALTH_STATUSES.HEALTHY] && 
                !ENV_HEALTH_STATUSES.DEGRADED && !ENV_HEALTH_STATUSES.UNHEALTHY && !ENV_HEALTH_STATUSES.UNKNOWN) {
                errors.push('env.health_checked requires health_status (one of: healthy, degraded, unhealthy, unknown)');
            }
            if (payload.health_data_json !== undefined) {
                try {
                    JSON.parse(payload.health_data_json || '{}');
                } catch (_) {
                    errors.push('env.health_checked health_data_json must be valid JSON if string');
                }
            }
            break;
            
        case 'env.health_changed':
            if (!payload.health_status || !['degraded', 'unhealthy'].includes(payload.health_status)) {
                errors.push('env.health_changed requires health_status (degraded or unhealthy)');
            }
            if (payload.reason && typeof payload.reason !== 'string') {
                errors.push('env.health_changed reason must be a string if provided');
            }
            if (payload.affected_files && !Array.isArray(payload.affected_files)) {
                errors.push('env.health_changed affected_files must be an array if provided');
            }
            break;
            
        default:
            // Unknown patch event type will be caught by event type validation
            break;
    }
    
    return { valid: errors.length === 0, errors };
}

/**
 * Validate recommendation.* event payload (G4)
 * @param {string} eventType - recommendation.* event type
 * @param {Object|null} payload - parsed payload object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateRecommendationEventPayload(eventType, payload) {
    const errors = [];
    
    if (payload === null || typeof payload !== 'object') {
        return { valid: false, errors: ['Recommendation events require a payload object'] };
    }
    
    if (!payload.recommendation_id || !isValidULID(payload.recommendation_id)) {
        errors.push(`Recommendation event ${eventType} requires a valid ULID recommendation_id`);
    }
    
    switch (eventType) {
        case 'recommendation.proposed':
            // Full descriptor fields required only at proposal time
            if (!payload.source_entity_type || !['card', 'spark', 'task', 'system'].includes(payload.source_entity_type)) {
                errors.push(`Recommendation event ${eventType} requires source_entity_type (card|spark|task|system)`);
            }
            if (!payload.source_entity_id || !isValidULID(payload.source_entity_id)) {
                errors.push(`Recommendation event ${eventType} requires source_entity_id (ULID)`);
            }
            if (!payload.recommendation_text || typeof payload.recommendation_text !== 'string') {
                errors.push(`Recommendation event ${eventType} requires recommendation_text (string)`);
            }
            if (payload.materiality_score !== undefined && (typeof payload.materiality_score !== 'number' || payload.materiality_score < 0 || payload.materiality_score > 1)) {
                errors.push('recommendation.proposed materiality_score must be 0-1 if provided');
            }
            if (payload.priority_level !== undefined && (typeof payload.priority_level !== 'number' || payload.priority_level < 1 || payload.priority_level > 9)) {
                errors.push('recommendation.proposed priority_level must be 1-9 if provided');
            }
            break;
            
        case 'recommendation.accepted':
            if (payload.binding_context !== undefined && payload.binding_context !== null && typeof payload.binding_context !== 'string') {
                errors.push('recommendation.accepted binding_context must be a JSON string if provided');
            }
            break;
            
        case 'recommendation.dismissed':
            // Optional reason field
            break;
            
        case 'recommendation.expired':
            // No additional required fields
            break;
            
        default:
            break;
    }
    
    return { valid: errors.length === 0, errors };
}

module.exports = {
    validateSHA256,
    validateEventType,
    validateBoundaryState,
    validateAttributionState,
    validateAttributionTransition,
    validateMaterialEventPayload,
    validateTaskStateTransition,
    validateCardStateTransition,
    validateSparkStateTransition,
    validateRecommendationStateTransition,
    validateTaskEventPayload,
    validateRecommendationEventPayload,
    validatePatchEventPayload,
    validatePatchStatus,
    validateEnvHealthStatus,
    validateRawEvent,
    validateBoundaryRelation,
    validateRPCRequest,
    BOUNDARY_STATES,
    ATTRIBUTION_STATES,
    ATTRIBUTION_STATE_TRANSITIONS,
    MATERIAL_EVENT_TYPES,
    TASK_STATES,
    TASK_STATE_TRANSITIONS,
    CARD_STATES,
    SPARK_STATES,
    RECOMMENDATION_STATES,
    TASK_EVENT_TYPES,
    RECOMMENDATION_EVENT_TYPES,
    CARD_EVENT_TYPES,
    SPARK_EVENT_TYPES,
    OVERREACH_SEVERITIES,
    PRIVILEGE_USER_DECISIONS,
    DIVERGENCE_CATEGORIES,
    PATCH_EVENT_TYPES,
    PATCH_STATUSES,
    ENV_HEALTH_STATUSES
};
