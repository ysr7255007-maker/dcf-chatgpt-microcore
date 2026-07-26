/**
 * G3 Surface - Materials Core (testable pure logic)
 *
 * Shared between seed/surface/g3-materials.html (browser, file://) and
 * seed/tests/g3-adapter-flow.test.js (node require). UMD, zero dependencies.
 *
 * Everything here is pure data-shaping over the companion HTTP contract
 * (seed/docs/g3-companion-v0.md §3). The companion stays the single
 * authority: this module never enforces the four-state machine, it only
 * offers UI conveniences (forward-state hints); regressions are sent as-is
 * and the server rejection is displayed verbatim.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DCF_G3_CORE = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Four-state attribution (mirror of companion types.js; server is authority)
    const ATTRIBUTION_STATES = ['ai_proposed', 'user_tentative', 'user_confirmed', 'reality_verified'];
    const ATTRIBUTION_LABELS = {
        ai_proposed: 'AI 提出',
        user_tentative: '用户暂定',
        user_confirmed: '用户确认',
        reality_verified: '现实验证'
    };
    const FORWARD_TRANSITIONS = {
        ai_proposed: ['user_tentative', 'user_confirmed', 'reality_verified'],
        user_tentative: ['user_confirmed', 'reality_verified'],
        user_confirmed: ['reality_verified'],
        reality_verified: []
    };

    // Adapter capture contract (content.js): assistant replies arrive as
    // these event types with payload.role === 'assistant'.
    const ASSISTANT_EVENT_TYPES = ['conversation.message.received', 'conversation.message.updated'];

    const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    /**
     * ULID generation (26-char Crockford, same alphabet as companion ulid.js)
     */
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
            // node without webcrypto global (not expected on 22+, kept honest)
            for (let i = 0; i < 16; i++) rnd += ULID_ENCODING[Math.floor(Math.random() * 32)];
        }
        return ts + rnd;
    }

    /**
     * payload_json arrives as string (DB row) or object (fresh ingest).
     */
    function parsePayload(payloadJson) {
        if (payloadJson == null) return null;
        if (typeof payloadJson === 'object') return payloadJson;
        try { return JSON.parse(payloadJson); } catch (_) { return null; }
    }

    /**
     * Filter ingested events down to assistant replies that can be marked
     * as revision candidates. Returns display-ready message descriptors.
     */
    function extractAssistantMessages(events) {
        const out = [];
        for (const e of events || []) {
            if (!e || ASSISTANT_EVENT_TYPES.indexOf(e.event_type) === -1) continue;
            const payload = parsePayload(e.payload_json);
            if (!payload || payload.role !== 'assistant') continue;
            if (typeof payload.text !== 'string' || payload.text.trim() === '') continue;
            out.push({
                event_id: e.event_id,
                source_id: e.source_id,
                event_type: e.event_type,
                text: payload.text,
                message_id: payload.message_id || null,
                conversation_path: payload.conversation_path || null,
                created_at: e.created_at || null,
                sequence_number: Number.isInteger(e.sequence_number) ? e.sequence_number : null
            });
        }
        return out;
    }

    /**
     * POST /rpc/material/revision body for manually marking an assistant
     * reply as a revision candidate.
     * - default attribution: ai_proposed (人工标记 AI 回复)
     * - source_ref: the ingested message's event_id (provenance back-link)
     */
    function buildRevisionPayload(opts) {
        const { entityId, message } = opts || {};
        if (!entityId) throw new Error('buildRevisionPayload: entityId is required');
        if (!message || typeof message.text !== 'string' || message.text.trim() === '') {
            throw new Error('buildRevisionPayload: message with non-empty text is required');
        }
        if (!message.event_id) throw new Error('buildRevisionPayload: message.event_id is required (source_ref)');
        return {
            entity_id: entityId,
            candidate_body: message.text,
            source_ref: message.event_id,
            assertion_attribution: opts.attribution || 'ai_proposed',
            base_sha256: opts.baseSha256 || null
        };
    }

    /**
     * POST /rpc/material/attribution body. target_ref identifies the
     * material entity; from_state must truthfully be the projection state.
     */
    function buildAttributionPayload(opts) {
        const { entityId, fromState, toState } = opts || {};
        if (!entityId) throw new Error('buildAttributionPayload: entityId is required');
        if (!fromState || !toState) throw new Error('buildAttributionPayload: fromState and toState are required');
        return {
            entity_id: entityId,
            target_ref: 'material:' + entityId,
            from_state: fromState,
            to_state: toState,
            evidence_ref: opts.evidenceRef || null
        };
    }

    /**
     * UI hint only: which states are forward from here. The server remains
     * the authority; the UI still allows sending regressions so the honest
     * rejection path stays exercisable.
     */
    function forwardStates(fromState) {
        return FORWARD_TRANSITIONS[fromState] ? FORWARD_TRANSITIONS[fromState].slice() : [];
    }

    // 发射文案的修订指令模板（人工标记闭环的第一步：材料 -> ChatGPT）
    const REVISION_INSTRUCTION_TEMPLATE = [
        '【DCF 修订请求】',
        '以下是材料 {ENTITY_ID} 的当前正文。请给出修订后的完整正文：',
        '- 保持原有结构与意图，直接输出修订后全文；',
        '- 不要附加解释、前言或代码块包裹。',
        '你的回复将由用户在 DCF Surface 中手动标记为该材料的修订候选（初始归属：ai_proposed）。',
        '--- 材料正文开始 ---',
        '{BODY}',
        '--- 材料正文结束 ---'
    ].join('\n');

    /**
     * Launch text: revision instruction template wrapped around the
     * material body. Copied to clipboard by the existing modal mechanism.
     */
    function buildLaunchText(opts) {
        const { entityId, body } = opts || {};
        if (typeof body !== 'string') throw new Error('buildLaunchText: body (string) is required');
        return REVISION_INSTRUCTION_TEMPLATE
            .replace('{ENTITY_ID}', entityId || '(未指定)')
            .replace('{BODY}', body);
    }

    /**
     * Normalize a non-2xx companion response for honest display.
     * - 409 push conflict carries error.data.conflict_text (rendered in full)
     * - 503 means gh unavailable, local-only mode
     * Note (companion defect, recorded not fixed): index.js rpcError() drops
     * its data argument, so attribution-400 responses carry only
     * error.message; the 409 path builds its body manually and keeps data.
     */
    function parseRpcFailure(status, body) {
        const err = (body && body.error) || {};
        const data = err.data || {};
        return {
            status: status,
            message: err.message || ('HTTP ' + status),
            conflictText: typeof data.conflict_text === 'string' ? data.conflict_text : null,
            conflictEventId: data.conflict_event_id || null,
            localOnly: status === 503
        };
    }

    function shortId(id, n) {
        return typeof id === 'string' ? id.substring(0, n || 10) : '';
    }

    return {
        ATTRIBUTION_STATES,
        ATTRIBUTION_LABELS,
        FORWARD_TRANSITIONS,
        ASSISTANT_EVENT_TYPES,
        REVISION_INSTRUCTION_TEMPLATE,
        generateULID,
        parsePayload,
        extractAssistantMessages,
        buildRevisionPayload,
        buildAttributionPayload,
        forwardStates,
        buildLaunchText,
        parseRpcFailure,
        shortId
    };
});
