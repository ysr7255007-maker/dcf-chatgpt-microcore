#!/usr/bin/env node
// G2 Surface acceptance: offline banner + auto-reconnect, driven via CDP
// against a real headless Chrome page session (file:// origin).
//
// Usage: node seed/tests/g2-reconnect.acceptance.mjs
// Prereq: port 8472 free; Google Chrome installed at the default macOS path.

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
const CDP_PORT = 9223;
const COMPANION_PORT = 8472;
const DASHBOARD = 'file://' + path.join(REPO_ROOT, 'seed', 'surface', 'g2-dashboard.html') + '?q=outbox';
const DB_PATH = path.join(REPO_ROOT, '.tmp-g2-reconnect', 'test.db');
const PROFILE_DIR = path.join(REPO_ROOT, '.tmp-g2-reconnect', 'chrome-profile');

// --- Minimal WebSocket CDP client (same approach as scripts/load-extension-via-cdp.mjs) ---
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
        // Client frames must be masked
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

function startCompanion() {
    const proc = spawn('node', [path.join(REPO_ROOT, 'seed', 'companion', 'index.js'), `--port=${COMPANION_PORT}`, `--db=${DB_PATH}`], { stdio: 'ignore' });
    return proc;
}

async function waitForCompanion(up, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await httpGetJson(`http://127.0.0.1:${COMPANION_PORT}/rpc/health`);
            if (up) return true;
        } catch {
            if (!up) return true;
        }
        await sleep(300);
    }
    throw new Error(`companion did not become ${up ? 'reachable' : 'unreachable'} in time`);
}

async function seedEvents() {
    const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const ulid = () => {
        let t = Date.now(), ts = '';
        for (let i = 0; i < 10; i++) { ts = ENC[t % 32] + ts; t = Math.floor(t / 32); }
        let r = '';
        for (let i = 0; i < 16; i++) r += ENC[Math.floor(Math.random() * 32)];
        return ts + r;
    };
    const SRC = '01JGXX0000TESTG2RECNNECT01';
    const events = [
        { event_id: ulid(), source_id: SRC, event_type: 'conversation.message', payload_json: { role: 'user', text: 'reconnect test outbox one' }, created_at: new Date().toISOString(), sequence_number: 1 },
        { event_id: ulid(), source_id: SRC, event_type: 'conversation.message', payload_json: { role: 'assistant', text: 'reconnect test outbox two' }, created_at: new Date().toISOString(), sequence_number: 2 }
    ];
    const body = JSON.stringify({ events });
    await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: COMPANION_PORT, path: '/rpc/events/batch', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(d));
        });
        req.on('error', reject);
        req.end(body);
    });
}

async function evalInPage(cdp, sessionId, expression) {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (res.error) throw new Error(JSON.stringify(res.error));
    return res.result && res.result.result ? res.result.result.value : undefined;
}

// --- Main ---
let chrome = null, companion = null;
let pass = 0, fail = 0;
const check = (name, ok) => {
    console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}: ${name}`);
    ok ? pass++ : fail++;
};

async function main() {
    console.log('G2 reconnect acceptance starting…');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.rmSync(DB_PATH, { force: true });

    // 1. companion up + seed data
    companion = startCompanion();
    await waitForCompanion(true);
    await seedEvents();
    console.log('✓ companion up, events seeded');

    // 2. headless chrome with CDP
    chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`, '--no-first-run', DASHBOARD
    ], { stdio: 'ignore' });
    await sleep(4000);

    const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const page = targets.find(t => t.type === 'page' && t.url.includes('g2-dashboard'));
    if (!page) throw new Error('dashboard page not found in CDP targets');

    const cdp = new CdpClient();
    await cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await sleep(2500); // let initial search + first poll settle

    // 3. online: banner hidden, results loaded
    const bannerHidden = await evalInPage(cdp, null, `!document.getElementById('offlineBanner').classList.contains('visible')`);
    check('online: offline banner hidden', bannerHidden === true);
    const resultCount = await evalInPage(cdp, null, `document.querySelectorAll('.result-item').length`);
    check('online: search results rendered (' + resultCount + ')', resultCount >= 2);

    // 4. kill companion → banner appears within poll window
    companion.kill('SIGKILL');
    await waitForCompanion(false);
    await sleep(4500); // > 2 poll cycles
    const bannerShown = await evalInPage(cdp, null, `document.getElementById('offlineBanner').classList.contains('visible')`);
    check('offline: banner visible after companion stops', bannerShown === true);

    // 5. restart companion → banner clears, data refreshes
    companion = startCompanion();
    await waitForCompanion(true);
    await sleep(4500);
    const bannerGone = await evalInPage(cdp, null, `!document.getElementById('offlineBanner').classList.contains('visible')`);
    check('reconnect: banner cleared after companion returns', bannerGone === true);
    const resultCount2 = await evalInPage(cdp, null, `document.querySelectorAll('.result-item').length`);
    check('reconnect: results refreshed (' + resultCount2 + ')', resultCount2 >= 2);

    cdp.close();
    console.log(`\nSummary: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
}).finally(() => {
    if (chrome) chrome.kill('SIGKILL');
    if (companion) try { companion.kill('SIGKILL'); } catch {}
});
