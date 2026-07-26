/**
 * G6 Surface — Patch Management UI Core (testable pure logic)
 *
 * Shared between seed/surface/g6-patches.html (browser, file://) and
 * seed/tests/g6-surface.test.js (node require). UMD, zero dependencies.
 *
 * Contract: companion HTTP at http://127.0.0.1:8472
 * - 8 RPC endpoints: query, propose, validate, activate, deactivate, revert, revalidate, supersede
 * - 6-state machine: proposed → validated → active → needs_revalidation → (validated/proposed) / reverted / superseded
 * - Environment health: healthy, degraded, unhealthy, unknown
 * - Response format: {jsonrpc: "2.0", result: {...}}
 *
 * Companion contract reference: seed/companion/index.js handlePatch*
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DCF_G6_CORE = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ──────────────────────────────────────────────────────────────
    // Constants (server is authority, mirrors g6-patch-reducers.js)
    // ──────────────────────────────────────────────────────────────
    const PATCH_STATUSES = ['proposed', 'validated', 'active', 'needs_revalidation', 'reverted', 'superseded'];

    const PATCH_STATUS_LABELS = {
        proposed: '提议中',
        validated: '已验证',
        active: '已激活',
        needs_revalidation: '需重新验证',
        reverted: '已回退',
        superseded: '已废弃'
    };

    const ENV_HEALTH_STATUSES = ['healthy', 'degraded', 'unhealthy', 'unknown'];

    const ENV_HEALTH_LABELS = {
        healthy: '健康',
        degraded: '降级',
        unhealthy: '不健康',
        unknown: '未知'
    };

    // Status → color mapping for badges
    const STATUS_COLORS = {
        proposed:          { bg: '#eaeef2', text: '#57606a', border: '#d0d7de' },
        validated:         { bg: '#ddf4ff', text: '#0550ae', border: '#0969da' },
        active:            { bg: '#dafbe1', text: '#1a7f37', border: '#2da44e' },
        needs_revalidation:{ bg: '#fff8c5', text: '#7d4e00', border: '#d29922' },
        reverted:          { bg: '#ffebe9', text: '#cf222e', border: '#cf222e' },
        superseded:        { bg: '#e1dff7', text: '#40326e', border: '#8250df' }
    };

    // Environment health → color mapping
    const ENV_HEALTH_COLORS = {
        healthy:    { bg: '#dafbe1', text: '#1a7f37', icon: '●' },
        degraded:   { bg: '#fff8c5', text: '#7d4e00', icon: '▲' },
        unhealthy:  { bg: '#ffebe9', text: '#cf222e', icon: '✖' },
        unknown:    { bg: '#eaeef2', text: '#57606a', icon: '?' }
    };

    // Status → available action buttons
    const STATUS_ACTIONS = {
        proposed:           ['validate', 'supersede'],
        validated:          ['activate', 'revert', 'supersede'],
        active:             ['deactivate', 'revert', 'supersede'],
        needs_revalidation: ['revalidate_valid', 'revalidate_invalid'],
        reverted:           [],
        superseded:         []
    };

    const ACTION_LABELS = {
        validate: '验证',
        activate: '激活',
        deactivate: '停用',
        revert: '回退',
        supersede: '废弃',
        revalidate_valid: '重新验证(有效)',
        revalidate_invalid: '重新验证(无效)'
    };

    const ACTION_BUTTON_CLASS = {
        validate: 'blue',
        activate: 'green',
        deactivate: 'secondary',
        revert: 'red',
        supersede: 'purple',
        revalidate_valid: 'green',
        revalidate_invalid: 'red'
    };

    // ──────────────────────────────────────────────────────────────
    // ULID & helpers (mirrors g4-lifecycle-core.js)
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

    function truncate(text, maxLen) {
        if (!text) return '';
        const s = String(text);
        return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
    }

    function formatTimestamp(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            return d.toLocaleString('zh-CN', { hour12: false });
        } catch (_) {
            return String(ts);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // RPC layer (non-throwing, returns {ok, status, result, failure})
    // ──────────────────────────────────────────────────────────────
    async function rpc(method, path, payload, baseUrl) {
        const url = (baseUrl || 'http://127.0.0.1:8472') + path;
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
    // API client functions (8 endpoints)
    // ──────────────────────────────────────────────────────────────

    /**
     * GET /rpc/patch/query
     * Query patches by status, patch_id, include_environment.
     * @param {string} baseUrl
     * @param {object} opts - { status, patch_id, include_environment }
     * @returns {Promise<{ok, status, result, failure}>}
     */
    async function fetchPatches(baseUrl, opts) {
        opts = opts || {};
        const params = new Array();
        if (opts.status) params.push('status=' + encodeURIComponent(opts.status));
        if (opts.patch_id) params.push('patch_id=' + encodeURIComponent(opts.patch_id));
        if (opts.include_environment) params.push('include_environment=true');
        const qs = params.length > 0 ? '?' + params.join('&') : '';
        const res = await rpc('GET', '/rpc/patch/query' + qs, undefined, baseUrl);
        if (res.ok) {
            return { ok: true, status: res.status, patches: res.result.patches || [], count: res.result.count || 0, result: res.result };
        }
        return { ok: false, status: res.status, patches: [], count: 0, failure: res.failure, result: null };
    }

    /**
     * POST /rpc/patch/propose
     * @param {string} baseUrl
     * @param {object} params - { title, description, patch_body_json }
     */
    async function proposePatch(baseUrl, params) {
        params = params || {};
        if (!params.title || typeof params.title !== 'string') {
            return { ok: false, status: 0, failure: { message: 'title is required (string)' } };
        }
        if (!params.patch_body_json || typeof params.patch_body_json !== 'string') {
            return { ok: false, status: 0, failure: { message: 'patch_body_json is required (stringified JSON)' } };
        }
        const body = { title: params.title, patch_body_json: params.patch_body_json };
        if (params.description) body.description = params.description;
        if (params.source_ref) body.source_ref = params.source_ref;
        return rpc('POST', '/rpc/patch/propose', body, baseUrl);
    }

    /**
     * POST /rpc/patch/validate
     * @param {string} baseUrl
     * @param {object} params - { patch_id, validated_by, validation_notes_json }
     */
    async function validatePatch(baseUrl, params) {
        params = params || {};
        if (!isValidULID(params.patch_id)) {
            return { ok: false, status: 0, failure: { message: 'patch_id is required (valid ULID)' } };
        }
        if (!params.validated_by || typeof params.validated_by !== 'string') {
            return { ok: false, status: 0, failure: { message: 'validated_by is required (string)' } };
        }
        const body = { patch_id: params.patch_id, validated_by: params.validated_by };
        if (params.validation_notes_json) body.validation_notes_json = params.validation_notes_json;
        return rpc('POST', '/rpc/patch/validate', body, baseUrl);
    }

    /**
     * POST /rpc/patch/activate
     * @param {string} baseUrl
     * @param {object} params - { patch_id }
     */
    async function activatePatch(baseUrl, params) {
        params = params || {};
        if (!isValidULID(params.patch_id)) {
            return { ok: false, status: 0, failure: { message: 'patch_id is required (valid ULID)' } };
        }
        return rpc('POST', '/rpc/patch/activate', { patch_id: params.patch_id }, baseUrl);
    }

    /**
     * POST /rpc/patch/deactivate
     * @param {string} baseUrl
     * @param {object} params - { patch_id }
     */
    async function deactivatePatch(baseUrl, params) {
        params = params || {};
        if (!isValidULID(params.patch_id)) {
            return { ok: false, status: 0, failure: { message: 'patch_id is required (valid ULID)' } };
        }
        return rpc('POST', '/rpc/patch/deactivate', { patch_id: params.patch_id }, baseUrl);
    }

    /**
     * POST /rpc/patch/revert
     * @param {string} baseUrl
     * @param {object} params - { patch_id, reverted_by, revert_reason }
     */
    async function revertPatch(baseUrl, params) {
        params = params || {};
        if (!isValidULID(params.patch_id)) {
            return { ok: false, status: 0, failure: { message: 'patch_id is required (valid ULID)' } };
        }
        if (!params.reverted_by || typeof params.reverted_by !== 'string') {
            return { ok: false, status: 0, failure: { message: 'reverted_by is required (string)' } };
        }
        const body = { patch_id: params.patch_id, reverted_by: params.reverted_by };
        if (params.revert_reason) body.revert_reason = params.revert_reason;
        return rpc('POST', '/rpc/patch/revert', body, baseUrl);
    }

    /**
     * POST /rpc/patch/revalidate
     * @param {string} baseUrl
     * @param {object} params - { patch_id, validation_result, validated_by }
     */
    async function revalidatePatch(baseUrl, params) {
        params = params || {};
        if (!isValidULID(params.patch_id)) {
            return { ok: false, status: 0, failure: { message: 'patch_id is required (valid ULID)' } };
        }
        if (params.validation_result && !['valid', 'invalid'].includes(params.validation_result)) {
            return { ok: false, status: 0, failure: { message: 'validation_result must be "valid" or "invalid"' } };
        }
        const body = { patch_id: params.patch_id };
        if (params.validation_result) body.validation_result = params.validation_result;
        if (params.validated_by) body.validated_by = params.validated_by;
        if (params.validation_notes_json) body.validation_notes_json = params.validation_notes_json;
        return rpc('POST', '/rpc/patch/revalidate', body, baseUrl);
    }

    /**
     * POST /rpc/patch/supersede
     * @param {string} baseUrl
     * @param {object} params - { patch_id, superseded_by_patch_id }
     */
    async function supersedePatch(baseUrl, params) {
        params = params || {};
        if (!isValidULID(params.patch_id)) {
            return { ok: false, status: 0, failure: { message: 'patch_id is required (valid ULID)' } };
        }
        if (!isValidULID(params.superseded_by_patch_id)) {
            return { ok: false, status: 0, failure: { message: 'superseded_by_patch_id is required (valid ULID)' } };
        }
        return rpc('POST', '/rpc/patch/supersede', {
            patch_id: params.patch_id,
            superseded_by_patch_id: params.superseded_by_patch_id
        }, baseUrl);
    }

    // ──────────────────────────────────────────────────────────────
    // UI state helpers (pure functions)
    // ──────────────────────────────────────────────────────────────

    /**
     * Get color scheme for a patch status.
     * @param {string} status
     * @returns {{bg, text, border}}
     */
    function getStatusColor(status) {
        return STATUS_COLORS[status] || STATUS_COLORS.proposed;
    }

    /**
     * Get available actions for a patch status.
     * @param {string} status
     * @returns {string[]} array of action keys
     */
    function getStatusActions(status) {
        return STATUS_ACTIONS[status] || [];
    }

    /**
     * Get color scheme for an environment health status.
     * @param {string} healthStatus
     * @returns {{bg, text, icon}}
     */
    function getEnvHealthColor(healthStatus) {
        return ENV_HEALTH_COLORS[healthStatus] || ENV_HEALTH_COLORS.unknown;
    }

    /**
     * Build HTML for a status badge.
     * @param {string} status
     * @returns {string} HTML string
     */
    function buildStatusBadge(status) {
        const c = getStatusColor(status);
        const label = PATCH_STATUS_LABELS[status] || status;
        return '<span class="patch-badge" style="background:' + c.bg + ';color:' + c.text + ';border:1px solid ' + c.border + '">' + esc(label) + '</span>';
    }

    /**
     * Build HTML for an environment health indicator.
     * @param {string} healthStatus - healthy|degraded|unhealthy|unknown
     * @param {string} [lastChecked] - ISO timestamp
     * @returns {string} HTML string
     */
    function buildHealthIndicator(healthStatus, lastChecked) {
        const c = getEnvHealthColor(healthStatus);
        const label = ENV_HEALTH_LABELS[healthStatus] || ENV_HEALTH_LABELS.unknown;
        let html = '<span class="env-health-indicator" style="background:' + c.bg + ';color:' + c.text + ';border:1px solid ' + c.border + ';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">';
        html += c.icon + ' ' + esc(label);
        html += '</span>';
        if (lastChecked) {
            html += '<span class="env-health-time" style="font-size:11px;color:#656d76;margin-left:6px;">检查于 ' + esc(formatTimestamp(lastChecked)) + '</span>';
        }
        return html;
    }

    /**
     * Build HTML for action buttons based on patch status.
     * @param {string} status
     * @param {string} patchId
     * @returns {string} HTML string
     */
    function buildActionButtons(status, patchId) {
        const actions = getStatusActions(status);
        if (actions.length === 0) return '';
        return actions.map(action => {
            const cls = ACTION_BUTTON_CLASS[action] || 'secondary';
            const label = ACTION_LABELS[action] || action;
            return '<button class="patch-action ' + cls + '" data-action="' + esc(action) + '" data-patch-id="' + esc(patchId) + '">' + esc(label) + '</button>';
        }).join('');
    }

    /**
     * Format a patch card as HTML.
     * @param {object} patch - patch projection row
     * @returns {string} HTML string
     */
    function formatPatchCard(patch) {
        if (!patch || !patch.patch_id) return '';
        const status = patch.patch_status || 'proposed';
        const c = getStatusColor(status);
        const desc = truncate(patch.description, 120);
        const title = patch.title || '(无标题)';
        const created = formatTimestamp(patch.created_at);
        const updated = formatTimestamp(patch.updated_at || patch.last_updated_at);
        const envHealth = patch.environment_health || 'unknown';

        let html = '<div class="patch-card st-' + esc(status) + '" data-patch-id="' + esc(patch.patch_id) + '" style="border-left:3px solid ' + c.border + ';">';
        html += '<div class="patch-card-header">';
        html += '<div class="patch-card-title">' + esc(title) + '</div>';
        html += buildStatusBadge(status);
        html += '</div>';
        if (desc) {
            html += '<div class="patch-card-desc">' + esc(desc) + '</div>';
        }
        html += '<div class="patch-card-meta">';
        html += '<span class="mono">' + esc(shortId(patch.patch_id, 10)) + '…</span>';
        html += '<span>创建: ' + esc(created) + '</span>';
        html += '<span>更新: ' + esc(updated) + '</span>';
        html += '</div>';
        // Environment health mini-indicator
        html += '<div class="patch-card-env">' + buildHealthIndicator(envHealth, patch.health_checked_at) + '</div>';
        // Action buttons
        html += '<div class="patch-card-actions">' + buildActionButtons(status, patch.patch_id) + '</div>';
        html += '</div>';
        return html;
    }

    /**
     * Format the detail panel content for a single patch.
     * @param {object} patch
     * @returns {string} HTML string
     */
    function formatPatchDetail(patch) {
        if (!patch) return '<div class="empty-honest">选择一个补丁查看详情</div>';
        const status = patch.patch_status || 'proposed';
        const envHealth = patch.environment_health || 'unknown';

        let html = '<div class="patch-detail">';
        html += '<h3>' + esc(patch.title || '(无标题)') + '</h3>';
        html += '<div style="margin-bottom:8px;">' + buildStatusBadge(status) + ' ' + buildHealthIndicator(envHealth, patch.health_checked_at) + '</div>';

        if (patch.description) {
            html += '<div class="detail-section"><label>描述</label><div>' + esc(patch.description) + '</div></div>';
        }

        html += '<div class="detail-section"><label>补丁 ID</label><div class="mono">' + esc(patch.patch_id) + '</div></div>';

        if (patch.patch_body_json) {
            const body = parsePayload(patch.patch_body_json);
            html += '<div class="detail-section"><label>补丁内容 (patch_body_json)</label><pre class="mono">' + esc(JSON.stringify(body || patch.patch_body_json, null, 2)) + '</pre></div>';
        }

        if (patch.validated_by) {
            html += '<div class="detail-section"><label>验证者</label><div>' + esc(patch.validated_by) + '</div></div>';
            html += '<div class="detail-section"><label>验证时间</label><div>' + esc(formatTimestamp(patch.validated_at)) + '</div></div>';
        }

        if (patch.validation_notes_json) {
            const notes = parsePayload(patch.validation_notes_json);
            html += '<div class="detail-section"><label>验证备注</label><pre class="mono">' + esc(JSON.stringify(notes || patch.validation_notes_json, null, 2)) + '</pre></div>';
        }

        if (patch.activated_at) {
            html += '<div class="detail-section"><label>激活时间</label><div>' + esc(formatTimestamp(patch.activated_at)) + '</div></div>';
        }

        if (patch.reverted_at) {
            html += '<div class="detail-section"><label>回退时间</label><div>' + esc(formatTimestamp(patch.reverted_at)) + '</div></div>';
            if (patch.reverted_by) html += '<div class="detail-section"><label>回退者</label><div>' + esc(patch.reverted_by) + '</div></div>';
            if (patch.revert_reason) html += '<div class="detail-section"><label>回退原因</label><div>' + esc(patch.revert_reason) + '</div></div>';
        }

        if (patch.superseded_by) {
            html += '<div class="detail-section"><label>被废弃</label><div class="mono">' + esc(patch.superseded_by) + '</div></div>';
        }

        html += '<div class="detail-section"><label>创建时间</label><div>' + esc(formatTimestamp(patch.created_at)) + '</div></div>';
        html += '<div class="detail-section"><label>更新时间</label><div>' + esc(formatTimestamp(patch.updated_at || patch.last_updated_at)) + '</div></div>';

        if (patch.environment_files && Array.isArray(patch.environment_files)) {
            html += '<div class="detail-section"><label>环境文件 (' + patch.environment_files.length + ')</label><div>';
            if (patch.environment_files.length === 0) {
                html += '<span style="color:#656d76;">无环境文件</span>';
            } else {
                html += '<ul style="list-style:none;padding:0;">';
                for (const ef of patch.environment_files) {
                    html += '<li class="mono" style="font-size:11px;padding:2px 0;">' + esc(JSON.stringify(ef)) + '</li>';
                }
                html += '</ul>';
            }
            html += '</div></div>';
        }

        html += '<div class="detail-actions">' + buildActionButtons(status, patch.patch_id) + '</div>';
        html += '</div>';
        return html;
    }

    /**
     * Filter patches by status (for tab filtering).
     * @param {Array} patches
     * @param {string} statusFilter - null/'' for all
     * @returns {Array}
     */
    function filterByStatus(patches, statusFilter) {
        if (!statusFilter || statusFilter === 'all') return patches;
        return patches.filter(p => p.patch_status === statusFilter);
    }

    /**
     * Count patches by status (for tab badges).
     * @param {Array} patches
     * @returns {object} {all, proposed, validated, active, needs_revalidation, reverted, superseded}
     */
    function countByStatus(patches) {
        const counts = { all: patches.length, proposed: 0, validated: 0, active: 0, needs_revalidation: 0, reverted: 0, superseded: 0 };
        for (const p of patches) {
            const s = p.patch_status;
            if (counts.hasOwnProperty(s)) counts[s]++;
        }
        return counts;
    }

    /**
     * Build propose payload with validation.
     * @param {object} fields - { title, description, patch_body_json }
     * @returns {object} payload for POST /rpc/patch/propose
     * @throws if invalid
     */
    function buildProposePayload(fields) {
        if (!fields || !fields.title || typeof fields.title !== 'string') {
            throw new Error('title is required (string)');
        }
        if (!fields.patch_body_json || typeof fields.patch_body_json !== 'string') {
            throw new Error('patch_body_json is required (stringified JSON)');
        }
        const payload = { title: fields.title, patch_body_json: fields.patch_body_json };
        if (fields.description) payload.description = fields.description;
        if (fields.source_ref) payload.source_ref = fields.source_ref;
        return payload;
    }

    /**
     * Build validate payload with validation.
     * @throws if invalid
     */
    function buildValidatePayload(patchId, validatedBy, validationNotesJson) {
        if (!isValidULID(patchId)) throw new Error('invalid patch_id');
        if (!validatedBy || typeof validatedBy !== 'string') throw new Error('validated_by is required (string)');
        const payload = { patch_id: patchId, validated_by: validatedBy };
        if (validationNotesJson) payload.validation_notes_json = validationNotesJson;
        return payload;
    }

    /**
     * Build revert payload with validation.
     * @throws if invalid
     */
    function buildRevertPayload(patchId, revertedBy, revertReason) {
        if (!isValidULID(patchId)) throw new Error('invalid patch_id');
        if (!revertedBy || typeof revertedBy !== 'string') throw new Error('reverted_by is required (string)');
        const payload = { patch_id: patchId, reverted_by: revertedBy };
        if (revertReason) payload.revert_reason = revertReason;
        return payload;
    }

    /**
     * Build revalidate payload with validation.
     * @throws if invalid
     */
    function buildRevalidatePayload(patchId, validationResult, validatedBy) {
        if (!isValidULID(patchId)) throw new Error('invalid patch_id');
        if (!['valid', 'invalid'].includes(validationResult)) throw new Error('validation_result must be "valid" or "invalid"');
        const payload = { patch_id: patchId, validation_result: validationResult };
        if (validatedBy) payload.validated_by = validatedBy;
        return payload;
    }

    /**
     * Build supersede payload with validation.
     * @throws if invalid
     */
    function buildSupersedePayload(patchId, supersededByPatchId) {
        if (!isValidULID(patchId)) throw new Error('invalid patch_id');
        if (!isValidULID(supersededByPatchId)) throw new Error('invalid superseded_by_patch_id');
        return { patch_id: patchId, superseded_by_patch_id: supersededByPatchId };
    }

    // ──────────────────────────────────────────────────────────────
    // Export
    // ──────────────────────────────────────────────────────────────
    return {
        // Constants
        PATCH_STATUSES,
        PATCH_STATUS_LABELS,
        ENV_HEALTH_STATUSES,
        ENV_HEALTH_LABELS,
        STATUS_COLORS,
        ENV_HEALTH_COLORS,
        STATUS_ACTIONS,
        ACTION_LABELS,
        ACTION_BUTTON_CLASS,

        // Generators & helpers
        generateULID,
        isValidULID,
        shortId,
        parsePayload,
        esc,
        truncate,
        formatTimestamp,

        // RPC
        rpc,

        // API client functions (8 endpoints)
        fetchPatches,
        proposePatch,
        validatePatch,
        activatePatch,
        deactivatePatch,
        revertPatch,
        revalidatePatch,
        supersedePatch,

        // UI state helpers
        getStatusColor,
        getStatusActions,
        getEnvHealthColor,
        buildStatusBadge,
        buildHealthIndicator,
        buildActionButtons,
        formatPatchCard,
        formatPatchDetail,
        filterByStatus,
        countByStatus,

        // Payload builders
        buildProposePayload,
        buildValidatePayload,
        buildRevertPayload,
        buildRevalidatePayload,
        buildSupersedePayload
    };
});
