/**
 * G3 (phase 3) - Adapter Command Queue Unit Tests
 *
 * Covers ruling C3 end to end, offline, zero npm dependencies:
 *   1. enqueue -> poll -> result full flow (done)
 *   2. idempotent poll (delivered rows are not re-delivered)
 *   3. failed result path
 *   4. result guards: unknown command 404, terminal overwrite 409
 *   5. enqueue validation (kind whitelist, timeout_ms)
 *   6. timeout expiry: queued command with timeout_ms lapses to 'expired'
 *   7. WS wake channel: raw RFC6455 handshake (net+crypto), broadcast of
 *      {"type":"command_available"} on enqueue, ping->pong, 404 on other paths
 *   8. Electron wait semantics via CompanionAdapterClient (done/failed/timeout)
 *
 * Ports are always dynamic (startTestServer port:0) - never 8472.
 */

'use strict';

const net = require('net');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const { startTestServer, stopTestServer } = require('../companion/index.js');
const { computeAccept, WAKE_PATH } = require('../companion/ws-wake.js');
const { CompanionAdapterClient } = require(
    path.join(__dirname, '../../packages/desktop-electron/src/companion-adapter-client.js'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        passed++;
        console.log('  \u2713 ' + label);
    } else {
        failed++;
        console.error('  \u2717 ' + label);
    }
}

/** Minimal JSON HTTP helper (native http, dynamic port). */
function request(port, method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1',
            port,
            method,
            path: urlPath,
            headers: payload
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                : {}
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/**
 * Minimal raw WebSocket client for the wake channel: performs the RFC6455
 * handshake over net.Socket, validates Sec-WebSocket-Accept, and surfaces
 * received text frames. Deliberately tiny - only what the tests need.
 */
function connectWakeClient(port, wsPath = WAKE_PATH) {
    return new Promise((resolve, reject) => {
        const key = crypto.randomBytes(16).toString('base64');
        const socket = net.connect(port, '127.0.0.1');
        const messages = [];
        const waiters = [];
        let handshakeDone = false;
        let buffer = Buffer.alloc(0);
        let statusLine = null;
        let acceptHeader = null;

        const client = {
            socket,
            get statusLine() { return statusLine; },
            get acceptHeader() { return acceptHeader; },
            expectedAccept: computeAccept(key),
            /** wait for the next text/pong frame ({opcode, text}) */
            nextFrame(timeoutMs = 2000) {
                return new Promise((res, rej) => {
                    if (messages.length > 0) return res(messages.shift());
                    const timer = setTimeout(() => rej(new Error('frame wait timeout')), timeoutMs);
                    waiters.push((frame) => { clearTimeout(timer); res(frame); });
                });
            },
            /** send a masked client frame (opcode + payload) */
            sendFrame(opcode, payloadStr = '') {
                const payload = Buffer.from(payloadStr, 'utf8');
                const mask = crypto.randomBytes(4);
                const masked = Buffer.from(payload);
                for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
                socket.write(Buffer.concat([
                    Buffer.from([0x80 | opcode, 0x80 | payload.length]),
                    mask,
                    masked
                ]));
            },
            close() { try { socket.destroy(); } catch (_) { /* done */ } }
        };

        socket.on('connect', () => {
            socket.write(
                `GET ${wsPath} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Key: ${key}\r\n` +
                'Sec-WebSocket-Version: 13\r\n' +
                '\r\n'
            );
        });

        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (!handshakeDone) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1) return;
                const header = buffer.subarray(0, headerEnd).toString('utf8');
                buffer = buffer.subarray(headerEnd + 4);
                statusLine = header.split('\r\n')[0];
                const match = header.match(/Sec-WebSocket-Accept:\s*(\S+)/i);
                acceptHeader = match ? match[1] : null;
                handshakeDone = true;
                if (!/101/.test(statusLine)) {
                    return reject(new Error('handshake refused: ' + statusLine));
                }
                resolve(client);
            }
            // parse server frames (unmasked, short) after handshake
            while (buffer.length >= 2) {
                const opcode = buffer[0] & 0x0f;
                const len = buffer[1] & 0x7f;
                if (len >= 126 || buffer.length < 2 + len) break;
                const payload = buffer.subarray(2, 2 + len).toString('utf8');
                buffer = buffer.subarray(2 + len);
                const frame = { opcode, text: payload };
                if (waiters.length > 0) waiters.shift()(frame);
                else messages.push(frame);
            }
        });

        socket.on('error', (err) => { if (!handshakeDone) reject(err); });
    });
}

/** Non-101 upgrade attempt: resolve with the raw status line. */
function attemptBadUpgrade(port, wsPath) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let data = '';
        socket.on('connect', () => {
            socket.write(
                `GET ${wsPath} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n` +
                'Connection: Upgrade\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\n' +
                'Sec-WebSocket-Version: 13\r\n\r\n');
        });
        socket.on('data', (chunk) => { data += chunk.toString('utf8'); });
        socket.on('close', () => resolve(data.split('\r\n')[0]));
        socket.on('error', reject);
        setTimeout(() => { socket.destroy(); }, 2000);
    });
}

async function main() {
    console.log('\u2550'.repeat(60));
    console.log('  G3 Adapter Command Queue - unit tests (dynamic port)');
    console.log('\u2550'.repeat(60));

    const ctx = await startTestServer({ port: 0 });
    const port = ctx.port;
    console.log('  test server on 127.0.0.1:' + port + ' (never 8472)');

    // Test 1: enqueue -> poll -> result full flow
    console.log('\nTest 1: enqueue -> poll -> result full flow');
    const enq = await request(port, 'POST', '/rpc/adapter/command', {
        kind: 'read-conversation', payload: { limit: 5 }
    });
    assert(enq.status === 200, 'enqueue returns 200');
    assert(typeof enq.body.result.command_id === 'string' && enq.body.result.command_id.length === 26,
        'enqueue returns ULID command_id');
    assert(enq.body.result.status === 'queued', "enqueue status is 'queued'");
    const cmdId = enq.body.result.command_id;

    const statusBefore = await request(port, 'GET', '/rpc/adapter/command/' + cmdId);
    assert(statusBefore.body.result.status === 'queued', 'GET :id shows queued before poll');

    const poll1 = await request(port, 'GET', '/rpc/adapter/command/poll');
    assert(poll1.status === 200, 'poll returns 200');
    assert(poll1.body.result.count === 1, 'poll delivers exactly 1 command');
    const delivered = poll1.body.result.commands[0];
    assert(delivered.command_id === cmdId, 'polled command_id matches');
    assert(delivered.kind === 'read-conversation', 'polled kind matches');
    assert(delivered.payload.limit === 5, 'polled payload round-trips');

    const statusMid = await request(port, 'GET', '/rpc/adapter/command/' + cmdId);
    assert(statusMid.body.result.status === 'delivered', 'GET :id shows delivered after poll');

    // Test 2: idempotent poll
    console.log('\nTest 2: idempotent poll');
    const poll2 = await request(port, 'GET', '/rpc/adapter/command/poll');
    assert(poll2.body.result.count === 0, 'second poll returns no commands (delivered not re-delivered)');

    // Test 3: done result
    console.log('\nTest 3: done result');
    const done = await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: cmdId, ok: true, result: { messages: [{ role: 'user', text: 'hi' }] }
    });
    assert(done.status === 200 && done.body.result.status === 'done', 'result marks command done');
    const statusDone = await request(port, 'GET', '/rpc/adapter/command/' + cmdId);
    assert(statusDone.body.result.status === 'done', 'GET :id shows done');
    assert(statusDone.body.result.result.messages[0].text === 'hi', 'result payload round-trips');

    // Test 4: failed result + guards
    console.log('\nTest 4: failed result and terminal guards');
    const enq2 = await request(port, 'POST', '/rpc/adapter/command', {
        kind: 'send-card', payload: { text: 'card body' }
    });
    const cmd2 = enq2.body.result.command_id;
    await request(port, 'GET', '/rpc/adapter/command/poll');
    const fail = await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: cmd2, ok: false, error: 'no active tab'
    });
    assert(fail.status === 200 && fail.body.result.status === 'failed', 'result marks command failed');
    const statusFail = await request(port, 'GET', '/rpc/adapter/command/' + cmd2);
    assert(statusFail.body.result.result.error === 'no active tab', 'failure error is preserved');

    const overwrite = await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: cmd2, ok: true, result: {}
    });
    assert(overwrite.status === 409, 'terminal command refuses overwrite (409)');

    const notFound = await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: '01UNKNOWNUNKNOWNUNKNOWNUNK', ok: true, result: {}
    });
    assert(notFound.status === 404, 'unknown command result is 404');

    const getMissing = await request(port, 'GET', '/rpc/adapter/command/01UNKNOWNUNKNOWNUNKNOWNUNK');
    assert(getMissing.status === 404, 'GET unknown command is 404');

    // Test 5: enqueue validation
    console.log('\nTest 5: enqueue validation');
    const badKind = await request(port, 'POST', '/rpc/adapter/command', { kind: 'rm-rf', payload: {} });
    assert(badKind.status === 400, 'invalid kind rejected with 400');
    const badTimeout = await request(port, 'POST', '/rpc/adapter/command', {
        kind: 'send-card', payload: {}, timeout_ms: -5
    });
    assert(badTimeout.status === 400, 'negative timeout_ms rejected with 400');

    // Test 6: timeout expiry
    console.log('\nTest 6: timeout expiry');
    const enq3 = await request(port, 'POST', '/rpc/adapter/command', {
        kind: 'read-conversation', payload: {}, timeout_ms: 60
    });
    const cmd3 = enq3.body.result.command_id;
    await new Promise((r) => setTimeout(r, 150));
    const statusExpired = await request(port, 'GET', '/rpc/adapter/command/' + cmd3);
    assert(statusExpired.body.result.status === 'expired', 'queued command lapses to expired after timeout_ms');
    const pollAfterExpiry = await request(port, 'GET', '/rpc/adapter/command/poll');
    assert(pollAfterExpiry.body.result.count === 0, 'expired command is not delivered by poll');
    const lateResult = await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: cmd3, ok: true, result: {}
    });
    assert(lateResult.status === 409, 'late result on expired command is refused (409)');

    // Test 7: WS wake channel
    console.log('\nTest 7: WS wake channel (raw RFC6455 client)');
    const ws = await connectWakeClient(port);
    assert(/101/.test(ws.statusLine), 'handshake answers 101 Switching Protocols');
    assert(ws.acceptHeader === ws.expectedAccept, 'Sec-WebSocket-Accept is RFC6455-correct');

    const enq4 = await request(port, 'POST', '/rpc/adapter/command', {
        kind: 'read-conversation', payload: {}
    });
    assert(enq4.body.result.wake_notified === 1, 'enqueue reports 1 wake notification');
    const frame = await ws.nextFrame();
    assert(frame.opcode === 0x1, 'broadcast arrives as a text frame');
    assert(frame.text === '{"type":"command_available"}',
        'broadcast payload is exactly {"type":"command_available"} (no business data)');

    ws.sendFrame(0x9, 'hb'); // ping
    const pong = await ws.nextFrame();
    assert(pong.opcode === 0xA && pong.text === 'hb', 'ping is answered with matching pong');
    ws.close();
    // drain the command so later tests see an empty queue
    await request(port, 'GET', '/rpc/adapter/command/poll');
    await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: enq4.body.result.command_id, ok: false, error: 'test drain'
    });

    const badPath = await attemptBadUpgrade(port, '/ws/other-channel');
    assert(/404/.test(badPath), 'non-wake upgrade path is refused with 404');

    // Test 8: Electron wait semantics (CompanionAdapterClient)
    console.log('\nTest 8: Electron wait semantics');
    const client = new CompanionAdapterClient({
        baseUrl: 'http://127.0.0.1:' + port,
        timeoutMs: 3000,
        pollIntervalMs: 50
    });

    // 8a: done - simulate the adapter completing the command mid-wait
    const done8 = client.execute('read-conversation', { limit: 3 });
    await new Promise((r) => setTimeout(r, 120));
    const poll8 = await request(port, 'GET', '/rpc/adapter/command/poll');
    assert(poll8.body.result.count === 1, 'client enqueue is visible to adapter poll');
    await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: poll8.body.result.commands[0].command_id,
        ok: true,
        result: { ok: true, messages: [] }
    });
    const outcome8 = await done8;
    assert(outcome8.ok === true && outcome8.status === 'done', 'client resolves ok on done');

    // 8b: failed
    const fail8 = client.execute('send-card', { text: 'x' });
    await new Promise((r) => setTimeout(r, 120));
    const poll8b = await request(port, 'GET', '/rpc/adapter/command/poll');
    await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: poll8b.body.result.commands[0].command_id,
        ok: false,
        error: 'composer not found'
    });
    const outcome8b = await fail8;
    assert(outcome8b.ok === false && outcome8b.status === 'failed', 'client resolves honest failure');
    assert(/composer not found/.test(outcome8b.error), 'failure error text is surfaced');

    // 8c: timeout - nobody answers; client must give an honest local timeout
    // (server-side timeout_ms is kept long so the local deadline fires first)
    const shortClient = new CompanionAdapterClient({
        baseUrl: 'http://127.0.0.1:' + port,
        timeoutMs: 300,
        pollIntervalMs: 50
    });
    const enq8c = await shortClient.enqueue('read-conversation', {}, 60000);
    assert(enq8c.ok === true, 'timeout scenario: enqueue succeeds');
    const outcome8c = await shortClient.waitForResult(enq8c.command_id, 300);
    assert(outcome8c.ok === false && /timed out/.test(outcome8c.error),
        'client times out honestly with {ok:false, error}');
    // drain: hand the still-pending command an expiry-free honest failure
    await request(port, 'GET', '/rpc/adapter/command/poll');
    await request(port, 'POST', '/rpc/adapter/command/result', {
        command_id: enq8c.command_id, ok: false, error: 'test drain'
    });
    // 8c-bis: server-side expiry surfaces as status 'expired' via execute
    const expiredOutcome = await shortClient.execute('read-conversation', {}, 100);
    assert(expiredOutcome.ok === false && expiredOutcome.status === 'expired',
        'server-side expiry surfaces honestly as expired');

    // 8d: companion unreachable - pick a fresh closed port
    const deadPortSrv = net.createServer();
    await new Promise((r) => deadPortSrv.listen(0, '127.0.0.1', r));
    const deadPort = deadPortSrv.address().port;
    await new Promise((r) => deadPortSrv.close(r));
    const deadClient = new CompanionAdapterClient({
        baseUrl: 'http://127.0.0.1:' + deadPort, timeoutMs: 500, pollIntervalMs: 50
    });
    const outcome8d = await deadClient.execute('read-conversation', {});
    assert(outcome8d.ok === false && /unreachable/.test(outcome8d.error),
        'unreachable companion yields honest {ok:false, error}');

    await stopTestServer();

    console.log('\n' + '\u2550'.repeat(40));
    console.log('  SUMMARY');
    console.log('\u2550'.repeat(40));
    console.log('  Passed: ' + passed);
    console.log('  Failed: ' + failed);
    console.log('\u2550'.repeat(40));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
