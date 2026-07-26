#!/usr/bin/env node
// G4 Surface acceptance: real-behavior verification of the core life-cycle
// 接住→显式绑定→推进→检查点→回灌 loop, driven via CDP against a real
// headless Chrome page session (file:// origin, no login state needed).
//
// Path exercised (with screenshots into seed/docs/evidence/g4/):
//   ① four categories separated (cards / sparks / recommendations / tasks)
//   ② 接住: click accept -> explicit binding modal (session radio, no default)
//      -> confirm disabled until session + execution_agent -> task materialized
//   ③ task progression proposed -> accepted -> in_progress (five-state machine)
//   ④ checkpoint saved + projection pointer
//   ⑤ 回灌: task.result_recorded + feedback_to_materials -> attribution chain
//   ⑥ regression completed -> in_progress -> 400 + rejected rendered verbatim
// UI assertions cross-checked against companion DB facts via HTTP.
//
// Usage: node seed/tests/g4-surface.acceptance.mjs
// Prereq: ports 8472/9224 free; Google Chrome at the default macOS path.

import { createConnection } from 'net';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9224;
const COMPANION_PORT = 8472;
const PAGE = 'file://' + path.join(REPO_ROOT, 'seed', 'surface', 'g4-lifecycle.html');
const TMP = path.join(REPO_ROOT, '.tmp-g4-accept');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'seed', 'docs', 'evidence', 'g4');

// --- Minimal WebSocket CDP client (same approach as g3-surface.acceptance.mjs) ---
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

function startCompanion(port, db, dcfDir) {
    return spawn(process.execPath, [path.join(REPO_ROOT, 'seed', 'companion', 'index.js'),
        `--port=${port}`, `--db=${db}`, `--dcf-dir=${dcfDir}`], { stdio: 'ignore' });
}

async function waitForHealth(port, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try { await httpGetJson(`http://127.0.0.1:${port}/rpc/health`); return true; }
        catch { await sleep(300); }
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

let chrome = null, companion = null, cdp = null;
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
    console.log('  📸 ' + path.join('seed/docs/evidence/g4', name));
}

async function main() {
    console.log('G4 Surface acceptance starting…');
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    companion = startCompanion(COMPANION_PORT, path.join(TMP, 'a.db'), path.join(TMP, 'dcf-a'));
    await waitForHealth(COMPANION_PORT);
    console.log('✓ companion up on 8472');

    // Seed: conversation (for /rpc/adapter/sessions), material, manual recommendation
    const sessionSourceId = ulid();
    const chatgptUuid = 'a1b2c3d4-e5f6-4a1b-9c2d-1234567890ab';
    await httpPostJson(COMPANION_PORT, '/rpc/events/ingest', {
        event: {
            event_id: ulid(), source_id: sessionSourceId,
            event_type: 'conversation.message.received',
            payload_json: {
                role: 'assistant', message_id: 'm-1',
                text: 'g4demo assistant reply held for binding',
                conversation_id: chatgptUuid,
                conversation_path: '/c/' + chatgptUuid,
                observed_at: new Date().toISOString()
            },
            created_at: new Date().toISOString()
        }
    });
    const materialId = ulid();
    await httpPostJson(COMPANION_PORT, '/rpc/material/revision', {
        entity_id: materialId, candidate_body: 'g4demo material body v1',
        source_ref: 'chat://g4demo/1', assertion_attribution: 'ai_proposed'
    });
    const recId = ulid();
    await httpPostJson(COMPANION_PORT, '/rpc/events/ingest', {
        event: {
            event_id: ulid(), source_id: recId,
            event_type: 'recommendation.proposed',
            payload_json: {
                recommendation_id: recId,
                source_entity_type: 'system', source_entity_id: ulid(),
                recommendation_text: 'g4demo: consolidate the intro material into one canonical doc',
                source_reasoning: 'g4demo material has divergent candidates; user asked twice about intro',
                target_material_ids: [materialId],
                materiality_score: 0.8, priority_level: 2
            },
            created_at: new Date().toISOString()
        }
    });
    console.log('✓ seed ready (1 session, 1 material, 1 pending recommendation)');

    chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox',
        '--disable-dev-shm-usage', `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${path.join(TMP, 'chrome-profile')}`, '--no-first-run',
        '--window-size=1440,1000', PAGE
    ], { stdio: 'ignore' });
    await sleep(4000);
    const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const page = targets.find(t => t.type === 'page' && t.url.includes('g4-lifecycle'));
    if (!page) throw new Error('g4-lifecycle page not found in CDP targets');
    cdp = new CdpClient();
    await cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(1500);

    // --- ① four categories separated ---
    console.log('\n📦 ① four categories separated (cards / sparks / recommendations / tasks)');
    await waitFor(`document.getElementById('pendingList').querySelectorAll('.rec-card').length > 0`, 10000, 'recommendation card rendered');
    const recCount = await evalInPage(`document.getElementById('pendingCount').textContent`);
    check('pending recommendation card visible (count=' + recCount + ')', recCount === '1');
    const reasoningText = await evalInPage(`document.querySelector('#pendingList .rec-card .rec-reasoning').textContent`);
    check('source_reasoning rendered (from event log, not projection column)', reasoningText.includes('g4demo material has divergent candidates'));
    const priorityChip = await evalInPage(`document.querySelector('#pendingList .rec-card .priority-chip').textContent`);
    check('priority chip rendered (P2)', priorityChip.includes('P2'));
    const cardsHonest = await evalInPage(`document.getElementById('cardsList').querySelector('.empty-honest') !== null`);
    check('cards panel honest empty state (no card producer / no query endpoint)', cardsHonest);
    const sparksHonest = await evalInPage(`document.getElementById('sparksList').querySelector('.empty-honest') !== null`);
    check('sparks panel honest empty state (no spark producer / no query endpoint)', sparksHonest);
    await screenshot('01-four-categories-separated.png');

    // --- ② 接住: explicit binding modal ---
    console.log('\n📦 ② 接住 -> explicit binding modal (session radio, no default, confirm disabled)');
    await evalInPage(`document.querySelector('#pendingList .rec-card .btn-accept').click(); true`);
    await waitFor(`document.getElementById('acceptModal').classList.contains('visible')`, 5000, 'accept modal visible');
    const confirmDisabledInitially = await evalInPage(`document.getElementById('confirmAcceptBtn').disabled`);
    check('confirm disabled before session selection (no default, no guessing)', confirmDisabledInitially === true);
    // openAcceptModal is async: modal becomes visible first, then fetchSessions
    // populates the list. Wait honestly for the session items to render.
    await waitFor(`document.querySelectorAll('#sessionList .session-item').length > 0`, 10000, 'session list populated from /rpc/adapter/sessions');
    const sessionCount = await evalInPage(`document.querySelectorAll('#sessionList .session-item').length`);
    check('session list populated from /rpc/adapter/sessions (' + sessionCount + ')', sessionCount >= 1);
    await evalInPage(`document.querySelector('#sessionList .session-item input[type=radio]').click(); true`);
    await evalInPage(`document.getElementById('execAgent').value = 'g4demo-user'; document.getElementById('execAgent').dispatchEvent(new Event('input')); true`);
    const confirmEnabledAfter = await evalInPage(`document.getElementById('confirmAcceptBtn').disabled`);
    check('confirm enabled after explicit session + execution_agent', confirmEnabledAfter === false);
    await screenshot('02-accept-binding-modal.png');
    await evalInPage(`document.getElementById('confirmAcceptBtn').click(); true`);
    await waitFor(`document.getElementById('acceptResult').classList.contains('ok')`, 10000, 'accept result ok');
    const acceptText = await evalInPage(`document.getElementById('acceptResult').textContent`);
    check('accept materialized a task_id in UI', /task_id=/.test(acceptText));
    const taskId = (acceptText.match(/task_id=([0-9A-HJKMNP-TV-Z]{26})/) || [])[1];
    check('task_id is a valid ULID', Boolean(taskId));
    // DB fact cross-check
    const tq = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/task/query?task_id=${taskId}`);
    check('DB: task source_ref = recommendation_id', tq.result.tasks[0].source_ref === recId);
    check('DB: bound_conversation_id = selected session source_id', tq.result.tasks[0].bound_conversation_id === sessionSourceId);
    check('DB: bound_execution_agent persisted', tq.result.tasks[0].bound_execution_agent === 'g4demo-user');
    await screenshot('03-accept-task-materialized.png');

    // --- ③ task progression proposed -> accepted -> in_progress ---
    console.log('\n📦 ③ five-state progression proposed -> accepted -> in_progress');
    await waitFor(`document.querySelector('.task-item[data-task-id="${taskId}"]') !== null`, 10000, 'task rendered in queue');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .to-state').value = 'accepted'; true`);
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-advance').click(); true`);
    await waitFor(`document.getElementById('taskResult').classList.contains('ok')`, 10000, 'proposed->accepted ok');
    let tq2 = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/task/query?task_id=${taskId}`);
    check('DB: task advanced to accepted', tq2.result.tasks[0].current_status === 'accepted');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .to-state').value = 'in_progress'; true`);
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-advance').click(); true`);
    await waitFor(`document.getElementById('taskResult').classList.contains('ok')`, 10000, 'accepted->in_progress ok');
    let tq3 = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/task/query?task_id=${taskId}`);
    check('DB: task advanced to in_progress', tq3.result.tasks[0].current_status === 'in_progress');
    await screenshot('04-task-progressed.png');

    // --- ④ checkpoint saved + projection pointer ---
    console.log('\n📦 ④ checkpoint saved + projection pointer');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .cp-note').value = 'g4demo halfway'; true`);
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-checkpoint').click(); true`);
    await waitFor(`document.getElementById('taskResult').classList.contains('ok') && document.getElementById('taskResult').textContent.includes('检查点已保存')`, 10000, 'checkpoint ok');
    let tq4 = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/task/query?task_id=${taskId}`);
    check('DB: checkpoint_event_id pointer set on task projection', Boolean(tq4.result.tasks[0].checkpoint_event_id));
    await screenshot('05-checkpoint-saved.png');

    // --- ⑤ 回灌: task.result_recorded + feedback -> attribution chain ---
    console.log('\n📦 ⑤ 回灌 (task.result_recorded + feedback_to_materials -> attribution chain)');
    await evalInPage(`document.getElementById('bpTaskSelect').value = ${JSON.stringify(taskId)}; true`);
    await evalInPage(`document.getElementById('bpKind').value = 'result_recorded'; true`);
    await evalInPage(`document.getElementById('bpMaterial').value = ${JSON.stringify(materialId)}; true`);
    const targetStateText = await evalInPage(`document.getElementById('bpTargetState').textContent`);
    check('backprop target state derived as reality_verified', targetStateText === 'reality_verified');
    await evalInPage(`document.getElementById('bpSubmitBtn').click(); true`);
    await waitFor(`document.getElementById('bpResult').classList.contains('ok')`, 10000, 'backprop ok');
    const bpText = await evalInPage(`document.getElementById('bpResult').textContent`);
    check('backprop rendered attribution chain (material.attribution.transitioned)', bpText.includes('material.attribution.transitioned'));
    check('backprop chain shows ai_proposed -> reality_verified', bpText.includes('ai_proposed') && bpText.includes('reality_verified'));
    // DB fact: material projection advanced
    const matQ = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/material/query?entity_id=${materialId}`);
    check('DB: material attribution_state = reality_verified', matQ.result.projection.attribution_state === 'reality_verified');
    await screenshot('06-backprop-chain.png');

    // --- ⑥ regression completed -> in_progress -> 400 + rejected ---
    console.log('\n📦 ⑥ regression honestly rejected (400 + rejected rendered verbatim)');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .to-state').value = 'in_progress'; true`);
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-advance').click(); true`);
    await waitFor(`document.getElementById('taskResult').classList.contains('err')`, 10000, 'regression rendered');
    const rejText = await evalInPage(`document.getElementById('taskResult').textContent`);
    check('regression rejection shows rejected=true', rejText.includes('rejected=true'));
    check('regression rejection shows rejection_event_id', rejText.includes('rejection_event_id'));
    check('regression rejection names transition_rejected event', rejText.includes('task.transition_rejected'));
    let tq5 = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/task/query?task_id=${taskId}`);
    check('DB: task unchanged at completed after rejection', tq5.result.tasks[0].current_status === 'completed');
    await screenshot('07-regression-rejected.png');

    cdp.close();
    console.log(`\nSummary: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
}).finally(() => {
    if (chrome) chrome.kill('SIGKILL');
    if (companion) try { companion.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});
