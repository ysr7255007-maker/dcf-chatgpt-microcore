// 零依赖 BrowserClaw MCP 客户端（复刻 g7 driver 模式，404 自动重连）
'use strict';

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
        clientInfo: { name: 'dcf-web-capture-acceptance', version: '1.0.0' }
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
}

function collectText(result) {
  return (result && result.content || [])
    .filter(c => c && c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('\n');
}

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

module.exports = { McpClient, collectText, extractEvalValue, stripUntrustedWrapper };
