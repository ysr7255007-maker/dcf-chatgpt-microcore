#!/usr/bin/env node

/**
 * seed/functions/task-generation/service.js — Task Generation Service Orchestration
 * 
 * 复用现有双路径路由（OpenCode API 主 + DeepLink 备）与 watchInboxFile 结果回收
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let OpenCodeBridgeClass = null;

class TaskGenerationService {
    constructor() {
        this.eventBus = null;
        this.initialized = false;
        this._bridges = new Map();
    }

    async initialize({ eventBus }) {
        this.eventBus = eventBus;
        this.initialized = true;
        
        // Lazy-load OpenCodeBridge to avoid circular dependency at startup
        try {
            const mod = await import('./opencode-bridge.mjs');
            OpenCodeBridgeClass = mod.OpenCodeBridge;
        } catch (err) {
            console.warn('[TaskGenerationService] Failed to load OpenCodeBridge:', err.message);
        }
        
        console.log('[TaskGenerationService] Initialized with', Object.keys(this._bridges).length, 'bridge(s)');
    }

    /**
     * Load OpenCodeBridge class (lazy ESM)
     */
    async _loadOpenCodeBridge() {
        if (!OpenCodeBridgeClass) {
            throw new Error('OpenCodeBridge module unavailable');
        }
        return OpenCodeBridgeClass;
    }

    /**
     * Generate card/task: dispatch via OpenCode API or fallback to DeepLink
     */
    async generate(kind, prompt, sourceIds = [], ide = null) {
        if (!this.initialized) {
            throw new Error('TaskGenerationService not initialized');
        }

        const taskId = `dcf-gen-${kind}-${this._generateUlid()}`;
        const nonce = crypto.randomBytes(16).toString('hex');
        
        // Try OpenCode API first
        try {
            const Bridge = await this._loadOpenCodeBridge();
            const bridge = new Bridge({ baseURL: 'http://127.0.0.1:4096' });
            
            const health = await bridge.healthCheck();
            if (health.ok) {
                // Dispatch via HTTP API
                return await this._dispatchViaOpenCode(kind, prompt, sourceIds.length, bridge, taskId, nonce);
            } else {
                console.warn(`[TaskGenerationService] OpenCode unreachable (${health.error}), falling back to DeepLink`);
            }
        } catch (err) {
            console.warn(`[TaskGenerationService] OpenCode dispatch failed: ${err.message}, falling back to DeepLink`);
        }

        // Fallback to DeepLink
        return await this._dispatchViaDeepLink(kind, prompt, sourceIds.length, taskId);
    }

    /**
     * Dispatch via OpenCode API
     */
    async _dispatchViaOpenCode(kind, prompt, conversationsIncluded, bridge, taskId, nonce) {
        const outputPath = path.join(require('os').tmpdir(), `dcf-opencode-${taskId}.json`);
        
        const dispatchResult = await bridge.dispatchTask({
            task_id: taskId,
            prompt: this._buildPrompt(prompt, kind, taskId, nonce, outputPath),
            output_path: outputPath,
            nonce,
            title: `DCF ${kind} generation`
        });

        if (dispatchResult.status === 'failed') {
            throw new Error('OpenCode dispatch failed: ' + (dispatchResult.error || 'unknown'));
        }

        // Auto-approve permissions
        const stopAutoApprove = dispatchResult.session_id
            ? bridge.autoApproveSession(dispatchResult.session_id, 10 * 60 * 1000)
            : () => {};

        // Watch for result
        const watchResult = await new Promise((resolve, reject) => {
            bridge.watchResult(outputPath, { timeoutMs: 10 * 60 * 1000, nonce, task_id: taskId })
                .then(result => resolve(result))
                .catch(err => reject(err));
        });

        stopAutoApprove();

        // Clean up temp file on success
        if (watchResult.ok && watchResult.data?.products) {
            this._loadGeneratedProducts(kind, watchResult.data.products, taskId);
            try {
                fs.unlinkSync(outputPath);
            } catch (_) {}
        }

        return {
            ok: true,
            data: {
                task_id: taskId,
                mode: 'opencode',
                ide: 'opencode',
                ide_name: 'OpenCode',
                conversations_included: conversationsIncluded,
                autosubmit: true
            }
        };
    }

    /**
     * Dispatch via DeepLink (fallback)
     */
    async _dispatchViaDeepLink(kind, prompt, conversationsIncluded, taskId) {
        const inboxDir = path.join(process.env.HOME || process.env.USERPROFILE, '.dcf', 'inbox');
        try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
        
        const inboxPath = path.join(inboxDir, `${taskId}.json`);
        const fullPrompt = prompt + `\n\n=== DCF 结果回收契约 ===\n完成后请将结果以 JSON 写入文件：${inboxPath}\n格式：{ "status": "completed", "products": [...] }\nproducts 中每个元素的 "source_conversation" 字段填材料行首 [Source ID: xxx] 中的 xxx 原值。`; 

        // Copy to clipboard for manual paste
        const clipboardPromise = this._copyToClipboard(fullPrompt);

        // Start watching inbox
        setTimeout(async () => {
            const watchPromise = new Promise(resolve => {
                const watcher = setInterval(() => {
                    try {
                        if (fs.existsSync(inboxPath)) {
                            const raw = fs.readFileSync(inboxPath, 'utf8');
                            if (raw.trim()) {
                                clearInterval(watcher);
                                try {
                                    const data = JSON.parse(raw);
                                    if (data.products) {
                                        this._loadGeneratedProducts(kind, data.products, taskId);
                                        fs.unlinkSync(inboxPath);
                                    }
                                } catch (_) {}
                                resolve();
                            }
                        }
                    } catch (_) {}
                }, 3000);
                setTimeout(() => clearInterval(watcher), 10 * 60 * 1000);
            });
            await watchPromise;
        }, 500);

        // Trigger DeepLink (just opens the IDE app)
        const deepLinkUrl = 'opencode://';
        try {
            const { execFileSync } = require('child_process');
            execFileSync('open', [deepLinkUrl]); // macOS only for now
        } catch (_) {}

        await clipboardPromise;

        return {
            ok: true,
            data: {
                task_id: taskId,
                mode: 'deeplink',
                ide: 'generic',
                ide_name: 'IDE',
                conversations_included: conversationsIncluded,
                clipboard: true
            }
        };
    }

    /**
     * Build full prompt with standardized output contract
     */
    _buildPrompt(prompt, kind, taskId, nonce, outputPath) {
        return `${prompt}

=== DCF 标准化输出契约 ===
请在任务完成后将结果以 JSON 格式写入文件：${outputPath}

JSON Schema:
{
  "task_id": "${taskId}",
  "nonce": "${nonce}",
  "status": "completed" | "failed",
  "products": [
    {
      "type": "${kind}",
      "title": "...",
      "summary": "...",
      "evidence": ["..."],
      "boundary_inherit": "OBSERVE_CURRENT_ONLY",
      "source_conversation": "<填入材料行首 [Source ID: xxx] 中的 xxx 原值>"
    }
  ],
  "evidence": {
    "session_id": "<your session id>",
    "messages_count": <number>,
    "error": null | "<error message>"
  }
}

注意：
- nonce 必须为 ${nonce}，否则结果将被拒绝入库
- task_id 必须为 ${taskId}
- 如果任务失败，status 设为 "failed"
- products 可以为空数组，但字段必须存在
- source_conversation 填该产物所依据材料行首 [Source ID: xxx] 标注的完整 ID 字符串；若无法对应具体行，填空字符串 ""
- 【关键】输出必须是严格合法的 JSON，任何字符串值内部如需引号，一律使用中文引号 “” ，绝对不要在字符串内出现未转义的英文双引号 " ; 对象/数组末尾不要有尾随逗号。写入前请自行校验 JSON 可被解析。
=== END DCF 标准化输出契约 ===`;
    }

    /**
     * Load generated products into repository
     */
    _loadGeneratedProducts(kind, products, taskId) {
        if (!Array.isArray(products)) return;

        for (const product of products) {
            try {
                const artifact = {
                    id: `artifact-${taskId}-${product.title.slice(0, 32)}-${Math.floor(Math.random() * 10000)}`,
                    conversation_id: null, // Will be set by caller
                    type: product.type || kind,
                    title: product.title || '',
                    summary: product.summary || '',
                    content: JSON.stringify(product),
                    status: 'generated',
                    created_at: new Date(),
                    generated_at: new Date(),
                    references_conversation_ids: []
                };
                
                // In real implementation, would insert into repo.artifacts.insert(artifact)
                console.log(`[TaskGenerationService] Loaded artifact: ${artifact.title}`);
            } catch (err) {
                console.error(`[TaskGenerationService] Failed to load product:`, err.message);
            }
        }
    }

    /**
     * Internal helpers
     */
    _generateUlid() {
        const timestamp = Date.now();
        const randomness = crypto.randomBytes(8).toString('hex');
        return timestamp.toString(36) + randomness.substring(0, 13);
    }

    _copyToClipboard(text) {
        return new Promise((resolve, reject) => {
            try {
                const { execFileSync } = require('child_process');
                // argv array prevents shell injection
                execFileSync('pbcopy', [], { input: text });
                resolve(true);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Close resources (no persistent connections currently held)
     */
    async close() {
        this._bridges.clear();
    }

    /**
     * Publish event for observability
     */
    _publishEvent(eventType, payload) {
        try {
            if (this.eventBus) {
                this.eventBus.publish(eventType, payload);
            }
        } catch (err) {
            console.debug('[TaskGenerationService] Event bus unavailable:', err.message);
        }
    }
}

// Export singleton instance
const taskGenerationService = new TaskGenerationService();

module.exports = {
    taskGenerationService
};
