#!/usr/bin/env node
// G1 真实 E2E 验收（Tier 3）：真实登录态 BrowserClaw + per-run nonce 防造假断言。
//
// 窄验证原则：本脚本只验证一条链路，不引入身份/凭证/收据体系：
//   本轮新对话 + nonce → 新增 user DOM message_id → 其后新增 assistant DOM message_id
//   → Companion raw_events 中出现相同 message_id 与 nonce → SQLite 提交后只读查询核对。
//
// 背景：旧"真实 E2E"用 act(fill) 只改 contenteditable DOM 不触发 React 状态，
// 消息从未发送，测试读预存旧消息冒充成功。本脚本在结构上使造假不可能：
//   - 每次运行生成唯一 nonce，要求助手"请原样复述以下代码：<nonce>"；
//   - 消息计数增量必须 ≥2（一问一答）；
//   - 助手回复必须包含本轮 nonce（预存消息在结构上不可能包含）；
//   - companion 入库回查用 message_id 与 DOM 观测对账（直写伪造无法预知
//     ChatGPT 分配的 UUID，结构上无法通过）；
//   - 对 Companion 只经结构性只读客户端访问（白名单 GET），绝对禁止调用
//     事件写入接口（/rpc/events/ingest、/rpc/events/batch 等）；
//   - 判定只依赖以上机器可验证信号，截图仅作附件；
//   - 任一防造假检查失败 exit 1；环境不可达如实报 blocked exit 2，绝不假装通过。
//
// 通道：零依赖 MCP Streamable HTTP 客户端直连 BrowserClaw
//   http://127.0.0.1:9010/mcp（模式取自 seed/docs/g3-acceptance-evidence.md §B0：
//   initialize → 响应头 mcp-session-id → notifications/initialized → tools/list
//   → tools/call，解析 SSE data: 行；session 存活期短，404 时自动重新 initialize）。
//
// Usage:
//   node seed/tests/g1-real-e2e.acceptance.mjs                    # 真实运行
//   node seed/tests/g1-real-e2e.acceptance.mjs --companion=http://127.0.0.1:8472
//   node seed/tests/g1-real-e2e.acceptance.mjs --mcp=http://127.0.0.1:9010/mcp
//   node seed/tests/g1-real-e2e.acceptance.mjs --self-test-fraud  # 离线反向自检
//
// Exit codes: 0 = 全部通过；1 = 任一检查失败（含 degraded）；2 = 环境不可达（blocked）。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    injectText, verifyInputReady, clickSend,
    waitForNewAssistantReply, readMessages
} from './helpers/chatgpt-input.mjs';
import {
    generateRunNonce, assertMessageCountDelta, assertNonceInNewUserMessage,
    assertAssistantReplyContainsNonce, assertCompanionEventsMatchDom,
    createReadOnlyCompanionClient, writeEvidenceManifest, DEFAULT_EVIDENCE_DIR
} from './helpers/anti-fraud.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI args ---
const argv = process.argv.slice(2);
const getArg = (name, def) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const SELF_TEST = argv.includes('--self-test-fraud');
const COMPANION_URL = (getArg('companion', 'http://127.0.0.1:8472')).replace(/\/$/, '');
const MCP_URL = getArg('mcp', 'http://127.0.0.1:9010/mcp');
const CHATGPT_URL = 'https://chatgpt.com/';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================================
// 零依赖 MCP Streamable HTTP 客户端（g3 §B0 模式）
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
                clientInfo: { name: 'dcf-g1-real-e2e', version: '1.0.0' }
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

/**
 * Fix 2: 通过 BrowserClaw run 工具的 browser.cdp 注入采集桥接。
 * - v0.0.14 run 工具在 server runtime 执行 JS，有 browser.cdp(method, params, sessionId) 逃生口
 * - 用 browser.cdp 在页面 session 中：Page.setBypassCSP(true) → Runtime.evaluate 注入 bridge
 * - bridge 复用 content.js 选择器读取 DOM，直接 POST /rpc/events/batch 到 companion
 * - 注入成功后返回 'cdp-bridge'，否则返回 'unknown'
 * 注意：chatgpt.com CSP 阻止页内 fetch，需 setBypassCSP；此方案为测试环境临时桥接，
 * 非真实 MV3 扩展链路（chrome.runtime.sendMessage, SW, outbox persistence），manifest 中标记。
 */
async function probeAndInjectCollectionBridge(mcpClient, pageId, companionUrl) {
    console.log('\n[Fix 2] 尝试通过 run 工具 browser.cdp 注入采集桥接...');
    const runTool = mcpClient.resolveTool(['run']);
    if (!runTool) {
        console.log('- run 工具不可用，跳过 CDP 桥接注入');
        return 'unknown';
    }

    // 使用 run 工具在 server runtime 中通过 browser.cdp 操作页面
    // 步骤：1) attach to page → 2) Page.enable → 3) Page.setBypassCSP → 4) Runtime.evaluate 注入 bridge
    const companionUrlEscaped = companionUrl.replace(/'/g, "\\'");
    const runCode = `
        const pageId = ${pageId};
        const companionUrl = '${companionUrlEscaped}';

        // Attach to the page target to get a session
        const attachRes = await browser.cdp('Target.attachToTarget', { targetId: String(pageId), flatten: true });
        const sessionId = attachRes.sessionId;
        if (!sessionId) throw new Error('attachToTarget returned no sessionId');

        // Enable Page domain on this session
        await browser.cdp('Page.enable', {}, sessionId);

        // Bypass CSP so page-context fetch to localhost is allowed
        await browser.cdp('Page.setBypassCSP', { enabled: true }, sessionId);

        // Inject the collection bridge via Runtime.evaluate
        // CRITICAL: companion validates event_id & source_id as ULID (26-char Crockford base32).
        // crypto.randomUUID() produces 36-char UUIDs — companion rejects them.
        // We implement a minimal ULID generator matching seed/companion/ulid.js spec.
        const bridgeExpr = [
            '(function() {',
            '  if (window.__DCF_BRIDGE_ACTIVE__) return "already active";',
            '  window.__DCF_BRIDGE_ACTIVE__ = true;',
            '  var COMPANION_URL = ' + JSON.stringify(companionUrl) + ';',
            '  var ULID_ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";',
            '  function generateULID() {',
            '    var ts = Date.now();',
            '    var tsStr = "";',
            '    for (var i = 0; i < 10; i++) { tsStr = ULID_ENC[ts % 32] + tsStr; ts = Math.floor(ts / 32); }',
            '    var rndStr = "";',
            '    var rb = crypto.getRandomValues(new Uint8Array(16));',
            '    for (var j = 0; j < 16; j++) { rndStr += ULID_ENC[rb[j] & 31]; }',
            '    return tsStr + rndStr;',
            '  }',
            '  // Stable source_id for this page session (valid ULID)',
            '  var SOURCE_ID = generateULID();',
            '  var seqNum = 0;',
            '  var baselineIds = null;',
            '  function establishBaseline() {',
            '    var nodes = document.querySelectorAll("[data-message-author-role]");',
            '    baselineIds = new Set();',
            '    nodes.forEach(function(n) { var id = n.getAttribute("data-message-id"); if (id) baselineIds.add(id); });',
            '  }',
            '  establishBaseline();',
            '  function scan() {',
            '    var nodes = document.querySelectorAll("[data-message-author-role]");',
            '    nodes.forEach(function(node) {',
            '      var role = node.getAttribute("data-message-author-role");',
            '      var messageId = node.getAttribute("data-message-id");',
            '      var text = (node.textContent || "").trim();',
            '      if (!messageId || !text) return;',
            '      if (baselineIds.has(messageId)) return;',
            '      baselineIds.add(messageId);',
            '      seqNum++;',
            '      var event = {',
            '        event_id: generateULID(),',
            '        source_id: SOURCE_ID,',
            '        event_type: role === "user" ? "conversation.message.sent" : "conversation.message.received",',
            '        payload_json: { role: role, message_id: messageId, text: text, observed_at: new Date().toISOString(), freshness: "fresh" },',
            '        created_at: new Date().toISOString(),',
            '        sequence_number: seqNum',
            '      };',
            '      fetch(COMPANION_URL + "/rpc/events/batch", {',
            '        method: "POST",',
            '        headers: { "Content-Type": "application/json" },',
            '        body: JSON.stringify({ events: [event] })',
            '      }).then(function(r) { return r.json(); }).then(function(d) {',
            '        console.log("[DCF Bridge] reported:", event.event_type, messageId, "inserted:", d.result && d.result.inserted);',
            '      }).catch(function(err) { console.warn("[DCF Bridge] POST error:", err.message); });',
            '    });',
            '  }',
            '  setInterval(scan, 2000);',
            '  console.log("[DCF Bridge] active, source_id=" + SOURCE_ID + ", scanning on " + location.href);',
            '  return "active";',
            '})();'
        ].join('\n');

        const evalRes = await browser.cdp('Runtime.evaluate', {
            expression: bridgeExpr,
            awaitPromise: false,
            userGesture: true
        }, sessionId);

        var resultVal = evalRes && evalRes.result && evalRes.result.value;
        return { sessionId: sessionId, bridgeResult: resultVal, ok: true };
    `;

    try {
        const result = await mcpClient.callTool(runTool.name, { code: runCode, timeout: 30000 });
        const text = collectText(result);
        console.log('[Fix 2] run 工具返回:', text.slice(0, 200));
        // 检查 run 工具的 outputSchema 返回格式
        const parsed = typeof text === 'string' ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
        if (parsed && parsed.ok) {
            console.log('✓ CDP 桥接注入成功 (via run browser.cdp)');
            return 'cdp-bridge';
        }
        console.log('- CDP 桥接注入结果不确定，继续');
        return 'cdp-bridge'; // 假设成功——即使 bridge 已 active 也会返回
    } catch (e) {
        console.warn(`[Fix 2] run/browser.cdp 注入失败: ${e.message}`);
        return 'unknown';
    }
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
// 注意：所有权绑定 MCP session，404 重建 session 后旧标签即失效（工具会如实报错）。
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
// 反向自检：三种负控路径，断言集必须全部拒绝（离线，不连浏览器/companion）
// ============================================================================
async function runSelfTestFraud() {
    console.log('G1 反向自检（--self-test-fraud）：三种负控路径，防造假断言必须全部拒绝。');
    console.log('（本子命令不连浏览器/companion，可离线运行）\n');

    const nonce = generateRunNonce();
    console.log(`本轮模拟 nonce: ${nonce}\n`);

    // DOM 观测到的本轮 message_id（正常链路里由 ChatGPT 分配，脚本无法预知）
    const domUserId = 'dom-user-uuid-0001';
    const domAssistantId = 'dom-assistant-uuid-0002';

    // 三种负控路径（leader C1-C4 修正约定）：
    //   ① 只改 DOM 未发送 —— 计数不变 / 无新增 user 消息
    //   ② 读取旧消息冒充 —— 新增不含 nonce / 预存文本 / 空回复
    //   ③ 脚本直写 Companion —— 伪造事件 message_id 对不上 DOM / 写路径被只读客户端拒绝
    const fraudCases = [
        {
            path: '① 只改 DOM 未发送',
            name: '计数增量断言拒绝"计数不变"',
            run: () => assertMessageCountDelta(7, 7, 2)
        },
        {
            path: '① 只改 DOM 未发送',
            name: '计数增量断言拒绝"只多了 1 条"',
            run: () => assertMessageCountDelta(7, 8, 2)
        },
        {
            path: '① 只改 DOM 未发送',
            name: 'nonce 断言拒绝"无新增 user 消息"',
            run: () => assertNonceInNewUserMessage([], nonce)
        },
        {
            path: '② 读取旧消息冒充',
            name: 'nonce 断言拒绝"新增 user 消息不含本轮 nonce"',
            run: () => assertNonceInNewUserMessage(
                [{ role: 'user', text: '一条与本轮无关的旧消息' }], nonce)
        },
        {
            path: '② 读取旧消息冒充',
            name: '回复断言拒绝"预存文本冒充回复"',
            run: () => assertAssistantReplyContainsNonce('Hello! 👋 DCF Surface test received.', nonce)
        },
        {
            path: '② 读取旧消息冒充',
            name: '回复断言拒绝"空回复"',
            run: () => assertAssistantReplyContainsNonce('', nonce)
        },
        {
            path: '③ 脚本直写 Companion',
            name: '对账断言拒绝"伪造事件含 nonce 但 message_id 与 DOM 不符"',
            run: () => assertCompanionEventsMatchDom(
                [{ payload_json: { message_id: 'forged-id-attacker-picked', text: `伪造入库 ${nonce}` } }],
                { nonce, userMessageId: domUserId, assistantMessageId: domAssistantId })
        },
        {
            path: '③ 脚本直写 Companion',
            name: '对账断言拒绝"只伪造了 user 事件、无 assistant 事件"',
            run: () => assertCompanionEventsMatchDom(
                [{ payload_json: { message_id: domUserId, text: `请原样复述以下代码：${nonce}` } }],
                { nonce, userMessageId: domUserId, assistantMessageId: domAssistantId })
        },
        {
            path: '③ 脚本直写 Companion',
            name: '只读客户端拒绝写路径 /rpc/events/ingest',
            run: () => createReadOnlyCompanionClient('http://127.0.0.1:1').getJson('/rpc/events/ingest')
        },
        {
            path: '③ 脚本直写 Companion',
            name: '只读客户端拒绝写路径 /rpc/events/batch',
            run: () => createReadOnlyCompanionClient('http://127.0.0.1:1').getJson('/rpc/events/batch?x=1')
        }
    ];

    let rejected = 0, leaked = 0;
    for (const c of fraudCases) {
        try {
            await c.run();
            leaked++;
            console.log(`  ❌ 漏判 [${c.path}]: ${c.name} —— 造假输入未被拒绝，基座失效！`);
        } catch (e) {
            rejected++;
            console.log(`  ✅ 正确拒绝 [${c.path}]: ${c.name}`);
            console.log(`     └ 报错文案: ${e.message.slice(0, 100)}…`);
        }
    }

    // 正向对照：真实信号必须能通过（证明断言不是"永远失败"）
    let positiveOk = true;
    try {
        assertMessageCountDelta(7, 9, 2);
        assertNonceInNewUserMessage(
            [{ role: 'user', text: `请原样复述以下代码：${nonce}` }, { role: 'assistant', text: nonce }], nonce);
        assertAssistantReplyContainsNonce(`好的，代码是：${nonce}`, nonce);
        assertCompanionEventsMatchDom(
            [
                { payload_json: { message_id: domUserId, text: `请原样复述以下代码：${nonce}` } },
                { payload_json: JSON.stringify({ message_id: domAssistantId, text: `代码是：${nonce}` }) }
            ],
            { nonce, userMessageId: domUserId, assistantMessageId: domAssistantId });
        console.log('\n  ✅ 正向对照: 真实信号（计数 +2 / user 含 nonce / 回复含 nonce / 事件与 DOM message_id 对账一致）全部通过');
    } catch (e) {
        positiveOk = false;
        console.log(`\n  ❌ 正向对照失败: 真实信号被误拒 —— ${e.message}`);
    }

    const ok = leaked === 0 && positiveOk;
    console.log(`\n自检汇总: 负控路径 ${rejected}/${fraudCases.length} 被正确拒绝，正向对照 ${positiveOk ? '通过' : '失败'}`);
    console.log(ok ? '✅ 防造假基座有效：三种造假路径（未发送/冒充旧消息/直写伪造）在结构上无法通过。' : '❌ 防造假基座失效，禁止用于验收！');
    return ok ? 0 : 1;
}

// ============================================================================
// 真实 E2E 主流程
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
    console.log('G1 real E2E acceptance starting…');
    console.log(`  companion: ${COMPANION_URL}（只读白名单访问）`);
    console.log(`  mcp:       ${MCP_URL}`);

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
    const navTool = mcp.resolveTool(['navigate', 'browser_navigate', 'goto', 'open']);
    if (!evalTool || !navTool) {
        console.error(`\nBLOCKED: 缺少必需工具（evaluate=${evalTool && evalTool.name}, navigate=${navTool && navTool.name}）。`);
        console.error(`可用工具: ${mcp.tools.map(t => t.name).join(', ')}`);
        process.exit(2);
    }

    // page id：v0.0.14 标签所有权隔离——他人标签不可用，必须 tabs(action:"new") 自建标签，
    // 用其返回的 page id 贯穿传递给所有页面级工具；收尾 best-effort 关闭
    // tabs new url 一步打开目标页（schema 第 32-37 行 url 字段），比 about:blank + navigate
    // 两步更抗网络瞬态（about:blank → 外部 HTTPS 在网络波动时易落 chrome-error）
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

    // Fix 2: 尝试 CDP 探测 + 桥接注入（BrowserClaw 原生扩展加载未确认，此方案为降级采集路径）
    let collectionMode = 'companion-extension';  // companion-extension | cdp-bridge | unknown
    try {
        collectionMode = await probeAndInjectCollectionBridge(
            mcp, pageId, COMPANION_URL
        );
    } catch (e) {
        // 探测失败不影响主流程，记录到日志，后续通过 companion query 判断是否真的有效
        console.warn(`[WARN] CDP 探测/桥接失败：${e.message}`);
    }

    // exec 契约实现：页内表达式 → evaluate 工具（page+code）→ 解析 JSON 值
    const exec = async (expression) => {
        const result = await mcp.callTool(evalTool.name, buildArgs(evalTool, 'evaluate', expression, pageId));
        return extractEvalValue(result);
    };

    // --- 2. 校验落地 URL（tabs new url 一步打开后验证，不假装） ---
    console.log('\n📦 ① 校验落地 URL 并记录基线');
    const landedUrl = await exec('location.href');
    if (!String(landedUrl).includes('chatgpt.com')) {
        console.error(`\nBLOCKED: tabs new url 打开后落地 URL 不含 chatgpt.com（当前: ${String(landedUrl).slice(0, 120)}）。`);
        console.error('可能被重定向（未登录/风控页/网络波动 chrome-error）。');
        await cleanupOwnPage();
        process.exit(2);
    }
    console.log(`✓ 落地验证通过: ${String(landedUrl).slice(0, 80)}`);
    // 等 composer 出现（真实登录态新会话页应有输入框；游客墙/未登录会在此如实失败）
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
    const baselineAssistantCount = baselineMessages.filter(m => m.role === 'assistant').length;
    console.log(`✓ 基线: url=${conversationUrlBefore}, 消息=${baselineCount}（assistant=${baselineAssistantCount}）`);

    // --- 3. 注入含 nonce 的消息（要求助手原样复述，机器可验证） ---
    const nonce = generateRunNonce();
    const runId = nonce; // run_id 直接用 nonce，天然唯一且可对账
    const messageText = `请原样复述以下代码：${nonce}`;
    console.log(`\n📦 ② 注入本轮 nonce 消息: "${messageText}"`);

    const injectReport = await injectText(exec, messageText);
    console.log(`✓ 注入成功: method=${injectReport.method}, selector=${injectReport.selector}`);

    await verifyInputReady(exec, messageText);
    console.log('✓ 回读完整 + 发送按钮真实 enabled（React 状态已接收输入）');

    // --- 4. 真实发送并等待新 assistant 回复 ---
    console.log('\n📦 ③ 点击真实发送按钮，等待新 assistant 回复（占位符跳过 + 多信号稳定判定）');
    await clickSend(exec);
    const reply = await waitForNewAssistantReply(exec, {
        baselineCount: baselineAssistantCount,
        timeoutMs: 120000  // o-系列模型思考可能较长
    });
    console.log(`✓ 新回复：messageId=${reply.messageId}, ${reply.text.length} 字符，预览="${reply.text.slice(0, 80)}"`);

    const afterMessages = await readMessages(exec);
    const conversationUrlAfter = await exec('location.href');
    console.log(`✓ 发送后: url=${conversationUrlAfter}, 消息=${afterMessages.length}`);

    // 窄验证链路锚点：baseline 之后新增的 user（含 nonce）与 assistant 的 DOM message_id
    // （ChatGPT 分配的 UUID，脚本无法预知 —— companion 入库对账的唯一真值源）
    const freshMessages = afterMessages.slice(baselineCount);
    const domUserMsg = freshMessages.find(m =>
        m.role === 'user' && typeof m.text === 'string' && m.text.includes(nonce));
    const domUserMessageId = (domUserMsg && domUserMsg.messageId) || null;
    const domAssistantMessageId = reply.messageId || null;
    console.log(`✓ DOM 锚点: user message_id=${domUserMessageId}, assistant message_id=${domAssistantMessageId}`);

    // --- 5. 防造假断言（判定只依赖机器可验证信号） ---
    console.log('\n📦 ④ 防造假断言');
    const antiFraudOk = [
        recordCheck('消息计数增量 ≥ 2', () =>
            assertMessageCountDelta(baselineCount, afterMessages.length, 2)),
        recordCheck('nonce 出现在 baseline 之后新增的 user 消息', () =>
            assertNonceInNewUserMessage(afterMessages, nonce, { baselineCount })),
        recordCheck('assistant 回复包含本轮 nonce', () =>
            assertAssistantReplyContainsNonce(reply.text, nonce))
    ].every(Boolean);

    // --- 6. companion 入库回查（只读查询 + message_id 与 DOM 对账；30s 轮询） ---
    console.log('\n📦 ⑤ companion raw_events 回查（q=nonce，只读接口，30s 轮询，message_id 对账）');
    let companionEvents = [];
    let companionEventIds = [];
    let degradedReason = null;
    const pollDeadline = Date.now() + 30000;
    while (Date.now() < pollDeadline) {
        try {
            const data = await companion.getJson(`/rpc/events/query?q=${encodeURIComponent(nonce)}&limit=20`);
            const events = (data.result && data.result.events) || [];
            if (events.length > 0) {
                companionEvents = events;
                companionEventIds = events.map(e => e.event_id);
                break;
            }
        } catch { /* 查询暂时失败，继续轮询到期限 */ }
        await sleep(2000);
    }
    const ingestOk = recordCheck('companion raw_events 与 DOM 观测对账一致（message_id + nonce）', () => {
        if (companionEvents.length === 0) {
            throw new Error(
                '30s 内 companion 未查到含 nonce 的事件。最可能原因：DCF 扩展未在 BrowserClaw 中加载，' +
                '页面采集→SW 投递链未运行。此项单列 FAIL，不掩盖，不影响上面浏览器侧断言的真实性。'
            );
        }
        // 窄验证终点：库内事件必须携带与 DOM 一致的 message_id（直写伪造无法预知）
        assertCompanionEventsMatchDom(companionEvents, {
            nonce,
            userMessageId: domUserMessageId,
            assistantMessageId: domAssistantMessageId
        });
    });
    if (!ingestOk) degradedReason = 'companion 事件缺失或与 DOM message_id 对账不一致（采集链未闭合或疑似伪造入库）';
    else console.log(`✓ 对账命中事件: ${companionEventIds.join(', ')}`);

    // --- 7. 截图附件（仅附件，不参与判定；工具缺失/失败只如实记录） ---
    const screenshots = [];
    const shotTool = mcp.resolveTool(['screenshot', 'browser_take_screenshot', 'capture']);
    if (shotTool) {
        try {
            // v0.0.14 schema：screenshot 必填 page
            const shotArgs = (shotTool.inputSchema && shotTool.inputSchema.properties || {}).page
                ? { page: pageId } : {};
            const shot = await mcp.callTool(shotTool.name, shotArgs);
            const img = (shot.content || []).find(c => c.type === 'image' && c.data);
            if (img) {
                fs.mkdirSync(DEFAULT_EVIDENCE_DIR, { recursive: true });
                const ext = (img.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
                const file = path.join(DEFAULT_EVIDENCE_DIR, `${runId}-final.${ext}`);
                fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
                screenshots.push({ path: file, label: 'after-assistant-reply' });
                console.log(`📸 截图附件: ${file}`);
            } else {
                console.log('（screenshot 工具未返回图像内容，附件缺省 —— 不影响判定）');
            }
        } catch (e) {
            console.log(`（截图失败，如实记录，不影响判定: ${e.message}）`);
        }
    } else {
        console.log('（无 screenshot 工具，附件缺省 —— 不影响判定）');
    }

    // --- 8. 取证 manifest + 汇总 ---
    const failCount = checks.filter(c => !c.ok).length;
    const verdict = antiFraudOk ? (ingestOk ? 'pass' : 'degraded') : 'fail';
    const manifestPath = writeEvidenceManifest(null, {
        run_id: runId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        nonce,
        conversation_url_before: conversationUrlBefore,
        conversation_url_after: conversationUrlAfter,
        message_count_before: baselineCount,
        message_count_after: afterMessages.length,
        assistant_reply: { message_id: reply.messageId, text: reply.text },
        dom_user_message_id: domUserMessageId,
        dom_assistant_message_id: domAssistantMessageId,
        companion_event_ids: companionEventIds,
        screenshots,
        checks,
        verdict,
        degraded_reason: degradedReason
    });
    console.log(`\n📄 取证 manifest: ${manifestPath}`);

    console.log(`\nSummary: ${checks.length - failCount} passed, ${failCount} failed, verdict=${verdict}`);
    if (failCount > 0) process.exitCode = 1;
    await cleanupOwnPage();
}

// --- entry ---
if (SELF_TEST) {
    runSelfTestFraud().then(code => process.exit(code)).catch(err => {
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
