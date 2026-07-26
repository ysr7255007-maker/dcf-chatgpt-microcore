/**
 * G4 Surface — Core Life Cycle UI (testable pure logic)
 * 
 * Shared between seed/surface/g4-lifecycle.html (browser, file://) and
 * seed/tests/g4-lifecycle-flow.test.js (node require). UMD, zero dependencies.
 * 
 * Contract: companion HTTP at http://127.0.0.1:8472
 * - Four categories separated: cards / sparks / recommendations / tasks
 * - Recommendation → task binding: explicit session selection (no defaults)
 * - Task progression with honest regression rejection display
 * - Back-propagation UI: material attribution chain generation
 * - Manual recommendation creation form (source_reasoning required)
 * 
 * Companion contract reference: seed/docs/g4-companion-v0.md §3-4
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DCF_G4_CORE = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ──────────────────────────────────────────────────────────────
    // Types mirror (server is authority)
    // ──────────────────────────────────────────────────────────────
    const TASK_STATES = ['proposed', 'accepted', 'in_progress', 'completed', 'failed'];
    const TASK_STATE_LABELS = {
        proposed: '提议中',
        accepted: '已接受',
        in_progress: '进行中',
        completed: '已完成',
        failed: '已失败'
    };

    const RECOMMENDATION_STATES = ['pending', 'accepted', 'dismissed', 'expired'];
    const RECOMMENDATION_STATE_LABELS = {
        pending: '待处理',
        accepted: '已接受',
        dismissed: '已忽略',
        expired: '已过期'
    };

    const CARD_STATES = ['new', 'triaged', 'processed', 'archived'];
    const SPARK_STATES = ['emerging', 'validated', 'actionable', 'dismissed'];

    // ──────────────────────────────────────────────────────────────
    // ULID & helpers
    // ──────────────────────────────────────────────────────────────
    const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    function generateULID() {
        let time = Date.now(), ts = '';
        for (let i = 0; i < 10; i++) {
            ts = ULID_ENCODING[time % 32] + ts;
            time = Math.floor(time / 32);
        }
        let rnd = '';
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            for (let i = 0; i < 16; i++) rnd += ULID_ENCODING[bytes[i] & 31];
        } else {
            for (let i = 0; i < 16; i++) rnd += ULID_ENCODING[Math.floor(Math.random() * 32)];
        }
        return ts + rnd;
    }

    function isValidULID(id) {
        if (!id || typeof id !== 'string') return false;
        if (id.length !== 26) return false;
        return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id);
    }

    function shortId(id, n) {
        return typeof id === 'string' ? id.substring(0, n || 10) : '';
    }

    function parsePayload(payloadJson) {
        if (payloadJson == null) return null;
        if (typeof payloadJson === 'object') return payloadJson;
        try { return JSON.parse(payloadJson); } catch (_) { return null; }
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // ──────────────────────────────────────────────────────────────
    // RPC layer (non-throwing, returns status+failure like g3)
    // ──────────────────────────────────────────────────────────────
    async function rpc(method, path, payload, COMPANION_URL = 'http://127.0.0.1:8472') {
        const url = COMPANION_URL + path;
        const opts = { method };
        if (payload !== undefined) {
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(payload);
        }
        try {
            const res = await fetch(url, opts);
            let body = null;
            try { body = await res.json(); } catch (_) { body = null; }
            if (res.ok && body && !body.error) {
                return { ok: true, status: res.status, result: body.result };
            }
            return { ok: false, status: res.status, failure: { message: body?.error?.message || ('HTTP ' + res.status), body } };
        } catch (err) {
            return { ok: false, status: 0, failure: { message: err.message } };
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Data fetching helpers
    // ──────────────────────────────────────────────────────────────
    async function fetchRecommendations(status = 'pending', COMPANION_URL = 'http://127.0.0.1:8472') {
        const res = await rpc('POST', '/rpc/recommendation/query', { status }, COMPANION_URL);
        return res.ok ? (res.result.recommendations || []) : [];
    }

    async function fetchTasks(status = null, COMPANION_URL = 'http://127.0.0.1:8472') {
        // Companion contract: /rpc/task/query requires task_id OR status.
        // status=null therefore means "all five states", queried honestly per state.
        if (status) {
            const res = await rpc('GET', `/rpc/task/query?status=${encodeURIComponent(status)}&limit=100`, undefined, COMPANION_URL);
            return res.ok ? (res.result.tasks || []) : [];
        }
        const lists = await Promise.all(TASK_STATES.map(s =>
            rpc('GET', `/rpc/task/query?status=${encodeURIComponent(s)}&limit=100`, undefined, COMPANION_URL)
        ));
        const merged = [];
        for (const res of lists) {
            if (res.ok && Array.isArray(res.result.tasks)) merged.push(...res.result.tasks);
        }
        return merged;
    }

    async function fetchSessions(COMPANION_URL = 'http://127.0.0.1:8472') {
        const res = await rpc('GET', '/rpc/adapter/sessions', undefined, COMPANION_URL);
        return res.ok ? (res.result.sessions || []) : [];
    }

    async function fetchMaterials(limit = 200, COMPANION_URL = 'http://127.0.0.1:8472') {
        const res = await rpc('GET', '/rpc/material/query', undefined, COMPANION_URL);
        return res.ok ? (res.result.projections || []) : [];
    }

    /**
     * recommendations_projection carries no source_reasoning column; the
     * honest source of truth is the recommendation.proposed event payload
     * (source_id === recommendation_id in the append-only log).
     */
    async function fetchRecommendationProvenance(recommendationId, COMPANION_URL = 'http://127.0.0.1:8472') {
        const res = await rpc('GET', '/rpc/events/query?source_id=' + encodeURIComponent(recommendationId) + '&limit=50', undefined, COMPANION_URL);
        if (!res.ok) return null;
        const events = res.result.events || [];
        const proposed = events.find(e => e.event_type === 'recommendation.proposed');
        if (!proposed) return null;
        return parsePayload(proposed.payload_json);
    }

    // ──────────────────────────────────────────────────────────────
    // Recommendation → Task binding: explicit session selection
    // ──────────────────────────────────────────────────────────────
    /**
     * Build accept payload with explicit binding context.
     * User must select a session (conversation_id) before confirmation button enabled.
     */
    function buildAcceptPayload(recommendationId, bindingContext) {
        if (!isValidULID(recommendationId)) throw new Error('invalid recommendation_id');
        if (!bindingContext || typeof bindingContext !== 'object') {
            throw new Error('binding_context must be an object with conversation_id/url and execution_agent');
        }
        if (!isValidULID(bindingContext.conversation_id) && !(typeof bindingContext.conversation_url === 'string')) {
            throw new Error('either valid conversation_id ULID or conversation_url string required');
        }
        if (!bindingContext.execution_agent || typeof bindingContext.execution_agent !== 'string') {
            throw new Error('execution_agent (human user or AI agent name) is required');
        }
        if (!bindingContext.user_confirmed_at || typeof bindingContext.user_confirmed_at !== 'string') {
            throw new Error('user_confirmed_at ISO timestamp required');
        }
        return {
            recommendation_id: recommendationId,
            binding_context: bindingContext
        };
    }

    /**
     * Build dismiss payload
     */
    function buildDismissPayload(recommendationId, reason) {
        if (!isValidULID(recommendationId)) throw new Error('invalid recommendation_id');
        return { recommendation_id: recommendationId, reason: reason || null };
    }

    // ──────────────────────────────────────────────────────────────
    // Task progression
    // ──────────────────────────────────────────────────────────────
    function buildTaskProgressionPayload(taskId, fromState, toState, extra = {}) {
        if (!isValidULID(taskId)) throw new Error('invalid task_id');
        if (!TASK_STATES.includes(fromState) || !TASK_STATES.includes(toState)) {
            throw new Error('from/to state must be one of: ' + TASK_STATES.join(', '));
        }
        const payload = { task_id: taskId, from_state: fromState, to_state: toState };
        if (toState === 'completed' && extra.result_event_id) {
            if (!isValidULID(extra.result_event_id)) throw new Error('invalid result_event_id');
            payload.result_event_id = extra.result_event_id;
        }
        if (toState === 'failed' && extra.failure_path_event_id) {
            if (!isValidULID(extra.failure_path_event_id)) throw new Error('invalid failure_path_event_id');
            payload.failure_path_event_id = extra.failure_path_event_id;
        }
        if (extra.feedback_to_materials && Array.isArray(extra.feedback_to_materials)) {
            payload.feedback_to_materials = extra.feedback_to_materials;
        }
        return payload;
    }

    function buildCheckpointPayload(taskId, checkpointId, checkpointType, snapshotJson) {
        if (!isValidULID(taskId) || !isValidULID(checkpointId)) {
            throw new Error('task_id and checkpoint_id must be valid ULIDs');
        }
        if (typeof checkpointType !== 'string' || !checkpointType) {
            throw new Error('checkpoint_type is required');
        }
        if (typeof snapshotJson !== 'string') {
            throw new Error('snapshot_json must be stringified JSON');
        }
        return { task_id: taskId, checkpoint_id: checkpointId, checkpoint_type: checkpointType, snapshot_json: snapshotJson };
    }

    // ──────────────────────────────────────────────────────────────
    // Back-propagation: create feedback-to-materials bundle
    // ──────────────────────────────────────────────────────────────
    function buildMaterialFeedbackBundle(materialId, targetAttributionState) {
        if (!isValidULID(materialId)) throw new Error('invalid entity_id');
        if (!['reality_verified', 'user_tentative'].includes(targetAttributionState)) {
            throw new Error('target state must be reality_verified (success) or user_tentative (failure/insight)');
        }
        return [{ entity_id: materialId, target_attribution: targetAttributionState }];
    }

    // ──────────────────────────────────────────────────────────────
    // Manual recommendation creation (G4初期推荐生产者是用户手动)
    // ──────────────────────────────────────────────────────────────
    function buildManualRecommendationPayload({ source_entity_type, source_entity_id, recommendation_text, source_reasoning, target_material_refs, materiality_score, priority_level }) {
        if (!source_entity_type || !['card', 'spark', 'task', 'system'].includes(source_entity_type)) {
            throw new Error('source_entity_type must be card|spark|task|system');
        }
        if (!isValidULID(source_entity_id)) throw new Error('invalid source_entity_id');
        if (!recommendation_text || typeof recommendation_text !== 'string' || recommendation_text.trim() === '') {
            throw new Error('recommendation_text is required and must be non-empty');
        }
        if (!source_reasoning || typeof source_reasoning !== 'string' || source_reasoning.trim() === '') {
            throw new Error('source_reasoning is required (explain why this recommendation emerged)');
        }
        if (target_material_refs && !Array.isArray(target_material_refs)) {
            throw new Error('target_material_refs must be array of ULIDs if provided');
        }
        if (materiality_score !== undefined && (typeof materiality_score !== 'number' || materiality_score < 0 || materiality_score > 1)) {
            throw new Error('materiality_score must be 0-1 if provided');
        }
        if (priority_level !== undefined && (typeof priority_level !== 'number' || priority_level < 1 || priority_level > 9)) {
            throw new Error('priority_level must be 1-9 if provided');
        }
        return {
            source_entity_type,
            source_entity_id,
            recommendation_text,
            source_reasoning,
            target_material_ids: target_material_refs || [],
            materiality_score: materiality_score ?? 0.6,
            priority_level: priority_level ?? 5
        };
    }

    /**
     * Manual recommendations have no dedicated RPC endpoint: they are
     * recommendation.proposed events submitted via POST /rpc/events/ingest.
     * Envelope contract (types.validateRawEvent): event_id + source_id ULIDs,
     * event_type, payload_json object. source_id = recommendation_id so the
     * provenance (source_reasoning) stays queryable per recommendation.
     */
    function buildRecommendationProposedEvent(fields) {
        const payload = buildManualRecommendationPayload(fields);
        const recommendationId = fields.recommendation_id || generateULID();
        if (!isValidULID(recommendationId)) throw new Error('invalid recommendation_id');
        return {
            event: {
                event_id: generateULID(),
                source_id: recommendationId,
                event_type: 'recommendation.proposed',
                payload_json: Object.assign({ recommendation_id: recommendationId }, payload),
                created_at: new Date().toISOString()
            }
        };
    }

    // ──────────────────────────────────────────────────────────────
    // UI render helpers (pure data shaping)
    // ──────────────────────────────────────────────────────────────
    function recommendCardStyle(rec) {
        const score = rec.materiality_score ?? 0.5;
        const level = Math.ceil((score - 0.1) / 0.2) + 1; // 1-9
        const palette = [
            { bg: '#f6f8fa', border: '#e1e4e8', text: '#656d76' },
            { bg: '#e1dff7', border: '#8250df', text: '#40326e' },
            { bg: '#fcefd6', border: '#d29922', text: '#633902' },
            { bg: '#f7efea', border: '#a46a03', text: '#482a02' }
        ];
        const idx = Math.min(level - 1, palette.length - 1);
        return palette[idx];
    }

    function stateBadgeClass(state) {
        const map = {
            recommended: 'st-pending',
            completed: 'st-completed',
            failed: 'st-failed',
            in_progress: 'st-in_progress',
            accepted: 'st-accepted',
            proposed: 'st-proposed',
            dismissed: 'st-dismissed',
            new: 'st-new'
        };
        return map[state] || 'st-none';
    }

    // ──────────────────────────────────────────────────────────────
    // Export
    // ──────────────────────────────────────────────────────────────
    return {
        // Types
        TASK_STATES,
        TASK_STATE_LABELS,
        RECOMMENDATION_STATES,
        RECOMMENDATION_STATE_LABELS,
        CARD_STATES,
        SPARK_STATES,

        // Generators
        generateULID,
        isValidULID,
        
        // Helpers
        shortId,
        parsePayload,
        esc,

        // RPC
        rpc,
        fetchRecommendations,
        fetchTasks,
        fetchSessions,
        fetchMaterials,
        fetchRecommendationProvenance,

        // Builders
        buildAcceptPayload,
        buildDismissPayload,
        buildTaskProgressionPayload,
        buildCheckpointPayload,
        buildMaterialFeedbackBundle,
        buildManualRecommendationPayload,
        buildRecommendationProposedEvent,

        // UI
        recommendCardStyle,
        stateBadgeClass
    };
});
