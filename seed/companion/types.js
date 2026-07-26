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

module.exports = {
    validateSHA256,
    validateEventType,
    validateBoundaryState,
    validateAttributionState,
    validateAttributionTransition,
    validateMaterialEventPayload,
    validatePayload,
    validateISO8601,
    validateSequenceNumber,
    validateRawEvent,
    validateBoundaryRelation,
    validateRPCRequest,
    BOUNDARY_STATES,
    ATTRIBUTION_STATES,
    ATTRIBUTION_STATE_TRANSITIONS,
    MATERIAL_EVENT_TYPES
};
