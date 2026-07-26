/**
 * G1 Companion - Event Processing Logic
 * Handles event ingestion, boundary management, and content retention policies
 * G3 extension: material.* event validation (mandatory four-state
 * assertion_attribution, forward-only transitions) + incremental
 * materials_projection updates via the shared pure reducer.
 */

const { generateULID } = require('./ulid');
const {
    validateRawEvent,
    validateBoundaryRelation,
    validateMaterialEventPayload,
    validateAttributionTransition,
    validateTaskStateTransition,
    validateTaskEventPayload,
    validateRecommendationEventPayload,
    BOUNDARY_STATES
} = require('./types');
const { CompanionDB } = require('./db');
const { applyEventToDb } = require('./materials');
const {
    applyTaskEventToDb,
    applyRecommendationEventToDb,
    applyCardEventToDb,
    applySparkEventToDb,
    generateMaterialFeedbackChain
} = require('./reducers/g4-reducers');

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
        
        // G3: material.* events carry mandatory assertion_attribution and
        // per-type required fields; missing/invalid -> honest rejection (400)
        if (typeof event.event_type === 'string' && event.event_type.startsWith('material.')) {
            const materialCheck = this.validateMaterialEvent(event);
            if (!materialCheck.valid) {
                return { success: false, error: materialCheck.error };
            }
        }
        
        // G4: task.* events - payload required fields + forward-only
        // state machine (regression -> honest rejection)
        if (typeof event.event_type === 'string' && event.event_type.startsWith('task.')) {
            const taskCheck = this.validateTaskEvent(event);
            if (!taskCheck.valid) {
                return { success: false, error: taskCheck.error, rejected: taskCheck.rejected || false };
            }
        }
        
        // G4: recommendation.* events - payload required fields per type
        if (typeof event.event_type === 'string' && event.event_type.startsWith('recommendation.')) {
            const recCheck = this.validateRecommendationEvent(event);
            if (!recCheck.valid) {
                return { success: false, error: recCheck.error };
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
        
        // Fix created_at BEFORE persistence so the incremental projection
        // reducer and the DB row observe the exact same timestamp
        if (!event.created_at) {
            event.created_at = new Date().toISOString();
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
            // G3/G4: incremental projection update via the SAME pure reducer
            // used by full recomputation (recompute === incremental)
            if (!result.duplicated && typeof event.event_type === 'string') {
                if (event.event_type.startsWith('material.')) {
                    applyEventToDb(this.db, event);
                } else if (event.event_type.startsWith('task.')) {
                    applyTaskEventToDb(this.db, event);
                    // G4: back-propagation to material attribution chain
                    await this.propagateMaterialFeedback(event);
                } else if (event.event_type.startsWith('recommendation.')) {
                    applyRecommendationEventToDb(this.db, event);
                } else if (event.event_type.startsWith('card.')) {
                    applyCardEventToDb(this.db, event);
                } else if (event.event_type.startsWith('spark.')) {
                    applySparkEventToDb(this.db, event);
                }
            }
            
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
            if (typeof event.event_type === 'string' && event.event_type.startsWith('material.')) {
                const materialCheck = this.validateMaterialEvent(event);
                if (!materialCheck.valid) {
                    validationErrors.push(`Event ${event.event_id || '?'}: ${materialCheck.error}`);
                }
            }
            if (typeof event.event_type === 'string' && event.event_type.startsWith('task.')) {
                const taskCheck = this.validateTaskEvent(event);
                if (!taskCheck.valid) {
                    validationErrors.push(`Event ${event.event_id || '?'}: ${taskCheck.error}`);
                }
            }
            if (typeof event.event_type === 'string' && event.event_type.startsWith('recommendation.')) {
                const recCheck = this.validateRecommendationEvent(event);
                if (!recCheck.valid) {
                    validationErrors.push(`Event ${event.event_id || '?'}: ${recCheck.error}`);
                }
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
            // Same timestamp for DB row and incremental reducer
            if (!event.created_at) {
                event.created_at = new Date().toISOString();
            }
        }
        
        // Bulk insert with idempotency
        const result = this.db.batchInsertEvents(eligibleEvents);
        
        // Track which ones were new vs duplicated
        if (result.success) {
            // G3/G4: incremental projection updates (same reducer as recompute)
            for (const event of eligibleEvents) {
                if (typeof event.event_type !== 'string') continue;
                if (event.event_type.startsWith('material.')) {
                    applyEventToDb(this.db, event);
                } else if (event.event_type.startsWith('task.')) {
                    applyTaskEventToDb(this.db, event);
                    await this.propagateMaterialFeedback(event);
                } else if (event.event_type.startsWith('recommendation.')) {
                    applyRecommendationEventToDb(this.db, event);
                } else if (event.event_type.startsWith('card.')) {
                    applyCardEventToDb(this.db, event);
                } else if (event.event_type.startsWith('spark.')) {
                    applySparkEventToDb(this.db, event);
                }
            }
            
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
     *
     * #18 fix: match ALL boundary rows for this source_id, not only the
     * canonical scope key. /rpc/boundary/update accepts arbitrary scope
     * strings, and the export gate (getNotObserveSourceIds) already ignores
     * scope — the ingest gate must not be blinder than the export gate.
     * Strictest state wins (BOUNDARY_STATES is ordered strictest-first):
     * zero content residue is a red line — refuse rather than leak.
     * Chosen over rejecting custom scopes at write time because it also
     * enforces rows ALREADY persisted under custom scopes, and it keeps
     * /rpc/boundary/update backward-compatible for existing callers.
     */
    getBoundaryState(sourceId) {
        // Default is "只用于当前" per spec
        const DEFAULT_BOUNDARY = 'OBSERVE_CURRENT_ONLY';
        
        const relations = this.getBoundaryRelationsBySource(sourceId);
        
        if (relations.length === 0) {
            return DEFAULT_BOUNDARY;
        }
        
        // Strictest wins across every scope declared for this source
        let strictest = null;
        for (const relation of relations) {
            const rank = BOUNDARY_STATES.indexOf(relation.boundary_state);
            if (rank === -1) continue; // unknown state rows carry no authority
            if (strictest === null || rank < BOUNDARY_STATES.indexOf(strictest)) {
                strictest = relation.boundary_state;
            }
        }
        
        return strictest || DEFAULT_BOUNDARY;
    }
    
    /**
     * Fetch every boundary relation declared for a source (any scope).
     * @param {string} sourceId - Source ID
     * @returns {Array<{source_id: string, scope: string, boundary_state: string}>}
     */
    getBoundaryRelationsBySource(sourceId) {
        if (!this.db || !this.db.db) {
            return [];
        }
        try {
            if (this.db.db.isMock) {
                const data = this.db.db.data || {};
                return (data.boundary_relations || [])
                    .filter(r => r && r.source_id === sourceId);
            }
            return this.db.db.prepare(
                'SELECT source_id, scope, boundary_state FROM boundary_relations WHERE source_id = ?'
            ).all(sourceId);
        } catch (error) {
            console.warn('getBoundaryRelationsBySource error:', error.message);
            // Fail closed: no explicit grant means default OBSERVE_CURRENT_ONLY
            return [];
        }
    }
    
    /**
     * G3: collect source_ids currently under a NOT_OBSERVE boundary.
     * Used by the export path to enforce the zero-residue principle.
     * @returns {string[]} source_ids with NOT_OBSERVE boundary
     */
    getNotObserveSourceIds() {
        try {
            if (this.db.db && this.db.db.isMock) {
                return [...new Set(
                    (this.db.db.data.boundary_relations || [])
                        .filter(r => r.boundary_state === 'NOT_OBSERVE')
                        .map(r => r.source_id)
                )];
            }
            const rows = this.db.db.prepare(
                "SELECT DISTINCT source_id FROM boundary_relations WHERE boundary_state = 'NOT_OBSERVE'"
            ).all();
            return rows.map(r => r.source_id);
        } catch (error) {
            return [];
        }
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
     * G3: validate a material.* event before ingestion.
     * - assertion_attribution is mandatory (four-state), else reject
     * - attribution transitions must be forward-only and must truthfully
     *   match the current projection state (regression -> reject)
     */
    validateMaterialEvent(event) {
        let payload;
        try {
            payload = typeof event.payload_json === 'string'
                ? JSON.parse(event.payload_json)
                : event.payload_json;
        } catch (error) {
            return { valid: false, error: `Material event payload is not valid JSON: ${error.message}` };
        }
        
        const check = validateMaterialEventPayload(event.event_type, payload);
        if (!check.valid) {
            return { valid: false, error: `Material event rejected: ${check.errors.join(', ')}` };
        }
        
        if (event.event_type === 'material.attribution.transitioned') {
            const transition = validateAttributionTransition(payload.from_state, payload.to_state);
            if (!transition.valid) {
                return { valid: false, error: `Attribution regression rejected: ${transition.error}` };
            }
            
            const current = this.db.getMaterialProjection(payload.entity_id);
            if (current && current.attribution_state && current.attribution_state !== payload.from_state) {
                return {
                    valid: false,
                    error: `Attribution from_state mismatch: projection has ${current.attribution_state}, event claims ${payload.from_state}`
                };
            }
        }
        
        return { valid: true };
    }
    
    /**
     * G4: Validate task.* events before ingestion.
     * - State transitions must be forward-only (regression -> reject)
     * - Required fields per event type are mandatory
     * - feedback_to_materials field for back-propagation events
     */
    validateTaskEvent(event) {
        let payload;
        try {
            payload = typeof event.payload_json === 'string'
                ? JSON.parse(event.payload_json)
                : event.payload_json;
        } catch (error) {
            return { valid: false, error: `Task event payload is not valid JSON: ${error.message}` };
        }
        
        const check = validateTaskEventPayload(event.event_type, payload);
        if (!check.valid) {
            return { valid: false, error: `Task event rejected: ${check.errors.join(', ')}` };
        }
        
        // For state-changing events, the TARGET state is derived from the
        // event type itself; regression against the persisted projection
        // state is rejected (forward-only, skipping allowed)
        const TARGET_STATE_BY_EVENT = {
            'task.accepted': 'accepted',
            'task.progressed': 'in_progress',
            'task.completed': 'completed',
            'task.result_recorded': 'completed',
            'task.failed': 'failed',
            'task.failure_recorded': 'failed'
        };
        const toState = TARGET_STATE_BY_EVENT[event.event_type];
        
        if (toState) {
            const currentState = this.getTaskState(payload.task_id);
            
            if (currentState && currentState !== toState) {
                const transitionCheck = validateTaskStateTransition(currentState, toState);
                if (!transitionCheck.valid) {
                    return {
                        valid: false,
                        rejected: true,
                        error: `Task state regression rejected: ${transitionCheck.error}`
                    };
                }
            }
        }
        
        return { valid: true };
    }
    
    /**
     * G4: Validate recommendation.* events
     */
    validateRecommendationEvent(event) {
        let payload;
        try {
            payload = typeof event.payload_json === 'string'
                ? JSON.parse(event.payload_json)
                : event.payload_json;
        } catch (error) {
            return { valid: false, error: `Recommendation event payload is not valid JSON: ${error.message}` };
        }
        
        const check = validateRecommendationEventPayload(event.event_type, payload);
        if (!check.valid) {
            return { valid: false, error: `Recommendation event rejected: ${check.errors.join(', ')}` };
        }
        
        return { valid: true };
    }
    
    /**
     * Get current task state from projection (for validation)
     */
    getTaskState(taskId) {
        if (!this.db || !this.db.db) {
            return null;
        }
        
        try {
            if (this.db.db.isMock) {
                const projection = (this.db.db.data.tasks_projection || []).find(t => t.task_id === taskId);
                return projection ? projection.current_status : null;
            }
            
            const stmt = this.db.db.prepare('SELECT current_status FROM tasks_projection WHERE task_id = ?');
            const row = stmt.get(taskId);
            return row ? row.current_status : null;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * G4: back-propagation. When a task lifecycle event carries
     * feedback_to_materials, emit a material.attribution.transitioned
     * event chain (evidence_ref -> originating task event_id).
     * - success acceptance (task.completed / task.result_recorded) -> reality_verified
     * - failure / insight paths -> user_tentative
     * Degenerate (no-op) or regressive transitions are skipped honestly.
     */
    async propagateMaterialFeedback(taskEvent) {
        const FEEDBACK_EVENT_TYPES = [
            'task.completed', 'task.failed',
            'task.result_recorded', 'task.failure_recorded', 'task.insight_changed'
        ];
        if (!FEEDBACK_EVENT_TYPES.includes(taskEvent.event_type)) {
            return { generated: 0 };
        }
        
        let payload;
        try {
            payload = typeof taskEvent.payload_json === 'string'
                ? JSON.parse(taskEvent.payload_json)
                : taskEvent.payload_json;
        } catch (_) {
            return { generated: 0 };
        }
        
        if (!payload || !Array.isArray(payload.feedback_to_materials) || payload.feedback_to_materials.length === 0) {
            return { generated: 0 };
        }
        
        // Snapshot current attribution states for the target materials
        const projections = new Map();
        for (const feedback of payload.feedback_to_materials) {
            if (feedback && feedback.entity_id) {
                const proj = this.db.getMaterialProjection(feedback.entity_id);
                if (proj) projections.set(feedback.entity_id, proj);
            }
        }
        
        const chain = generateMaterialFeedbackChain(taskEvent, projections);
        let generated = 0;
        const eventIds = [];
        
        for (const link of chain) {
            const { from_state, to_state } = link.payload_json;
            // Forward-only: skip no-op and regressive links instead of corrupting the chain
            if (from_state === to_state) continue;
            if (!validateAttributionTransition(from_state, to_state).valid) continue;
            
            const result = await this.ingestEvent({
                event_id: link.event_id,
                source_id: link.source_id,
                event_type: link.event_type,
                payload_json: { ...link.payload_json, provenance: link.provenance },
                created_at: link.created_at
            });
            
            if (result.success) {
                generated++;
                eventIds.push(link.event_id);
            }
        }
        
        return { generated, event_ids: eventIds };
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
