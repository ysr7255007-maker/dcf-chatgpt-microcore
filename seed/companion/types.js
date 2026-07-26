/**
 * G1 Companion - Type Validation (Zero Dependency)
 * Manual JSON Schema-like validation without external dependencies
 */

const { isValidULID } = require('./ulid');

// Boundary state constants
const BOUNDARY_STATES = ['NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'];

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
    
    // Pattern: lowercase words separated by dots
    if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(eventType)) {
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

module.exports = {
    validateSHA256,
    validateEventType,
    validateBoundaryState,
    validatePayload,
    validateISO8601,
    validateSequenceNumber,
    validateRawEvent,
    validateBoundaryRelation,
    validateRPCRequest,
    BOUNDARY_STATES
};
