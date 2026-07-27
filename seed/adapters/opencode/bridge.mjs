/**
 * OpenCode Bridge — Phase 5 (Deep Link + HTTP API/SSE + 标准化输出回读)
 *
 * Responsibilities:
 *   - dispatchTask: create OpenCode session, enqueue message via prompt_async,
 *     attempt Deep Link to bring UI to foreground. API不可达则如实返回错误，不伪造。
 *   - watchResult: fs.watch + polling fallback to detect the result JSON file
 *     written by OpenCode per the standardized output contract. Validates nonce
 *     and schema before accepting.
 *   - abortTask: abort a running OpenCode session via POST /session/:id/abort.
 *   - getStatus: query live session status via GET /session/:id and /session/status.
 *
 * Design principles (from ADR 2026-07-17 & 2026-07-18):
 *   - prompt_async returning 204 is NOT proof of execution — only the result
 *     file (standardized output contract) is the completion authority.
 *   - /session/status is supplemental evidence, not completion authority.
 *   - Deep Link (opencode://) only brings the UI to foreground; it does not
 *     carry task parameters. If OpenCode cannot accept params via Deep Link,
 *     DCF creates the task via API first, then opens the UI.
 *   - All failures are recorded honestly with evidence; no fabricated results.
 *
 * Zero npm dependencies (Node 18+ http/https/crypto/fs/child_process).
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

// ---------------------------------------------------------------------------
// Generic HTTP client (native http/https)
// ---------------------------------------------------------------------------

/**
 * Make an HTTP/HTTPS request and return { status, headers, body }.
 * @param {string} method — HTTP method
 * @param {string} fullUrl — full URL
 * @param {Object} [headers={}] — request headers
 * @param {string|null} [bodyText=null] — serialized body
 * @param {number} [timeoutMs=30000] — request timeout
 * @returns {Promise<{status: number, headers: Object, body: string}>}
 */
export function httpRequest(method, fullUrl, headers = {}, bodyText = null, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(fullUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const options = {
            method,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + (parsed.search || ''),
            headers: { ...headers }
        };
        if (bodyText != null) {
            options.headers['Content-Length'] = Buffer.byteLength(bodyText);
        }

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
        });

        if (bodyText != null) req.write(bodyText);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Default Deep Link launcher (best-effort, platform-specific)
// ---------------------------------------------------------------------------

/**
 * Default Deep Link launcher. On macOS uses `open`, on Linux uses `xdg-open`.
 * In tests this is replaced with a mock.
 * @param {string} deepLinkUrl — the opencode:// URL
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export function defaultDeepLinkLauncher(deepLinkUrl) {
    return new Promise((resolve) => {
        const cmd = process.platform === 'darwin'
            ? 'open'
            : process.platform === 'linux'
                ? 'xdg-open'
                : null;

        if (!cmd) {
            resolve({ ok: false, error: `Deep Link not supported on platform: ${process.platform}` });
            return;
        }

        // Use spawn with argv array (no shell interpolation) for safety
        const child = spawn(cmd, [deepLinkUrl], { stdio: 'ignore' });
        child.on('error', (err) => {
            resolve({ ok: false, error: err.message });
        });
        child.on('exit', (code) => {
            resolve({ ok: code === 0, error: code !== 0 ? `exit code ${code}` : null });
        });
    });
}

// ---------------------------------------------------------------------------
// Result JSON validation
// ---------------------------------------------------------------------------

/**
 * Validate the result JSON written by OpenCode against the standardized output contract.
 *
 * Schema:
 *   {
 *     task_id: string,
 *     nonce: string,
 *     status: "completed" | "failed",
 *     products: array,
 *     evidence: { session_id?: string, messages_count?: number, error?: string|null, ... }
 *   }
 *
 * @param {*} data — parsed JSON
 * @param {string} expectedNonce — the nonce issued at dispatch time
 * @param {string|null} [expectedTaskId=null] — optional task_id check
 * @returns {{ valid: boolean, errors: string[], rejected: boolean }}
 *   rejected=true means nonce mismatch (tampering / wrong task) — must NOT be ingested.
 */
export function validateResultJson(data, expectedNonce, expectedTaskId = null) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['result is not an object'], rejected: false };
    }

    if (typeof data.task_id !== 'string' || !data.task_id) {
        errors.push('task_id must be a non-empty string');
    }

    if (typeof data.nonce !== 'string' || !data.nonce) {
        errors.push('nonce must be a non-empty string');
    }

    if (!['completed', 'failed'].includes(data.status)) {
        errors.push('status must be "completed" or "failed"');
    }

    if (!Array.isArray(data.products)) {
        errors.push('products must be an array');
    }

    if (!data.evidence || typeof data.evidence !== 'object') {
        errors.push('evidence must be an object');
    }

    // Nonce check — hard rejection (different task / tampering)
    if (typeof data.nonce === 'string' && data.nonce !== expectedNonce) {
        return {
            valid: false,
            errors: [`nonce mismatch: expected ${expectedNonce}, got ${data.nonce}`],
            rejected: true
        };
    }

    // Task ID check (if provided)
    if (expectedTaskId && typeof data.task_id === 'string' && data.task_id !== expectedTaskId) {
        errors.push(`task_id mismatch: expected ${expectedTaskId}, got ${data.task_id}`);
    }

    return { valid: errors.length === 0, errors, rejected: false };
}

// ---------------------------------------------------------------------------
// Generate a cryptographic nonce
// ---------------------------------------------------------------------------

/**
 * Generate a random nonce for task dispatch.
 * @returns {string} 32-char hex string
 */
export function generateNonce() {
    return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// OpenCodeBridge
// ---------------------------------------------------------------------------

/**
 * OpenCode Bridge — manages task dispatch, result watching, abort, and status
 * queries against the OpenCode HTTP API.
 */
export class OpenCodeBridge {
    /**
     * @param {Object} opts
     * @param {string} [opts.baseURL='http://127.0.0.1:4096'] — OpenCode server base URL
     * @param {string} [opts.username='opencode'] — Basic Auth username
     * @param {string|null} [opts.password=null] — Basic Auth password
     * @param {Function|null} [opts.deepLinkLauncher=null] — override Deep Link launcher
     * @param {Function|null} [opts.httpFn=null] — override HTTP client (for testing)
     */
    constructor({
        baseURL = 'http://127.0.0.1:4096',
        username = 'opencode',
        password = null,
        deepLinkLauncher = null,
        httpFn = null
    } = {}) {
        this.baseURL = baseURL.replace(/\/$/, '');
        this.username = username;
        this.password = password;
        this._tasks = new Map(); // task_id → task state
        this._deepLinkLauncher = deepLinkLauncher || defaultDeepLinkLauncher;
        this._http = httpFn || httpRequest;
    }

    /**
     * Build Basic Auth header.
     * @returns {Object}
     */
    _authHeader() {
        if (this.password) {
            const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
            return { Authorization: `Basic ${token}` };
        }
        return {};
    }

    /**
     * Internal: call the OpenCode API.
     * @param {string} method — HTTP method
     * @param {string} apiPath — API path (e.g. /session)
     * @param {Object|null} [body=null] — request body (will be JSON-serialized)
     * @param {number} [timeoutMs=30000]
     * @returns {Promise<{status: number, body: string}>}
     */
    async _api(method, apiPath, body = null, timeoutMs = 30000) {
        const headers = { ...this._authHeader() };
        let bodyText = null;
        if (body !== null) {
            bodyText = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        const fullUrl = `${this.baseURL}${apiPath}`;
        const result = await this._http(method, fullUrl, headers, bodyText, timeoutMs);
        return result;
    }

    /**
     * Build the full prompt including the standardized output contract.
     * The prompt instructs OpenCode to write the result JSON to output_path.
     *
     * @param {string} prompt — the original task prompt
     * @param {string} task_id — DCF task ID
     * @param {string} nonce — cryptographic nonce for validation
     * @param {string} output_path — absolute path where OpenCode should write the result
     * @returns {string} full prompt with output contract appended
     */
    _buildPrompt(prompt, task_id, nonce, output_path) {
        return `${prompt}

=== DCF 标准化输出契约 ===
请在任务完成后将结果以 JSON 格式写入文件：${output_path}

JSON Schema:
{
  "task_id": "${task_id}",
  "nonce": "${nonce}",
  "status": "completed" | "failed",
  "products": [
    {
      "type": "card" | "maintenance_task",
      "title": "...",
      "summary": "...",
      "evidence": ["..."],
      "boundary_inherit": "OBSERVE_CURRENT_ONLY",
      "source_conversation": "..."
    }
  ],
  "evidence": {
    "session_id": "<your OpenCode session id>",
    "messages_count": <number>,
    "error": null | "<error message if failed>"
  }
}

注意：
- nonce 必须为 ${nonce}，否则结果将被拒绝入库
- task_id 必须为 ${task_id}
- 如果任务失败，status 设为 "failed"，evidence.error 填写原因
- products 可以为空数组（无结构化产物时），但字段必须存在
=== END DCF 标准化输出契约 ===`;
    }

    /**
     * Dispatch a task to OpenCode.
     *
     * Flow:
     *   1. POST /session — create a new session
     *   2. POST /session/:id/prompt_async — enqueue the message (non-blocking)
     *   3. Attempt Deep Link (opencode://) to bring UI to foreground
     *
     * NOTE: prompt_async returning 204 is NOT proof that the task started.
     * Only the result file (written per the output contract) is completion authority.
     *
     * @param {Object} params
     * @param {string} params.task_id — DCF task ID
     * @param {string} params.prompt — the task prompt
     * @param {string} params.output_path — absolute path for result JSON
     * @param {string} params.nonce — cryptographic nonce
     * @param {string} [params.conversation_url=null] — source conversation URL
     * @param {string} [params.entity_id=null] — source entity ID
     * @param {string} [params.title=null] — optional session title
     * @param {string} [params.agent=null] — optional OpenCode agent ID
     * @param {string} [params.model=null] — optional OpenCode model ID
     * @returns {Promise<Object>} { task_id, status, session_id, deep_link, deep_link_result, error? }
     */
    async dispatchTask({ task_id, prompt, output_path, nonce, conversation_url = null, entity_id = null, title = null, agent = null, model = null }) {
        const now = new Date().toISOString();

        // Step 1: Create session
        const sessionBody = {};
        if (title) sessionBody.title = String(title).slice(0, 240);

        let sessionRes;
        try {
            sessionRes = await this._api('POST', '/session', sessionBody);
        } catch (e) {
            // API unreachable — honest error, no fabrication
            this._tasks.set(task_id, {
                status: 'failed', error: `OpenCode API unreachable: ${e.message}`,
                session_id: null, output_path, nonce, created_at: now
            });
            return { task_id, status: 'failed', error: `OpenCode API unreachable: ${e.message}`, session_id: null };
        }

        if (sessionRes.status >= 400) {
            const err = `Failed to create session: HTTP ${sessionRes.status}: ${sessionRes.body.slice(0, 500)}`;
            this._tasks.set(task_id, { status: 'failed', error: err, session_id: null, output_path, nonce, created_at: now });
            return { task_id, status: 'failed', error: err, session_id: null };
        }

        let session;
        try {
            session = JSON.parse(sessionRes.body);
        } catch (e) {
            const err = `Session response parse error: ${e.message}`;
            this._tasks.set(task_id, { status: 'failed', error: err, session_id: null, output_path, nonce, created_at: now });
            return { task_id, status: 'failed', error: err, session_id: null };
        }

        const sessionId = session.id || session.session_id;
        if (!sessionId) {
            const err = 'Session response missing id field';
            this._tasks.set(task_id, { status: 'failed', error: err, session_id: null, output_path, nonce, created_at: now });
            return { task_id, status: 'failed', error: err, session_id: null };
        }

        // Step 2: Send message via prompt_async (non-blocking enqueue)
        const fullPrompt = this._buildPrompt(prompt, task_id, nonce, output_path);
        const messageBody = {
            parts: [{ type: 'text', text: fullPrompt }]
        };
        if (agent) messageBody.agent = agent;
        if (model) messageBody.model = model;

        let msgRes;
        try {
            msgRes = await this._api('POST', `/session/${encodeURIComponent(sessionId)}/prompt_async`, messageBody);
        } catch (e) {
            const err = `Failed to send message: ${e.message}`;
            this._tasks.set(task_id, { status: 'failed', error: err, session_id: sessionId, output_path, nonce, created_at: now });
            return { task_id, status: 'failed', error: err, session_id: sessionId };
        }

        // prompt_async returns 204 on success — but this is NOT proof of execution (per ADR)
        if (msgRes.status >= 400 && msgRes.status !== 204) {
            const err = `Failed to send message: HTTP ${msgRes.status}: ${msgRes.body.slice(0, 500)}`;
            this._tasks.set(task_id, { status: 'failed', error: err, session_id: sessionId, output_path, nonce, created_at: now });
            return { task_id, status: 'failed', error: err, session_id: sessionId };
        }

        // Step 3: Attempt Deep Link (best-effort, does not affect task status)
        const deepLinkUrl = `opencode://session/${encodeURIComponent(sessionId)}`;
        let deepLinkResult = null;
        try {
            deepLinkResult = await this._deepLinkLauncher(deepLinkUrl);
        } catch (e) {
            deepLinkResult = { ok: false, error: e.message };
        }

        // Record task state
        this._tasks.set(task_id, {
            status: 'dispatched',
            session_id: sessionId,
            output_path,
            nonce,
            prompt: fullPrompt,
            conversation_url,
            entity_id,
            created_at: now,
            deep_link: { url: deepLinkUrl, result: deepLinkResult },
            result: null,
            error: null
        });

        return {
            task_id,
            status: 'dispatched',
            session_id: sessionId,
            deep_link: deepLinkUrl,
            deep_link_result: deepLinkResult
        };
    }

    /**
     * Watch for the result JSON file at output_path.
     *
     * Uses fs.watch for immediate notification plus polling fallback (1s interval)
     * to handle platforms where fs.watch is unreliable. When the file appears and
     * contains valid JSON with matching nonce, resolves with the result.
     *
     * @param {string} output_path — absolute path to watch
     * @param {Object} opts
     * @param {number} [opts.timeoutMs=300000] — watch timeout (default 5 minutes)
     * @param {string} [opts.nonce] — expected nonce for validation
     * @param {string} [opts.task_id=null] — expected task_id for validation
     * @returns {Promise<Object>} resolves to one of:
     *   { ok: true, data, output_path } — valid result
     *   { ok: false, rejected: true, reason, raw_data, output_path } — nonce mismatch
     *   { ok: false, timeout: true, reason, output_path } — timed out
     */
    watchResult(output_path, { timeoutMs = 300000, nonce, task_id = null } = {}) {
        const startTime = Date.now();
        const pollIntervalMs = 1000;

        return new Promise((resolve) => {
            let watcher = null;
            let pollTimer = null;
            let timeoutTimer = null;
            let resolved = false;

            const cleanup = () => {
                if (watcher) { try { watcher.close(); } catch (_) {} }
                if (pollTimer) clearInterval(pollTimer);
                if (timeoutTimer) clearTimeout(timeoutTimer);
            };

            const checkFile = () => {
                if (resolved) return;
                try {
                    if (!fs.existsSync(output_path)) return;
                    const raw = fs.readFileSync(output_path, 'utf8');
                    if (!raw || raw.trim() === '') return;

                    let data;
                    try {
                        data = JSON.parse(raw);
                    } catch (_) {
                        // File exists but not valid JSON yet — might be partially written
                        return;
                    }

                    // Validate
                    const validation = validateResultJson(data, nonce, task_id);

                    if (validation.rejected) {
                        // Nonce mismatch — hard reject (tampering / wrong task)
                        resolved = true;
                        cleanup();
                        resolve({
                            ok: false,
                            rejected: true,
                            reason: validation.errors.join('; '),
                            raw_data: data,
                            output_path
                        });
                        return;
                    }

                    if (!validation.valid) {
                        // Schema invalid — might be partial write, keep waiting
                        return;
                    }

                    // Valid result
                    resolved = true;
                    cleanup();
                    resolve({ ok: true, data, output_path });
                } catch (_) {
                    // File read error — keep waiting
                }
            };

            // Initial check
            checkFile();

            // fs.watch for immediate notification
            try {
                const dir = path.dirname(output_path);
                if (fs.existsSync(dir)) {
                    watcher = fs.watch(dir, (eventType, filename) => {
                        if (filename === path.basename(output_path)) {
                            // Small delay for write completion
                            setTimeout(checkFile, 100);
                        }
                    });
                    watcher.on('error', () => { /* rely on polling */ });
                }
            } catch (_) { /* watch not available, rely on polling */ }

            // Polling fallback (always active as backup)
            pollTimer = setInterval(checkFile, pollIntervalMs);

            // Timeout
            timeoutTimer = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve({
                    ok: false,
                    timeout: true,
                    reason: `watchResult timed out after ${timeoutMs}ms`,
                    output_path
                });
            }, timeoutMs);
        });
    }

    /**
     * Abort a running OpenCode task.
     * @param {string} task_id — DCF task ID
     * @returns {Promise<Object>} { task_id, status, session_id, error? }
     */
    async abortTask(task_id) {
        const task = this._tasks.get(task_id);
        if (!task) {
            return { task_id, status: 'unknown', error: 'task not found' };
        }
        if (!task.session_id) {
            task.status = 'aborted';
            return { task_id, status: 'aborted', session_id: null, error: 'no session was created' };
        }

        // Already terminal?
        if (['completed', 'failed', 'aborted'].includes(task.status)) {
            return { task_id, status: task.status, session_id: task.session_id, error: `task already ${task.status}` };
        }

        try {
            const res = await this._api('POST', `/session/${encodeURIComponent(task.session_id)}/abort`, {});
            if (res.status >= 400) {
                return {
                    task_id,
                    status: 'failed',
                    session_id: task.session_id,
                    error: `Abort failed: HTTP ${res.status}: ${res.body.slice(0, 500)}`
                };
            }
            task.status = 'aborted';
            return { task_id, status: 'aborted', session_id: task.session_id };
        } catch (e) {
            return { task_id, status: 'failed', session_id: task.session_id, error: `Abort error: ${e.message}` };
        }
    }

    /**
     * Query the status of a dispatched task.
     *
     * If the task is already terminal (completed/failed/aborted), returns cached state.
     * Otherwise queries the OpenCode API for live session status.
     *
     * @param {string} task_id — DCF task ID
     * @returns {Promise<Object>} { task_id, status, session_id, output_path?, result?, error?, api_status? }
     */
    async getStatus(task_id) {
        const task = this._tasks.get(task_id);
        if (!task) {
            return { task_id, status: 'unknown', error: 'task not found' };
        }

        // If terminal with result, return cached
        if (['completed', 'failed', 'aborted'].includes(task.status) && task.result) {
            return {
                task_id,
                status: task.status,
                session_id: task.session_id,
                result: task.result,
                error: task.error,
                created_at: task.created_at
            };
        }

        // Query API for live status (supplemental evidence)
        let apiStatus = null;
        if (task.session_id) {
            try {
                const res = await this._api('GET', `/session/${encodeURIComponent(task.session_id)}`);
                if (res.status < 400) {
                    apiStatus = JSON.parse(res.body);
                }
            } catch (_) { /* API query failed, return cached status */ }
        }

        return {
            task_id,
            status: task.status,
            session_id: task.session_id,
            output_path: task.output_path,
            created_at: task.created_at,
            error: task.error,
            api_status: apiStatus ? {
                status: apiStatus.status || apiStatus.state || null,
                title: apiStatus.title || null
            } : null
        };
    }

    /**
     * Update a task's status and result (called by companion when watcher resolves).
     * @param {string} task_id
     * @param {string} status — new status
     * @param {Object|null} [result=null] — result data
     * @param {string|null} [error=null] — error message
     * @returns {boolean} true if task was found and updated
     */
    updateTaskStatus(task_id, status, result = null, error = null) {
        const task = this._tasks.get(task_id);
        if (!task) return false;
        task.status = status;
        if (result !== null) task.result = result;
        if (error !== null) task.error = error;
        return true;
    }

    /**
     * Get all tracked tasks (for Surface display).
     * @returns {Array<Object>}
     */
    getAllTasks() {
        return Array.from(this._tasks.entries()).map(([task_id, t]) => ({
            task_id,
            status: t.status,
            session_id: t.session_id,
            output_path: t.output_path,
            created_at: t.created_at,
            error: t.error,
            result: t.result,
            deep_link: t.deep_link || null
        }));
    }

    /**
     * Check if the OpenCode server is reachable.
     * @returns {Promise<{ok: boolean, version?: string, error?: string}>}
     */
    async healthCheck() {
        try {
            const res = await this._api('GET', '/global/health', null, 5000);
            if (res.status < 400) {
                const data = JSON.parse(res.body);
                return { ok: true, version: data.version || null };
            }
            return { ok: false, error: `HTTP ${res.status}` };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
}
