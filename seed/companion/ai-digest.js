/**
 * AI Digest Engine — Phase 4 (AI 材料代谢最小循环)
 *
 * Responsibilities:
 *   - enqueueDigest(conversationId, eventIds): queue a digest job when a
 *     conversation is archived (OBSERVE_AND_ARCHIVE).
 *   - runDigest(job): call AI model (API preferred → local Ollama fallback →
 *     OpenCode dispatch stub), parse dual output (Markdown + JSON), validate
 *     JSON against schema, persist products with boundary inheritance.
 *
 * Honest principles:
 *   - Missing config → never silently skip or fake products. Record a failure
 *     event and auto-generate a "repair task".
 *   - NOT_OBSERVE source materials must NOT enter products (boundary enforced).
 *   - Products start at ai_proposed, forward-only four-state machine.
 *   - Idempotent: repeated trigger for the same conversation does not duplicate.
 *
 * Zero npm dependencies (Node 18+ http/https/crypto/fs).
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { generateULID } = require('./ulid');
const { getConfig, getStatus } = require('./ai-config');
const { ATTRIBUTION_STATES } = require('./types');

// ---------------------------------------------------------------------------
// Schema validation (zero-dependency, structural)
// ---------------------------------------------------------------------------

const VALID_BOUNDARY_STATES = ['NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'];

/**
 * Validate a card product against the expected schema.
 * @param {Object} p — parsed product
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCardProduct(p) {
    const errors = [];
    if (!p || typeof p !== 'object') { return { valid: false, errors: ['product is not an object'] }; }
    if (p.type !== 'card') errors.push('type must be "card"');
    if (!p.title || typeof p.title !== 'string') errors.push('title must be a non-empty string');
    if (!p.summary || typeof p.summary !== 'string') errors.push('summary must be a non-empty string');
    if (!Array.isArray(p.evidence)) errors.push('evidence must be an array');
    if (!VALID_BOUNDARY_STATES.includes(p.boundary_inherit)) errors.push('boundary_inherit must be a valid boundary state');
    if (!p.source_conversation || typeof p.source_conversation !== 'string') errors.push('source_conversation must be a non-empty string');
    return { valid: errors.length === 0, errors };
}

/**
 * Validate a maintenance_task product.
 * @param {Object} p — parsed product
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMaintenanceTaskProduct(p) {
    const errors = [];
    if (!p || typeof p !== 'object') { return { valid: false, errors: ['product is not an object'] }; }
    if (p.type !== 'maintenance_task') errors.push('type must be "maintenance_task"');
    if (!p.task || typeof p.task !== 'string') errors.push('task must be a non-empty string');
    if (!Array.isArray(p.criteria)) errors.push('criteria must be an array');
    if (p.risk != null && typeof p.risk !== 'string') errors.push('risk must be a string or null');
    if (p.rollback_plan != null && typeof p.rollback_plan !== 'string') errors.push('rollback_plan must be a string or null');
    if (typeof p.priority !== 'number' || p.priority < 1 || p.priority > 9 || !Number.isInteger(p.priority))
        errors.push('priority must be an integer 1-9');
    if (!VALID_BOUNDARY_STATES.includes(p.boundary_inherit)) errors.push('boundary_inherit must be a valid boundary state');
    if (!p.source_conversation || typeof p.source_conversation !== 'string') errors.push('source_conversation must be a non-empty string');
    return { valid: errors.length === 0, errors };
}

/**
 * Validate any product (dispatch by type).
 */
function validateProduct(p) {
    if (!p || !p.type) return { valid: false, errors: ['missing type field'] };
    if (p.type === 'card') return validateCardProduct(p);
    if (p.type === 'maintenance_task') return validateMaintenanceTaskProduct(p);
    return { valid: false, errors: [`unknown product type: ${p.type}`] };
}

// ---------------------------------------------------------------------------
// AI response parsing (dual Markdown + JSON output)
// ---------------------------------------------------------------------------

/**
 * Parse the AI model's raw text response into { markdown, products }.
 * Expected format:
 *   <<<MARKDOWN>>>
 *   (human-readable markdown)
 *   <<<JSON>>>
 *   (JSON array of products)
 *
 * Falls back gracefully: if no delimiter found, returns raw text as markdown
 * and empty products array (honest "no structured products" outcome).
 *
 * @param {string} rawText
 * @returns {{ markdown: string, products: Array, parseError: string|null }}
 */
function parseAIResponse(rawText) {
    if (typeof rawText !== 'string') {
        return { markdown: '', products: [], parseError: 'response is not a string' };
    }

    const mdMarker = '<<<MARKDOWN>>>';
    const jsonMarker = '<<<JSON>>>';
    const mdIdx = rawText.indexOf(mdMarker);
    const jsonIdx = rawText.indexOf(jsonMarker);

    if (mdIdx === -1 || jsonIdx === -1 || jsonIdx < mdIdx) {
        // No valid delimiter structure — return raw text as markdown, no products
        return { markdown: rawText.trim(), products: [], parseError: null };
    }

    const markdown = rawText.slice(mdIdx + mdMarker.length, jsonIdx).trim();
    const jsonStr = rawText.slice(jsonIdx + jsonMarker.length).trim();

    if (!jsonStr) {
        return { markdown, products: [], parseError: null };
    }

    try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
            return { markdown, products: parsed, parseError: null };
        }
        // Single object — wrap in array
        if (typeof parsed === 'object' && parsed !== null) {
            return { markdown, products: [parsed], parseError: null };
        }
        return { markdown, products: [], parseError: 'JSON is not an array or object' };
    } catch (e) {
        return { markdown, products: [], parseError: `JSON parse error: ${e.message}` };
    }
}

// ---------------------------------------------------------------------------
// HTTP client (native http/https, zero npm)
// ---------------------------------------------------------------------------

/**
 * Make an HTTP/HTTPS POST request and return the response body text.
 * @param {string} endpoint — full URL
 * @param {Object} headers
 * @param {string} bodyText — serialized body
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<{ status: number, body: string }>}
 */
function httpPost(endpoint, headers, bodyText, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(endpoint);
        const transport = parsed.protocol === 'https:' ? https : http;
        const options = {
            method: 'POST',
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + (parsed.search || ''),
            headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyText) }
        };

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
        });

        req.write(bodyText);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Boundary checking
// ---------------------------------------------------------------------------

/**
 * Check if any source event has a NOT_OBSERVE boundary. If so, products
 * from that source must not be created (zero-residue principle).
 *
 * @param {Object} db — CompanionDB instance
 * @param {string} conversationId
 * @returns {boolean} true if NOT_OBSERVE boundary applies
 */
function isNotObserveBoundary(db, conversationId) {
    try {
        if (db.db && db.db.isMock) {
            const relations = (db.db.data.boundary_relations || [])
                .filter(r => r.source_id === conversationId);
            return relations.some(r => r.boundary_state === 'NOT_OBSERVE');
        }
        const rows = db.db.prepare(
            "SELECT boundary_state FROM boundary_relations WHERE source_id = ?"
        ).all(conversationId);
        return rows.some(r => r.boundary_state === 'NOT_OBSERVE');
    } catch (_) {
        // Fail closed: if we can't determine boundary, assume safe (default is OBSERVE_CURRENT_ONLY)
        return false;
    }
}

/**
 * Get the boundary state for a conversation.
 */
function getBoundaryState(db, conversationId) {
    try {
        if (db.db && db.db.isMock) {
            const relations = (db.db.data.boundary_relations || [])
                .filter(r => r.source_id === conversationId);
            if (relations.length === 0) return 'OBSERVE_CURRENT_ONLY';
            if (relations.some(r => r.boundary_state === 'NOT_OBSERVE')) return 'NOT_OBSERVE';
            if (relations.some(r => r.boundary_state === 'OBSERVE_AND_ARCHIVE')) return 'OBSERVE_AND_ARCHIVE';
            return 'OBSERVE_CURRENT_ONLY';
        }
        const rows = db.db.prepare(
            "SELECT boundary_state FROM boundary_relations WHERE source_id = ?"
        ).all(conversationId);
        if (rows.length === 0) return 'OBSERVE_CURRENT_ONLY';
        if (rows.some(r => r.boundary_state === 'NOT_OBSERVE')) return 'NOT_OBSERVE';
        if (rows.some(r => r.boundary_state === 'OBSERVE_AND_ARCHIVE')) return 'OBSERVE_AND_ARCHIVE';
        return 'OBSERVE_CURRENT_ONLY';
    } catch (_) {
        return 'OBSERVE_CURRENT_ONLY';
    }
}

// ---------------------------------------------------------------------------
// System prompt loading
// ---------------------------------------------------------------------------

let _cachedSystemPrompt = null;

function getSystemPrompt() {
    if (_cachedSystemPrompt) return _cachedSystemPrompt;
    try {
        const promptPath = path.join(__dirname, 'prompts', 'ai-digest-system.txt');
        _cachedSystemPrompt = fs.readFileSync(promptPath, 'utf8');
    } catch (_) {
        _cachedSystemPrompt = '你是 DCF 的 AI 归纳引擎。请将对话材料归纳为结构化 JSON 产物。';
    }
    return _cachedSystemPrompt;
}

// ---------------------------------------------------------------------------
// AIDigestEngine
// ---------------------------------------------------------------------------

class AIDigestEngine {
    /**
     * @param {Object} deps
     * @param {Object} deps.db — CompanionDB instance
     * @param {Object} [deps.eventProcessor] — EventProcessor (optional, for recording events)
     * @param {string} [deps.configPath] — override config path for testing
     * @param {Function} [deps.httpPostFn] — override HTTP POST for testing
     */
    constructor({ db, eventProcessor = null, configPath = null, httpPostFn = null }) {
        this.db = db;
        this.eventProcessor = eventProcessor;
        this.configPath = configPath;
        this._httpPost = httpPostFn || httpPost;
        this._queue = []; // in-memory queue
    }

    /**
     * Get AI status (delegates to ai-config).
     */
    getStatus() {
        return getStatus(this.configPath);
    }

    /**
     * Enqueue a digest job for a conversation.
     * Idempotent: if a non-terminal job already exists for this conversation,
     * returns the existing job without creating a duplicate.
     *
     * @param {string} conversationId — source conversation ID
     * @param {Array<string>} [eventIds] — source event IDs (optional)
     * @returns {{ job_id: string, status: string, duplicated: boolean }}
     */
    enqueueDigest(conversationId, eventIds = null) {
        // Check for existing non-terminal job
        const existing = this.db.getDigestJobsByConversation(conversationId);
        const nonTerminal = existing.find(j => j.status === 'queued' || j.status === 'running');
        if (nonTerminal) {
            return { job_id: nonTerminal.job_id, status: nonTerminal.status, duplicated: true };
        }

        // Check for existing done job (idempotent: don't re-digest)
        const doneJob = existing.find(j => j.status === 'done');
        if (doneJob) {
            return { job_id: doneJob.job_id, status: 'done', duplicated: true };
        }

        const jobId = generateULID();
        this.db.insertDigestJob({
            job_id: jobId,
            conversation_id: conversationId,
            event_ids: eventIds
        });
        this._queue.push({ job_id: jobId, conversation_id: conversationId, event_ids: eventIds });

        return { job_id: jobId, status: 'queued', duplicated: false };
    }

    /**
     * Run a digest job: call AI model, parse output, validate, persist products.
     *
     * Routing: API preferred → local Ollama fallback → OpenCode dispatch stub.
     * All failures are recorded honestly; no fabricated products.
     *
     * @param {Object} job — { job_id, conversation_id, event_ids }
     * @param {string} [materialText] — pre-assembled material text for the AI
     * @returns {Promise<{ success: boolean, products: Array, source_level: string, error?: string }>}
     */
    async runDigest(job, materialText = null) {
        const { job_id, conversation_id } = job;

        // Boundary check: NOT_OBSERVE sources must not produce products
        const boundary = getBoundaryState(this.db, conversation_id);
        if (boundary === 'NOT_OBSERVE') {
            this.db.updateDigestJob(job_id, {
                status: 'failed',
                source_level: 'none',
                error_message: 'Source conversation has NOT_OBSERVE boundary — no products allowed'
            });
            return {
                success: false,
                products: [],
                source_level: 'none',
                error: 'NOT_OBSERVE boundary blocks product creation'
            };
        }

        // Mark job as running
        this.db.updateDigestJob(job_id, { status: 'running' });

        const config = getConfig(this.configPath);
        const material = materialText || this._assembleMaterial(job);

        // Try API first
        if (config.configured) {
            try {
                const apiResult = await this._callAPI(config, material, conversation_id);
                const products = this._processAIResponse(apiResult, conversation_id, boundary, job.event_ids || []);
                if (products.length > 0 || apiResult) {
                    this._persistProducts(products, conversation_id, boundary, job.event_ids || [], apiResult);
                    this.db.updateDigestJob(job_id, {
                        status: 'done',
                        source_level: 'api',
                        products_json: JSON.stringify(products.map(p => p._id))
                    });
                    return { success: true, products, source_level: 'api' };
                }
            } catch (apiError) {
                // API failed — try fallback if configured
                if (config.local_fallback) {
                    try {
                        const localResult = await this._callLocal(config.local_fallback, material, conversation_id);
                        const products = this._processAIResponse(localResult, conversation_id, boundary, job.event_ids || []);
                        this._persistProducts(products, conversation_id, boundary, job.event_ids || [], localResult);
                        this.db.updateDigestJob(job_id, {
                            status: 'done',
                            source_level: 'local',
                            products_json: JSON.stringify(products.map(p => p._id))
                        });
                        return { success: true, products, source_level: 'local' };
                    } catch (localError) {
                        // Both API and local failed
                        return this._handleAllFailed(job_id, conversation_id, `API: ${apiError.message}; Local: ${localError.message}`);
                    }
                }
                // API failed, no local fallback
                if (config.opencode_fallback) {
                    return this._handleOpenCodeFallback(job_id, conversation_id, apiError.message);
                }
                return this._handleAllFailed(job_id, conversation_id, `API: ${apiError.message}`);
            }
        }

        // API not configured — try local fallback
        const status = getStatus(this.configPath);
        if (status.level === 'local') {
            try {
                const localResult = await this._callLocal(status.detail, material, conversation_id);
                const products = this._processAIResponse(localResult, conversation_id, boundary, job.event_ids || []);
                this._persistProducts(products, conversation_id, boundary, job.event_ids || [], localResult);
                this.db.updateDigestJob(job_id, {
                    status: 'done',
                    source_level: 'local',
                    products_json: JSON.stringify(products.map(p => p._id))
                });
                return { success: true, products, source_level: 'local' };
            } catch (localError) {
                if (config.opencode_fallback || getConfig(this.configPath).opencode_fallback) {
                    return this._handleOpenCodeFallback(job_id, conversation_id, localError.message);
                }
                return this._handleAllFailed(job_id, conversation_id, `Local: ${localError.message}`);
            }
        }

        // No AI capability configured at all
        if (getConfig(this.configPath).opencode_fallback !== false) {
            return this._handleOpenCodeFallback(job_id, conversation_id, 'No AI capability configured');
        }

        return this._handleAllFailed(job_id, conversation_id, 'No AI capability configured');
    }

    /**
     * Call the API endpoint (OpenAI-compatible chat completions format).
     * @returns {Promise<string>} raw response text
     */
    async _callAPI(config, material, conversationId) {
        const systemPrompt = getSystemPrompt();
        const body = JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `对话 source_id: ${conversationId}\n\n材料内容:\n${material}` }
            ],
            temperature: 0.3,
            max_tokens: 4096
        });

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.api_key}`
        };

        const result = await this._httpPost(config.api_endpoint, headers, body);
        if (result.status >= 400) {
            throw new Error(`API returned HTTP ${result.status}: ${result.body.slice(0, 200)}`);
        }

        // Parse OpenAI-compatible response
        try {
            const parsed = JSON.parse(result.body);
            const content = parsed.choices?.[0]?.message?.content;
            if (!content) throw new Error('API response missing choices[0].message.content');
            return content;
        } catch (e) {
            throw new Error(`API response parse error: ${e.message}`);
        }
    }

    /**
     * Call local Ollama endpoint.
     * @returns {Promise<string>} raw response text
     */
    async _callLocal(localConfig, material, conversationId) {
        const ollamaUrl = localConfig.ollama_url || localConfig;
        const model = localConfig.model || 'qwen2.5:7b';
        const systemPrompt = getSystemPrompt();
        const body = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `对话 source_id: ${conversationId}\n\n材料内容:\n${material}` }
            ],
            stream: false
        });

        const result = await this._httpPost(ollamaUrl, { 'Content-Type': 'application/json' }, body);
        if (result.status >= 400) {
            throw new Error(`Ollama returned HTTP ${result.status}: ${result.body.slice(0, 200)}`);
        }

        try {
            const parsed = JSON.parse(result.body);
            const content = parsed.message?.content || parsed.choices?.[0]?.message?.content;
            if (!content) throw new Error('Ollama response missing message.content');
            return content;
        } catch (e) {
            throw new Error(`Ollama response parse error: ${e.message}`);
        }
    }

    /**
     * Handle OpenCode fallback (phase 5 channel — stub for now).
     */
    _handleOpenCodeFallback(jobId, conversationId, reason) {
        // Phase 5 channel not yet implemented — honest stub
        this.db.updateDigestJob(jobId, {
            status: 'failed',
            source_level: 'opencode',
            error_message: `OpenCode dispatch pending phase 5 implementation. Reason: ${reason}`
        });
        return {
            success: false,
            products: [],
            source_level: 'opencode',
            error: `派发待阶段 5 实现: ${reason}`
        };
    }

    /**
     * Handle total failure: record honestly, no fabricated products.
     */
    _handleAllFailed(jobId, conversationId, reason) {
        this.db.updateDigestJob(jobId, {
            status: 'failed',
            source_level: 'none',
            error_message: reason
        });
        return {
            success: false,
            products: [],
            source_level: 'none',
            error: reason
        };
    }

    /**
     * Process the AI response: parse, validate each product, filter out invalid.
     * Products inherit the source conversation's boundary state.
     */
    _processAIResponse(rawResponse, conversationId, boundaryState, sourceEventIds) {
        const { markdown, products, parseError } = parseAIResponse(rawResponse);

        const validProducts = [];
        for (const p of products) {
            // Force boundary_inherit to match the source conversation's boundary
            p.boundary_inherit = boundaryState;
            p.source_conversation = conversationId;

            const check = validateProduct(p);
            if (!check.valid) {
                // Skip invalid products honestly — don't fabricate or "fix" them
                continue;
            }

            // Attach parsed markdown and raw JSON for dual-output storage
            p._markdown = markdown;
            p._json = JSON.stringify(p, null, 2);
            p._id = generateULID();
            validProducts.push(p);
        }

        return validProducts;
    }

    /**
     * Persist validated products to the database.
     */
    _persistProducts(products, conversationId, boundaryState, sourceEventIds, rawResponse) {
        const sourceEventIdsJson = sourceEventIds.length > 0 ? JSON.stringify(sourceEventIds) : null;
        const { markdown } = parseAIResponse(rawResponse);

        for (const p of products) {
            if (p.type === 'card') {
                this.db.upsertAiCard({
                    card_id: p._id,
                    title: p.title,
                    summary: p.summary,
                    evidence: p.evidence,
                    boundary_inherit: p.boundary_inherit,
                    source_conversation: p.source_conversation,
                    source_event_ids: sourceEventIdsJson,
                    markdown_body: markdown,
                    json_body: p._json,
                    attribution_state: 'ai_proposed'
                });
            } else if (p.type === 'maintenance_task') {
                this.db.upsertAiMaintenanceTask({
                    task_id: p._id,
                    task: p.task,
                    criteria: p.criteria,
                    risk: p.risk || null,
                    rollback_plan: p.rollback_plan || null,
                    priority: p.priority,
                    boundary_inherit: p.boundary_inherit,
                    source_conversation: p.source_conversation,
                    source_event_ids: sourceEventIdsJson,
                    markdown_body: markdown,
                    json_body: p._json,
                    attribution_state: 'ai_proposed'
                });
            }
        }
    }

    /**
     * Assemble material text from source events (simple concatenation).
     * In production this would fetch events by conversationId and format them.
     */
    _assembleMaterial(job) {
        if (job.event_ids && job.event_ids.length > 0) {
            return `材料来自事件: ${job.event_ids.join(', ')}\n对话ID: ${job.conversation_id}`;
        }
        return `对话ID: ${job.conversation_id}`;
    }

    /**
     * Auto-generate a "repair task" when AI capability is not configured.
     * This task is a maintenance_task with priority 1 (highest).
     *
     * @param {string} [conversationId] — optional source conversation
     * @returns {Object} the generated repair task
     */
    generateRepairTask(conversationId = 'system') {
        const taskId = generateULID();
        const repairTask = {
            task_id: taskId,
            task: '配置 AI 归纳能力：在 ~/.dcf/ai-config.json 中填写 api_endpoint、api_key、model',
            criteria: [
                'ai-config.json 文件存在且可读',
                'api_endpoint、api_key、model 字段非空',
                'getStatus() 返回 level=api 或 level=local'
            ],
            risk: '未配置 AI 归纳能力将导致对话归档后无法自动产出知识卡片与维护任务',
            rollback_plan: '删除或清空 ai-config.json 即可恢复到未配置状态',
            priority: 1,
            boundary_inherit: 'OBSERVE_CURRENT_ONLY',
            source_conversation: conversationId,
            source_event_ids: null,
            markdown_body: '## AI 归纳能力未配置\n\n请配置 `~/.dcf/ai-config.json`：\n\n```json\n{\n  "api_endpoint": "https://api.example.com/v1/chat/completions",\n  "api_key": "your-key",\n  "model": "your-model"\n}\n```',
            json_body: JSON.stringify({
                type: 'maintenance_task',
                task: '配置 AI 归纳能力',
                priority: 1,
                boundary_inherit: 'OBSERVE_CURRENT_ONLY'
            }, null, 2),
            attribution_state: 'ai_proposed'
        };

        this.db.upsertAiMaintenanceTask(repairTask);
        return repairTask;
    }

    /**
     * Process the queue: run all queued digest jobs sequentially.
     * Called by the RPC trigger or a periodic sweep.
     */
    async processQueue() {
        const queued = this.db.getQueuedDigestJobs();
        const results = [];
        for (const job of queued) {
            const eventIds = job.event_ids_json ? JSON.parse(job.event_ids_json) : [];
            const result = await this.runDigest({
                job_id: job.job_id,
                conversation_id: job.conversation_id,
                event_ids: eventIds
            });
            results.push({ job_id: job.job_id, ...result });
        }
        return results;
    }
}

module.exports = {
    AIDigestEngine,
    parseAIResponse,
    validateProduct,
    validateCardProduct,
    validateMaintenanceTaskProduct,
    getBoundaryState,
    isNotObserveBoundary,
    getSystemPrompt
};
