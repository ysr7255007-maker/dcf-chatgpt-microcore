/**
 * G1 Companion - Event Processing Logic
 * Handles event ingestion, boundary management, and content retention policies
 */

const { generateULID } = require('./ulid');
const { validateRawEvent, validateBoundaryRelation, BOUNDARY_STATES } = require('./types');
const { CompanionDB } = require('./db');

class EventProcessor {
    constructor(db) {
        if (!(db instanceof CompanionDB)) {
            throw new Error('db must be an instance of CompanionDB');
        }
        
        this.db = db;
        
        // Content retention policy enforcement
        this.CONTENT_RETENTION_POLICY = 'NONE'; // No content persisted except what's necessary
    }
    
    /**
     * Ingest a single event
     * @param {Object} event - Event to ingest
     * @param {boolean} options.validateSchema - Whether to validate schema (default: true)
     * @returns {{success: boolean, event_id?: string, error?: string, duplicated?: boolean}}
     */
    async ingestEvent(event, options = {}) {
        const validate = options.validateSchema !== false;
        
        // Validate event structure
        if (validate) {
            const validation = validateRawEvent(event);
            if (!validation.valid) {
                return { 
                    success: false, 
                    error: `Event validation failed: ${validation.errors.join(', ')}` 
                };
            }
        }
        
        // Check for "don't read" content retention policy
        if (this.isContentRetentionBlocked(event)) {
            return {
                success: false,
                error: 'Content retention policy blocks persisting content without observer consent'
            };
        }
        
        // Generate event_id if not provided (client doesn't provide one)
        if (!event.event_id || typeof event.event_id !== 'string') {
            event.event_id = generateULID();
        } else if (!validateRawEvent(event).valid) {
            return {
                success: false,
                error: 'Invalid event_id format'
            };
        }
        
        // Ensure source_id exists and is valid ULID
        if (!event.source_id || !this.isValidULID(event.source_id)) {
            return {
                success: false,
                error: 'source_id must be a valid ULID'
            };
        }
        
        // Check boundary state before processing
        const boundaryState = this.getBoundaryState(event.source_id);
        if (boundaryState === 'NOT_OBSERVE') {
            // Only allow boundary-setting events
            if (!this.isBoundarySettingEvent(event)) {
                return {
                    success: false,
                    error: `Source ${event.source_id} has NOT_OBSERVE boundary. Only boundary-setting events allowed.`
                };
            }
        }
        
        // Persist the event (idempotent by event_id)
        const result = this.db.insertEvent(event);
        
        if (result.success) {
            // Update boundary for derived entities if any
            await this.processInheritance(event);
            
            // Set default boundary if not exists ("只用于当前")
            await this.ensureDefaultBoundary(event.source_id);
        }
        
        return result;
    }
    
    /**
     * Batch ingest events
     * @param {Array} events - Events to ingest
     * @returns {{success: boolean, inserted: number, errors: string[], event_ids?: string[]}}
     */
    async batchIngestEvents(events) {
        if (!Array.isArray(events)) {
            return { success: false, inserted: 0, errors: ['Events must be an array'] };
        }
        
        // Validate all events first
        const validationErrors = [];
        for (const event of events) {
            const validation = validateRawEvent(event);
            if (!validation.valid) {
                validationErrors.push(`Event ${event.event_id || '?'}: ${validation.errors.join(', ')}`);
            }
        }
        
        if (validationErrors.length > 0) {
            return { success: false, inserted: 0, errors: validationErrors };
        }
        
        // Filter out events that violate content retention
        const blockedEvents = [];
        const eligibleEvents = [];
        
        for (const event of events) {
            if (this.isContentRetentionBlocked(event)) {
                blockedEvents.push(event.event_id || '?');
            } else {
                eligibleEvents.push(event);
            }
        }
        
        if (blockedEvents.length > 0) {
            return {
                success: false,
                inserted: 0,
                errors: [`Content retention policy blocks ${blockedEvents.length} event(s)`]
            };
        }
        
        // Generate event_ids for those without
        for (const event of eligibleEvents) {
            if (!event.event_id) {
                event.event_id = generateULID();
            }
        }
        
        // Bulk insert with idempotency
        const result = this.db.batchInsertEvents(eligibleEvents);
        
        // Track which ones were new vs duplicated
        if (result.success) {
            await this.processInheritanceBatch(eligibleEvents);
            
            // Ensure default boundaries
            const sourceIds = [...new Set(eligibleEvents.map(e => e.source_id))];
            for (const sourceId of sourceIds) {
                await this.ensureDefaultBoundary(sourceId);
            }
        }
        
        return result;
    }
    
    /**
     * Query events by source
     * @param {string} sourceId - Source ID
     * @param {Object} options - Options
     * @returns {{success: boolean, events?: Array, error?: string}}
     */
    queryEventsBySource(sourceId, options = {}) {
        if (!this.isValidULID(sourceId)) {
            return { success: false, error: 'Invalid source_id format' };
        }
        
        try {
            const events = this.db.queryEventsBySource(sourceId, options);
            return { success: true, events };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Search events across all sources
     * @param {string} query - Search query
     * @param {number} limit - Max results (default 50)
     * @returns {{success: boolean, events?: Array, error?: string}}
     */
    searchEvents(query, limit = 50) {
        if (!query || typeof query !== 'string') {
            return { success: false, error: 'Query must be a non-empty string' };
        }
        
        try {
            const events = this.db.searchEvents(query, limit);
            return { success: true, events };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Set boundary state for a source/scope combination
     * @param {Object} relation - Boundary relation
     * @returns {{success: boolean, error?: string}}
     */
    setBoundary(relation) {
        const validation = validateBoundaryRelation(relation);
        if (!validation.valid) {
            return { success: false, error: `Validation failed: ${validation.errors.join(', ')}` };
        }
        
        // Enforce inheritance rule: children inherit parent's boundary unless explicitly overridden
        if (relation.inherited_from_event_ids && relation.inherited_from_event_ids.length > 0) {
            // Verify at least one parent exists and we have permission to inherit/override
            const hasValidParent = relation.inherited_from_event_ids.some(parentId => {
                if (this.db.db && this.db.db.isMock) {
                    return this.db.db.data.raw_events.some(e => e.event_id === parentId);
                }
                const row = this.db.db.prepare('SELECT 1 FROM raw_events WHERE event_id = ?').get(parentId);
                return !!row;
            });
            
            if (!hasValidParent) {
                return {
                    success: false,
                    error: 'At least one inherited_from_event_id must reference an existing event'
                };
            }
        }
        
        return this.db.setBoundaryRelation(relation);
    }
    
    /**
     * Get current boundary state for a source
     * @param {string} sourceId - Source ID
     * @returns {string} Boundary state or 'NOT_OBSERVE' as default
     */
    getBoundaryState(sourceId) {
        // Default is "只用于当前" per spec
        const DEFAULT_BOUNDARY = 'OBSERVE_CURRENT_ONLY';
        
        // Try to get explicit boundary
        const relation = this.db.getBoundaryRelation(sourceId, `${DEFAULT_BOUNDARY}:${sourceId}`);
        
        if (relation) {
            return relation.boundary_state;
        }
        
        return DEFAULT_BOUNDARY;
    }
    
    /**
     * Ensure default boundary exists for a source
     * @param {string} sourceId - Source ID
     */
    async ensureDefaultBoundary(sourceId) {
        if (!this.isValidULID(sourceId)) {
            return;
        }
        
        const scope = `OBSERVE_CURRENT_ONLY:${sourceId}`;
        const existing = this.db.getBoundaryRelation(sourceId, scope);
        
        if (!existing) {
            await this.setBoundary({
                source_id: sourceId,
                scope: scope,
                boundary_state: 'OBSERVE_CURRENT_ONLY',
                inherited_from_event_ids: []
            });
        }
    }
    
    /**
     * Process inheritance chain after event insertion
     * Children automatically inherit parent's boundary state
     * @param {Object} event - Inserted event
     */
    async processInheritance(event) {
        // If event payload contains derived entities, register their boundaries
        if (!event.payload_json) return;
        
        try {
            const payload = typeof event.payload_json === 'string'
                ? JSON.parse(event.payload_json)
                : event.payload_json;
            
            // Look for child entities in payload
            if (payload.children && Array.isArray(payload.children)) {
                for (const child of payload.children) {
                    if (child.id && this.isValidULID(child.id)) {
                        // Child inherits from parent unless explicitly stated otherwise
                        await this.setBoundary({
                            source_id: child.id,
                            scope: `inherits:${sourceId}`,
                            boundary_state: 'OBSERVE_CURRENT_ONLY', // Default inheritance
                            inherited_from_event_ids: [event.event_id]
                        });
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to process inheritance:', error.message);
        }
    }
    
    /**
     * Batch process inheritance
     */
    async processInheritanceBatch(events) {
        for (const event of events) {
            await this.processInheritance(event);
        }
    }
    
    /**
     * Check if event violates content retention policy
     * "不读取" content should not contain body/attachment/DOM snapshots
     * @param {Object} event - Event to check
     * @returns {boolean} True if content retention is blocked
     */
    isContentRetentionBlocked(event) {
        // If payload contains sensitive content markers but no authorized boundary
        if (event.payload_json) {
            try {
                const payload = typeof event.payload_json === 'string'
                    ? JSON.parse(event.payload_json)
                    : event.payload_json;
                
                // Check for content-sensitive fields that require authorization
                const sensitiveFields = ['body', 'attachment', 'dom_snapshot', 'raw_content'];
                for (const field of sensitiveFields) {
                    if (payload[field]) {
                        const boundaryState = this.getBoundaryState(event.source_id);
                        if (boundaryState === 'NOT_OBSERVE') {
                            return true;
                        }
                    }
                }
            } catch (error) {
                // Invalid JSON, let validator handle it
            }
        }
        
        return false;
    }
    
    /**
     * Check if event is a boundary-setting event
     * @param {Object} event - Event to check
     * @returns {boolean} True if this event sets/modifies boundaries
     */
    isBoundarySettingEvent(event) {
        // Events that modify boundaries are specifically designed to do so
        const boundaryEventTypes = [
            'system.boundary.created',
            'system.boundary.updated',
            'system.boundary.transferred',
            'auth.authorization.granted',
            'auth.authorization.revoke d'
        ];
        
        return boundaryEventTypes.includes(event.event_type);
    }
    
    /**
     * Materialize a computed projection/snapshot
     * @param {string} name - Projection name
     * @param {*} snapshotData - Snapshot data object
     * @returns {{success: boolean, snapshot_hash?: string, error?: string}}
     */
    materializeProjection(name, snapshotData) {
        try {
            const snapshotContent = JSON.stringify(snapshotData);
            const result = this.db.materializeView(name, snapshotContent);
            
            if (result.success) {
                return {
                    success: true,
                    snapshot_hash: result.snapshot_hash
                };
            } else {
                return { success: false, error: result.error };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Get database statistics
     * @returns {Object} Stats
     */
    getStats() {
        return this.db.getStats();
    }
    
    /**
     * Helper: Check ULID format
     */
    isValidULID(str) {
        // Re-implement here to avoid circular dependency
        return typeof str === 'string' && 
               str.length === 26 && 
               /^[0-9A-HJKMNP-TV-Z]{26}$/.test(str);
    }
}

module.exports = { EventProcessor };
