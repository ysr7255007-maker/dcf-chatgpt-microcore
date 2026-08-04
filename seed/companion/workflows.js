#!/usr/bin/env node

/**
 * seed/companion/workflows.js — 主流程显式编排（组合根）
 * 
 * Design Principle:
 *   - 主流程可追溯：顺序调用各模块 contract，调用链可读
 *   - 事件仅旁路：不在这里编排事件驱动的主流程
 *   - 组合根：初始化 core 单例 → 注入各 function
 * 
 * Usage:
 *   const { initializeModules, importThenQuery, generateFromRecent } = require('./workflows');
 *   await initializeModules({ repoDbPath });
 *   const result = await importThenQuery(intent);
 */

const dataImportFn = require('../functions/data-import');
const conversationQueryFn = require('../functions/conversation-query');
const taskGenerationFn = require('../functions/task-generation');
const { bus, EventType } = require('../core/event-bus');
const sqlite3 = require('sqlite3');

let initialized = false;
let eventsDbPath = null; // 双轨期：legacy 事件流存储路径（raw_events 所在 DB）

/**
 * 组合根：初始化 core 单例 → 注入各 function
 * @param {string} repoDbPath 中央库路径（conversations_v2）
 * @param {string} [eventsDb] 事件流 DB 路径（legacy raw_events，双轨期桥接）
 */
async function initializeModules({ repoDbPath, eventsDb = null }) {
    if (initialized) return;

    // 初始化顺序：data-import（内含 repo）→ conversation-query（共享 repo）→ task-generation
    await dataImportFn.initialize(repoDbPath);
    await conversationQueryFn.initialize(repoDbPath);
    await taskGenerationFn.initialize({ dbPath: repoDbPath });

    eventsDbPath = eventsDb;
    initialized = true;
    console.log('[workflows] All modules initialized');
}

/**
 * import → query 显式编排
 * 顺序调用链：fullImport → executeIntent
 */
async function importThenQuery(intent) {
    const imported = await dataImportFn.fullImport(intent);              // contract 边界
    const available = await conversationQueryFn.executeIntent({ recentRounds: 20 });
    return { imported, available };
}

/**
 * 从 payload_json 提取消息文本（与 legacy extractEventText 等价）
 */
function extractEventText(payloadJson) {
    let payload = payloadJson;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (_) { return payload; }
    }
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.content === 'string') return payload.content;
    if (typeof payload.body === 'string') return payload.body;
    if (typeof payload.summary === 'string') return payload.summary;
    if (typeof payload.title === 'string') return payload.title;
    if (Array.isArray(payload.messages)) {
        return payload.messages
            .map(m => (m && typeof m === 'object') ? (m.text || m.content || '') : String(m || ''))
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

/**
 * 剔除 DCF 自身请求消息与旧 artifact 块（与 legacy sanitizeForDigest 等价），
 * 防止旧产物污染新生成。
 */
function sanitizeForDigest(text) {
    if (text.includes('[DCF-REQUEST]')) return '';
    return text.replace(/<<<DCF_\w+[\s\S]*?DCF_\w+>>>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * 从事件流（legacy raw_events 存储）读取对话消息材料。
 * 这是「从当前对话提取」的正确数据源：Chrome 扩展实时上报的当前对话消息，
 * 按 sourceIds 限定到当前对话；不传 sourceIds 时取全部对话的最近消息。
 *
 * 双轨期桥接：raw_events 仍由 legacy 轨拥有（/rpc/events/ingest 未迁移），
 * 此处只读访问同一 DB 文件。事件流迁移后改走新架构存储。
 *
 * @returns {Promise<Array<{sourceId: string, text: string}>>} 按时间正序的消息材料
 */
async function readConversationMaterial({ sourceIds = [], limit = 15 } = {}) {
    if (!eventsDbPath || eventsDbPath === ':memory:') return [];

    const wanted = Array.isArray(sourceIds) && sourceIds.length > 0
        ? new Set(sourceIds.map(String))
        : null;

    const db = await new Promise((resolve, reject) => {
        const d = new sqlite3.Database(eventsDbPath, sqlite3.OPEN_READONLY, (err) =>
            err ? reject(err) : resolve(d));
    });

    try {
        const rows = await new Promise((resolve, reject) => {
            db.all(
                `SELECT source_id, payload_json, created_at FROM raw_events
                 WHERE event_type LIKE 'conversation.%'
                 ORDER BY created_at DESC LIMIT ?`,
                [Math.max(limit * 4, 50)], // 多取一些，过滤后再截断
                (err, rows) => err ? reject(err) : resolve(rows || [])
            );
        });

        return rows
            .filter(r => !wanted || wanted.has(String(r.source_id)))
            .map(r => ({ sourceId: r.source_id, ts: Date.parse(r.created_at || '') || 0, text: sanitizeForDigest(extractEventText(r.payload_json)) }))
            .filter(e => e.text)
            .slice(0, limit)
            .reverse(); // 时间正序
    } finally {
        db.close();
    }
}

/**
 * 权威 digest prompt builder（单一事实源）
 * - 材料来自事件流（当前对话消息），按 sourceIds 限定；与 legacy 语义一致
 * - 每行带 [Source ID: xxx] 前缀：材料里嵌值，AI 不需要做字段映射
 * - 空材料返回 null（fail loudly，不发出 "Analyze 空材料" 的指令）
 */
async function buildDigestPrompt(kind, { limit = 15, sourceIds = [] } = {}) {
    const effectiveLimit = Math.min(30, Math.max(3, parseInt(limit) || 15));

    // 主路径：事件流（当前对话提取，legacy 语义）
    const material = await readConversationMaterial({ sourceIds, limit: effectiveLimit });

    let digest;
    if (material.length > 0) {
        digest = material
            .map(e => `- [Source ID: ${e.sourceId}] ${e.text.slice(0, 200)}`)
            .join('\n');
    } else if (!sourceIds || sourceIds.length === 0) {
        // 回退路径：未指定对话且事件流为空时，用中央库归档（新能力）
        const conversations = await conversationQueryFn.executeIntent({
            recentRounds: effectiveLimit,
            excludeGenerated: false
        });
        digest = conversations
            .map(c => {
                const text = (c.summary || c.first_message_text || '').replace(/\s+/g, ' ').trim();
                if (!text) return null;
                return `- [Source ID: ${c.source_id || c.id}] ${text.slice(0, 200)}`;
            })
            .filter(Boolean)
            .join('\n');
    } else {
        // 指定了对话但事件流无该对话的消息：不回退，如实失败
        digest = '';
    }

    if (!digest) return null;

    const instruction = kind === 'task'
        ? '请基于这些对话，提出 1-3 条最值得执行的任务建议，放入 products 数组。每个元素字段：{ "title": "任务标题", "reason": "为什么值得做", "priority": 3, "confidence": 0.8 }，priority 为 1-9（1 最高），confidence 为 0-1。'
        : '请基于这些对话，归纳 1-3 张最有长期价值的知识卡片，放入 products 数组。每个元素字段：{ "title": "标题（≤40字）", "summary": "摘要（100-300字）", "evidence": ["引用原对话关键句 1", "引用 2"] }';

    const mapping = '字段映射：材料每行开头的 [Source ID: xxx] 是该要点所属对话的标识；products 中每个元素的 "source_conversation" 字段必须填入该要点所依据行的 Source ID 原值（含方括号内的完整字符串）。';

    return ['以下是我最近存档的对话要点（由 DCF 从本地事件流提取）：', '', digest, '', instruction, '', mapping].join('\n');
}

/**
 * import → query → generate 显式编排
 * 顺序调用链：fullImport → executeIntent → generate
 */
async function generateFromRecent(kind, intent = {}) {
    // Step 1: import（可选，若 intent.sourceTypes 非空）
    let importResult = null;
    if (intent.sourceTypes && intent.sourceTypes.length > 0) {
        importResult = await dataImportFn.fullImport(intent);
    }

    // Step 2: 构造 prompt（权威 builder，事件流材料 + Source ID 与字段映射）
    const prompt = await buildDigestPrompt(kind, { limit: intent.limit || 15, sourceIds: intent.sourceIds || [] });
    if (!prompt) {
        return { ok: false, error: 'No stored conversations yet - nothing to generate from' };
    }
    const conversations = await conversationQueryFn.executeIntent({
        recentRounds: intent.limit || 15,
        excludeGenerated: false
    });

    // Step 3: generate（contract 边界）
    const result = await taskGenerationFn.generate({
        kind,
        prompt,
        sourceIds: intent.sourceIds || [],
        limit: intent.limit || 15,
        ide: intent.ide
    });

    // 发布 generation.completed 事件（旁路 observability）
    bus.publish(EventType.GenerationCompleted, {
        kind,
        task_id: result.data.task_id
    });

    return { ok: true, importResult, conversations, result };
}

/**
 * 关闭所有模块
 */
async function shutdownModules() {
    await dataImportFn.shutdown();
    await conversationQueryFn.shutdown();
    await taskGenerationFn.shutdown();
    initialized = false;
    console.log('[workflows] All modules shutdown');
}

module.exports = {
    initializeModules,
    importThenQuery,
    generateFromRecent,
    buildDigestPrompt,
    shutdownModules
};
