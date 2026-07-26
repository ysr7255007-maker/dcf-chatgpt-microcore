/**
 * G4 Companion - Core Life Cycle Reducers
 * 
 * Pure reducers for:
 * - Task lifecycle progression (task.created → task.completed/task.failed)
 * - Recommendation lifecycle (recommendation.proposed → recommendation.accepted/dismissed)
 * - Card processing (card.created → processed/archived)
 * - Spark validation (spark.emerged → validated/actionable/dismissed)
 * - Back-propagation: material.attribution.transitioned event chains from feedback_to_materials
 * 
 * Attribution four-state machine (forward-only):
 *   ai_proposed -> user_tentative -> user_confirmed -> reality_verified
 * 
 * Zero npm dependencies.
 */

const { generateULID, isValidULID } = require('../ulid');
const { TASK_STATES, TASK_STATE_TRANSITIONS, CARD_STATES, SPARK_STATES, RECOMMENDATION_STATES } = require('../types');

function sha256(content) {
    const crypto = require('crypto');
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

// ============================================================================
// Task Lifecycle Reducer
// ============================================================================

/**
 * Empty task projection initial state.
 */
function createEmptyTaskProjection(taskId) {
    return {
        task_id: taskId,
        source_ref: null,
        objective: null,
        boundary_inherited_from: null,
        bound_conversation_id: null,
        bound_conversation_url: null,
        bound_execution_agent: null,
        current_status: 'proposed',
        progress_json: null,
        checkpoint_event_id: null,
        result_event_id: null,
        failure_path_event_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

/**
 * Convert DB row to reducer state.
 */
function taskFromRow(row) {
    if (!row) return null;
    
    let progress = [];
    if (row.progress_json) {
        try { progress = JSON.parse(row.progress_json) || []; } catch (_) { progress = []; }
    }
    
    return {
        task_id: row.task_id,
        source_ref: row.source_ref || null,
        objective: row.objective || null,
        boundary_inherited_from: row.boundary_inherited_from || null,
        bound_conversation_id: row.bound_conversation_id || null,
        bound_conversation_url: row.bound_conversation_url || null,
        bound_execution_agent: row.bound_execution_agent || null,
        current_status: row.current_status || 'proposed',
        progress: progress,
        checkpoint_event_id: row.checkpoint_event_id || null,
        result_event_id: row.result_event_id || null,
        failure_path_event_id: row.failure_path_event_id || null,
        last_updated_at: row.last_updated_at || row.updated_at || null
    };
}

/**
 * PURE reducer: apply one task.* event to a task projection.
 */
function applyTaskEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.task_id) return projection;
    
    const proj = projection || createEmptyTaskProjection(payload.task_id);
    
    switch (event.event_type) {
        case 'task.created':
            proj.objective = payload.objective || proj.objective;
            proj.source_ref = payload.source_ref || proj.source_ref;
            proj.bound_conversation_id = payload.bound_conversation_id || proj.bound_conversation_id;
            proj.bound_conversation_url = payload.bound_conversation_url || proj.bound_conversation_url;
            proj.bound_execution_agent = payload.bound_execution_agent || proj.bound_execution_agent;
            proj.boundary_inherited_from = payload.boundary_inherited_from || proj.boundary_inherited_from;
            break;
            
        case 'task.accepted':
            proj.current_status = 'accepted';
            proj.updated_at = event.created_at;
            break;
            
        case 'task.progressed':
            proj.current_status = 'in_progress';
            if (payload.progress_json) {
                proj.progress_json = typeof payload.progress_json === 'string' 
                    ? payload.progress_json 
                    : JSON.stringify(payload.progress_json);
            }
            proj.updated_at = event.created_at;
            break;
            
        case 'task.checkpoint_saved':
            proj.checkpoint_event_id = payload.checkpoint_id || proj.checkpoint_event_id;
            proj.updated_at = event.created_at;
            break;
            
        case 'task.completed':
        case 'task.result_recorded':
            proj.current_status = 'completed';
            proj.result_event_id = payload.result_event_id || proj.result_event_id;
            
            // Back-propagate feedback_to_materials chain
            if (payload.feedback_to_materials && Array.isArray(payload.feedback_to_materials)) {
                proj.material_feedback_chain = proj.material_feedback_chain || [];
                for (const feedback of payload.feedback_to_materials) {
                    proj.material_feedback_chain.push({
                        event_id: event.event_id,
                        event_type: 'task.result_recorded',
                        target_entity_id: feedback.entity_id,
                        attribution_state: 'reality_verified',
                        recorded_at: event.created_at
                    });
                }
            }
            proj.updated_at = event.created_at;
            break;
            
        case 'task.failed':
        case 'task.failure_recorded':
            proj.current_status = 'failed';
            proj.failure_path_event_id = payload.failure_path_event_id || proj.failure_path_event_id;
            
            // Back-propagate feedback_to_materials chain on failure too
            if (payload.feedback_to_materials && Array.isArray(payload.feedback_to_materials)) {
                proj.material_feedback_chain = proj.material_feedback_chain || [];
                for (const feedback of payload.feedback_to_materials) {
                    proj.material_feedback_chain.push({
                        event_id: event.event_id,
                        event_type: 'task.failure_recorded',
                        target_entity_id: feedback.entity_id,
                        attribution_state: 'user_tentative',  // Failure doesn't confirm reality
                        recorded_at: event.created_at
                    });
                }
            }
            proj.updated_at = event.created_at;
            break;
            
        case 'task.insight_changed':
            // May update objective or add insights
            if (payload.objective) proj.objective = payload.objective;
            proj.updated_at = event.created_at;
            break;
            
        case 'task.rebind':
            if (payload.new_binding) {
                proj.bound_conversation_id = payload.new_binding.conversation_id || proj.bound_conversation_id;
                proj.bound_execution_agent = payload.new_binding.execution_agent || proj.bound_execution_agent;
            }
            proj.updated_at = event.created_at;
            break;
            
        default:
            break;
    }
    
    return proj;
}

/**
 * PURE full reduction: task events (log order) -> Map<task_id, projection>.
 */
function reduceTaskEvents(events) {
    const map = new Map();
    
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        if (!payload || !payload.task_id) continue;
        
        const next = applyTaskEvent(map.get(payload.task_id), event);
        map.set(payload.task_id, next);
    }
    
    return map;
}

// ============================================================================
// Recommendation Lifecycle Reducer
// ============================================================================

/**
 * Empty recommendation projection initial state.
 */
function createEmptyRecommendationProjection(recId) {
    return {
        recommendation_id: recId,
        source_entity_type: null,
        source_entity_id: null,
        recommendation_text: null,
        suggested_action: null,
        target_material_ids: [],
        materiality_score: 0.5,
        priority_level: 5,
        status: 'pending',
        binding_context_json: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

/**
 * Convert DB row to reducer state.
 */
function recommendationFromRow(row) {
    if (!row) return null;
    
    let targetIds = [];
    if (row.target_material_ids) {
        try { targetIds = JSON.parse(row.target_material_ids) || []; } catch (_) { targetIds = []; }
    }
    
    return {
        recommendation_id: row.recommendation_id,
        source_entity_type: row.source_entity_type || null,
        source_entity_id: row.source_entity_id || null,
        recommendation_text: row.recommendation_text || null,
        suggested_action: row.suggested_action || null,
        target_material_ids: targetIds,
        materiality_score: row.materiality_score || 0.5,
        priority_level: row.priority_level || 5,
        status: row.status || 'pending',
        binding_context_json: row.binding_context_json || null,
        last_updated_at: row.last_updated_at || row.updated_at || null
    };
}

/**
 * PURE reducer: apply one recommendation.* event to a recommendation projection.
 */
function applyRecommendationEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.recommendation_id) return projection;
    
    const proj = projection || createEmptyRecommendationProjection(payload.recommendation_id);
    
    switch (event.event_type) {
        case 'recommendation.proposed':
            proj.source_entity_type = payload.source_entity_type || proj.source_entity_type;
            proj.source_entity_id = payload.source_entity_id || proj.source_entity_id;
            proj.recommendation_text = payload.recommendation_text || proj.recommendation_text;
            proj.suggested_action = payload.suggested_action || proj.suggested_action;
            if (payload.target_material_ids && Array.isArray(payload.target_material_ids)) {
                proj.target_material_ids = payload.target_material_ids;
            }
            if (payload.materiality_score !== undefined) proj.materiality_score = payload.materiality_score;
            if (payload.priority_level !== undefined) proj.priority_level = payload.priority_level;
            break;
            
        case 'recommendation.accepted':
            proj.status = 'accepted';
            if (payload.binding_context) {
                proj.binding_context_json = payload.binding_context;
            }
            proj.updated_at = event.created_at;
            break;
            
        case 'recommendation.dismissed':
            proj.status = 'dismissed';
            proj.updated_at = event.created_at;
            break;
            
        case 'recommendation.expired':
            proj.status = 'expired';
            proj.updated_at = event.created_at;
            break;
            
        default:
            break;
    }
    
    return proj;
}

/**
 * PURE full reduction: recommendation events (log order) -> Map<rec_id, projection>.
 */
function reduceRecommendationEvents(events) {
    const map = new Map();
    
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        if (!payload || !payload.recommendation_id) continue;
        
        const next = applyRecommendationEvent(map.get(payload.recommendation_id), event);
        map.set(payload.recommendation_id, next);
    }
    
    return map;
}

// ============================================================================
// Card Lifecycle Reducer
// ============================================================================

/**
 * Empty card projection initial state.
 */
function createEmptyCardProjection(cardId) {
    return {
        card_id: cardId,
        title: null,
        body_text: null,
        materiality_score: 0.5,
        priority_level: 5,
        status: 'new',
        source_event_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

/**
 * Convert DB row to reducer state.
 */
function cardFromRow(row) {
    if (!row) return null;
    
    return {
        card_id: row.card_id,
        title: row.title || null,
        body_text: row.body_text || null,
        materiality_score: row.materiality_score || 0.5,
        priority_level: row.priority_level || 5,
        status: row.status || 'new',
        source_event_id: row.source_event_id || null,
        last_updated_at: row.last_updated_at || row.updated_at || null
    };
}

/**
 * PURE reducer: apply one card.* event to a card projection.
 */
function applyCardEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.card_id) return projection;
    
    const proj = projection || createEmptyCardProjection(payload.card_id);
    
    switch (event.event_type) {
        case 'card.created':
            proj.title = payload.title || proj.title;
            proj.body_text = payload.body_text || proj.body_text;
            proj.materiality_score = payload.materiality_score ?? proj.materiality_score;
            proj.priority_level = payload.priority_level ?? proj.priority_level;
            proj.source_event_id = payload.source_event_id || proj.source_event_id;
            break;
            
        default:
            break;
    }
    
    return proj;
}

/**
 * PURE full reduction: card events (log order) -> Map<card_id, projection>.
 */
function reduceCardEvents(events) {
    const map = new Map();
    
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        if (!payload || !payload.card_id) continue;
        
        const next = applyCardEvent(map.get(payload.card_id), event);
        map.set(payload.card_id, next);
    }
    
    return map;
}

// ============================================================================
// Spark Lifecycle Reducer
// ============================================================================

/**
 * Empty spark projection initial state.
 */
function createEmptySparkProjection(sparkId) {
    return {
        spark_id: sparkId,
        insight_summary: null,
        confidence_score: 0.5,
        category: null,
        related_card_ids: [],
        status: 'emerging',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

/**
 * Convert DB row to reducer state.
 */
function sparkFromRow(row) {
    if (!row) return null;
    
    let relatedCards = [];
    if (row.related_card_ids) {
        try { relatedCards = JSON.parse(row.related_card_ids) || []; } catch (_) { relatedCards = []; }
    }
    
    return {
        spark_id: row.spark_id,
        insight_summary: row.insight_summary || null,
        confidence_score: row.confidence_score || 0.5,
        category: row.category || null,
        related_card_ids: relatedCards,
        status: row.status || 'emerging',
        last_updated_at: row.last_updated_at || row.updated_at || null
    };
}

/**
 * PURE reducer: apply one spark.* event to a spark projection.
 */
function applySparkEvent(projection, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.spark_id) return projection;
    
    const proj = projection || createEmptySparkProjection(payload.spark_id);
    
    switch (event.event_type) {
        case 'spark.emerged':
            proj.insight_summary = payload.insight_summary || proj.insight_summary;
            proj.confidence_score = payload.confidence_score ?? proj.confidence_score;
            proj.category = payload.category || proj.category;
            if (payload.related_card_ids && Array.isArray(payload.related_card_ids)) {
                proj.related_card_ids = payload.related_card_ids;
            }
            break;
            
        default:
            break;
    }
    
    return proj;
}

/**
 * PURE full reduction: spark events (log order) -> Map<spark_id, projection>.
 */
function reduceSparkEvents(events) {
    const map = new Map();
    
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        if (!payload || !payload.spark_id) continue;
        
        const next = applySparkEvent(map.get(payload.spark_id), event);
        map.set(payload.spark_id, next);
    }
    
    return map;
}

// ============================================================================
// Material Attribution Transition Chain (Back-propagation)
// ============================================================================

/**
 * Generate back-propagation material.attribution.transitioned events from
 * task.feedback_to_materials field.
 * 
 * Each feedback item creates a transition chain:
 *   material.attribution.transitioned(target_entity_id, ..., to_state='reality_verified')
 * 
 * Returns array of generated events with event_id, payload, and provenance指向task event.
 */
function generateMaterialFeedbackChain(taskEvent, projectionsMap) {
    const chain = [];
    const payload = parsePayload(taskEvent.payload_json);
    
    if (!payload.feedback_to_materials || !Array.isArray(payload.feedback_to_materials)) {
        return chain;
    }
    
    for (const feedback of payload.feedback_to_materials) {
        const targetEntityId = feedback.entity_id;
        if (!targetEntityId || !isValidULID(targetEntityId)) {
            continue;
        }
        
        // Get current attribution state from projection
        const currentProj = projectionsMap.get(targetEntityId);
        const currentState = currentProj ? currentProj.attribution_state : 'ai_proposed';
        
        // New attribution state is decided by the ORIGINATING task event type:
        // success acceptance (task.completed / task.result_recorded) -> reality_verified
        // failure / insight paths -> user_tentative (reality NOT confirmed)
        const SUCCESS_EVENT_TYPES = ['task.completed', 'task.result_recorded'];
        const newState = SUCCESS_EVENT_TYPES.includes(taskEvent.event_type)
            ? 'reality_verified'
            : 'user_tentative';
        
        // Generate ULID for new attribution transition event
        const eventId = generateULID();
        const timestamp = taskEvent.created_at || new Date().toISOString();
        
        chain.push({
            event_id: eventId,
            source_id: targetEntityId,
            event_type: 'material.attribution.transitioned',
            payload_json: {
                entity_id: targetEntityId,
                from_state: currentState,
                to_state: newState,
                target_ref: `task:${taskEvent.event_id}`,
                evidence_ref: taskEvent.event_id,
                assertion_attribution: newState,
                feedback_source_task_id: taskEvent.event_id
            },
            sha256: null,
            created_at: timestamp,
            provenance: {
                originating_task_event_id: taskEvent.event_id,
                originating_event_type: taskEvent.event_type,
                feedback_index: chain.length
            }
        });
    }
    
    return chain;
}

// ============================================================================
// Incremental DB persistence (same pure reducers as recompute path)
// ============================================================================

/**
 * Fetch one tasks_projection row (real sqlite or mock mode).
 */
function getTaskProjectionRow(db, taskId) {
    if (db.db.isMock) {
        return (db.db.data.tasks_projection || []).find(t => t.task_id === taskId) || null;
    }
    try {
        return db.db.prepare('SELECT * FROM tasks_projection WHERE task_id = ?').get(taskId) || null;
    } catch (_) {
        return null;
    }
}

/**
 * Upsert one tasks_projection row.
 */
function upsertTaskProjection(db, proj) {
    const record = {
        task_id: proj.task_id,
        source_ref: proj.source_ref || null,
        objective: proj.objective || null,
        boundary_inherited_from: proj.boundary_inherited_from || null,
        bound_conversation_id: proj.bound_conversation_id || null,
        bound_conversation_url: proj.bound_conversation_url || null,
        bound_execution_agent: proj.bound_execution_agent || null,
        current_status: proj.current_status || 'proposed',
        progress_json: proj.progress_json || null,
        checkpoint_event_id: proj.checkpoint_event_id || null,
        result_event_id: proj.result_event_id || null,
        failure_path_event_id: proj.failure_path_event_id || null,
        created_at: proj.created_at || new Date().toISOString(),
        updated_at: proj.updated_at || new Date().toISOString()
    };
    
    if (db.db.isMock) {
        const arr = db.db.data.tasks_projection = db.db.data.tasks_projection || [];
        const idx = arr.findIndex(t => t.task_id === record.task_id);
        if (idx >= 0) arr[idx] = record; else arr.push(record);
        return { success: true };
    }
    
    try {
        db.db.prepare(`
            INSERT OR REPLACE INTO tasks_projection
                (task_id, source_ref, objective, boundary_inherited_from,
                 bound_conversation_id, bound_conversation_url, bound_execution_agent,
                 current_status, progress_json, checkpoint_event_id,
                 result_event_id, failure_path_event_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.task_id, record.source_ref, record.objective, record.boundary_inherited_from,
            record.bound_conversation_id, record.bound_conversation_url, record.bound_execution_agent,
            record.current_status, record.progress_json, record.checkpoint_event_id,
            record.result_event_id, record.failure_path_event_id, record.created_at, record.updated_at
        );
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Incremental path: apply one task.* event to the persisted projection.
 * Shares applyTaskEvent() with the recompute path (recompute === incremental).
 */
function applyTaskEventToDb(db, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.task_id) return { success: true, skipped: true };
    
    const row = getTaskProjectionRow(db, payload.task_id);
    const next = applyTaskEvent(row ? { ...row } : null, event);
    if (!next) return { success: true, skipped: true };
    
    return upsertTaskProjection(db, next);
}

/**
 * Fetch one recommendations_projection row.
 */
function getRecommendationProjectionRow(db, recId) {
    if (db.db.isMock) {
        return (db.db.data.recommendations_projection || []).find(r => r.recommendation_id === recId) || null;
    }
    try {
        return db.db.prepare('SELECT * FROM recommendations_projection WHERE recommendation_id = ?').get(recId) || null;
    } catch (_) {
        return null;
    }
}

/**
 * Upsert one recommendations_projection row.
 * NOT NULL columns (source fields) require a seeded proposal first;
 * bare accept/dismiss without a proposal is skipped (nothing usable yet).
 */
function upsertRecommendationProjection(db, proj) {
    if (!proj.source_entity_type || !proj.source_entity_id || !proj.recommendation_text) {
        return { success: true, skipped: true };
    }
    
    const record = {
        recommendation_id: proj.recommendation_id,
        source_entity_type: proj.source_entity_type,
        source_entity_id: proj.source_entity_id,
        recommendation_text: proj.recommendation_text,
        suggested_action: proj.suggested_action || null,
        target_material_ids: Array.isArray(proj.target_material_ids)
            ? JSON.stringify(proj.target_material_ids)
            : (proj.target_material_ids || null),
        materiality_score: proj.materiality_score ?? 0.5,
        priority_level: proj.priority_level ?? 5,
        status: proj.status || 'pending',
        binding_context_json: proj.binding_context_json || null,
        created_at: proj.created_at || new Date().toISOString(),
        updated_at: proj.updated_at || new Date().toISOString()
    };
    
    if (db.db.isMock) {
        const arr = db.db.data.recommendations_projection = db.db.data.recommendations_projection || [];
        const idx = arr.findIndex(r => r.recommendation_id === record.recommendation_id);
        if (idx >= 0) arr[idx] = record; else arr.push(record);
        return { success: true };
    }
    
    try {
        db.db.prepare(`
            INSERT OR REPLACE INTO recommendations_projection
                (recommendation_id, source_entity_type, source_entity_id, recommendation_text,
                 suggested_action, target_material_ids, materiality_score, priority_level,
                 status, binding_context_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.recommendation_id, record.source_entity_type, record.source_entity_id,
            record.recommendation_text, record.suggested_action, record.target_material_ids,
            record.materiality_score, record.priority_level, record.status,
            record.binding_context_json, record.created_at, record.updated_at
        );
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Incremental path: apply one recommendation.* event to the persisted projection.
 */
function applyRecommendationEventToDb(db, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.recommendation_id) return { success: true, skipped: true };
    
    const row = getRecommendationProjectionRow(db, payload.recommendation_id);
    const next = applyRecommendationEvent(row ? { ...row } : null, event);
    if (!next) return { success: true, skipped: true };
    
    return upsertRecommendationProjection(db, next);
}

/**
 * Incremental path: apply one card.* event to the persisted projection.
 */
function applyCardEventToDb(db, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.card_id) return { success: true, skipped: true };
    
    let row = null;
    if (db.db.isMock) {
        row = (db.db.data.cards_projection || []).find(c => c.card_id === payload.card_id) || null;
    } else {
        try {
            row = db.db.prepare('SELECT * FROM cards_projection WHERE card_id = ?').get(payload.card_id) || null;
        } catch (_) { row = null; }
    }
    
    const next = applyCardEvent(row ? { ...row } : null, event);
    if (!next) return { success: true, skipped: true };
    
    const record = {
        card_id: next.card_id,
        title: next.title || null,
        body_text: next.body_text || null,
        materiality_score: next.materiality_score ?? 0.5,
        priority_level: next.priority_level ?? 5,
        status: next.status || 'new',
        source_event_id: next.source_event_id || null,
        created_at: next.created_at || new Date().toISOString(),
        updated_at: next.updated_at || new Date().toISOString()
    };
    
    if (db.db.isMock) {
        const arr = db.db.data.cards_projection = db.db.data.cards_projection || [];
        const idx = arr.findIndex(c => c.card_id === record.card_id);
        if (idx >= 0) arr[idx] = record; else arr.push(record);
        return { success: true };
    }
    
    try {
        db.db.prepare(`
            INSERT OR REPLACE INTO cards_projection
                (card_id, title, body_text, materiality_score, priority_level,
                 status, source_event_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.card_id, record.title, record.body_text, record.materiality_score,
            record.priority_level, record.status, record.source_event_id,
            record.created_at, record.updated_at
        );
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Incremental path: apply one spark.* event to the persisted projection.
 */
function applySparkEventToDb(db, event) {
    const payload = parsePayload(event.payload_json);
    if (!payload || !payload.spark_id) return { success: true, skipped: true };
    
    let row = null;
    if (db.db.isMock) {
        row = (db.db.data.sparks_projection || []).find(s => s.spark_id === payload.spark_id) || null;
    } else {
        try {
            row = db.db.prepare('SELECT * FROM sparks_projection WHERE spark_id = ?').get(payload.spark_id) || null;
        } catch (_) { row = null; }
    }
    
    let prior = null;
    if (row) {
        let relatedCards = [];
        if (row.related_card_ids) {
            try { relatedCards = JSON.parse(row.related_card_ids) || []; } catch (_) { relatedCards = []; }
        }
        prior = { ...row, related_card_ids: relatedCards };
    }
    const next = applySparkEvent(prior, event);
    if (!next) return { success: true, skipped: true };
    
    const record = {
        spark_id: next.spark_id,
        insight_summary: next.insight_summary || null,
        confidence_score: next.confidence_score ?? 0.5,
        category: next.category || null,
        related_card_ids: Array.isArray(next.related_card_ids)
            ? JSON.stringify(next.related_card_ids)
            : (next.related_card_ids || null),
        status: next.status || 'emerging',
        created_at: next.created_at || new Date().toISOString(),
        updated_at: next.updated_at || new Date().toISOString()
    };
    
    if (db.db.isMock) {
        const arr = db.db.data.sparks_projection = db.db.data.sparks_projection || [];
        const idx = arr.findIndex(s => s.spark_id === record.spark_id);
        if (idx >= 0) arr[idx] = record; else arr.push(record);
        return { success: true };
    }
    
    try {
        db.db.prepare(`
            INSERT OR REPLACE INTO sparks_projection
                (spark_id, insight_summary, confidence_score, category,
                 related_card_ids, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.spark_id, record.insight_summary, record.confidence_score,
            record.category, record.related_card_ids, record.status,
            record.created_at, record.updated_at
        );
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    // Event parsers
    parsePayload,
    sha256,
    
    // Task reducers
    createEmptyTaskProjection,
    taskFromRow,
    applyTaskEvent,
    reduceTaskEvents,
    
    // Recommendation reducers
    createEmptyRecommendationProjection,
    recommendationFromRow,
    applyRecommendationEvent,
    reduceRecommendationEvents,
    
    // Card reducers
    createEmptyCardProjection,
    cardFromRow,
    applyCardEvent,
    reduceCardEvents,
    
    // Spark reducers
    createEmptySparkProjection,
    sparkFromRow,
    applySparkEvent,
    reduceSparkEvents,
    
    // Material back-propagation
    generateMaterialFeedbackChain,
    
    // Incremental DB persistence (recompute === incremental)
    getTaskProjectionRow,
    upsertTaskProjection,
    applyTaskEventToDb,
    getRecommendationProjectionRow,
    upsertRecommendationProjection,
    applyRecommendationEventToDb,
    applyCardEventToDb,
    applySparkEventToDb
};
