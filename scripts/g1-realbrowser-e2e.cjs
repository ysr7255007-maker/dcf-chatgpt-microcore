'use strict';
/**
 * scripts/g1-realbrowser-e2e.cjs — G1 采集链真实浏览器端到端验收（可复现）
 *
 * 证明迁移+修复后的 G1 bundle 在真实 Chrome 中端到端可采集并交付：
 *   real Chrome (Extensions.loadUnpacked) → content_script bundle.js (isolated world)
 *   → engine capture → dcf.observation → G1 SW → OutboxCore → companion /rpc/events/batch → raw_events
 *
 * 自包含：构建临时测试扩展（G1 副本 + localhost 测试适配器）+ 合成对话页，
 * 用 CDP Extensions.loadUnpacked 加载（绕过 --load-extension CLI 限制），运行后清理。
 *
 * 前置：companion 运行在 127.0.0.1:8472；本机有 Google Chrome。
 * 用途：localhost 合成对话验证 G1 链完整性；8 品牌站真实登录态复验以 BrowserClaw 为准。
 *
 * 运行：node scripts/g1-realbrowser-e2e.cjs
 */
const net = require('net'); const crypto = require('crypto'); const http = require('http');
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const DCF_ULID = require(path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'ulid.js'));

const ROOT = path.resolve(__dirname, '..');
const G1 = path.join(ROOT, 'seed', 'adapters', 'chrome');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-e2e-'));
const EXT = path.join(WORK, 'ext');
const PROFILE = path.join(WORK, 'profile');
const CHROME = process.env.DCF_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = Number(process.env.DCF_CDP_PORT || 9231);
const SITE_PORT = Number(process.env.DCF_SITE_PORT || 9913);
const COMPANION = process.env.DCF_COMPANION_URL || 'http://127.0.0.1:8472';
const CONV = 'realchain', MARKER = 'DCF-G1-E2E-MARKER-REALCHAIN';
const EVIDENCE = path.join(ROOT, 'docs', 'acceptance', 'web-capture', 'g1-realbrowser-e2e-evidence.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>G1 E2E</title></head><body>
<div data-dcf-role="user">${MARKER} DCF 观察职责归属哪层？</div>
<div data-dcf-role="assistant">观察职责属于 Target Adapter（seed/adapters/chrome），经 dcf.observation 送 companion。</div>
</body></html>`;

// Build a temp test extension: G1 copy + localhost test adapter appended to bundle + localhost manifest match.
function buildTestExt() {
    fs.cpSync(G1, EXT, { recursive: true });
    const bundlePath = path.join(EXT, 'web-capture', 'bundle.js');
    fs.appendFileSync(bundlePath, `

/* ===== E2E TEST-ONLY: localhost adapter (not shipped) ===== */
(function(g){
  var eng = g.__DCF_WEB_CAPTURE_ENGINE__, chk = g.__DCF_WEB_CAPTURE_CHECK__;
  if (!eng || !chk) return;
  var a = { host:'localhost', matches:['http://localhost:*/*','http://127.0.0.1:*/*'],
    conversationId:function(u){var m=u.pathname.match(/\\/c\\/([\\w-]+)/);return m?m[1]:'e2e';},
    messageSelectors:['[data-dcf-role]','.dcf-msg'],
    roleOf:function(el){return el.getAttribute('data-dcf-role');},
    textOf:function(el){return (el.textContent||'').trim();}, verified:false };
  try { chk.assertSiteAdapter(a); eng.registerAdapter(a); eng.start(); }
  catch(e){ console.error('[e2e] reject:', e.message); }
})(typeof globalThis!=='undefined'?globalThis:this);
`);
    const mp = path.join(EXT, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.host_permissions.push(`http://localhost:${SITE_PORT}/*`);
    for (const cs of m.content_scripts) {
        if ((cs.js || []).includes('web-capture/bundle.js')) cs.matches.push(`http://localhost:${SITE_PORT}/*`);
    }
    fs.writeFileSync(mp, JSON.stringify(m, null, 2));
}

class Cdp {
    constructor(wsUrl) { this.u = new URL(wsUrl); this.id = 0; this.pending = new Map(); this.handlers = []; this.buf = Buffer.alloc(0); this.hs = false; }
    connect() { return new Promise((resolve, reject) => {
        this.sock = net.connect({ host: this.u.hostname, port: this.u.port }, () => {
            const key = crypto.randomBytes(16).toString('base64');
            this.sock.write(`GET ${this.u.pathname} HTTP/1.1\r\nHost: ${this.u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        });
        this.sock.on('data', (d) => this._onData(d, resolve));
        this.sock.on('error', reject);
    }); }
    _onData(d, rc) { if (!this.hs) { this.buf = Buffer.concat([this.buf, d]); const s = this.buf.toString(); const i = s.indexOf('\r\n\r\n'); if (i >= 0) { this.hs = true; this.buf = this.buf.slice(Buffer.byteLength(s.slice(0, i + 4))); rc(); if (this.buf.length) this._drain(); } return; } this.buf = Buffer.concat([this.buf, d]); this._drain(); }
    _drain() { let f; while ((f = this._frame())) { try { const m = JSON.parse(f); if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); } else if (m.method) this.handlers.forEach(h => h(m)); } catch (e) {} } }
    _frame() { const b = this.buf; if (b.length < 2) return null; const l0 = b[1] & 127; let off = 2, len = l0; if (l0 === 126) { if (b.length < 4) return null; len = (b[2] << 8) | b[3]; off = 4; } else if (l0 === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; } if (b.length < off + len) return null; const p = b.slice(off, off + len).toString(); this.buf = b.slice(off + len); return p; }
    send(method, params = {}, sessionId) { const id = ++this.id; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId; const p = Buffer.from(JSON.stringify(msg)); const len = p.length; let h; if (len < 126) h = Buffer.from([0x81, 0x80 | len]); else h = Buffer.from([0x81, 0x80 | 126, (len >> 8) & 255, len & 255]); const mask = crypto.randomBytes(4); const masked = Buffer.alloc(len); for (let i = 0; i < len; i++) masked[i] = p[i] ^ mask[i % 4]; this.sock.write(Buffer.concat([h, mask, masked])); return new Promise(res => this.pending.set(id, res)); }
    on(fn) { this.handlers.push(fn); }
}

async function main() {
    buildTestExt();
    const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(HTML); });
    await new Promise(r => server.listen(SITE_PORT, '127.0.0.1', r));
    const convKey = 'localhost/c/' + CONV;
    const sourceId = await DCF_ULID.stableIdFromString('dcf.source:' + convKey);

    // Preflight: companion reachable?
    try { await fetch(`${COMPANION}/rpc/health`); } catch (e) { console.error(`companion unreachable at ${COMPANION} — start it first`); server.close(); process.exit(3); }

    const chrome = spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, 'about:blank'], { stdio: 'ignore' });
    await sleep(4000);
    const ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    const browser = new Cdp(ver.webSocketDebuggerUrl); await browser.connect();

    const load = await browser.send('Extensions.loadUnpacked', { path: EXT });
    const extId = load.result && load.result.id;
    if (!extId) { console.error('Extensions.loadUnpacked failed:', JSON.stringify(load.error)); }

    const tgt = await browser.send('Target.createTarget', { url: `http://localhost:${SITE_PORT}/c/${CONV}` });
    const att = await browser.send('Target.attachToTarget', { targetId: tgt.result.targetId, flatten: true });
    const sid = att.result.sessionId;
    await browser.send('Runtime.enable', {}, sid);
    let ctxCount = 0; browser.on((m) => { if (m.method === 'Runtime.executionContextCreated') ctxCount++; });
    await sleep(6000);
    const be = await browser.send('Runtime.evaluate', { expression: "document.documentElement.getAttribute('data-dcf-web-capture')", returnByValue: true }, sid);
    const beacon = be.result && be.result.result ? be.result.result.value : null;

    let events = [];
    for (let i = 0; i < 10; i++) { await sleep(2000); try { const r = await fetch(`${COMPANION}/rpc/events/query?source_id=${encodeURIComponent(sourceId)}&limit=50&orderBy=ASC`); const j = await r.json(); events = (j.result && j.result.events) || j.result || []; if (Array.isArray(events) && events.length) break; } catch (e) {} }

    try { process.kill(chrome.pid); } catch (_) {}
    server.close();
    await sleep(1500); // let Chrome release the profile dir before cleanup

    const payload = (e) => { try { return JSON.parse(e.payload_json); } catch { return e.payload || {}; } };
    const checks = {
        extension_loads_in_real_chrome: !!extId,
        content_script_injected: !!beacon, // beacon 由 content-script 引擎写入共享 DOM，其存在即证明注入
        engine_started_and_emitted: !!beacon && JSON.parse(beacon).emitted >= 2,
        events_delivered_via_g1_chain: events.length >= 2,
        user_marker_present: events.some(e => (payload(e).text || '').includes(MARKER)),
        assistant_present: events.some(e => payload(e).role === 'assistant'),
        transport_web_capture: events.length > 0 && events.every(e => payload(e).transport === 'web-capture'),
        source_id_consistent: events.every(e => e.source_id === sourceId)
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
        wave: '1.6-realbrowser-e2e', at: new Date().toISOString(),
        chain: 'real Chrome (Extensions.loadUnpacked) → content_script bundle.js (isolated world) → engine → dcf.observation → G1 SW → OutboxCore → companion /rpc/events/batch → raw_events',
        extension_id: extId || null, beacon: beacon ? JSON.parse(beacon) : null, source_id: sourceId, event_count: events.length,
        events: events.map(e => ({ event_type: e.event_type, role: payload(e).role, text: payload(e).text, transport: payload(e).transport, conversation_id: payload(e).conversation_id })),
        checks, passed,
        note: 'localhost 合成对话 + 测试适配器；证明迁移+修复后 G1 bundle 在真实 Chrome 端到端可采集并交付。8 品牌站真实登录态复验以 BrowserClaw 为准。'
    };
    fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
    console.log('\n=== G1 real-browser E2E ===');
    for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'} — evidence: ${EVIDENCE}`);
    // temp WORK dir left in os.tmpdir() (OS-managed); Chrome may still hold the profile briefly.
    process.exitCode = passed ? 0 : 1;
}
main().catch(e => { console.error('fatal', e.message, e.stack); process.exitCode = 1; });
