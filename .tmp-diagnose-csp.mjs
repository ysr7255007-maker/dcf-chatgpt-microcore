#!/usr/bin/env node
// 诊断：chatgpt.com CSP 是否阻止 fetch 到 localhost:8472
const MCP_URL = 'http://127.0.0.1:9010/mcp';
const CHATGPT_URL = 'https://chatgpt.com/';

class McpClient {
    constructor(endpoint) { this.endpoint = endpoint; this.sessionId = null; this.nextId = 1; this.tools = []; }
    async #post(body) {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
        if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
        return fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    #parseMessages(text, contentType) {
        if ((contentType || '').includes('text/event-stream')) {
            const out = [];
            for (const line of text.split(/\r?\n/)) { if (!line.startsWith('data:')) continue; const p = line.slice(5).trim(); if (!p) continue; try { out.push(JSON.parse(p)); } catch {} }
            return out;
        }
        try { return [JSON.parse(text)]; } catch { return []; }
    }
    async initialize() {
        this.sessionId = null; const id = this.nextId++;
        const res = await this.#post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'diag-csp', version: '1.0' } } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.sessionId = res.headers.get('mcp-session-id');
        const msgs = this.#parseMessages(await res.text(), res.headers.get('content-type'));
        const reply = msgs.find(m => m.id === id);
        if (!reply || reply.error) throw new Error('init failed');
        await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const listed = await this.request('tools/list', {});
        this.tools = listed.tools || [];
        return reply.result;
    }
    async request(method, params, canReinit = true) {
        const id = this.nextId++;
        const res = await this.#post({ jsonrpc: '2.0', id, method, params });
        if (res.status === 404 && canReinit) { await this.initialize(); return this.request(method, params, false); }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const msgs = this.#parseMessages(await res.text(), res.headers.get('content-type'));
        const reply = msgs.find(m => m.id === id) || msgs.find(m => m.result !== undefined || m.error !== undefined);
        if (!reply) throw new Error('no result');
        if (reply.error) throw new Error(JSON.stringify(reply.error));
        return reply.result;
    }
    async callTool(name, args) {
        const result = await this.request('tools/call', { name, arguments: args });
        if (result && result.isError) throw new Error(`isError: ${collectText(result).slice(0, 300)}`);
        return result;
    }
    resolveTool(candidates) {
        for (const c of candidates) { const t = this.tools.find(t => t.name === c); if (t) return t; }
        for (const c of candidates) { const t = this.tools.find(t => t.name.toLowerCase().includes(c)); if (t) return t; }
        return null;
    }
}
function collectText(result) { return (result && result.content || []).filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n'); }
function stripUntrustedWrapper(text) {
    const m = text.match(/\[UNTRUSTED_PAGE_CONTENT[^\]]*\]\s*[^\n]*\n([\s\S]*?)\n\[END_UNTRUSTED_PAGE_CONTENT[^\]]*\]/);
    const body = m ? m[1] : text;
    return body.replace(/\n?Tip: this session is[^\n]*\s*$/, '').trim();
}
function extractEvalValue(result) {
    const raw = collectText(result);
    const text = stripUntrustedWrapper(raw);
    try { return JSON.parse(text); } catch {}
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
    const firstBrace = text.search(/[[{]/);
    if (firstBrace >= 0) { try { return JSON.parse(text.slice(firstBrace)); } catch {} }
    const trimmed = text.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"'))) { try { return JSON.parse(trimmed); } catch {} }
    if (!trimmed || /\[UNTRUSTED_PAGE_CONTENT/.test(trimmed)) throw new Error(`parse failed: ${raw.slice(0, 200)}`);
    return trimmed;
}
function buildArgs(tool, kind, value, pageId) {
    const props = (tool.inputSchema && tool.inputSchema.properties) || {};
    const args = {};
    if (props.page && Number.isInteger(pageId)) args.page = pageId;
    if (kind === 'evaluate') { if (props.code) { args.code = `return (${value});`; } else if (props.function) { args.function = `() => { return (${value}); }`; } else { const key = ['expression', 'script', 'js'].find(k => props[k]) || 'code'; args[key] = value; } return args; }
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

async function main() {
    const mcp = new McpClient(MCP_URL);
    await mcp.initialize();
    const evalTool = mcp.resolveTool(['evaluate', 'run', 'evaluate_script']);
    const pageId = await createOwnPage(mcp, CHATGPT_URL);
    console.log('pageId:', pageId);
    const exec = async (expression) => {
        const result = await mcp.callTool(evalTool.name, buildArgs(evalTool, 'evaluate', expression, pageId));
        return extractEvalValue(result);
    };

    console.log('waiting 6s for page load...');
    await new Promise(r => setTimeout(r, 6000));

    // 检查 1: data-dcf-content-injected 标记（seed/adapters/chrome 扩展）
    console.log('\n=== 检查 1: seed 扩展 content.js 注入标记 ===');
    const marker = await exec(`(() => document.documentElement.getAttribute('data-dcf-content-injected'))()`);
    console.log('data-dcf-content-injected:', JSON.stringify(marker));

    // 检查 2: 尝试从页面 fetch companion
    console.log('\n=== 检查 2: 页面 fetch companion 测试 ===');
    const fetchTest = await exec(`(async () => {
        try {
            const res = await fetch('http://127.0.0.1:8472/rpc/health');
            const body = await res.text();
            return { ok: true, status: res.status, bodyHead: body.slice(0, 200) };
        } catch (e) {
            return { ok: false, error: e.message, errorName: e.name };
        }
    })()`);
    console.log(JSON.stringify(fetchTest, null, 2));

    // 检查 3: 检查 CSP 头
    console.log('\n=== 检查 3: CSP 检查 ===');
    const cspCheck = await exec(`(() => {
        const metas = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
        const cspMetas = Array.from(metas).map(m => m.getAttribute('content'));
        // Check if connect-src allows localhost
        return { cspMetas, hasConnectSrc: cspMetas.some(c => c && c.includes('connect-src')) };
    })()`);
    console.log(JSON.stringify(cspCheck, null, 2));

    // 清理
    const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
    if (tabsTool) { try { await mcp.callTool(tabsTool.name, { action: 'close', page: pageId }); } catch {} }
    console.log('\n诊断完成。');
    process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
