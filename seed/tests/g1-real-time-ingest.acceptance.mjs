#!/usr/bin/env node
// G1 实时采集验收（Tier 3，阶段 2-3 交付物）：真实登录态 BrowserClaw + per-run nonce
// 验证"新对话到达后立即上报"的实时采集链路，并量化采集延迟。
//
// 验证目标（窄链路，一条路走到底）：
//   本轮新标签 + nonce 消息真实发送（t0）→ DCF 采集链（content.js → SW → outbox
//   → companion）自行上报 → companion raw_events 在 30s 内出现该 nonce
//   → 采集延迟 ingest_latency_ms = 首次命中时刻 - t0，写入取证 manifest。
//
// 防造假原则（与 g1-real-e2e 同源）：
//   - 判定只依赖机器可验证信号：per-run 唯一 nonce、DOM 新增 user 消息、
//     companion 只读回查命中时刻；不依赖任何截图或人工描述；
//   - 对 Companion 只经结构性只读客户端访问（白名单 GET），绝对禁止调用
//     事件写入接口（/rpc/events/ingest、/rpc/events/batch 等）——本脚本
//     不注入任何页内采集桥接，命中必须来自真实采集链自行上报；
//   - 30s 内 companion 无该 nonce 事件 → 如实 FAIL（exit 1，manifest
//     verdict=fail）并注明可能原因（DCF 采集扩展未加载到 BrowserClaw 浏览器
//     属预期环境缺口），绝不假过；
//   - 环境不可达（companion/MCP）如实报 blocked exit 2，不做任何"通过"声明。
//
// 通道：零依赖 MCP Streamable HTTP 客户端直连 BrowserClaw
//   http://127.0.0.1:9010/mcp（模式取自 seed/docs/g3-acceptance-evidence.md §B0：
//   initialize → 响应头 mcp-session-id → notifications/initialized → tools/list
//   → tools/call，解析 SSE data: 行；session 存活期短，404 时自动重新 initialize）。
//
// Usage:
//   node seed/tests/g1-real-time-ingest.acceptance.mjs                    # 真实运行
//   node seed/tests/g1-real-time-ingest.acceptance.mjs --companion=http://127.0.0.1:8472
//   node seed/tests/g1-real-time-ingest.acceptance.mjs --mcp=http://127.0.0.1:9010/mcp
//   node seed/tests/g1-real-time-ingest.acceptance.mjs --self-test        # 离线自检
//
// Exit codes: 0 = 通过；1 = 断言失败（含 30s 超时未入库）；2 = 环境不可达（blocked）。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    injectText, verifyInputReady, clickSend, readMessages
} from './helpers/chatgpt-input.mjs';
import {
    generateRunNonce, createReadOnlyCompanionClient,
    writeEvidenceManifest, DEFAULT_EVIDENCE_DIR
} from './helpers/anti-fraud.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI args ---
const argv = process.argv.slice(2);
const getArg = (name, def) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const SELF_TEST = argv.includes('--self-test');
const COMPANION_URL = (getArg('companion', 'http://127.0.0.1:8472')).replace(/\/$/, '');
const MCP_URL = getArg('mcp', 'http://127.0.0.1:9010/mcp');
const CHATGPT_URL = 'https://chatgpt.com/';
const INGEST_TIMEOUT_MS = 30000;   // 阶段 2-3 验收标准：30s 内入库
const POLL_INTERVAL_MS = 1000;     // 1s 粒度轮询，保证延迟测量分辨率

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================================
// 零依赖 MCP Streamable HTTP 客户端（g3 §B0 模式，复制自 g1-real-e2e）
// ============================================================================
class McpClient {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.sessionId = null;
        this.nextId = 1;
        this.tools = [];
    }

    async #post(body) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        };
        if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
        return fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    }

    // 解析响应体：SSE 时抽取所有 data: 行，否则整体按 JSON 解析
    #parseMessages(text, contentType) {
        if ((contentType || '').includes('text/event-stream')) {
            const out = [];
            for (const line of text.split(/\r?\n/)) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload) continue;
                try { out.push(JSON.parse(payload)); } catch { /* 忽略非 JSON data 行 */ }
            }
            return out;
        }
        try { return [JSON.parse(text)]; } catch { return []; }
    }

    async initialize() {
        this.sessionId = null;
        const id = this.nextId++;
        const res = await this.#post({
            jsonrpc: '2.0', id, method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'dcf-g1-real-time-ingest', version: '1.0.0' }
            }
        });
        if (!res.ok) throw new Error(`MCP initialize HTTP ${res.status}`);
        this.sessionId = res.headers.get('mcp-session-id');
        const msgs = this.#parseMessages(await res.text(), res.headers.get('content-type'));
        const reply = msgs.find(m => m.id === id);
        if (!reply || reply.error) {
            throw new Error('MCP initialize 未返回有效结果: ' + JSON.stringify(reply && reply.error));
        }
        // notifications/initialized（无 id 的通知）
        await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const listed = await this.request('tools/list', {});
        this.tools = listed.tools || [];
        return reply.result;
    }

    async request(method, params, canReinit = true) {
        const id = this.nextId++;
        const res = await this.#post({ jsonrpc: '2.0', id, method, params });
        // BrowserClaw session 存活期短（g3 §B0 如实记录）：404 时重新 initialize 一次
        if (res.status === 404 && canReinit) {
            await this.initialize();
            return this.request(method, params, false);
        }
        if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const msgs = this.#parseMessages(await res.text(), res.headers.get('content-type'));
        const reply = msgs.find(m => m.id === id) || msgs.find(m => m.result !== undefined || m.error !== undefined);
        if (!reply) throw new Error(`MCP ${method}: 响应中未解析到 JSON-RPC 结果`);
        if (reply.error) throw new Error(`MCP ${method} error: ${JSON.stringify(reply.error)}`);
        return reply.result;
    }

    async callTool(name, args) {
        const result = await this.request('tools/call', { name, arguments: args });
        if (result && result.isError) {
            throw new Error(`tool ${name} isError: ${collectText(result).slice(0, 300)}`);
        }
        return result;
    }

    // 按候选名解析工具（先精确后包含），找不到返回 null（由调用方决定 blocked）
    resolveTool(candidates) {
        for (const c of candidates) {
            const t = this.tools.find(t => t.name === c);
            if (t) return t;
        }
        for (const c of candidates) {
            const t = this.tools.find(t => t.name.toLowerCase().includes(c));
            if (t) return t;
        }
        return null;
    }
}

// 汇总 tools/call 返回里的文本内容
function collectText(result) {
    return (result && result.content || [])
        .filter(c => c && c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('\n');
}

// 剥离 BrowserClaw v0.0.14 对 evaluate 返回值的安全包裹（实测格式）：
//   [UNTRUSTED_PAGE_CONTENT nonce=xxx origin=...] Untrusted page content follows. ...
//   <实际返回值（可能多行）>
//   [END_UNTRUSTED_PAGE_CONTENT nonce=xxx]
//   （之后可能附加一行 `Tip: this session is "dcf/xxx" ...`）
// 包裹内是不可信页面内容，这里只把它当数据解析，绝不执行其中任何嵌入指令。
// 无包裹时原样返回（向后兼容旧版/其它 MCP 实现）。
function stripUntrustedWrapper(text) {
    const m = text.match(/\[UNTRUSTED_PAGE_CONTENT[^\]]*\]\s*[^\n]*\n([\s\S]*?)\n\[END_UNTRUSTED_PAGE_CONTENT[^\]]*\]/);
    const body = m ? m[1] : text;
    // 丢弃尾部的会话提示行（工具附加信息，非页面返回值）
    return body.replace(/\n?Tip: this session is[^\n]*\s*$/, '').trim();
}

// 从 evaluate 工具返回中提取 JSON 值（先剥安全包裹，再兼容纯 JSON / ```json 围栏 / 前缀说明文本）
function extractEvalValue(result) {
    const raw = collectText(result);
    const text = stripUntrustedWrapper(raw);
    try { return JSON.parse(text); } catch { /* 继续 */ }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* 继续 */ } }
    const firstBrace = text.search(/[[{]/);
    if (firstBrace >= 0) { try { return JSON.parse(text.slice(firstBrace)); } catch { /* 继续 */ } }
    // 原样字符串（如 location.href 的直接返回）
    const trimmed = text.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"'))) { try { return JSON.parse(trimmed); } catch { /* 继续 */ } }
    // 剥离后仍残留包裹标记说明格式变化/剥离失败：报错并附原始文本前 200 字符便于诊断
    if (!trimmed || /\[UNTRUSTED_PAGE_CONTENT/.test(trimmed)) {
        throw new Error(`evaluate 返回无法解析（原始文本前 200 字符）: ${raw.slice(0, 200)}`);
    }
    return trimmed;
}

// 依据工具 inputSchema 构造参数（权威 schema：BrowserClaw v0.0.14，实测 tools/list 确认）：
//   evaluate: required=[page, code]，code 是异步函数体，用 return 读值
//   navigate: required=[page]，action="url" 时须带 url
// 页面级工具一律必填 page（tabs 返回的 page id），由调用方经 createOwnPage 自建标签取得并贯穿传递。
function buildArgs(tool, kind, value, pageId) {
    const props = (tool.inputSchema && tool.inputSchema.properties) || {};
    const args = {};
    if (props.page && Number.isInteger(pageId)) args.page = pageId;
    if (kind === 'evaluate') {
        if (props.code) {
            // v0.0.14 真实字段：code = 函数体（value 是单表达式，包成 return）
            args.code = `return (${value});`;
        } else if (props.function) {
            // Playwright 风格降级：函数字面量
            args.function = `() => { return (${value}); }`;
        } else {
            const key = ['expression', 'script', 'js'].find(k => props[k]) || 'code';
            args[key] = value;
        }
        return args;
    }
    if (kind === 'navigate') {
        // v0.0.14 真实字段：action 枚举 [url, back, forward, reload]，url 仅 action="url" 时必填
        if (props.action) args.action = 'url';
        const key = ['url', 'href', 'link'].find(k => props[k]) || 'url';
        args[key] = value;
        return args;
    }
    return args;
}

// v0.0.14 标签所有权隔离（实测）：非本 session 创建的标签一律拒绝
// "page N is not owned by this agent"，必须 tabs(action:"new") 自建标签并使用
// 返回的 page id（返回文本实测为 "opened page N"，兼容 "[N]" 变体）。
async function createOwnPage(mcp, url) {
    const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
    if (!tabsTool) return null;
    const args = { action: 'new' };
    if (url) args.url = url;
    const text = collectText(await mcp.callTool(tabsTool.name, args));
    const m = text.match(/opened page (\d+)/i) || text.match(/\[(\d+)\]/);
    return m ? parseInt(m[1], 10) : null;
}

// 收尾：best-effort 关闭自己创建的标签（失败不影响判定与退出码）
let ownPage = null;
async function cleanupOwnPage() {
    if (!ownPage) return;
    const { mcp, pageId } = ownPage;
    ownPage = null;
    try {
        const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
        if (tabsTool) await mcp.callTool(tabsTool.name, { action: 'close', page: pageId });
    } catch { /* best-effort，关闭失败不影响判定 */ }
}

// ============================================================================
// 实时采集判定纯函数（--self-test 离线覆盖，不连浏览器/companion）
// ============================================================================

/**
 * 计算采集延迟：首次命中时刻 - 发送时刻 t0。
 * @param {number} t0Ms 发送时刻（epoch ms）
 * @param {number} firstHitMs 首次在 companion 查到 nonce 的时刻（epoch ms）
 * @returns {number} 延迟毫秒数（≥0）
 * @throws 参数非法或命中时刻早于发送时刻（时钟倒挂 = 数据不可信）时抛错
 */
function computeIngestLatencyMs(t0Ms, firstHitMs) {
    if (!Number.isFinite(t0Ms) || !Number.isFinite(firstHitMs)) {
        throw new Error(`computeIngestLatencyMs: 时刻非法 t0=${t0Ms} firstHit=${firstHitMs}`);
    }
    const latency = firstHitMs - t0Ms;
    if (latency < 0) {
        throw new Error(
            `computeIngestLatencyMs: 命中时刻(${firstHitMs})早于发送时刻(${t0Ms})，` +
            `时钟倒挂说明命中事件不是本轮发送产生的 —— 延迟数据不可信，拒绝记录。`
        );
    }
    return latency;
}

/**
 * 判断事件数组中是否存在真正携带本轮 nonce 的事件
 * （payload_json 可能是对象或 JSON 字符串，统一取 text 字段核对）。
 * @param {Array} events companion /rpc/events/query 返回的事件数组
 * @param {string} nonce 本轮 nonce
 * @returns {boolean}
 */
function eventsContainNonce(events, nonce) {
    if (!Array.isArray(events) || !nonce) return false;
    return events.some(e => {
        if (!e) return false;
        const p = typeof e.payload_json === 'object' && e.payload_json !== null
            ? e.payload_json
            : (() => { try { return JSON.parse(e.payload_json); } catch { return {}; } })();
        return typeof p.text === 'string' && p.text.includes(nonce);
    });
}

/**
 * 轮询 companion 只读查询直到 nonce 事件出现或超时。
 * 时钟与查询函数可注入（自检用虚拟时钟离线验证超时/延迟逻辑）。
 * @param {object} opts
 * @param {(nonce: string) => Promise<Array>} opts.queryFn 只读查询函数
 * @param {string} opts.nonce 本轮 nonce
 * @param {number} opts.t0Ms 发送时刻（epoch ms）
 * @param {number} [opts.timeoutMs=30000]
 * @param {number} [opts.intervalMs=1000]
 * @param {() => number} [opts.nowFn=Date.now]
 * @param {(ms: number) => Promise<void>} [opts.sleepFn=sleep]
 * @returns {Promise<{firstHitMs: number, latencyMs: number, events: Array}|null>}
 *          命中返回延迟信息；超时返回 null（由调用方断言 FAIL，不静默）
 */
async function pollForNonceIngest(opts) {
    const {
        queryFn, nonce, t0Ms,
        timeoutMs = INGEST_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS,
        nowFn = Date.now, sleepFn = sleep
    } = opts;
    if (typeof queryFn !== 'function') throw new Error('pollForNonceIngest: queryFn 必填');
    if (!nonce) throw new Error('pollForNonceIngest: nonce 必填');
    if (!Number.isFinite(t0Ms)) throw new Error('pollForNonceIngest: t0Ms 必填');
    const deadline = t0Ms + timeoutMs;
    while (nowFn() <= deadline) {
        let events = [];
        try { events = await queryFn(nonce); } catch { /* 查询瞬态失败，继续轮询到期限 */ }
        if (eventsContainNonce(events, nonce)) {
            const firstHitMs = nowFn();
            return { firstHitMs, latencyMs: computeIngestLatencyMs(t0Ms, firstHitMs), events };
        }
        await sleepFn(intervalMs);
    }
    return null;
}

/**
 * 超时断言：轮询结果为 null 时如实抛错（含预期环境缺口说明），绝不假过。
 * @param {object|null} pollResult pollForNonceIngest 返回值
 * @param {string} nonce 本轮 nonce
 * @param {number} timeoutMs
 * @returns {object} 命中信息（透传）
 * @throws 超时未入库时抛错
 */
function assertIngestedWithinTimeout(pollResult, nonce, timeoutMs) {
    if (!pollResult) {
        throw new Error(
            `${Math.round(timeoutMs / 1000)}s 内 companion raw_events 未出现本轮 nonce "${nonce}"。` +
            `实时采集链未闭合。最可能原因：DCF 采集扩展未加载到 BrowserClaw 浏览器` +
            `（属预期环境缺口），页面采集 → SW → outbox → companion 投递链未运行。` +
            `本脚本不注入任何采集桥接，此项如实 FAIL，不掩盖。`
        );
    }
    return pollResult;
}

// ============================================================================
// --self-test：离线自检（校验延迟计算与超时断言逻辑，不连浏览器/companion）
// ============================================================================
async function runSelfTest() {
    console.log('G1 实时采集自检（--self-test）：延迟计算 + 超时断言逻辑，离线运行。\n');
    const nonce = generateRunNonce();
    console.log(`本轮模拟 nonce: ${nonce}\n`);

    // 虚拟时钟：sleepFn 只推进虚拟时间，不真实等待
    const makeVirtualClock = (startMs) => {
        let now = startMs;
        return {
            nowFn: () => now,
            sleepFn: async (ms) => { now += ms; },
            advance: (ms) => { now += ms; }
        };
    };

    const cases = [];
    const check = (name, fn) => cases.push({ name, fn });

    check('延迟计算：t0=1000, hit=3500 → 2500ms', async () => {
        const v = computeIngestLatencyMs(1000, 3500);
        if (v !== 2500) throw new Error(`期望 2500，实际 ${v}`);
    });
    check('延迟计算：命中早于发送（时钟倒挂）必须拒绝', async () => {
        let threw = false;
        try { computeIngestLatencyMs(5000, 4000); } catch { threw = true; }
        if (!threw) throw new Error('倒挂延迟未被拒绝 —— 延迟数据可被伪造为负值');
    });
    check('延迟计算：非法时刻必须拒绝', async () => {
        let threw = false;
        try { computeIngestLatencyMs(NaN, 1000); } catch { threw = true; }
        if (!threw) throw new Error('非法 t0 未被拒绝');
    });
    check('nonce 命中判定：不含 nonce 的事件不得误判命中', async () => {
        const miss = eventsContainNonce(
            [{ payload_json: { text: '一条与本轮无关的旧消息' } }], nonce);
        if (miss) throw new Error('无关事件被误判为命中 —— 预存数据可冒充实时采集');
    });
    check('nonce 命中判定：对象与 JSON 字符串 payload 均可命中', async () => {
        const objHit = eventsContainNonce([{ payload_json: { text: `hello ${nonce}` } }], nonce);
        const strHit = eventsContainNonce([{ payload_json: JSON.stringify({ text: `hi ${nonce}` }) }], nonce);
        if (!objHit || !strHit) throw new Error(`真实命中被误拒 obj=${objHit} str=${strHit}`);
    });
    check('轮询：queryFn 始终无事件 → 30s 虚拟超时返回 null，断言如实抛错', async () => {
        const clock = makeVirtualClock(100000);
        const result = await pollForNonceIngest({
            queryFn: async () => [], nonce, t0Ms: 100000,
            timeoutMs: 30000, intervalMs: 1000,
            nowFn: clock.nowFn, sleepFn: clock.sleepFn
        });
        if (result !== null) throw new Error('超时未返回 null');
        let threw = false, msg = '';
        try { assertIngestedWithinTimeout(result, nonce, 30000); }
        catch (e) { threw = true; msg = e.message; }
        if (!threw) throw new Error('超时未入库被静默放过 —— 假过路径！');
        if (!msg.includes('采集扩展')) throw new Error('超时报错未注明预期环境缺口原因');
    });
    check('轮询：第 3 次查询命中 → 延迟 = 命中时刻 - t0（虚拟 2000ms）', async () => {
        const clock = makeVirtualClock(200000);
        let calls = 0;
        const result = await pollForNonceIngest({
            queryFn: async () => {
                calls++;
                return calls >= 3 ? [{ payload_json: { text: `采集入库 ${nonce}` } }] : [];
            },
            nonce, t0Ms: 200000, timeoutMs: 30000, intervalMs: 1000,
            nowFn: clock.nowFn, sleepFn: clock.sleepFn
        });
        if (!result) throw new Error('真实命中被误判为超时');
        // 第 1、2 次未命中各 sleep 1000ms，第 3 次命中时虚拟时刻 = t0 + 2000
        if (result.latencyMs !== 2000) throw new Error(`期望延迟 2000ms，实际 ${result.latencyMs}`);
        const passthrough = assertIngestedWithinTimeout(result, nonce, 30000);
        if (passthrough !== result) throw new Error('命中结果未被断言透传');
    });
    check('只读客户端：写路径 /rpc/events/batch 必须被结构性拒绝', async () => {
        let threw = false;
        try { await createReadOnlyCompanionClient('http://127.0.0.1:1').getJson('/rpc/events/batch?x=1'); }
        catch { threw = true; }
        if (!threw) throw new Error('写路径未被只读白名单拒绝 —— 直写伪造入库通道存在！');
    });

    let passed = 0, failed = 0;
    for (const c of cases) {
        try {
            await c.fn();
            passed++;
            console.log(`  ✅ PASS: ${c.name}`);
        } catch (e) {
            failed++;
            console.log(`  ❌ FAIL: ${c.name}`);
            console.log(`     └ ${e.message}`);
        }
    }
    console.log(`\n自检汇总: ${passed}/${cases.length} 通过，${failed} 失败`);
    console.log(failed === 0
        ? '✅ 延迟计算与超时断言逻辑有效：超时必失败、倒挂必拒绝、无关事件不误判。'
        : '❌ 自检失败，禁止用于验收！');
    return failed === 0 ? 0 : 1;
}

// ============================================================================
// 真实实时采集主流程
// ============================================================================
const checks = [];
function recordCheck(name, fn) {
    try {
        fn();
        checks.push({ name, ok: true });
        console.log(`  ✅ PASS: ${name}`);
        return true;
    } catch (e) {
        checks.push({ name, ok: false, error: e.message });
        console.log(`  ❌ FAIL: ${name}`);
        console.log(`     └ ${e.message}`);
        return false;
    }
}

// Companion 只能经结构性只读客户端访问（白名单 GET，无写方法）：
// 从代码结构上排除"脚本直写 Companion 伪造入库"造假路径。
const companion = createReadOnlyCompanionClient(COMPANION_URL);

async function main() {
    const startedAt = new Date().toISOString();
    console.log('G1 real-time ingest acceptance starting…');
    console.log(`  companion: ${COMPANION_URL}（只读白名单访问）`);
    console.log(`  mcp:       ${MCP_URL}`);
    console.log(`  验收标准:  发送后 ${INGEST_TIMEOUT_MS / 1000}s 内 nonce 出现在 raw_events`);

    // --- 0. companion health（不可达 = blocked，如实退出 2，不假装通过） ---
    let health;
    try {
        health = await companion.getJson('/rpc/health');
    } catch (e) {
        console.error(`\nBLOCKED: companion 不可达（${COMPANION_URL}/rpc/health）: ${e.message}`);
        console.error('环境未就绪，本次不做任何"通过"声明。启动方式：node seed/companion/index.js --port=8472');
        process.exit(2);
    }
    console.log(`✓ companion healthy: ${JSON.stringify(health.result || health).slice(0, 120)}`);

    // --- 1. MCP 直连 BrowserClaw ---
    const mcp = new McpClient(MCP_URL);
    try {
        await mcp.initialize();
    } catch (e) {
        console.error(`\nBLOCKED: BrowserClaw MCP 不可达（${MCP_URL}）: ${e.message}`);
        console.error('需要 BrowserClaw（继承真实登录态）在本机运行并暴露 Streamable HTTP 端点。');
        process.exit(2);
    }
    console.log(`✓ MCP 握手成功，session=${mcp.sessionId}，tools=${mcp.tools.length} (${mcp.tools.map(t => t.name).join(', ')})`);

    const evalTool = mcp.resolveTool(['evaluate', 'browser_evaluate', 'execute', 'run']);
    if (!evalTool) {
        console.error('\nBLOCKED: 缺少必需的 evaluate 工具。');
        console.error(`可用工具: ${mcp.tools.map(t => t.name).join(', ')}`);
        process.exit(2);
    }

    // --- 2. 自建标签打开 chatgpt.com（tabs new url 一步打开，标签所有权隔离） ---
    let pageId = null;
    try {
        pageId = await createOwnPage(mcp, CHATGPT_URL);
    } catch (e) {
        console.error(`\nBLOCKED: tabs(new) 自建标签失败: ${e.message}`);
        process.exit(2);
    }
    if (!Number.isInteger(pageId)) {
        console.error('\nBLOCKED: 未能从 tabs(new) 返回文本解析出 page id（期望 "opened page N"）。');
        process.exit(2);
    }
    ownPage = { mcp, pageId };
    console.log(`✓ 自建标签 page id=${pageId}（tabs new）`);

    // exec 契约实现：页内表达式 → evaluate 工具（page+code）→ 解析 JSON 值
    const exec = async (expression) => {
        const result = await mcp.callTool(evalTool.name, buildArgs(evalTool, 'evaluate', expression, pageId));
        return extractEvalValue(result);
    };

    // --- 3. 校验落地 URL 并等待 composer ---
    console.log('\n📦 ① 校验落地 URL 并记录基线');
    const landedUrl = await exec('location.href');
    if (!String(landedUrl).includes('chatgpt.com')) {
        console.error(`\nBLOCKED: 落地 URL 不含 chatgpt.com（当前: ${String(landedUrl).slice(0, 120)}）。`);
        console.error('可能被重定向（未登录/风控页/网络波动 chrome-error）。');
        await cleanupOwnPage();
        process.exit(2);
    }
    console.log(`✓ 落地验证通过: ${String(landedUrl).slice(0, 80)}`);
    const composerDeadline = Date.now() + 45000;
    let composerReady = false;
    while (Date.now() < composerDeadline) {
        try {
            const found = await exec(`(() => { const el = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]'); return !!el && (el.offsetParent !== null || (el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)); })()`);
            if (found === true) { composerReady = true; break; }
        } catch { /* session/页面尚未就绪，继续等 */ }
        await sleep(1500);
    }
    if (!composerReady) {
        console.error('FAIL: 45s 内未找到 ChatGPT composer —— 可能未登录或页面结构变化。如实失败。');
        await cleanupOwnPage();
        process.exit(1);
    }

    const conversationUrlBefore = await exec('location.href');
    const baselineMessages = await readMessages(exec);
    const baselineCount = baselineMessages.length;
    console.log(`✓ 基线: url=${conversationUrlBefore}, 消息=${baselineCount}`);

    // --- 4. 注入含 nonce 的消息并真实发送，记录 t0 ---
    const nonce = generateRunNonce();
    const runId = nonce; // run_id 直接用 nonce，天然唯一且可对账
    const messageText = `DCF 实时采集验收，请原样复述以下代码：${nonce}`;
    console.log(`\n📦 ② 注入本轮 nonce 消息: "${messageText}"`);

    const injectReport = await injectText(exec, messageText);
    console.log(`✓ 注入成功: method=${injectReport.method}, selector=${injectReport.selector}`);

    await verifyInputReady(exec, messageText);
    console.log('✓ 回读完整 + 发送按钮真实 enabled（React 状态已接收输入）');

    console.log('\n📦 ③ 点击真实发送按钮，记录发送时刻 t0');
    await clickSend(exec);
    const t0Ms = Date.now();
    const t0Iso = new Date(t0Ms).toISOString();
    console.log(`✓ 已发送，t0 = ${t0Iso}`);

    // --- 5. 确认 user 消息真实进入 DOM（发送真实性锚点，不依赖截图） ---
    let domUserMessageId = null;
    const domDeadline = Date.now() + 15000;
    while (Date.now() < domDeadline) {
        try {
            const msgs = await readMessages(exec);
            const hit = msgs.slice(baselineCount).find(m =>
                m.role === 'user' && typeof m.text === 'string' && m.text.includes(nonce));
            if (hit) { domUserMessageId = hit.messageId || null; break; }
        } catch { /* 页面瞬态，继续 */ }
        await sleep(1000);
    }
    const sendOk = recordCheck('nonce 消息真实进入 DOM（新增 user 消息）', () => {
        if (!domUserMessageId && domUserMessageId !== '') {
            throw new Error(
                `15s 内 DOM 未出现含本轮 nonce 的新增 user 消息 —— 消息未真实发送，` +
                `后续采集断言无意义。疑似输入注入未进入页面状态或发送动作未生效。`
            );
        }
    });
    if (sendOk) console.log(`✓ DOM 锚点: user message_id=${domUserMessageId}`);

    // --- 6. 轮询 companion raw_events（只读白名单，30s，1s 粒度） ---
    console.log(`\n📦 ④ 轮询 companion raw_events（q=nonce，只读接口，${INGEST_TIMEOUT_MS / 1000}s 上限）`);
    let pollResult = null;
    let companionEventIds = [];
    let ingestLatencyMs = null;
    let firstHitIso = null;
    if (sendOk) {
        pollResult = await pollForNonceIngest({
            queryFn: async (n) => {
                const data = await companion.getJson(`/rpc/events/query?q=${encodeURIComponent(n)}&limit=20`);
                return (data.result && data.result.events) || [];
            },
            nonce, t0Ms,
            timeoutMs: INGEST_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS
        });
    }
    const ingestOk = recordCheck(`companion raw_events 在 ${INGEST_TIMEOUT_MS / 1000}s 内出现本轮 nonce`, () => {
        if (!sendOk) throw new Error('前置失败：消息未真实发送，采集断言直接判 FAIL，不做无意义轮询。');
        const hit = assertIngestedWithinTimeout(pollResult, nonce, INGEST_TIMEOUT_MS);
        ingestLatencyMs = hit.latencyMs;
        firstHitIso = new Date(hit.firstHitMs).toISOString();
        companionEventIds = hit.events.map(e => e.event_id).filter(Boolean);
    });
    if (ingestOk) {
        console.log(`✓ 采集延迟 ingest_latency_ms = ${ingestLatencyMs}（首次命中 ${firstHitIso}）`);
        console.log(`✓ 命中事件: ${companionEventIds.join(', ')}`);
    }

    // --- 7. 取证 manifest + 汇总 ---
    const failCount = checks.filter(c => !c.ok).length;
    const verdict = failCount === 0 ? 'pass' : 'fail';
    const failReason = verdict === 'fail'
        ? (checks.find(c => !c.ok) || {}).error || null
        : null;
    const manifestPath = writeEvidenceManifest(null, {
        run_id: runId,
        test: 'g1-real-time-ingest',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        nonce,
        conversation_url_before: conversationUrlBefore,
        message_count_before: baselineCount,
        dom_user_message_id: domUserMessageId,
        t0_sent_at: t0Iso,
        first_hit_at: firstHitIso,
        ingest_latency_ms: ingestLatencyMs,
        ingest_timeout_ms: INGEST_TIMEOUT_MS,
        companion_event_ids: companionEventIds,
        checks,
        verdict,
        fail_reason: failReason
    });
    console.log(`\n📄 取证 manifest: ${manifestPath}`);
    console.log(`（evidence 目录: ${DEFAULT_EVIDENCE_DIR}）`);

    console.log(`\nSummary: ${checks.length - failCount} passed, ${failCount} failed, verdict=${verdict}`);
    if (failCount > 0) process.exitCode = 1;
    await cleanupOwnPage();
}

// --- entry ---
if (SELF_TEST) {
    runSelfTest().then(code => process.exit(code)).catch(err => {
        console.error('FATAL:', err.message);
        process.exit(1);
    });
} else {
    main().catch(async err => {
        console.error('FATAL:', err.message);
        await cleanupOwnPage();
        process.exitCode = 1;
    });
}
