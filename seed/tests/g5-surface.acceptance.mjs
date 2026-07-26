#!/usr/bin/env node
// G5 Surface acceptance: real-behavior verification of cross-executor
// collaboration features (rebind, binding_history, audit events, agent filter),
// driven via CDP against a real headless Chrome page session.
//
// Path exercised (with screenshots into seed/docs/evidence/g5/):
//   ① task rendered with G5 controls (rebind button, exec history toggle, audit container)
//   ② rebind modal: open -> fill agent + url + reason -> confirm -> 200 + projection updated
//   ③ executor history: expand -> binding_history entries visible (from→to agent, reason)
//   ④ audit events: ingest overreach(critical) -> red banner visible in UI
//   ⑤ audit events: ingest expansion(pending) -> yellow banner with approve/deny buttons
//   ⑥ expansion approve: click approve -> new event ingested -> banner updates to decided
//   ⑦ audit events: ingest divergence -> blue info banner visible
//   ⑧ agent filter: select agent from dropdown -> task list filtered
// UI assertions cross-checked against companion DB facts via HTTP.
//
// Usage: node seed/tests/g5-surface.acceptance.mjs
// Prereq: ports 8472/9225 free; Google Chrome at the default macOS path.

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
const CDP_PORT = 9225;
const COMPANION_PORT = 8472;
const PAGE = 'file://' + path.join(REPO_ROOT, 'seed', 'surface', 'g4-lifecycle.html');
const TMP = path.join(REPO_ROOT, '.tmp-g5-accept');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'seed', 'docs', 'evidence', 'g5');

// --- Minimal WebSocket CDP client (same approach as g4-surface.acceptance.mjs) ---
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
    console.log('  📸 ' + path.join('seed/docs/evidence/g5', name));
}

async function main() {
    console.log('G5 Surface acceptance starting…');
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    companion = startCompanion(COMPANION_PORT, path.join(TMP, 'a.db'), path.join(TMP, 'dcf-a'));
    await waitForHealth(COMPANION_PORT);
    console.log('✓ companion up on 8472');

    // Seed: material + recommendation + accept -> task with agent-A
    const materialId = ulid();
    await httpPostJson(COMPANION_PORT, '/rpc/material/revision', {
        entity_id: materialId, candidate_body: 'g5demo material body',
        source_ref: 'chat://g5demo/1', assertion_attribution: 'ai_proposed'
    });

    const recId = ulid();
    await httpPostJson(COMPANION_PORT, '/rpc/events/ingest', {
        event: {
            event_id: ulid(), source_id: recId,
            event_type: 'recommendation.proposed',
            payload_json: {
                recommendation_id: recId,
                source_entity_type: 'system', source_entity_id: ulid(),
                recommendation_text: 'g5demo: task for cross-executor rebind testing',
                source_reasoning: 'g5demo acceptance seed',
                target_material_ids: [materialId],
                materiality_score: 0.7, priority_level: 3
            },
            created_at: new Date().toISOString()
        }
    });

    // Accept the recommendation with agent-A binding
    const acceptRes = await httpPostJson(COMPANION_PORT, '/rpc/recommendation/accept', {
        recommendation_id: recId,
        binding_context: {
            conversation_url: 'https://chatgpt.com/c/g5demo-init',
            execution_agent: 'agent-A',
            user_confirmed_at: new Date().toISOString()
        }
    });
    const taskId = acceptRes.body.result.task_id;
    console.log('✓ seed ready (1 material, 1 task with agent-A, task_id=' + taskId.substring(0, 8) + '…)');

    // Pre-seed audit events for the task so they appear on page load
    // Overreach (critical)
    await httpPostJson(COMPANION_PORT, '/rpc/events/ingest', {
        event: {
            event_id: ulid(), source_id: taskId,
            event_type: 'task.overreach_detected',
            payload_json: {
                task_id: taskId,
                objective: 'g5demo task objective',
                executed_action: 'agent-A modified files outside task boundary',
                detection_evidence: { files: ['outside/scope.js'] },
                detected_at: new Date().toISOString(),
                detected_by: 'boundary-guard',
                severity: 'critical'
            },
            created_at: new Date().toISOString()
        }
    });
    // Expansion (pending)
    await httpPostJson(COMPANION_PORT, '/rpc/events/ingest', {
        event: {
            event_id: ulid(), source_id: taskId,
            event_type: 'task.privilege_expansion_requested',
            payload_json: {
                task_id: taskId,
                current_boundary: 'read-only',
                requested_boundary: 'read-write',
                justification: 'need to edit the target file',
                requested_by: 'agent-A',
                user_decision: 'pending'
            },
            created_at: new Date().toISOString()
        }
    });
    // Divergence
    await httpPostJson(COMPANION_PORT, '/rpc/events/ingest', {
        event: {
            event_id: ulid(), source_id: taskId,
            event_type: 'task.value_divergence_reported',
            payload_json: {
                task_id: taskId,
                objective: 'fix typo in doc',
                execution_divergence: 'agent rewrote entire section',
                execution_rationale: 'thought section needed restructuring',
                reported_by: 'value-monitor',
                category: 'scope'
            },
            created_at: new Date().toISOString()
        }
    });
    console.log('✓ audit events seeded (overreach critical + expansion pending + divergence)');

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

    // --- ① task rendered with G5 controls ---
    console.log('\n📦 ① task rendered with G5 controls (rebind btn, history toggle, audit container)');
    await waitFor(`document.querySelector('.task-item[data-task-id="${taskId}"]') !== null`, 10000, 'task rendered');
    const hasRebindBtn = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-rebind') !== null`);
    check('rebind button present in task item', hasRebindBtn);
    const hasHistoryToggle = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .exec-history-toggle') !== null`);
    check('executor history toggle present', hasHistoryToggle);
    const hasAuditContainer = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .audit-events-container') !== null`);
    check('audit events container present', hasAuditContainer);
    const hasAgentFilter = await evalInPage(`document.getElementById('agentFilter') !== null`);
    check('agent filter dropdown present at top of task panel', hasAgentFilter);
    await screenshot('01-g5-controls-present.png');

    // --- ② audit events rendered (async hydration) ---
    console.log('\n📦 ② audit events rendered (overreach red, expansion yellow, divergence blue)');
    await waitFor(`document.querySelector('.task-item[data-task-id="${taskId}"] .audit-events-container').children.length > 0`, 10000, 'audit events hydrated');
    const auditBanners = await evalInPage(`document.querySelectorAll('.task-item[data-task-id="${taskId}"] .audit-banner').length`);
    check('three audit banners rendered (overreach + expansion + divergence)', auditBanners === 3);
    const hasRedBanner = await evalInPage(`document.querySelectorAll('.task-item[data-task-id="${taskId}"] .audit-banner.overreach-critical').length === 1`);
    check('overreach critical banner is red', hasRedBanner);
    const redBannerText = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .audit-banner.overreach-critical').textContent`);
    check('overreach banner shows pause suggestion', redBannerText.includes('暂停') || redBannerText.includes('建议暂停'));
    const hasYellowBanner = await evalInPage(`document.querySelectorAll('.task-item[data-task-id="${taskId}"] .audit-banner.expansion-pending').length === 1`);
    check('expansion pending banner is yellow', hasYellowBanner);
    const hasApproveBtn = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-approve-expansion') !== null`);
    check('expansion banner has approve button', hasApproveBtn);
    const hasDenyBtn = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-deny-expansion') !== null`);
    check('expansion banner has deny button', hasDenyBtn);
    const hasBlueBanner = await evalInPage(`document.querySelectorAll('.task-item[data-task-id="${taskId}"] .audit-banner.divergence').length === 1`);
    check('divergence banner is blue', hasBlueBanner);
    await screenshot('02-audit-events-rendered.png');

    // --- ③ rebind modal: open -> fill -> confirm ---
    console.log('\n📦 ③ rebind modal: open -> fill agent-B -> confirm -> 200');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-rebind').click(); true`);
    await waitFor(`document.getElementById('rebindModal').classList.contains('visible')`, 5000, 'rebind modal visible');
    const rebindInfoText = await evalInPage(`document.getElementById('rebindTaskInfo').textContent`);
    check('rebind modal shows current agent (agent-A)', rebindInfoText.includes('agent-A'));
    const confirmDisabledInitially = await evalInPage(`document.getElementById('confirmRebindBtn').disabled`);
    check('rebind confirm disabled before agent name entered', confirmDisabledInitially === true);
    await evalInPage(`document.getElementById('rebindAgent').value = 'agent-B'; document.getElementById('rebindAgent').dispatchEvent(new Event('input')); true`);
    await evalInPage(`document.getElementById('rebindUrl').value = 'https://chatgpt.com/c/rebind-demo'; true`);
    await evalInPage(`document.getElementById('rebindReason').value = 'handoff to agent-B for specialized work'; true`);
    const confirmEnabledAfter = await evalInPage(`document.getElementById('confirmRebindBtn').disabled`);
    check('rebind confirm enabled after agent name entered', confirmEnabledAfter === false);
    await screenshot('03-rebind-modal-open.png');
    await evalInPage(`document.getElementById('confirmRebindBtn').click(); true`);
    await waitFor(`document.getElementById('rebindResult').classList.contains('ok')`, 10000, 'rebind result ok');
    const rebindResultText = await evalInPage(`document.getElementById('rebindResult').textContent`);
    check('rebind result shows success', rebindResultText.includes('重绑成功'));
    check('rebind result shows previous_agent=agent-A', rebindResultText.includes('agent-A'));
    // DB cross-check
    const tq1 = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/task/query?task_id=${taskId}`);
    check('DB: bound_execution_agent updated to agent-B', tq1.result.tasks[0].bound_execution_agent === 'agent-B');
    check('DB: bound_conversation_url updated', tq1.result.tasks[0].bound_conversation_url === 'https://chatgpt.com/c/rebind-demo');
    await screenshot('04-rebind-success.png');

    // --- ④ executor history: expand -> binding_history entries ---
    console.log('\n📦 ④ executor history: expand -> binding_history entries visible');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .exec-history-toggle').click(); true`);
    await waitFor(`!document.querySelector('.task-item[data-task-id="${taskId}"] .exec-history-body').classList.contains('collapsed')`, 5000, 'history expanded');
    await waitFor(`document.querySelectorAll('.task-item[data-task-id="${taskId}"] .exec-history-entry').length > 0`, 10000, 'history entries loaded');
    const historyEntries = await evalInPage(`document.querySelectorAll('.task-item[data-task-id="${taskId}"] .exec-history-entry').length`);
    check('binding_history shows 1 entry (one rebind)', historyEntries === 1);
    const historyText = await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .exec-history-body').textContent`);
    check('history shows from agent-A', historyText.includes('agent-A'));
    check('history shows to agent-B', historyText.includes('agent-B'));
    check('history shows reason', historyText.includes('handoff to agent-B'));
    await screenshot('05-executor-history-expanded.png');

    // --- ⑤ expansion approve: click approve -> banner updates ---
    console.log('\n📦 ⑤ expansion approve: click approve button -> new event ingested -> banner updates');
    await evalInPage(`document.querySelector('.task-item[data-task-id="${taskId}"] .btn-approve-expansion').click(); true`);
    await waitFor(`document.getElementById('taskResult').classList.contains('ok')`, 10000, 'approve decision submitted');
    const approveText = await evalInPage(`document.getElementById('taskResult').textContent`);
    check('approve result shows approved', approveText.includes('approved'));
    // Wait for audit events to refresh
    await sleep(1000);
    // DB: latest expansion event should be approved
    const expQ = await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/events/query?source_id=${taskId}&limit=200`);
    const expEvents = expQ.result.events.filter(e => e.event_type === 'task.privilege_expansion_requested');
    const latestExp = expEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    check('DB: latest expansion event user_decision = approved', JSON.parse(latestExp.payload_json).user_decision === 'approved');
    await screenshot('06-expansion-approved.png');

    // --- ⑥ agent filter: select agent-B -> task list filtered ---
    console.log('\n📦 ⑥ agent filter: select agent-B -> task list shows only agent-B tasks');
    // First close the rebind modal if still open
    await evalInPage(`document.getElementById('rebindModal').classList.remove('visible'); true`);
    // Wait for task list to refresh after rebind
    await sleep(1500);
    // Get current agent filter options
    const agentOptions = await evalInPage(`Array.from(document.getElementById('agentFilter').options).map(o => o.value)`);
    check('agent filter has agent-B option', agentOptions.includes('agent-B'));
    // Select agent-B
    await evalInPage(`document.getElementById('agentFilter').value = 'agent-B'; document.getElementById('agentFilter').dispatchEvent(new Event('change')); true`);
    await sleep(2000);
    const filteredTaskCount = await evalInPage(`document.querySelectorAll('.task-item').length`);
    check('agent-B filter shows at least 1 task', filteredTaskCount >= 1);
    const filteredTaskAgent = await evalInPage(`document.querySelector('.task-item') ? document.querySelector('.task-item').textContent : ''`);
    check('filtered task list contains agent-B', filteredTaskAgent.includes('agent-B'));
    // Reset filter
    await evalInPage(`document.getElementById('agentFilter').value = ''; document.getElementById('agentFilter').dispatchEvent(new Event('change')); true`);
    await sleep(1500);
    await screenshot('07-agent-filter.png');

    // --- ⑦ final state overview ---
    console.log('\n📦 ⑦ final state overview');
    await screenshot('08-final-state.png');

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
