#!/usr/bin/env node
// G7 历史对话逐个串行读取 + SQLite 入库驱动（任务 #13）
//
// 用户硬约束（不可违反）：挨个串行读取——一次只读一个对话
//   导航 → 等待稳定 → 读取 → 入库 → 节流(≥2s + 随机抖动) → 下一个。
// 严禁并发多标签 / 批量分页 / 一次性预取。任一对话失败记录后继续下一个。
//
// 分两级路径（如实标注实际所走路径）：
//   第 1 步：探测扩展链（POST /rpc/adapter/command {kind:'list-conversations'}
//            → 轮询该 command 状态 probeMs 秒）。被消费返回结果 → A 路径；
//            始终无结果 → 记录"扩展链无消费者"证据，走 B 路径。
//   A 路径：逐个 enqueue read-by-id（一次一个，等上一个 done 再发下一个），
//            由 Chrome 扩展完成导航读取与观测入库。
//   B 路径（诚实降级）：BrowserClaw evaluate 串行采集 + 官方 ingest 端点入库。
//            transport 标注 "browserclaw-evaluate-direct-ingest"，非 mv3-extension 链。
//
// 幂等键严格复刻 seed/adapters/chrome/{content.js,outbox-core.js,ulid.js} 真实契约：
//   conversation_key = 'chatgpt.com' + '/c/<uuid>'（content.js conversationKey()）
//   source_id        = stableIdFromString('dcf.source:' + conversation_key)
//   observation_key  = message_id + ':' + event_type（content.js reportMessage()）
//   event_id         = stableIdFromString('dcf.event:' + source_id + ':' + observation_key)
//   event_type       = user→conversation.message.sent / assistant→conversation.message.received
// 相同输入 → 相同 event_id（raw_events 主键幂等），重复运行不重复入库。
//
// Usage:
//   node seed/tests/g7-history-ingest.driver.mjs
//   node seed/tests/g7-history-ingest.driver.mjs --limit=10 --probe-ms=60000
//   node seed/tests/g7-history-ingest.driver.mjs --companion=http://127.0.0.1:8472 --mcp=http://127.0.0.1:9010/mcp
//
// Exit: 0 完成（含逐条成败明细）；2 环境不可达（blocked，绝不假装通过）。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// 复用真实扩展的 stableIdFromString（SHA-256 → 26×5bit Crockford Base32）
const DCF_ULID = require(path.join(REPO_ROOT, 'seed', 'adapters', 'chrome', 'ulid.js'));

// --- CLI args ---
const argv = process.argv.slice(2);
const getArg = (name, def) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const COMPANION_URL = (getArg('companion', 'http://127.0.0.1:8472')).replace(/\/$/, '');
const MCP_URL = getArg('mcp', 'http://127.0.0.1:9010/mcp');
const LIMIT = parseInt(getArg('limit', '10'), 10);
const PROBE_MS = parseInt(getArg('probe-ms', '60000'), 10);
const CHATGPT_URL = 'https://chatgpt.com/';
const TEXT_MAX = 4000;
const EVIDENCE_DIR = path.join(REPO_ROOT, 'seed', 'docs', 'evidence', 'e2e-real');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
// 节流：串行读取硬约束——每个对话之间 ≥2s + 随机抖动 0-1500ms
async function throttle() {
    const ms = 2000 + Math.floor(Math.random() * 1500);
    console.log(`  … 节流 ${ms}ms 后读取下一个`);
    await sleep(ms);
}

// ============================================================================
// companion HTTP（本任务 B 路径经官方 ingest 端点写入，是被授权的数据采集路径）
// ============================================================================
async function companionGet(pathAndQuery) {
    const res = await fetch(COMPANION_URL + pathAndQuery, { method: 'GET' });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* leave null */ }
    return { status: res.status, ok: res.ok, body, text };
}
async function companionPost(pathName, payload) {
    const res = await fetch(COMPANION_URL + pathName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* leave null */ }
    return { status: res.status, ok: res.ok, body, text };
}
async function companionEventCount() {
    const h = await companionGet('/rpc/health');
    return (h.body && h.body.result && h.body.result.event_count) ?? null;
}

// ============================================================================
// 零依赖 MCP Streamable HTTP 客户端（g1-real-e2e / g3 §B0 模式，404 自动重连）
// ============================================================================
class McpClient {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.sessionId = null;
        this.nextId = 1;
        this.tools = [];
    }
    async _post(body) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        };
        if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
        return fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    _parseMessages(text, contentType) {
        if ((contentType || '').includes('text/event-stream')) {
            const out = [];
            for (const line of text.split(/\r?\n/)) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload) continue;
                try { out.push(JSON.parse(payload)); } catch { /* ignore */ }
            }
            return out;
        }
        try { return [JSON.parse(text)]; } catch { return []; }
    }
    async initialize() {
        this.sessionId = null;
        const id = this.nextId++;
        const res = await this._post({
            jsonrpc: '2.0', id, method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'dcf-g7-history-ingest', version: '1.0.0' }
            }
        });
        if (!res.ok) throw new Error(`MCP initialize HTTP ${res.status}`);
        this.sessionId = res.headers.get('mcp-session-id');
        const msgs = this._parseMessages(await res.text(), res.headers.get('content-type'));
        const reply = msgs.find(m => m.id === id);
        if (!reply || reply.error) {
            throw new Error('MCP initialize 未返回有效结果: ' + JSON.stringify(reply && reply.error));
        }
        await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const listed = await this.request('tools/list', {});
        this.tools = listed.tools || [];
        return reply.result;
    }
    async request(method, params, canReinit = true) {
        const id = this.nextId++;
        const res = await this._post({ jsonrpc: '2.0', id, method, params });
        if (res.status === 404 && canReinit) {
            await this.initialize();
            return this.request(method, params, false);
        }
        if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const msgs = this._parseMessages(await res.text(), res.headers.get('content-type'));
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

function collectText(result) {
    return (result && result.content || [])
        .filter(c => c && c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('\n');
}

// 剥离 BrowserClaw evaluate 返回的 [UNTRUSTED_PAGE_CONTENT ...] 安全包裹（仅当数据解析）
function stripUntrustedWrapper(text) {
    const m = text.match(/\[UNTRUSTED_PAGE_CONTENT[^\]]*\]\s*[^\n]*\n([\s\S]*?)\n\[END_UNTRUSTED_PAGE_CONTENT[^\]]*\]/);
    const body = m ? m[1] : text;
    return body.replace(/\n?Tip: this session is[^\n]*\s*$/, '').trim();
}
function extractEvalValue(result) {
    const raw = collectText(result);
    const text = stripUntrustedWrapper(raw);
    try { return JSON.parse(text); } catch { /* continue */ }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* continue */ } }
    const firstBrace = text.search(/[[{]/);
    if (firstBrace >= 0) { try { return JSON.parse(text.slice(firstBrace)); } catch { /* continue */ } }
    const trimmed = text.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) { try { return JSON.parse(trimmed); } catch { /* continue */ } }
    if (!trimmed || /\[UNTRUSTED_PAGE_CONTENT/.test(trimmed)) {
        throw new Error(`evaluate 返回无法解析（原始前 200 字符）: ${raw.slice(0, 200)}`);
    }
    return trimmed;
}
function buildArgs(tool, kind, value, pageId) {
    const props = (tool.inputSchema && tool.inputSchema.properties) || {};
    const args = {};
    if (props.page && Number.isInteger(pageId)) args.page = pageId;
    if (kind === 'evaluate') {
        if (props.code) args.code = `return (${value});`;
        else if (props.function) args.function = `() => { return (${value}); }`;
        else {
            const key = ['expression', 'script', 'js'].find(k => props[k]) || 'code';
            args[key] = value;
        }
        return args;
    }
    if (kind === 'navigate') {
        if (props.action) args.action = 'url';
        const key = ['url', 'href', 'link'].find(k => props[k]) || 'url';
        args[key] = value;
        return args;
    }
    return args;
}
async function createOwnPage(mcp, url) {
    const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
    if (!tabsTool) return null;
    const args = { action: 'new' };
    if (url) args.url = url;
    const text = collectText(await mcp.callTool(tabsTool.name, args));
    const m = text.match(/opened page (\d+)/i) || text.match(/\[(\d+)\]/);
    return m ? parseInt(m[1], 10) : null;
}
let ownPage = null;
async function cleanupOwnPage() {
    if (!ownPage) return;
    const { mcp, pageId } = ownPage;
    ownPage = null;
    try {
        const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
        if (tabsTool) await mcp.callTool(tabsTool.name, { action: 'close', page: pageId });
    } catch { /* best-effort */ }
}

// ============================================================================
// 幂等键构造（复刻真实扩展契约）
// ============================================================================
async function deriveIds(conversationId, messageId, eventType) {
    const conversationKey = 'chatgpt.com/c/' + conversationId;
    const sourceId = await DCF_ULID.stableIdFromString('dcf.source:' + conversationKey);
    const observationKey = messageId + ':' + eventType;
    const eventId = await DCF_ULID.stableIdFromString('dcf.event:' + sourceId + ':' + observationKey);
    return { conversationKey, sourceId, observationKey, eventId };
}
async function sourceIdFor(conversationId) {
    return DCF_ULID.stableIdFromString('dcf.source:chatgpt.com/c/' + conversationId);
}
function eventTypeForRole(role) {
    return role === 'user' ? 'conversation.message.sent' : 'conversation.message.received';
}

// 把一个对话的消息数组转成 raw_events 批（严格按 content.js reportMessage 的 payload 形状）
async function buildEventBatch(conversationId, conversationPath, messages, firstObservedAt) {
    const events = [];
    let seq = 0;
    for (const m of messages) {
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        if (!m.message_id || !m.text) continue;
        const eventType = eventTypeForRole(m.role);
        const { sourceId, observationKey, eventId } = await deriveIds(conversationId, m.message_id, eventType);
        seq += 1;
        events.push({
            event_id: eventId,
            source_id: sourceId,
            event_type: eventType,
            payload_json: {
                role: m.role,
                message_id: m.message_id,
                text: String(m.text).slice(0, TEXT_MAX),
                conversation_id: conversationId,
                conversation_path: conversationPath,
                observed_at: nowISO(),
                baseline_member: true,
                first_observed_at: firstObservedAt,
                freshness: 'aged',
                observation_key: observationKey,
                snapshot: true,
                transport: 'browserclaw-evaluate-direct-ingest'
            },
            created_at: nowISO(),
            sequence_number: seq
        });
    }
    return events;
}

// ============================================================================
// 第 1 步：探测扩展链（enqueue list-conversations → 轮询 command 状态 probeMs）
// ============================================================================
async function probeExtensionChain() {
    console.log(`\n[Step1] 探测扩展链：POST /rpc/adapter/command {kind:'list-conversations'}，轮询 ${PROBE_MS}ms`);
    const enq = await companionPost('/rpc/adapter/command', { kind: 'list-conversations', payload: {}, timeout_ms: PROBE_MS });
    if (!(enq.ok && enq.body && enq.body.result && enq.body.result.command_id)) {
        console.log(`[Step1] enqueue 失败（HTTP ${enq.status}）：${enq.text.slice(0, 200)}`);
        return { path: 'B', consumed: false, probe: { enqueue_http: enq.status, enqueue_body: enq.body } };
    }
    const commandId = enq.body.result.command_id;
    console.log(`[Step1] 已入队 command_id=${commandId}, wake_notified=${enq.body.result.wake_notified}`);
    const deadline = Date.now() + PROBE_MS;
    let lastStatus = enq.body.result.status || 'queued';
    const statusTrail = [];
    while (Date.now() < deadline) {
        await sleep(3000);
        const q = await companionGet('/rpc/adapter/command/' + commandId);
        const st = (q.body && q.body.result && q.body.result.status) || 'unknown';
        if (st !== lastStatus) { statusTrail.push({ at: nowISO(), status: st }); lastStatus = st; }
        process.stdout.write(`\r[Step1] command status=${st}  (${Math.round((deadline - Date.now()) / 1000)}s 剩余)   `);
        if (st === 'done') {
            const result = q.body.result.result;
            console.log(`\n[Step1] ✓ command 被消费并 done → A 路径可用`);
            return { path: 'A', consumed: true, command_id: commandId, probe: { final_status: st, result, status_trail: statusTrail } };
        }
        if (st === 'failed' || st === 'expired') {
            console.log(`\n[Step1] command 终态=${st}（无有效结果）→ 走 B 路径`);
            return { path: 'B', consumed: false, command_id: commandId, probe: { final_status: st, status_trail: statusTrail } };
        }
    }
    console.log(`\n[Step1] ${PROBE_MS}ms 内 command 始终 ${lastStatus}（无消费者/无结果）→ 记录证据，走 B 路径`);
    return { path: 'B', consumed: false, command_id: commandId, probe: { final_status: lastStatus, status_trail: statusTrail } };
}

// ============================================================================
// B 路径：BrowserClaw evaluate 串行采集 + 官方 ingest 端点入库
// ============================================================================
// 枚举侧边栏 nav a[href*="/c/"]，排除 /g/g-... GPT 专属，取前 N 个普通对话
const ENUM_EXPR = `JSON.stringify((function(){
  var anchors = document.querySelectorAll('nav a[href*="/c/"]');
  var seen = {}; var out = [];
  anchors.forEach(function(a){
    var href = a.getAttribute('href') || '';
    if (href.indexOf('/g/g-') !== -1) return;
    var m = /\\/c\\/([^\\/?#]+)/.exec(href);
    if (!m) return;
    var id = m[1];
    if (seen[id]) return; seen[id] = true;
    out.push({ id: id, title: (a.textContent||'').trim().slice(0,120), url: '/c/'+id });
  });
  return { ok:true, count: out.length, conversations: out };
})())`;

// 读取当前页所有消息（复刻 content.js readConversation 的 DOM 契约）
const READ_EXPR = `JSON.stringify((function(){
  var nodes = document.querySelectorAll('[data-message-author-role]');
  var msgs = [];
  nodes.forEach(function(n){
    var role = n.getAttribute('data-message-author-role');
    var id = n.getAttribute('data-message-id');
    if (role !== 'user' && role !== 'assistant') return;
    var t = (n.textContent||'').trim();
    if (!t) return;
    msgs.push({ role: role, message_id: id, text: t.slice(0,${TEXT_MAX}) });
  });
  var m = /^\\/c\\/([^\\/?#]+)/.exec(location.pathname);
  return { ok:true, total: msgs.length, messages: msgs,
    conversation_id: m ? m[1] : null, path: location.pathname, url: location.href, title: document.title };
})())`;

const COUNT_EXPR = `document.querySelectorAll('[data-message-author-role]').length`;

async function waitComposerOrSidebar(exec, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const ready = await exec(`(function(){
              var comp = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
              var side = document.querySelectorAll('nav a[href*="/c/"]').length;
              return (!!comp) || side > 0;
            })()`);
            if (ready === true) return true;
        } catch { /* not ready */ }
        await sleep(1500);
    }
    return false;
}

// 导航到一个历史对话并等待消息 DOM 稳定（连续 2 次相同且 >0，超时 20s 记 timeout）
async function navigateAndWaitStable(mcp, navTool, exec, pageId, conversationId) {
    const targetUrl = 'https://chatgpt.com/c/' + conversationId;
    await mcp.callTool(navTool.name, buildArgs(navTool, 'navigate', targetUrl, pageId));
    const deadline = Date.now() + 20000;
    let prev = -1, stableHits = 0, lastCount = 0;
    while (Date.now() < deadline) {
        await sleep(1500);
        let count = 0;
        try { count = await exec(COUNT_EXPR); } catch { count = 0; }
        lastCount = count;
        if (count > 0 && count === prev) {
            stableHits += 1;
            if (stableHits >= 1) return { stable: true, count }; // prev==count => 2 consecutive equal reads
        } else {
            stableHits = 0;
        }
        prev = count;
    }
    return { stable: false, count: lastCount, reason: 'timeout' };
}

// ============================================================================
// A 路径：逐个 enqueue read-by-id（一次一个，等 done 再发下一个）
// ============================================================================
async function readByIdSerial(conversationId, timeoutMs) {
    const enq = await companionPost('/rpc/adapter/command', {
        kind: 'read-by-id', payload: { conversationId, limit: 200 }, timeout_ms: timeoutMs
    });
    if (!(enq.ok && enq.body && enq.body.result && enq.body.result.command_id)) {
        return { ok: false, error: 'enqueue failed http ' + enq.status };
    }
    const commandId = enq.body.result.command_id;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(2000);
        const q = await companionGet('/rpc/adapter/command/' + commandId);
        const st = (q.body && q.body.result && q.body.result.status) || 'unknown';
        if (st === 'done') return { ok: true, command_id: commandId, result: q.body.result.result };
        if (st === 'failed' || st === 'expired') return { ok: false, command_id: commandId, error: 'command ' + st };
    }
    return { ok: false, command_id: commandId, error: 'command timeout (no consumer)' };
}

// ============================================================================
// 主流程
// ============================================================================
async function main() {
    const startedAt = nowISO();
    console.log('G7 历史对话逐个串行读取 + SQLite 入库驱动启动…');
    console.log(`  companion: ${COMPANION_URL}`);
    console.log(`  mcp:       ${MCP_URL}`);
    console.log(`  limit:     ${LIMIT}  probe-ms: ${PROBE_MS}`);

    // 0. companion 健康（不可达 = blocked exit 2）
    const count0 = await companionEventCount();
    if (count0 === null) {
        console.error(`\nBLOCKED: companion 不可达（${COMPANION_URL}/rpc/health）。启动：node seed/companion/index.js --port=8472`);
        process.exit(2);
    }
    console.log(`✓ companion healthy，入库前 raw_events event_count=${count0}`);

    // 1. 探测扩展链，决定 A/B
    const probeResult = await probeExtensionChain();
    const path = probeResult.path;

    // MCP 连接（A/B 都需要——A 需要驱动串行节奏，B 需要采集；此处 B 才真正用到 evaluate）
    const mcp = new McpClient(MCP_URL);
    try {
        await mcp.initialize();
    } catch (e) {
        console.error(`\nBLOCKED: BrowserClaw MCP 不可达（${MCP_URL}）: ${e.message}`);
        process.exit(2);
    }
    console.log(`✓ MCP 握手成功 session=${mcp.sessionId}，tools=${mcp.tools.map(t => t.name).join(', ')}`);

    const transport = path === 'A' ? 'mv3-extension-read-by-id' : 'browserclaw-evaluate-direct-ingest';
    const perConversation = [];
    let enumerated = [];

    if (path === 'B') {
        const navTool = mcp.resolveTool(['navigate', 'browser_navigate', 'goto', 'open']);
        const evalTool = mcp.resolveTool(['evaluate', 'browser_evaluate', 'execute', 'run']);
        if (!navTool || !evalTool) {
            console.error(`\nBLOCKED: 缺少 navigate/evaluate 工具。可用: ${mcp.tools.map(t => t.name).join(', ')}`);
            process.exit(2);
        }
        let pageId = null;
        try { pageId = await createOwnPage(mcp, CHATGPT_URL); } catch (e) {
            console.error(`\nBLOCKED: tabs(new) 自建标签失败: ${e.message}`); process.exit(2);
        }
        if (!Number.isInteger(pageId)) {
            console.error('\nBLOCKED: 未解析出 page id（期望 "opened page N"）。'); process.exit(2);
        }
        ownPage = { mcp, pageId };
        console.log(`✓ 自建标签 page id=${pageId}`);

        const exec = async (expression) =>
            extractEvalValue(await mcp.callTool(evalTool.name, buildArgs(evalTool, 'evaluate', expression, pageId)));

        const landed = await exec('location.href');
        if (!String(landed).includes('chatgpt.com')) {
            console.error(`\nBLOCKED: 落地 URL 不含 chatgpt.com（${String(landed).slice(0, 120)}）。可能未登录/风控/网络。`);
            await cleanupOwnPage(); process.exit(2);
        }
        console.log(`✓ 落地: ${String(landed).slice(0, 80)}`);
        if (!await waitComposerOrSidebar(exec, 45000)) {
            console.error('\nBLOCKED: 45s 内未见 composer/侧边栏对话链接，可能未登录。');
            await cleanupOwnPage(); process.exit(2);
        }

        // 枚举对话（LIGHT，一次调用，不预取内容）
        const enumRes = await exec(ENUM_EXPR);
        enumerated = (enumRes.conversations || []).slice(0, LIMIT);
        console.log(`✓ 侧边栏枚举普通对话 ${enumRes.count} 个，取前 ${enumerated.length} 个串行读取`);
        if (enumerated.length === 0) {
            console.error('\nBLOCKED: 侧边栏无普通对话链接。'); await cleanupOwnPage(); process.exit(2);
        }

        // for 循环严格串行：导航→等待稳定→读取→入库→节流
        for (let i = 0; i < enumerated.length; i++) {
            const conv = enumerated[i];
            const firstObservedAt = nowISO();
            const rec = {
                index: i + 1, conversation_id: conv.id, title: conv.title,
                url: '/c/' + conv.id, status: 'fail', message_count: 0,
                source_id: await sourceIdFor(conv.id), reason: null,
                inserted: 0, duplicated: 0
            };
            console.log(`\n[${i + 1}/${enumerated.length}] 对话 ${conv.id}  "${conv.title.slice(0, 40)}"`);
            try {
                const settle = await navigateAndWaitStable(mcp, navTool, exec, pageId, conv.id);
                if (!settle.stable) {
                    rec.reason = `导航后消息 DOM 未稳定（${settle.reason || 'unstable'}, count=${settle.count}）`;
                    console.log(`  ✗ ${rec.reason}`);
                    perConversation.push(rec);
                    await throttle();
                    continue;
                }
                const snap = await exec(READ_EXPR);
                if (snap.conversation_id !== conv.id) {
                    rec.reason = `导航未落到目标对话（当前 ${snap.conversation_id}）`;
                    console.log(`  ✗ ${rec.reason}`);
                    perConversation.push(rec);
                    await throttle();
                    continue;
                }
                const events = await buildEventBatch(conv.id, snap.path, snap.messages, firstObservedAt);
                if (events.length === 0) {
                    rec.reason = '页面无可入库消息（0 条 role/message_id/text）';
                    console.log(`  ✗ ${rec.reason}`);
                    perConversation.push(rec);
                    await throttle();
                    continue;
                }
                const ing = await companionPost('/rpc/events/batch', { events, id: 'g7-' + conv.id });
                if (!(ing.ok && ing.body && ing.body.result)) {
                    rec.reason = `ingest 失败 HTTP ${ing.status}: ${ing.text.slice(0, 160)}`;
                    console.log(`  ✗ ${rec.reason}`);
                    perConversation.push(rec);
                    await throttle();
                    continue;
                }
                rec.status = 'ok';
                rec.message_count = events.length;
                rec.inserted = ing.body.result.inserted;
                rec.duplicated = ing.body.result.duplicated;
                console.log(`  ✓ 读取 ${snap.total} 条 → 入库 ${events.length} 事件（inserted=${rec.inserted}, duplicated=${rec.duplicated}）settle=${settle.count}`);
                perConversation.push(rec);
            } catch (e) {
                rec.reason = '异常: ' + e.message;
                console.log(`  ✗ ${rec.reason}`);
                perConversation.push(rec);
            }
            await throttle();
        }
        await cleanupOwnPage();
    } else {
        // A 路径：逐个 read-by-id（此环境预期不可达，但仍如实执行并逐条记录）
        // 复用探针 list-conversations 的结果作为对话清单来源
        const listResult = probeResult.probe && probeResult.probe.result;
        enumerated = ((listResult && listResult.conversations) || []).slice(0, LIMIT);
        console.log(`✓ 扩展链 list-conversations 返回 ${enumerated.length} 个对话，逐个 read-by-id`);
        for (let i = 0; i < enumerated.length; i++) {
            const conv = enumerated[i];
            const rec = {
                index: i + 1, conversation_id: conv.id, title: conv.title || '',
                url: '/c/' + conv.id, status: 'fail', message_count: 0,
                source_id: await sourceIdFor(conv.id), reason: null
            };
            console.log(`\n[${i + 1}/${enumerated.length}] read-by-id ${conv.id}`);
            const r = await readByIdSerial(conv.id, 30000);
            if (r.ok && r.result && Array.isArray(r.result.messages)) {
                rec.status = 'ok';
                rec.message_count = r.result.messages.length;
                console.log(`  ✓ 扩展返回 ${rec.message_count} 条`);
            } else {
                rec.reason = r.error || 'no result';
                console.log(`  ✗ ${rec.reason}`);
            }
            perConversation.push(rec);
            await throttle();
        }
    }

    // 2. 入库后计数
    const count1 = await companionEventCount();
    console.log(`\n[Step2] 入库后 raw_events event_count=${count1}（增量 ${count1 - count0}）`);

    // 每对话入库消息数（按 source_id 维度查询 conversation.message.* 事件）
    for (const rec of perConversation) {
        try {
            const q = await companionGet(`/rpc/events/query?source_id=${encodeURIComponent(rec.source_id)}&limit=500&orderBy=ASC`);
            const events = (q.body && q.body.result && q.body.result.events) || [];
            rec.db_message_events = events.filter(e => typeof e.event_type === 'string' && e.event_type.indexOf('conversation.message.') === 0).length;
        } catch { rec.db_message_events = null; }
    }

    // 3. 去重验证：对第 1 个成功对话重复读取+入库一次，确认 COUNT 不变
    let dedup = null;
    const firstOk = perConversation.find(r => r.status === 'ok');
    if (path === 'B' && firstOk) {
        console.log(`\n[Step3] 去重验证：重复入库对话 ${firstOk.conversation_id}`);
        const countBeforeDedup = await companionEventCount();
        // 重新构造同一批事件（相同 message_id → 相同 event_id）；文本从库里已入库的读回即可
        const q = await companionGet(`/rpc/events/query?source_id=${encodeURIComponent(firstOk.source_id)}&limit=500&orderBy=ASC`);
        const dbEvents = (q.body && q.body.result && q.body.result.events) || [];
        const replay = dbEvents
            .filter(e => typeof e.event_type === 'string' && e.event_type.indexOf('conversation.message.') === 0)
            .map(e => {
                const p = typeof e.payload_json === 'string' ? JSON.parse(e.payload_json) : (e.payload_json || {});
                return {
                    role: p.role,
                    message_id: p.message_id,
                    text: p.text
                };
            });
        const replayEvents = await buildEventBatch(firstOk.conversation_id, '/c/' + firstOk.conversation_id, replay, nowISO());
        const ing = await companionPost('/rpc/events/batch', { events: replayEvents, id: 'g7-dedup-' + firstOk.conversation_id });
        const countAfterDedup = await companionEventCount();
        dedup = {
            conversation_id: firstOk.conversation_id,
            replay_event_count: replayEvents.length,
            ingest_result: ing.body && ing.body.result,
            count_before: countBeforeDedup,
            count_after: countAfterDedup,
            idempotent: countBeforeDedup === countAfterDedup
        };
        console.log(`  ${dedup.idempotent ? '✓' : '✗'} 幂等: 重复入库 ${replayEvents.length} 事件，COUNT ${countBeforeDedup}→${countAfterDedup}，inserted=${ing.body && ing.body.result && ing.body.result.inserted}, duplicated=${ing.body && ing.body.result && ing.body.result.duplicated}`);
    }

    // 4. manifest
    const ts = Date.now();
    const okCount = perConversation.filter(r => r.status === 'ok').length;
    const manifest = {
        task: '#13 真机逐个串行读取历史对话并验证 SQLite 入库',
        transport,
        path,
        transport_note: path === 'B'
            ? 'BrowserClaw evaluate 串行采集 + companion 官方 /rpc/events/batch 入库；非 MV3 扩展链（扩展未安装，命令队列无消费者，见 probe 证据）。这是被授权的数据采集路径，不冒充扩展链验证。'
            : 'MV3 扩展 read-by-id 命令链（扩展消费 list-conversations 探针成功）。',
        started_at: startedAt,
        finished_at: nowISO(),
        companion_url: COMPANION_URL,
        mcp_url: MCP_URL,
        db_path: (process.env.HOME || '~') + '/.dcf/dcf.db',
        probe: probeResult.probe || null,
        event_count_before: count0,
        event_count_after: count1,
        event_count_delta: count1 - count0,
        conversations_enumerated: enumerated.length,
        conversations_ok: okCount,
        conversations_failed: perConversation.length - okCount,
        per_conversation: perConversation,
        dedup_verification: dedup,
        constraints: {
            serial_one_at_a_time: true,
            throttle_ms_min: 2000,
            throttle_jitter_ms_max: 1500,
            no_concurrency: true,
            no_batch_pagination: true
        }
    };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const manifestPath = `${EVIDENCE_DIR}/manifest-history-ingest-${ts}.json`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n📄 manifest: ${manifestPath}`);

    // 5. 汇总表
    console.log('\n================ 10 个对话逐条结果 ================');
    console.log('idx | conversation_id | msg | db_msg | 状态 | 失败原因');
    for (const r of perConversation) {
        console.log(`${String(r.index).padStart(2)} | ${r.conversation_id} | ${String(r.message_count).padStart(3)} | ${String(r.db_message_events ?? '-').padStart(3)} | ${r.status === 'ok' ? '成功' : '失败'} | ${r.reason || ''}`);
    }
    console.log('==================================================');
    console.log(`所走路径: ${path}（transport=${transport}）`);
    console.log(`入库前=${count0}  入库后=${count1}  增量=${count1 - count0}`);
    if (dedup) console.log(`去重验证: ${dedup.idempotent ? '幂等生效（COUNT 不变）' : '❌ COUNT 变化'} ${dedup.count_before}→${dedup.count_after}`);
    console.log(`成功 ${okCount} / 共 ${perConversation.length}`);
}

main().catch(async err => {
    console.error('FATAL:', err && err.stack || err);
    await cleanupOwnPage();
    process.exitCode = 1;
});
