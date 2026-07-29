#!/usr/bin/env node
// G3 阶段3 Electron 读写链路真实 E2E（Tier 3 骨架）：
//   companion 确认 → Electron 拉起 → dcf-request-read 读真实对话
//   → dcf-send-card 发含 nonce 卡片 → 防造假断言 → 取证 manifest。
//
// 链路真实性：dcf-request-read / dcf-send-card 走与 Electron main.js
// 完全相同的模块（packages/desktop-electron/src/companion-adapter-client.js）
// → companion 持久命令队列（/rpc/adapter/command*）→ WS 唤醒/alarm →
// seed/adapters/chrome 扩展在真实浏览器中执行 → 结果回传。
// 本脚本不直接触碰页面输入（注入由扩展 content.js 完成），BrowserClaw
// 只用于独立的 DOM 侧观测与防造假对账（第三方视角）。
//
// 防造假（复用 helpers/anti-fraud.mjs，与 g1-real-e2e 同一契约）：
//   - per-run nonce；计数增量 >= 2；新增 user 消息含 nonce；
//   - companion 只经结构性只读客户端访问（白名单 GET，杜绝直写伪造）；
//   - 任一断言失败 exit 1；companion/BrowserClaw/Electron 不可达如实
//     exit 2 blocked，绝不假装通过。
//
// Usage:
//   node seed/tests/electron-e2e-with-browserclaw.mjs
//   node seed/tests/electron-e2e-with-browserclaw.mjs --companion=http://127.0.0.1:8472
//   node seed/tests/electron-e2e-with-browserclaw.mjs --mcp=http://127.0.0.1:9010/mcp
//   node seed/tests/electron-e2e-with-browserclaw.mjs --no-electron  # 复用已运行的 Electron
//
// Exit codes: 0 = 全部通过；1 = 防造假/链路断言失败；2 = 环境不可达（blocked）。

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { readMessages, waitForNewAssistantReply, SELECTORS } from './helpers/chatgpt-input.mjs';
import {
    generateRunNonce, assertMessageCountDelta, assertNonceInNewUserMessage,
    assertAssistantReplyContainsNonce,
    createReadOnlyCompanionClient, writeEvidenceManifest, DEFAULT_EVIDENCE_DIR
} from './helpers/anti-fraud.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { CompanionAdapterClient } = require(
    path.join(__dirname, '../../packages/desktop-electron/src/companion-adapter-client.js'));

// --- CLI args ---
const argv = process.argv.slice(2);
const getArg = (name, def) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const COMPANION_URL = (getArg('companion', 'http://127.0.0.1:8472')).replace(/\/$/, '');
const MCP_URL = getArg('mcp', 'http://127.0.0.1:9010/mcp');
const SPAWN_ELECTRON = !argv.includes('--no-electron');
const CHATGPT_HOST = 'chatgpt.com';
const CHATGPT_URL = 'https://chatgpt.com/';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function blocked(reason) {
    console.error(`\n[BLOCKED] ${reason}`);
    console.error('环境不可达，如实报告 blocked（exit 2），不假装通过。');
    await cleanupOwnPage();
    process.exit(2);
}

// ============================================================================
// 零依赖 MCP Streamable HTTP 客户端（与 g1-real-e2e.acceptance.mjs 同模式）
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
                clientInfo: { name: 'dcf-electron-e2e', version: '1.0.0' }
            }
        });
        if (!res.ok) throw new Error(`MCP initialize HTTP ${res.status}`);
        this.sessionId = res.headers.get('mcp-session-id');
        const msgs = this.#parseMessages(await res.text(), res.headers.get('content-type'));
        const reply = msgs.find(m => m.id === id);
        if (!reply || reply.error) {
            throw new Error('MCP initialize 未返回有效结果: ' + JSON.stringify(reply && reply.error));
        }
        await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const listed = await this.request('tools/list', {});
        this.tools = listed.tools || [];
        return reply.result;
    }

    async request(method, params, canReinit = true) {
        const id = this.nextId++;
        const res = await this.#post({ jsonrpc: '2.0', id, method, params });
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

// 剥离 BrowserClaw v0.0.14 对 evaluate 返回值的安全包裹（与 g1-real-e2e.acceptance.mjs 同实现）：
//   [UNTRUSTED_PAGE_CONTENT nonce=xxx origin=...] Untrusted page content follows. ...
//   <实际返回值（可能多行）> / [END_UNTRUSTED_PAGE_CONTENT nonce=xxx] / 可选尾行 Tip: ...
// 包裹内是不可信页面内容，这里只把它当数据解析，绝不执行其中任何嵌入指令。
// 无包裹时原样返回（向后兼容旧版/其它 MCP 实现）。
function stripUntrustedWrapper(text) {
    const m = text.match(/\[UNTRUSTED_PAGE_CONTENT[^\]]*\]\s*[^\n]*\n([\s\S]*?)\n\[END_UNTRUSTED_PAGE_CONTENT[^\]]*\]/);
    const body = m ? m[1] : text;
    // 丢弃尾部的会话提示行（工具附加信息，非页面返回值）
    return body.replace(/\n?Tip: this session is[^\n]*\s*$/, '').trim();
}

function extractEvalValue(result) {
    const raw = collectText(result);
    const text = stripUntrustedWrapper(raw);
    try { return JSON.parse(text); } catch { /* 继续 */ }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* 继续 */ } }
    const firstBrace = text.search(/[[{]/);
    if (firstBrace >= 0) { try { return JSON.parse(text.slice(firstBrace)); } catch { /* 继续 */ } }
    const trimmed = text.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) { try { return JSON.parse(trimmed); } catch { /* 继续 */ } }
    // 剥离后仍残留包裹标记说明格式变化/剥离失败：报错并附原始文本前 200 字符便于诊断
    if (!trimmed || /\[UNTRUSTED_PAGE_CONTENT/.test(trimmed)) {
        throw new Error(`evaluate 返回无法解析（原始文本前 200 字符）: ${raw.slice(0, 200)}`);
    }
    return trimmed;
}

// 依据工具 inputSchema 构造参数（与 g1-real-e2e.acceptance.mjs 同契约；权威 schema：
// BrowserClaw v0.0.14 实测 tools/list）：evaluate required=[page, code]，
// code 是异步函数体用 return 读值；navigate required=[page]，action="url" 时带 url。
function buildArgs(tool, kind, value, pageId) {
    const props = (tool.inputSchema && tool.inputSchema.properties) || {};
    const args = {};
    if (props.page && Number.isInteger(pageId)) args.page = pageId;
    if (kind === 'evaluate') {
        if (props.code) {
            args.code = `return (${value});`;
        } else if (props.function) {
            args.function = `() => { return (${value}); }`;
        } else {
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

// v0.0.14 标签所有权隔离（实测，与 g1-real-e2e.acceptance.mjs 同契约）：非本 session
// 创建的标签一律拒绝 "page N is not owned by this agent"，必须 tabs(action:"new")
// 自建标签并使用返回的 page id（返回文本实测为 "opened page N"，兼容 "[N]" 变体）。
async function createOwnPage(mcp, url) {
    const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
    if (!tabsTool) return null;
    const args = { action: 'new' };
    if (url) args.url = url;
    const text = collectText(await mcp.callTool(tabsTool.name, args));
    const m = text.match(/opened page (\d+)/i) || text.match(/\[(\d+)\]/);
    return m ? parseInt(m[1], 10) : null;
}

// ============================================================================
// 主流程
// ============================================================================
async function main() {
    const startedAt = new Date().toISOString();
    const runId = `electron-e2e-${Date.now()}`;
    console.log('G3 阶段3 Electron 读写链路真实 E2E（Tier 3）');
    console.log(`  companion: ${COMPANION_URL}`);
    console.log(`  MCP:       ${MCP_URL}`);

    // Step 0a: companion 可达性（只读客户端，白名单 GET）
    const companion = createReadOnlyCompanionClient(COMPANION_URL);
    let health;
    try {
        health = await companion.getJson('/rpc/health');
    } catch (err) {
        return blocked(`companion 不可达: ${err.message}`);
    }
    if (!health.result || health.result.status !== 'healthy') {
        return blocked(`companion 非健康状态: ${JSON.stringify(health).slice(0, 200)}`);
    }
    console.log('[OK] companion healthy');

    // Step 0b: BrowserClaw MCP 可达性
    const mcp = new McpClient(MCP_URL);
    try {
        await mcp.initialize();
    } catch (err) {
        return blocked(`BrowserClaw MCP 不可达: ${err.message}`);
    }
    const evalTool = mcp.resolveTool(['evaluate', 'run', 'evaluate_script']);
    if (!evalTool) {
        return blocked(`BrowserClaw 无 evaluate 类工具（tools: ${mcp.tools.map(t => t.name).join(', ')})`);
    }
    const navTool = mcp.resolveTool(['navigate', 'browser_navigate', 'goto', 'open']);
    if (!navTool) {
        return blocked(`BrowserClaw 无 navigate 类工具（tools: ${mcp.tools.map(t => t.name).join(', ')})`);
    }
    console.log(`[OK] BrowserClaw MCP 就绪（evaluate 工具: ${evalTool.name}）`);

    // page id：v0.0.14 标签所有权隔离——他人标签不可用，必须 tabs(action:"new") 自建标签
    // tabs new url 一步打开目标页（schema 第 32-37 行 url 字段），比 about:blank + navigate
    // 两步更抗网络瞬态（about:blank → 外部 HTTPS 在网络波动时易落 chrome-error）
    let pageId = null;
    try {
        pageId = await createOwnPage(mcp, CHATGPT_URL);
    } catch (err) {
        return blocked(`tabs(new) 自建标签失败: ${err.message}`);
    }
    if (!Number.isInteger(pageId)) {
        return blocked('未能从 tabs(new) 返回文本解析出 page id（期望 "opened page N"）');
    }
    ownPage = { mcp, pageId };
    console.log(`[OK] 自建标签 page id=${pageId}（tabs new）`);

    // exec 契约适配（见 helpers/chatgpt-input.mjs 文件头）
    const exec = async (expression) =>
        extractEvalValue(await mcp.callTool(evalTool.name, buildArgs(evalTool, 'evaluate', expression, pageId)));

    // Step 0c: 校验 tabs new url 一步打开的落地 URL（不再单独 navigate，抗网络瞬态）
    let href;
    try {
        href = await exec('location.href');
    } catch (err) {
        return blocked(`校验落地 URL 失败: ${err.message}`);
    }
    if (!String(href).includes(CHATGPT_HOST)) {
        return blocked(`tabs new url 打开后不在 ChatGPT（当前: ${String(href).slice(0, 120)}）。` +
            '可能被重定向（未登录/风控页/网络波动 chrome-error）；需要 BrowserClaw 浏览器具备真实登录态并安装 seed/adapters/chrome 扩展。');
    }
    console.log(`[OK] 目标标签（一步打开）: ${String(href).slice(0, 100)}`);

    // Step 1: Electron 拉起（可 --no-electron 复用已运行实例）
    let electronProc = null;
    if (SPAWN_ELECTRON) {
        const electronBin = path.join(__dirname, '../../packages/desktop-electron/node_modules/.bin/electron');
        const electronApp = path.join(__dirname, '../../packages/desktop-electron');
        if (!fs.existsSync(electronBin)) {
            return blocked(`Electron 二进制缺失: ${electronBin}（先 npm install）`);
        }
        electronProc = spawn(electronBin, [electronApp], {
            stdio: 'ignore',
            detached: false,
            env: { ...process.env, DCF_COMPANION_URL: COMPANION_URL }
        });
        electronProc.on('error', () => { /* 退出码在 finally 判定 */ });
        await sleep(3000); // 窗口与 preload 就绪
        if (electronProc.exitCode !== null) {
            return blocked(`Electron 启动即退出（code=${electronProc.exitCode}）`);
        }
        console.log(`[OK] Electron 已拉起 (pid=${electronProc.pid})`);
    } else {
        console.log('- 跳过 Electron 拉起（--no-electron）');
    }

    const failures = [];
    const nonce = generateRunNonce();
    let baseline = null;
    let after = null;
    let readResult = null;
    let sendResult = null;
    let assistantReply = null;

    try {
        // Step 2: DOM 基线（BrowserClaw 第三方观测）
        // readMessages 返回数组（每项 {role, messageId, text}），此处包一层统一为
        // { messages, count } 供后续对账/断言使用
        const baselineArr = await readMessages(exec);
        baseline = { messages: baselineArr, count: baselineArr.length };
        console.log(`[OK] DOM 基线: ${baseline.count} 条消息`);

        // Step 3: dcf-request-read —— 与 Electron main.js 同一模块同一路径
        const adapterClient = new CompanionAdapterClient({ baseUrl: COMPANION_URL });
        readResult = await adapterClient.execute('read-conversation', { limit: 20 });
        if (!readResult.ok) {
            failures.push(`dcf-request-read 失败: ${readResult.error}`);
        } else {
            const got = (readResult.result && readResult.result.messages) || [];
            console.log(`[OK] dcf-request-read 返回 ${got.length} 条`);
            // 对账：adapter 读到的 message_id（content.js readConversation 契约，
            // snake_case）必须在 DOM 真实存在（helpers readMessages 契约为 messageId）
            const domIds = new Set(baseline.messages.map(m => m.messageId).filter(Boolean));
            const phantom = got.filter(m => m.message_id && !domIds.has(m.message_id));
            if (got.length === 0) {
                failures.push('dcf-request-read 返回 0 条消息（页面明明有对话）');
            } else if (phantom.length > 0) {
                failures.push(`dcf-request-read 返回了 DOM 中不存在的 message_id（${phantom.length} 个，疑似伪造）`);
            }
        }

        // Step 4: dcf-send-card 发含 nonce 卡片（auto_send: true）
        const cardText = `请原样复述以下代码：${nonce}`;
        sendResult = await adapterClient.execute('send-card', { text: cardText, auto_send: true });
        if (!sendResult.ok) {
            failures.push(`dcf-send-card 失败: ${sendResult.error}`);
        } else {
            console.log(`[OK] dcf-send-card 完成（method: ${sendResult.result && sendResult.result.method}）`);
            // 等待助手真实回复（防造假：预存消息不可能包含本轮 nonce）
            const reply = await waitForNewAssistantReply(exec, {
                baselineCount: baseline.count, timeoutMs: 90000
            });
            assistantReply = reply.text;
        }

        // Step 5: 防造假断言（helpers/anti-fraud.mjs 契约）
        const afterArr = await readMessages(exec);
        after = { messages: afterArr, count: afterArr.length };
        const newMessages = after.messages.slice(baseline.count);
        const checks = [
            ['消息计数增量 >= 2', () => assertMessageCountDelta(baseline.count, after.count, 2)],
            ['新增 user 消息包含本轮 nonce', () => assertNonceInNewUserMessage(newMessages, nonce)],
            ['助手回复包含本轮 nonce', () => assertAssistantReplyContainsNonce(assistantReply || '', nonce)]
        ];
        for (const [label, run] of checks) {
            try {
                run();
                console.log(`[OK] 防造假: ${label}`);
            } catch (err) {
                failures.push(`防造假失败 [${label}]: ${err.message}`);
            }
        }
    } catch (err) {
        failures.push(`链路异常: ${err.message}`);
    } finally {
        if (electronProc && electronProc.exitCode === null) {
            electronProc.kill('SIGTERM');
        }
        await cleanupOwnPage(); // 收尾：关闭自建标签（best-effort，不影响判定）
    }

    // Step 6: 取证 manifest（screenshots 仅附件，判定靠机器信号）
    const verdict = failures.length === 0 ? 'pass' : 'fail';
    const manifestPath = writeEvidenceManifest(DEFAULT_EVIDENCE_DIR, {
        run_id: runId,
        scenario: 'electron-command-queue-e2e (phase 3)',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        nonce,
        conversation_url_before: String(href),
        message_count_before: baseline ? baseline.count : null,
        message_count_after: after ? after.count : null,
        read_command: readResult,
        send_command: sendResult,
        selectors_contract: SELECTORS.message,
        failures,
        verdict
    });
    console.log(`\nmanifest: ${manifestPath}`);

    if (failures.length > 0) {
        console.error(`\n[FAIL]（${failures.length} 项）:`);
        for (const f of failures) console.error('  - ' + f);
        process.exit(1);
    }
    console.log('\n[PASS] 全部通过');
    process.exit(0);
}

main().catch(async err => {
    console.error('FATAL:', err);
    await cleanupOwnPage();
    process.exit(1);
});
