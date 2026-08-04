#!/usr/bin/env node
/**
 * G5 OpenCode Bridge — Phase 5 Acceptance Test
 *
 * Validates the OpenCode bridge: Deep Link + HTTP API/SSE + standardized
 * output readback. Uses a mock OpenCode HTTP server (zero npm dependencies,
 * offline, dynamic ports).
 *
 * Scenarios:
 *   1. dispatch → API creates session → prompt_async enqueued → Deep Link
 *      attempted (mock) → mock OpenCode writes result JSON → bridge.watchResult
 *      reads → nonce/Schema validation passes → status = completed
 *   2. nonce mismatch → result rejected, not ingested
 *   3. API unreachable → honest error, no fabrication
 *   4. abort → status flow to aborted
 *   5. companion RPC integration: dispatch via POST /rpc/opencode/dispatch,
 *      query via GET /rpc/opencode/status/:task_id
 *
 * Run: node seed/tests/g5-opencode-bridge.acceptance.mjs
 */

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Import bridge (ESM)
const { OpenCodeBridge, validateResultJson, generateNonce } = await import(
    '../adapters/opencode/bridge.mjs'
);

// Import companion (CommonJS via createRequire)
const { startTestServer, stopTestServer } = require('../companion/index.js');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (!condition) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message}`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message}\n    expected: ${e}\n    actual:   ${a}`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

// ---------------------------------------------------------------------------
// Mock OpenCode HTTP API server
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock OpenCode HTTP server.
 * Endpoints:
 *   POST /session                    — create session
 *   POST /session/:id/prompt_async   — enqueue message (returns 204)
 *   GET  /session/:id                — get session details
 *   POST /session/:id/abort          — abort session
 *   GET  /global/health              — health check
 *   GET  /session/status             — all session statuses
 */
function createMockOpenCodeServer() {
    return new Promise((resolve) => {
        const sessions = new Map();
        let sessionCounter = 0;

        const server = http.createServer((req, res) => {
            const urlObj = new URL(req.url, `http://127.0.0.1`);
            const pathname = urlObj.pathname;
            let body = '';

            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                const jsonBody = body ? (() => { try { return JSON.parse(body); } catch (_) { return {}; } })() : {};

                // CORS
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

                // POST /session
                if (pathname === '/session' && req.method === 'POST') {
                    const sessionId = `ses_mock_${++sessionCounter}`;
                    const session = {
                        id: sessionId,
                        title: jsonBody.title || 'DCF Task',
                        status: 'idle',
                        time: { created: Date.now(), updated: Date.now() }
                    };
                    sessions.set(sessionId, session);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(session));
                    return;
                }

                // POST /session/:id/prompt_async
                const promptAsyncMatch = pathname.match(/^\/session\/([^/]+)\/prompt_async$/);
                if (promptAsyncMatch && req.method === 'POST') {
                    const sid = promptAsyncMatch[1];
                    const session = sessions.get(sid);
                    if (!session) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'session not found' }));
                        return;
                    }
                    session.status = 'busy';
                    // Return 204 (per OpenCode API spec — NOT proof of execution)
                    res.writeHead(204);
                    res.end();
                    return;
                }

                // GET /session/:id
                const sessionGetMatch = pathname.match(/^\/session\/([^/]+)$/);
                if (sessionGetMatch && req.method === 'GET') {
                    const sid = sessionGetMatch[1];
                    const session = sessions.get(sid);
                    if (!session) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'session not found' }));
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(session));
                    return;
                }

                // POST /session/:id/abort
                const abortMatch = pathname.match(/^\/session\/([^/]+)\/abort$/);
                if (abortMatch && req.method === 'POST') {
                    const sid = abortMatch[1];
                    const session = sessions.get(sid);
                    if (!session) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'session not found' }));
                        return;
                    }
                    session.status = 'aborted';
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('true');
                    return;
                }

                // GET /session/status
                if (pathname === '/session/status' && req.method === 'GET') {
                    const status = {};
                    for (const [sid, session] of sessions) {
                        status[sid] = { status: session.status };
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(status));
                    return;
                }

                // GET /global/health
                if (pathname === '/global/health' && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ healthy: true, version: '1.18.3-mock' }));
                    return;
                }

                // 404
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `not found: ${req.method} ${pathname}` }));
            });
        });

        server.listen(0, '127.0.0.1', () => {
            resolve({
                server,
                port: server.address().port,
                baseURL: `http://127.0.0.1:${server.address().port}`,
                close: () => new Promise(r => server.close(r))
            });
        });
    });
}

// ---------------------------------------------------------------------------
// HTTP client for companion RPC
// ---------------------------------------------------------------------------

function rpcGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch (_) { resolve({ status: res.statusCode, body: data }); }
            });
        }).on('error', reject);
    });
}

function rpcPost(url, bodyObj) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(bodyObj);
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + (parsed.search || ''),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch (_) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

async function test1_dispatch_watch_completed() {
    console.log('\n--- Test 1: dispatch → watch → completed ---');

    const mock = await createMockOpenCodeServer();
    const deepLinkCalls = [];
    const bridge = new OpenCodeBridge({
        baseURL: mock.baseURL,
        username: 'opencode',
        password: null,
        deepLinkLauncher: async (url) => {
            deepLinkCalls.push(url);
            return { ok: true, error: null };
        }
    });

    const taskId = 'dcf-oc-test-001';
    const nonce = generateNonce();
    const outputPath = path.join(os.tmpdir(), `dcf-test-${taskId}.json`);

    // Clean up any leftover
    try { fs.unlinkSync(outputPath); } catch (_) {}

    // Dispatch
    const dispatchResult = await bridge.dispatchTask({
        task_id: taskId,
        prompt: '请归纳以下对话材料',
        output_path: outputPath,
        nonce,
        entity_id: 'conv-test-001'
    });

    assert(dispatchResult.status === 'dispatched', 'dispatch status should be "dispatched"');
    assert(dispatchResult.session_id != null, 'session_id should be non-null');
    assert(dispatchResult.deep_link != null, 'deep_link should be non-null');
    assert(deepLinkCalls.length === 1, 'Deep Link should be called exactly once');
    assert(deepLinkCalls[0].startsWith('opencode://'), 'Deep Link URL should use opencode:// scheme');

    // Simulate OpenCode writing the result JSON
    const resultData = {
        task_id: taskId,
        nonce: nonce,
        status: 'completed',
        products: [
            {
                type: 'card',
                title: '测试知识卡片',
                summary: '这是一个测试卡片',
                evidence: ['event-1', 'event-2'],
                boundary_inherit: 'OBSERVE_CURRENT_ONLY',
                source_conversation: 'conv-test-001'
            }
        ],
        evidence: {
            session_id: dispatchResult.session_id,
            messages_count: 3,
            error: null
        }
    };

    // Write result file (simulating OpenCode completing the task)
    fs.writeFileSync(outputPath, JSON.stringify(resultData, null, 2));

    // Watch for result (should pick up the file quickly)
    const watchResult = await bridge.watchResult(outputPath, { timeoutMs: 5000, nonce, task_id: taskId });

    assert(watchResult.ok === true, 'watchResult should succeed');
    assert(watchResult.data.task_id === taskId, 'result task_id should match');
    assert(watchResult.data.nonce === nonce, 'result nonce should match');
    assert(watchResult.data.status === 'completed', 'result status should be completed');
    assert(Array.isArray(watchResult.data.products), 'products should be an array');
    assert(watchResult.data.products.length === 1, 'should have 1 product');

    // Update task status (simulating companion)
    bridge.updateTaskStatus(taskId, 'completed', watchResult.data);

    // Query status
    const status = await bridge.getStatus(taskId);
    assert(status.status === 'completed', 'getStatus should return completed');
    assert(status.result != null, 'getStatus should have result');

    // Cleanup
    try { fs.unlinkSync(outputPath); } catch (_) {}
    await mock.close();

    console.log('  ✅ Test 1 complete');
}

async function test2_nonce_mismatch() {
    console.log('\n--- Test 2: nonce mismatch → rejected ---');

    const mock = await createMockOpenCodeServer();
    const bridge = new OpenCodeBridge({
        baseURL: mock.baseURL,
        deepLinkLauncher: async () => ({ ok: true, error: null })
    });

    const taskId = 'dcf-oc-test-002';
    const nonce = generateNonce();
    const wrongNonce = generateNonce();
    const outputPath = path.join(os.tmpdir(), `dcf-test-${taskId}.json`);

    try { fs.unlinkSync(outputPath); } catch (_) {}

    // Dispatch
    await bridge.dispatchTask({
        task_id: taskId,
        prompt: '测试任务',
        output_path: outputPath,
        nonce
    });

    // Write result with WRONG nonce
    const resultData = {
        task_id: taskId,
        nonce: wrongNonce,  // wrong nonce!
        status: 'completed',
        products: [],
        evidence: { session_id: 'ses_xxx', messages_count: 0, error: null }
    };
    fs.writeFileSync(outputPath, JSON.stringify(resultData));

    // Watch — should reject
    const watchResult = await bridge.watchResult(outputPath, { timeoutMs: 3000, nonce, task_id: taskId });

    assert(watchResult.ok === false, 'watchResult should fail (ok=false)');
    assert(watchResult.rejected === true, 'watchResult should be rejected');
    assert(watchResult.reason != null && watchResult.reason.includes('nonce mismatch'), 'reason should mention nonce mismatch');
    assert(watchResult.raw_data != null, 'raw_data should be present for rejected results');

    // Cleanup
    try { fs.unlinkSync(outputPath); } catch (_) {}
    await mock.close();

    console.log('  ✅ Test 2 complete');
}

async function test3_api_unreachable() {
    console.log('\n--- Test 3: API unreachable → honest error ---');

    // Use a port that's definitely not listening
    const bridge = new OpenCodeBridge({
        baseURL: 'http://127.0.0.1:1',  // port 1 — unreachable
        deepLinkLauncher: async () => ({ ok: false, error: 'mock' })
    });

    const taskId = 'dcf-oc-test-003';
    const nonce = generateNonce();
    const outputPath = path.join(os.tmpdir(), `dcf-test-${taskId}.json`);

    const dispatchResult = await bridge.dispatchTask({
        task_id: taskId,
        prompt: '测试任务',
        output_path: outputPath,
        nonce
    });

    assert(dispatchResult.status === 'failed', 'dispatch should fail when API unreachable');
    assert(dispatchResult.error != null, 'error message should be present');
    assert(dispatchResult.error.includes('unreachable') || dispatchResult.error.includes('ECONNREFUSED') || dispatchResult.error.includes('connect'),
        'error should mention connection failure');
    assert(dispatchResult.session_id === null, 'session_id should be null on failure');

    // No result file should have been created
    assert(!fs.existsSync(outputPath), 'no output file should be created on dispatch failure');

    console.log('  ✅ Test 3 complete');
}

async function test4_abort() {
    console.log('\n--- Test 4: abort → status aborted ---');

    const mock = await createMockOpenCodeServer();
    const bridge = new OpenCodeBridge({
        baseURL: mock.baseURL,
        deepLinkLauncher: async () => ({ ok: true, error: null })
    });

    const taskId = 'dcf-oc-test-004';
    const nonce = generateNonce();
    const outputPath = path.join(os.tmpdir(), `dcf-test-${taskId}.json`);

    try { fs.unlinkSync(outputPath); } catch (_) {}

    // Dispatch
    const dispatchResult = await bridge.dispatchTask({
        task_id: taskId,
        prompt: '长时间任务',
        output_path: outputPath,
        nonce
    });
    assert(dispatchResult.status === 'dispatched', 'should dispatch successfully');

    // Abort
    const abortResult = await bridge.abortTask(taskId);
    assert(abortResult.status === 'aborted', 'abort should return aborted status');
    assert(abortResult.session_id === dispatchResult.session_id, 'session_id should match');

    // Query status — should be aborted
    const status = await bridge.getStatus(taskId);
    assert(status.status === 'aborted', 'getStatus should return aborted');

    // Cleanup
    try { fs.unlinkSync(outputPath); } catch (_) {}
    await mock.close();

    console.log('  ✅ Test 4 complete');
}

async function test5_companion_rpc_integration() {
    console.log('\n--- Test 5: companion RPC integration ---');

    const mock = await createMockOpenCodeServer();

    // Set env var so companion's bridge uses the mock server
    process.env.OPENCODE_SERVER_URL = mock.baseURL;

    const testServer = await startTestServer({ port: 0, dbPath: ':memory:' });
    const companionBase = `http://127.0.0.1:${testServer.port}`;

    try {
        // Dispatch via RPC
        const dispatchRes = await rpcPost(`${companionBase}/rpc/opencode/dispatch`, {
            prompt: 'RPC 集成测试任务',
            entity_id: 'conv-rpc-001',
            timeout_ms: 5000
        });

        assert(dispatchRes.status === 200, 'dispatch RPC should return 200');
        const dispatchBody = dispatchRes.body;
        assert(dispatchBody.result != null, 'dispatch response should have result');
        assert(dispatchBody.result.status === 'dispatched', 'dispatch status should be "dispatched"');
        assert(dispatchBody.result.task_id != null, 'task_id should be present');
        assert(dispatchBody.result.session_id != null, 'session_id should be present');
        assert(dispatchBody.result.nonce != null, 'nonce should be present');
        assert(dispatchBody.result.output_path != null, 'output_path should be present');

        const taskId = dispatchBody.result.task_id;
        const nonce = dispatchBody.result.nonce;
        const outputPath = dispatchBody.result.output_path;

        // Query status via RPC
        const statusRes = await rpcGet(`${companionBase}/rpc/opencode/status/${encodeURIComponent(taskId)}`);
        assert(statusRes.status === 200, 'status RPC should return 200');
        assert(statusRes.body.result.status === 'dispatched', 'status should be "dispatched"');
        assert(statusRes.body.result.session_id != null, 'status should have session_id');

        // Simulate OpenCode writing result
        const resultData = {
            task_id: taskId,
            nonce: nonce,
            status: 'completed',
            products: [
                {
                    type: 'card',
                    title: 'RPC 测试卡片',
                    summary: '通过 RPC 派发的任务产出的卡片',
                    evidence: ['ev-1'],
                    boundary_inherit: 'OBSERVE_CURRENT_ONLY',
                    source_conversation: 'conv-rpc-001'
                }
            ],
            evidence: {
                session_id: dispatchBody.result.session_id,
                messages_count: 2,
                error: null
            }
        };
        fs.writeFileSync(outputPath, JSON.stringify(resultData, null, 2));

        // Wait for the companion's background watcher to pick it up
        await new Promise(r => setTimeout(r, 2000));

        // Query status again — should be completed
        const statusRes2 = await rpcGet(`${companionBase}/rpc/opencode/status/${encodeURIComponent(taskId)}`);
        assert(statusRes2.body.result.status === 'completed', 'status should be "completed" after result file written');

        // Cleanup
        try { fs.unlinkSync(outputPath); } catch (_) {}
    } finally {
        delete process.env.OPENCODE_SERVER_URL;
        await stopTestServer();
    }

    await mock.close();
    console.log('  ✅ Test 5 complete');
}

async function test6_validate_result_json() {
    console.log('\n--- Test 6: validateResultJson unit checks ---');

    // Valid result
    const valid = validateResultJson({
        task_id: 't1', nonce: 'n1', status: 'completed',
        products: [], evidence: { error: null }
    }, 'n1', 't1');
    assert(valid.valid === true, 'valid result should pass');
    assert(valid.rejected === false, 'valid result should not be rejected');

    // Nonce mismatch
    const mismatch = validateResultJson({
        task_id: 't1', nonce: 'wrong', status: 'completed',
        products: [], evidence: {}
    }, 'n1', 't1');
    assert(mismatch.valid === false, 'nonce mismatch should fail');
    assert(mismatch.rejected === true, 'nonce mismatch should be rejected');

    // Missing fields
    const missing = validateResultJson({
        task_id: 't1', nonce: 'n1'
    }, 'n1', 't1');
    assert(missing.valid === false, 'missing fields should fail');
    assert(missing.rejected === false, 'missing fields should not be rejected (not a nonce issue)');

    // Not an object
    const notObj = validateResultJson('string', 'n1');
    assert(notObj.valid === false, 'non-object should fail');

    // Invalid status
    const badStatus = validateResultJson({
        task_id: 't1', nonce: 'n1', status: 'invalid',
        products: [], evidence: {}
    }, 'n1', 't1');
    assert(badStatus.valid === false, 'invalid status should fail');

    console.log('  ✅ Test 6 complete');
}

async function test7_health_check() {
    console.log('\n--- Test 7: healthCheck ---');

    const mock = await createMockOpenCodeServer();
    const bridge = new OpenCodeBridge({ baseURL: mock.baseURL });

    const health = await bridge.healthCheck();
    assert(health.ok === true, 'healthCheck should return ok=true');
    assert(health.version === '1.18.3-mock', 'healthCheck should return version');

    await mock.close();

    // Test unreachable
    const bridge2 = new OpenCodeBridge({ baseURL: 'http://127.0.0.1:1' });
    const health2 = await bridge2.healthCheck();
    assert(health2.ok === false, 'healthCheck should return ok=false for unreachable server');

    console.log('  ✅ Test 7 complete');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=========================================');
    console.log('G5 OpenCode Bridge — Phase 5 Acceptance');
    console.log('=========================================');

    await test1_dispatch_watch_completed();
    await test2_nonce_mismatch();
    await test3_api_unreachable();
    await test4_abort();
    await test5_companion_rpc_integration();
    await test6_validate_result_json();
    await test7_health_check();

    console.log('\n=========================================');
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('=========================================');

    if (testsFailed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
