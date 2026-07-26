#!/usr/bin/env node
// G3 Surface acceptance: real-behavior verification of the manual-marking
// revision-candidate loop, driven via CDP against a real headless Chrome
// page session (file:// origin, no login state needed).
//
// Path exercised (with screenshots into seed/docs/evidence/g3/):
//   mark assistant reply as revision candidate (ai_proposed)
//   -> four-state transition (forward OK, regression rejected verbatim)
//   -> launch modal with revision instruction template
//   -> GitHub push without base -> 409 conflict text rendered IN FULL
//   -> pull-then-push (recommended) -> candidate on dcf/candidates only
//   -> export (Markdown + JSONL)
//   -> gh-unavailable companion -> 503 local-only rendered honestly
//
// Usage: node seed/tests/g3-surface.acceptance.mjs
// Prereq: ports 8472/18475 free; Google Chrome at the default macOS path.

import { createConnection } from 'net';
import { createHash } from 'crypto';
import { spawn, execFileSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9224;
const COMPANION_PORT = 8472;      // page default
const LOCAL_ONLY_PORT = 18475;    // second companion started WITHOUT gh in PATH
const PAGE = 'file://' + path.join(REPO_ROOT, 'seed', 'surface', 'g3-materials.html');
const TMP = path.join(REPO_ROOT, '.tmp-g3-accept');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'seed', 'docs', 'evidence', 'g3');

// --- Minimal WebSocket CDP client (same approach as g2-reconnect.acceptance.mjs) ---
class CdpClient {
    constructor() { this.id = 0; this.socket = null; this.pending = new Map(); this.buffer = Buffer.alloc(0); }
    async connect(wsUrl) {
        return new Promise((resolve, reject) => {
            const url = new URL(wsUrl);
            this.socket = createConnection({ port: url.port || 80, host: url.hostname }, () => {
                const key = createHash('sha1').update(Math.random().toString()).digest('base64');
                this.socket.write([
                    `GET ${url.pathname}${url.search} HTTP/1.1`,
                    `Host: ${url.host}`,
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Key: ${key}`,
                    'Sec-WebSocket-Version: 13',
                    '', ''
                ].join('\r\n'));
            });
            let headersDone = false;
            this.socket.on('data', (data) => {
                if (!headersDone) {
                    this.buffer = Buffer.concat([this.buffer, data]);
                    const idx = this.buffer.indexOf('\r\n\r\n');
                    if (idx !== -1) {
                        headersDone = true;
                        this.buffer = this.buffer.slice(idx + 4);
                        resolve();
                        this.processFrames();
                    }
                    return;
                }
                this.buffer = Buffer.concat([this.buffer, data]);
                this.processFrames();
            });
            this.socket.on('error', reject);
        });
    }
    processFrames() {
        while (this.buffer.length >= 2) {
            const first = this.buffer[0];
            const second = this.buffer[1];
            const opcode = first & 0x0f;
            let len = second & 0x7f;
            let offset = 2;
            if (len === 126) {
                if (this.buffer.length < 4) break;
                len = this.buffer.readUInt16BE(2); offset = 4;
            } else if (len === 127) {
                if (this.buffer.length < 10) break;
                len = Number(this.buffer.readBigUInt64BE(2)); offset = 10;
            }
            if (this.buffer.length < offset + len) break;
            const payload = this.buffer.slice(offset, offset + len).toString('utf8');
            this.buffer = this.buffer.slice(offset + len);
            if (opcode === 1) {
                try {
                    const msg = JSON.parse(payload);
                    if (msg.id && this.pending.has(msg.id)) {
                        const r = this.pending.get(msg.id);
                        this.pending.delete(msg.id);
                        r(msg);
                    }
                } catch { /* ignore partial frames */ }
            }
        }
    }
    send(method, params = {}, sessionId = null) {
        this.id++;
        const msg = { id: this.id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        const payload = Buffer.from(JSON.stringify(msg), 'utf8');
        let header;
        if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
        else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
        else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
        const mask = Buffer.from([0, 0, 0, 0]);
        const frame = Buffer.concat([header, mask, payload]);
        return new Promise((resolve) => {
            this.pending.set(this.id, resolve);
            this.socket.write(frame);
        });
    }
    close() { if (this.socket) this.socket.end(); }
}

// --- Helpers ---
const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

function httpPostJson(port, urlPath, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: urlPath, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.end(body);
    });
}

function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function startCompanion(port, db, dcfDir, envPath = null) {
    const env = { ...process.env };
    if (envPath) env.PATH = envPath; // strips gh -> honest local-only mode
    // process.execPath: absolute node binary, still works with a stripped PATH
    return spawn(process.execPath, [path.join(REPO_ROOT, 'seed', 'companion', 'index.js'),
        `--port=${port}`, `--db=${db}`, `--dcf-dir=${dcfDir}`], { stdio: 'ignore', env });
}

async function waitForHealth(port, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await httpGetJson(`http://127.0.0.1:${port}/rpc/health`);
            return true;
        } catch { await sleep(300); }
    }
    throw new Error(`companion on ${port} did not become healthy`);
}

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
    let t = Date.now(), ts = '';
    for (let i = 0; i < 10; i++) { ts = ENC[t % 32] + ts; t = Math.floor(t / 32); }
    let r = '';
    for (let i = 0; i < 16; i++) r += ENC[Math.floor(Math.random() * 32)];
    return ts + r;
}

let chrome = null, companionA = null, companionB = null;
let cdp = null;
let pass = 0, fail = 0;
const check = (name, ok) => {
    console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}: ${name}`);
    ok ? pass++ : fail++;
};

async function evalInPage(expression) {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.error) throw new Error(JSON.stringify(res.error));
    if (res.result && res.result.exceptionDetails) {
        throw new Error('page exception: ' + JSON.stringify(res.result.exceptionDetails.exception));
    }
    return res.result && res.result.result ? res.result.result.value : undefined;
}

async function waitFor(expression, timeoutMs = 15000, label = expression) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const v = await evalInPage(expression);
        if (v) return v;
        await sleep(400);
    }
    throw new Error('timeout waiting for: ' + label);
}

async function screenshot(name) {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const b64 = res.result && res.result.data;
    if (!b64) throw new Error('screenshot failed: ' + name);
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(b64, 'base64'));
    console.log('  📸 ' + path.join('seed/docs/evidence/g3', name));
}

async function main() {
    console.log('G3 Surface acceptance starting…');
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // 0. simulated GitHub remote: local bare repo with a user canonical file
    const bareRepo = path.join(TMP, 'remote.git');
    git(['init', '--bare', '--initial-branch=main', bareRepo], TMP);
    const userWork = path.join(TMP, 'user-work');
    git(['clone', bareRepo, userWork], TMP);
    const canonicalPath = 'notes/topic.md';
    const userV1 = '# Topic\n\nuser intro paragraph\n\nsection A\n';
    fs.mkdirSync(path.join(userWork, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(userWork, canonicalPath), userV1);
    git(['add', canonicalPath], userWork);
    git(['-c', 'user.name=g3-user', '-c', 'user.email=g3-user@localhost', 'commit', '-m', 'user: initial notes'], userWork);
    git(['push', 'origin', 'HEAD:main'], userWork);
    console.log('✓ local bare remote ready (user canonical on main)');

    // 1. companions: A = full (8472), B = PATH without gh (18475, 503 path)
    companionA = startCompanion(COMPANION_PORT, path.join(TMP, 'a.db'), path.join(TMP, 'dcf-a'));
    companionB = startCompanion(LOCAL_ONLY_PORT, path.join(TMP, 'b.db'), path.join(TMP, 'dcf-b'), '/usr/bin:/bin');
    await waitForHealth(COMPANION_PORT);
    await waitForHealth(LOCAL_ONLY_PORT);
    console.log('✓ companions up: 8472 (full), 18475 (PATH without gh)');

    // 2. seed adapter-captured conversation into A (same envelope content.js produces)
    const sourceId = ulid();
    const assistantText = 'g3demo REVISED: # Topic\n\nintro paragraph revised by assistant\n\nsection A\n';
    await httpPostJson(COMPANION_PORT, '/rpc/events/batch', {
        events: [
            {
                event_id: ulid(), source_id: sourceId, event_type: 'conversation.message.sent',
                payload_json: { role: 'user', message_id: 'u-1', text: 'g3demo please revise the intro', conversation_path: '/c/demo', observed_at: new Date().toISOString() },
                created_at: new Date().toISOString(), sequence_number: 1
            },
            {
                event_id: ulid(), source_id: sourceId, event_type: 'conversation.message.received',
                payload_json: { role: 'assistant', message_id: 'a-1', text: assistantText, conversation_path: '/c/demo', observed_at: new Date().toISOString() },
                created_at: new Date().toISOString(), sequence_number: 2
            }
        ]
    });
    console.log('✓ conversation seeded (1 user + 1 assistant message)');

    // 3. headless chrome on the G3 surface
    chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${path.join(TMP, 'chrome-profile')}`, '--no-first-run',
        '--window-size=1440,1000', PAGE
    ], { stdio: 'ignore' });
    await sleep(4000);
    const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const page = targets.find(t => t.type === 'page' && t.url.includes('g3-materials'));
    if (!page) throw new Error('g3-materials page not found in CDP targets');
    cdp = new CdpClient();
    await cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(1500);

    // --- ① mark assistant reply as revision candidate ---
    console.log('\n📦 ① mark assistant reply as revision candidate');
    await evalInPage(`document.getElementById('msgSearchInput').value = 'g3demo'; document.getElementById('msgSearchBtn').click(); true`);
    await waitFor(`document.querySelectorAll('input[name="msgPick"]').length > 0`, 10000, 'assistant messages listed');
    const msgCount = await evalInPage(`document.querySelectorAll('input[name="msgPick"]').length`);
    check('only assistant replies listed as markable (' + msgCount + ')', msgCount === 1);
    await evalInPage(`document.querySelector('input[name="msgPick"]').click(); true`);
    await evalInPage(`document.getElementById('entitySelect').value = '__new__'; document.getElementById('markBtn').click(); true`);
    await waitFor(`document.getElementById('markResult').classList.contains('ok')`, 10000, 'mark result ok');
    const markText = await evalInPage(`document.getElementById('markResult').textContent`);
    check('marking succeeded with event_id + sha256', /event_id:/.test(markText) && /candidate_sha256:/.test(markText));
    check('marking defaulted to ai_proposed', /assertion_attribution: ai_proposed/.test(markText));
    const entityId = (markText.match(/entity_id: (\S+)/) || [])[1];
    check('entity created (' + entityId + ')', Boolean(entityId));
    await waitFor(`document.getElementById('detailStateBadge').textContent.includes('ai_proposed')`, 10000, 'detail shows ai_proposed');
    await screenshot('01-mark-candidate.png');

    // --- ② four-state transition: forward then regression ---
    console.log('\n📦 ② four-state transition (forward + honest regression rejection)');
    await evalInPage(`document.getElementById('toStateSelect').value = 'user_confirmed'; document.getElementById('transitionBtn').click(); true`);
    await waitFor(`document.getElementById('transitionResult').classList.contains('ok')`, 10000, 'forward transition ok');
    const badge = await evalInPage(`document.getElementById('detailStateBadge').textContent`);
    check('state badge advanced to user_confirmed', badge.includes('user_confirmed'));
    await screenshot('02-transition-confirmed.png');

    await evalInPage(`document.getElementById('toStateSelect').value = 'ai_proposed'; document.getElementById('transitionBtn').click(); true`);
    await waitFor(`document.getElementById('transitionResult').classList.contains('err')`, 10000, 'regression rejected');
    const rejText = await evalInPage(`document.getElementById('transitionResult').textContent`);
    check('regression rejection reason shown verbatim', /Cannot transition/.test(rejText) && /reality_verified/.test(rejText));
    const rejectedRow = await evalInPage(`document.querySelectorAll('.event-row.rejected').length`);
    check('rejection visible in event chain (transition_rejected)', rejectedRow >= 1);
    const badgeAfter = await evalInPage(`document.getElementById('detailStateBadge').textContent`);
    check('state unchanged after rejection', badgeAfter.includes('user_confirmed'));
    await screenshot('03-regression-rejected.png');

    // --- ③ launch modal with revision instruction template ---
    console.log('\n📦 ③ launch modal (revision instruction template)');
    await evalInPage(`document.getElementById('launchBtn').click(); true`);
    await waitFor(`document.getElementById('launchModal').classList.contains('visible')`, 5000, 'launch modal visible');
    const launchText = await evalInPage(`document.getElementById('launchPayload').textContent`);
    check('launch text contains revision instruction template', launchText.includes('【DCF 修订请求】'));
    check('launch text carries material body verbatim', launchText.includes('intro paragraph revised by assistant'));
    await screenshot('04-launch-template.png');
    await evalInPage(`document.getElementById('cancelLaunchBtn').click(); true`);

    // --- ④ GitHub: push WITHOUT base -> 409 conflict rendered in full ---
    console.log('\n📦 ④ push without sync base -> 409 conflict text rendered in full');
    await evalInPage(`document.getElementById('ghRemote').value = ${JSON.stringify(bareRepo)};
        document.getElementById('ghFilePath').value = ${JSON.stringify(canonicalPath)};
        document.getElementById('ghPushBtn').click(); true`);
    await waitFor(`document.getElementById('conflictPre').classList.contains('visible')`, 30000, '409 conflict pre visible');
    const conflictText = await evalInPage(`document.getElementById('conflictPre').textContent`);
    check('conflict text carries diff3 markers verbatim', conflictText.includes('<<<<<<<') && conflictText.includes('>>>>>>>'));
    check('both sides visible in conflict text', conflictText.includes('user intro paragraph') && conflictText.includes('revised by assistant'));
    const ghErrText = await evalInPage(`document.getElementById('ghResult').textContent`);
    check('409 result names conflict_event_id (recorded for user decision)', /conflict_event_id: \S+/.test(ghErrText));
    await evalInPage(`document.getElementById('conflictPre').scrollIntoView({block:'center'}); true`);
    await sleep(500);
    await screenshot('05-push-conflict-409.png');

    // --- ⑤ recommended path: pull (build base) then push -> candidate branch only ---
    console.log('\n📦 ⑤ pull-then-push (recommended) -> dcf/candidates only, canonical untouched');
    await evalInPage(`document.getElementById('ghSyncBtn').click(); true`);
    await waitFor(`document.getElementById('ghResult').classList.contains('ok') && document.getElementById('ghResult').textContent.includes('先 pull 后 push 完成')`, 40000, 'pull-then-push ok');
    const syncText = await evalInPage(`document.getElementById('ghResult').textContent`);
    check('candidate pushed to dcf/candidates branch', syncText.includes('branch=dcf/candidates'));
    check('candidate path under dcf/candidates/', syncText.includes('candidate_path=dcf/candidates/'));
    await evalInPage(`document.getElementById('ghResult').scrollIntoView({block:'center'}); true`);
    await sleep(500);
    await screenshot('06-pull-then-push.png');
    // remote facts: canonical byte-identical on main, candidate only on branch
    const checkWork = path.join(TMP, 'check-work');
    git(['clone', bareRepo, checkWork], TMP);
    const mainCanonical = git(['show', `origin/main:${canonicalPath}`], checkWork);
    check('user canonical on main byte-identical (never overwritten)', mainCanonical === userV1);
    let mainHasDcf = true;
    try { git(['show', `origin/main:dcf/candidates/${entityId}.md`], checkWork); } catch { mainHasDcf = false; }
    check('no DCF artifact on user default branch', mainHasDcf === false);
    const branchCandidate = git(['show', `origin/dcf/candidates:dcf/candidates/${entityId}.md`], checkWork);
    check('candidate readable from dcf/candidates branch', branchCandidate.includes('revised by assistant'));

    // --- ⑥ export ---
    console.log('\n📦 ⑥ export (self-interpreting Markdown + JSONL)');
    const exportDir = path.join(TMP, 'exports');
    await evalInPage(`document.getElementById('exportDirInput').value = ${JSON.stringify(exportDir)};
        document.getElementById('exportBtn').click(); true`);
    await waitFor(`document.getElementById('exportResult').classList.contains('ok')`, 15000, 'export ok');
    const exportText = await evalInPage(`document.getElementById('exportResult').textContent`);
    const exportPath = (exportText.match(/export_path: (\S+)/) || [])[1];
    check('export returned export_path', Boolean(exportPath));
    const trio = ['README.md', 'materials.md', 'events.jsonl'].every(f => fs.existsSync(path.join(exportPath, f)));
    check('export trio exists on disk (README/materials/events)', trio);
    await evalInPage(`document.getElementById('exportResult').scrollIntoView({block:'center'}); true`);
    await sleep(500);
    await screenshot('07-export.png');

    // --- ⑦ 503 local-only rendered honestly (companion without gh in PATH) ---
    console.log('\n📦 ⑦ gh unavailable -> 503 local-only rendered honestly');
    // companion B needs one material entity so the Surface can select it
    const bEntity = ulid();
    const bMsg = ulid();
    await httpPostJson(LOCAL_ONLY_PORT, '/rpc/material/revision', {
        entity_id: bEntity, candidate_body: 'local-only demo body', source_ref: bMsg,
        assertion_attribution: 'ai_proposed'
    });
    await cdp.send('Page.navigate', { url: PAGE + '?companion=http://127.0.0.1:' + LOCAL_ONLY_PORT });
    await sleep(2500);
    await waitFor(`document.querySelectorAll('.material-item').length > 0`, 10000, 'material listed on companion B');
    await evalInPage(`document.querySelector('.material-item').click(); true`);
    await sleep(800);
    await evalInPage(`document.getElementById('ghRemote').value = 'someowner/somerepo';
        document.getElementById('ghFilePath').value = 'notes/topic.md';
        document.getElementById('ghPullBtn').click(); true`);
    await waitFor(`document.getElementById('ghResult').classList.contains('err')`, 20000, '503 rendered');
    const localOnlyText = await evalInPage(`document.getElementById('ghResult').textContent`);
    check('503 local-only message rendered honestly', localOnlyText.includes('503') && localOnlyText.includes('local-only'));
    await evalInPage(`document.getElementById('ghResult').scrollIntoView({block:'center'}); true`);
    await sleep(500);
    await screenshot('08-local-only-503.png');

    cdp.close();
    console.log(`\nSummary: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
}).finally(() => {
    if (chrome) chrome.kill('SIGKILL');
    for (const c of [companionA, companionB]) {
        if (c) try { c.kill('SIGKILL'); } catch { /* already gone */ }
    }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});
