#!/usr/bin/env node
// 防造假断言集（Tier 3 真实 E2E 专用，ESM，零 npm 依赖）。
//
// 核心原则：判定只依赖机器可验证信号（per-run nonce、消息计数增量、
// 回复文本可追溯、companion 入库回查）。截图仅作附件（manifest 里带
// sha256 供人工复核），绝不参与 pass/fail 判定。
//
// 背景：旧"真实 E2E"读取预存旧消息（"Hello! 👋 DCF Surface test received."）
// 冒充成功。本模块的每条断言都设计为：预存数据在结构上无法通过 ——
//   - nonce 每次运行唯一，历史消息不可能包含它；
//   - 消息计数必须真实增长，读旧会话无增量；
//   - 断言失败必须 throw（错误文案指明疑似造假路径），绝不静默。

import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'seed', 'docs', 'evidence', 'e2e-real');

/**
 * 生成本轮运行唯一 nonce。
 * 格式：DCF-NONCE-{时间戳 base36 大写}-{crypto 随机段}
 * 时间戳保证跨运行单调区分，crypto 随机段防止同毫秒碰撞与可预测性。
 * @returns {string}
 */
export function generateRunNonce() {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(6).toString('hex').toUpperCase();
    return `DCF-NONCE-${ts}-${rand}`;
}

/**
 * 断言消息计数真实增长（一问一答至少 +2）。
 * @param {number|Array} before 发送前计数（或消息数组）
 * @param {number|Array} after 发送后计数（或消息数组）
 * @param {number} [min=2] 最小增量
 * @throws 增量不足时抛错
 */
export function assertMessageCountDelta(before, after, min = 2) {
    const b = Array.isArray(before) ? before.length : Number(before);
    const a = Array.isArray(after) ? after.length : Number(after);
    if (!Number.isFinite(b) || !Number.isFinite(a)) {
        throw new Error(`assertMessageCountDelta: 计数非法 before=${before} after=${after}`);
    }
    const delta = a - b;
    if (delta < min) {
        throw new Error(
            `消息计数增量不足：期望 ≥${min}，实际 ${delta}（before=${b}, after=${a}）。` +
            `增量为 0/不足意味着没有新消息真实产生 —— 疑似读取预存会话冒充成功。`
        );
    }
}

/**
 * 断言 nonce 出现在 baseline 之后新增的 user 消息里。
 * @param {Array<{role: string, text: string}>} messages 新增消息切片
 *        （调用方须传 baseline 之后的消息；也可传全量并指定 opts.baselineCount）
 * @param {string} nonce 本轮 nonce
 * @param {object} [opts]
 * @param {number} [opts.baselineCount=0] 若 messages 为全量列表，此处给出基线数量
 * @throws 新增 user 消息中找不到 nonce 时抛错
 */
export function assertNonceInNewUserMessage(messages, nonce, opts = {}) {
    if (!Array.isArray(messages)) throw new Error('assertNonceInNewUserMessage: messages 必须是数组');
    if (!nonce) throw new Error('assertNonceInNewUserMessage: nonce 不能为空');
    const { baselineCount = 0 } = opts;
    const fresh = messages.slice(baselineCount);
    const freshUsers = fresh.filter(m => m && m.role === 'user');
    if (freshUsers.length === 0) {
        throw new Error(
            `baseline 之后没有任何新增 user 消息（新增共 ${fresh.length} 条）。` +
            `说明消息从未真实发送 —— 输入注入未进入页面状态，或发送动作未生效。`
        );
    }
    const hit = freshUsers.some(m => typeof m.text === 'string' && m.text.includes(nonce));
    if (!hit) {
        throw new Error(
            `新增 user 消息中未找到本轮 nonce "${nonce}"。` +
            `新增 user 消息预览：${freshUsers.map(m => JSON.stringify((m.text || '').slice(0, 60))).join(' | ')}。` +
            `疑似发送了别的内容，或读取了与本轮无关的会话。`
        );
    }
}

/**
 * 断言 assistant 回复文本包含本轮 nonce。
 * @param {string} replyText assistant 回复全文
 * @param {string} nonce 本轮 nonce
 * @throws 未包含时抛错，错误文案明确指出疑似读取预存消息
 */
export function assertAssistantReplyContainsNonce(replyText, nonce) {
    if (!nonce) throw new Error('assertAssistantReplyContainsNonce: nonce 不能为空');
    if (typeof replyText !== 'string' || !replyText.includes(nonce)) {
        const head = typeof replyText === 'string' ? replyText.slice(0, 120) : String(replyText);
        throw new Error(
            `回复未包含本轮 nonce，疑似读取预存消息。` +
            `期望包含 "${nonce}"，实际回复（前 120 字符）："${head}"。` +
            `预存的历史回复在结构上不可能包含本轮唯一 nonce，此断言失败即判定造假路径。`
        );
    }
}

/**
 * 窄验证链路终点断言：companion raw_events 必须与 DOM 观测一致。
 * 要求：
 *   - 至少一条事件的 payload.message_id === DOM 新增 user 消息的 message_id，且文本含 nonce；
 *   - 至少一条事件的 payload.message_id === DOM 新增 assistant 消息的 message_id。
 * 意义：脚本直写 Companion 伪造的事件无法事先知道 ChatGPT 为本轮新消息分配的
 * DOM message_id（UUID），因此伪造入库在结构上无法通过本断言。
 * @param {Array} events companion /rpc/events/query 返回的事件数组
 * @param {object} expected { nonce, userMessageId, assistantMessageId }
 * @throws 任一对应关系缺失时抛错，文案指明疑似直写伪造
 */
export function assertCompanionEventsMatchDom(events, { nonce, userMessageId, assistantMessageId }) {
    if (!Array.isArray(events)) throw new Error('assertCompanionEventsMatchDom: events 必须是数组');
    if (!nonce || !userMessageId || !assistantMessageId) {
        throw new Error('assertCompanionEventsMatchDom: nonce/userMessageId/assistantMessageId 均为必填（DOM 观测缺失时不得声称入库验证通过）');
    }
    const payloadOf = (e) => (e && (typeof e.payload_json === 'object' ? e.payload_json : safeParse(e.payload_json))) || {};
    const userHit = events.some(e => {
        const p = payloadOf(e);
        return p.message_id === userMessageId && typeof p.text === 'string' && p.text.includes(nonce);
    });
    const assistantHit = events.some(e => payloadOf(e).message_id === assistantMessageId);
    if (!userHit || !assistantHit) {
        const seen = events.map(e => payloadOf(e).message_id).filter(Boolean);
        throw new Error(
            `companion 事件与 DOM 观测不一致：` +
            `需要 user message_id=${userMessageId}（含 nonce）命中=${userHit}，` +
            `assistant message_id=${assistantMessageId} 命中=${assistantHit}。` +
            `库内观测到的 message_id：[${seen.join(', ')}]。` +
            `若事件含 nonce 但 message_id 对不上 DOM，疑似脚本绕过采集链直写 Companion 伪造入库。`
        );
    }
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
}

// Companion 只读访问白名单：Tier 3 验收脚本对 Companion 只允许只读查询，
// 绝对禁止调用事件写入接口（/rpc/events/ingest、/rpc/events/batch 等）。
export const COMPANION_READONLY_ALLOWLIST = Object.freeze([
    '/rpc/health',
    '/rpc/stats',
    '/rpc/events/query'
]);

/**
 * 创建结构性只读的 companion 客户端：
 *   - 仅提供 getJson，没有任何写方法；
 *   - 路径不在白名单内直接 throw（含写入接口）；
 *   - 强制 GET，无 body。
 * 验收脚本必须经由这里访问 companion，从结构上排除"脚本直写入库"造假路径。
 * @param {string} baseUrl 如 http://127.0.0.1:8472
 */
export function createReadOnlyCompanionClient(baseUrl) {
    const base = String(baseUrl || '').replace(/\/$/, '');
    return {
        async getJson(pathAndQuery) {
            const pathname = String(pathAndQuery).split('?')[0];
            if (!COMPANION_READONLY_ALLOWLIST.includes(pathname)) {
                throw new Error(
                    `只读 companion 客户端拒绝访问 "${pathname}"：不在只读白名单 ` +
                    `[${COMPANION_READONLY_ALLOWLIST.join(', ')}] 内。` +
                    `Tier 3 验收禁止调用 Companion 写入接口（防止脚本直写伪造入库）。`
                );
            }
            const res = await fetch(base + pathAndQuery, { method: 'GET' });
            if (!res.ok) throw new Error(`companion GET ${pathname} HTTP ${res.status}`);
            return res.json();
        }
    };
}

/**
 * 计算文件 sha256（截图附件用）。
 * @param {string} filePath
 * @returns {string} hex digest
 */
export function sha256File(filePath) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * 输出取证 manifest JSON（目录自动创建）。
 * manifest 字段约定：run_id、started_at/finished_at（时间窗）、nonce、
 * conversation_url_before/after、message_count_before/after、
 * companion_event_ids、screenshots（数组，每项含 path 与 sha256，仅附件）、
 * verdict（pass|degraded|fail|blocked）、degraded_reason。
 * @param {string|null} dir 目标目录，缺省 seed/docs/evidence/e2e-real/
 * @param {object} manifest
 * @returns {string} 写入的文件路径
 */
export function writeEvidenceManifest(dir, manifest) {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('writeEvidenceManifest: manifest 必须是对象');
    }
    const targetDir = dir || DEFAULT_EVIDENCE_DIR;
    fs.mkdirSync(targetDir, { recursive: true });

    const finalManifest = {
        ...manifest,
        generated_at: new Date().toISOString(),
        // 再次声明判定依据，防止后人误用截图当判定信号
        note: '判定只依赖机器可验证信号（nonce/计数增量/companion 回查）；screenshots 仅作附件。'
    };

    // 截图仅附件：补齐 sha256 供完整性复核，不参与判定
    if (Array.isArray(finalManifest.screenshots)) {
        finalManifest.screenshots = finalManifest.screenshots.map(s => {
            if (!s || s.sha256 || !s.path) return s;
            try {
                return { ...s, sha256: sha256File(s.path) };
            } catch (e) {
                return { ...s, sha256: null, sha256_error: e.message };
            }
        });
    }

    const runId = finalManifest.run_id || `run-${Date.now()}`;
    const file = path.join(targetDir, `manifest-${runId}.json`);
    fs.writeFileSync(file, JSON.stringify(finalManifest, null, 2) + '\n');
    return file;
}
