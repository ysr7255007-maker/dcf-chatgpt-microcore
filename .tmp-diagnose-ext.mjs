#!/usr/bin/env node
// 诊断扩展在 BrowserClaw 中的真实状态
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
        const res = await this.#post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'diag-ext', version: '1.0' } } });
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

    console.log('waiting 8s for page load + extension injection...');
    await new Promise(r => setTimeout(r, 8000));

    // 诊断 1: content.js 是否注入（检查 console.log 标记 + chrome.runtime 是否可用）
    console.log('\n=== 诊断 1: content.js 注入检查 ===');
    const inject = await exec(`(() => {
        // content.js 不设全局标记，但它用 console.log 输出 '[DCF observe] content script active on ...'
        // 检查 chrome.runtime 是否可用（只在扩展上下文中存在）
        const hasChromeRuntime = typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';
        // 检查是否有 MutationObserver 被注册（content.js 的特征）
        // 无法直接检查 observer，但可以检查 content.js 设置的 tracked Map 等（闭包内的）
        // 替代方案：检查 content.js 是否注册了 onMessage listener
        // 最可靠：尝试 chrome.runtime.sendMessage（只有扩展上下文才有）
        return {
            hasChromeRuntime,
            chromeRuntimeId: hasChromeRuntime ? (chrome.runtime.id || null) : null,
            url: location.href,
            title: document.title
        };
    })()`);
    console.log(JSON.stringify(inject, null, 2));

    // 诊断 2: 检查页面 console 日志中是否有 [DCF observe] 标记
    // 注意：BrowserClaw evaluate 在页面上下文执行，但无法读取 console 历史
    // 替代：直接检查 chrome.runtime.sendMessage 是否可用
    console.log('\n=== 诊断 2: chrome.runtime.sendMessage 可用性 ===');
    const msgTest = await exec(`(() => {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            return { available: false, reason: 'chrome.runtime.sendMessage not available' };
        }
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type: 'dcf.get_stats' }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ available: true, error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve({ available: true, response: response || null });
                });
            } catch (e) {
                resolve({ available: true, error: e.message });
            }
        });
    })()`);
    console.log(JSON.stringify(msgTest, null, 2));

    // 诊断 3: 检查 message DOM 结构是否被 content.js 扫描到
    console.log('\n=== 诊断 3: 消息 DOM 结构 ===');
    const msgDom = await exec(`(() => {
        const nodes = document.querySelectorAll('[data-message-author-role]');
        return Array.from(nodes).map(n => ({
            role: n.getAttribute('data-message-author-role'),
            messageId: n.getAttribute('data-message-id'),
            textHead: (n.textContent || '').slice(0, 60)
        }));
    })()`);
    console.log(JSON.stringify(msgDom, null, 2));

    // 清理
    const tabsTool = mcp.resolveTool(['tabs', 'browser_tabs', 'pages']);
    if (tabsTool) { try { await mcp.callTool(tabsTool.name, { action: 'close', page: pageId }); } catch {} }
    console.log('\n诊断完成。');
    process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
