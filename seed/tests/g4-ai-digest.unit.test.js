/**
 * G4 AI Digest — Phase 4 Unit Tests
 *
 * Scenarios:
 *   1. Config missing: getStatus unconfigured; repair task auto-generated;
 *      send order logic (mock clipboard/command queue) correct.
 *   2. Config present (mock API returns valid JSON): digest produces
 *      card + maintenance_task; Schema validation passes; four-state
 *      initial ai_proposed; NOT_OBSERVE source excluded.
 *   3. API failure → local fallback (mock Ollama success) → valid products.
 *      All fail → failure recorded, no fabricated products.
 *   4. Idempotency: repeated trigger same conversation → no duplicates.
 *
 * Zero npm dependencies. Dynamic ports. Offline.
 *
 * Run: node seed/tests/g4-ai-digest.unit.test.js
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startTestServer, stopTestServer } = require('../companion/index');
const { AIDigestEngine, parseAIResponse, validateProduct, validateCardProduct, validateMaintenanceTaskProduct } = require('../companion/ai-digest');
const { getConfig, getStatus, isConfigured } = require('../companion/ai-config');
const { CompanionDB } = require('../companion/db');
const { generateULID } = require('../companion/ulid');

let testsPassed = 0;
let testsFailed = 0;
let testCtx = null;
let tmpConfigDir = null;

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

/**
 * Create a temp ai-config.json for testing.
 */
function writeTempConfig(config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-ai-config-'));
    const configPath = path.join(dir, 'ai-config.json');
    if (config) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
    return configPath;
}

/**
 * Create a mock HTTP server that returns controlled AI responses.
 * Returns { server, port, setResponse }.
 */
function createMockAIServer() {
    return new Promise((resolve) => {
        let mockResponse = { status: 200, body: '{}' };
        const server = http.createServer((req, res) => {
            let data = '';
            req.on('data', c => data += c);
            req.on('end', () => {
                res.writeHead(mockResponse.status, { 'Content-Type': 'application/json' });
                res.end(mockResponse.body);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({
                server,
                port: server.address().port,
                setResponse: (status, body) => { mockResponse = { status, body }; }
            });
        });
    });
}

/**
 * Build a mock OpenAI-compatible API response.
 */
function buildMockAPIResponse(content) {
    return JSON.stringify({
        choices: [{ message: { content } }]
    });
}

/**
 * Build a mock Ollama-compatible response.
 */
function buildMockOllamaResponse(content) {
    return JSON.stringify({ message: { content } });
}

/**
 * Build a dual-output AI response (Markdown + JSON).
 */
function buildDualOutput(markdown, products) {
    return `<<<MARKDOWN>>>\n${markdown}\n<<<JSON>>>\n${JSON.stringify(products)}`;
}

// ============================================================================
// Test Suite 1: Config Missing Scenario
// ============================================================================
async function testConfigMissing() {
    console.log('\n📋 Test Suite 1: Config Missing Scenario');

    // 1a. getStatus returns unconfigured when no config file
    const status = getStatus('/nonexistent/path/ai-config.json');
    assert(status.level === 'unconfigured', 'getStatus returns level=unconfigured');
    assert(status.indicator === '⚪', 'getStatus indicator is ⚪');
    assert(status.label === '未配置', 'getStatus label is 未配置');

    // 1b. isConfigured returns false
    assert(isConfigured('/nonexistent/path/ai-config.json') === false, 'isConfigured returns false');

    // 1c. getConfig returns { configured: false }
    const config = getConfig('/nonexistent/path/ai-config.json');
    assert(config.configured === false, 'getConfig returns configured=false');

    // 1d. AIDigestEngine with unconfigured status auto-generates repair task
    const db = new CompanionDB(':memory:');
    await db.initialize();
    const engine = new AIDigestEngine({
        db,
        configPath: '/nonexistent/path/ai-config.json',
        httpPostFn: async () => { throw new Error('should not be called'); }
    });

    const repairTask = engine.generateRepairTask('conv-test-001');
    assert(repairTask.task_id != null, 'Repair task has task_id');
    assert(repairTask.priority === 1, 'Repair task priority is 1 (highest)');
    assert(repairTask.attribution_state === 'ai_proposed', 'Repair task starts at ai_proposed');
    assert(repairTask.task.includes('ai-config.json'), 'Repair task mentions ai-config.json');

    // 1e. Repair task is persisted in DB
    const allTasks = db.getAllAiMaintenanceTasks();
    assert(allTasks.length === 1, 'One repair task in DB');
    assert(allTasks[0].task_id === repairTask.task_id, 'Repair task ID matches');

    // 1f. runDigest with unconfigured config returns failure honestly
    const jobId = generateULID();
    db.insertDigestJob({ job_id: jobId, conversation_id: 'conv-test-001' });
    const result = await engine.runDigest({
        job_id: jobId,
        conversation_id: 'conv-test-001',
        event_ids: []
    });
    assert(result.success === false, 'runDigest returns success=false when unconfigured');
    assert(result.products.length === 0, 'No products when unconfigured');
    assert(result.source_level === 'opencode' || result.source_level === 'none', 'Source level is opencode or none');

    // 1g. Job status is failed in DB
    const job = db.getDigestJob(jobId);
    assert(job.status === 'failed', 'Job status is failed');

    db.close();
}

// ============================================================================
// Test Suite 2: Config Present — Successful Digest
// ============================================================================
async function testConfigPresent() {
    console.log('\n📋 Test Suite 2: Config Present (Mock API Success)');

    const mockAI = await createMockAIServer();
    const configPath = writeTempConfig({
        api_endpoint: `http://127.0.0.1:${mockAI.port}/v1/chat/completions`,
        api_key: 'test-key-123',
        model: 'test-model',
        local_fallback: { ollama_url: `http://127.0.0.1:${mockAI.port}/api/chat`, model: 'test-local' },
        opencode_fallback: true
    });

    // 2a. getConfig returns configured=true
    const config = getConfig(configPath);
    assert(config.configured === true, 'getConfig returns configured=true');
    assert(config.api_endpoint.includes('127.0.0.1'), 'api_endpoint is set');

    // 2b. getStatus returns level=api
    const status = getStatus(configPath);
    assert(status.level === 'api', 'getStatus returns level=api');
    assert(status.indicator === '🟢', 'getStatus indicator is 🟢');

    // 2c. Set mock API to return valid dual output with card + maintenance_task
    const validMarkdown = '## 测试卡片\n\n这是一个测试卡片。';
    const validProducts = [
        {
            type: 'card',
            title: '对话关键决策记录',
            summary: '本次对话中讨论了系统架构设计的关键决策，包括采用事件溯源模式和四态归属机。',
            evidence: ['用户说：我们应该用事件溯源', '助手建议：四态机保证前向性'],
            boundary_inherit: 'OBSERVE_AND_ARCHIVE',
            source_conversation: 'conv-test-002'
        },
        {
            type: 'maintenance_task',
            task: '更新架构文档以反映事件溯源决策',
            criteria: ['文档包含事件溯源章节', '图示更新'],
            risk: '文档更新可能遗漏部分模块',
            rollback_plan: '从 git 历史恢复旧版文档',
            priority: 3,
            boundary_inherit: 'OBSERVE_AND_ARCHIVE',
            source_conversation: 'conv-test-002'
        }
    ];
    mockAI.setResponse(200, buildMockAPIResponse(buildDualOutput(validMarkdown, validProducts)));

    // 2d. Create engine and run digest
    const db = new CompanionDB(':memory:');
    await db.initialize();
    const engine = new AIDigestEngine({
        db,
        configPath,
        httpPostFn: null // use real httpPost to mock server
    });

    // Set boundary to OBSERVE_AND_ARCHIVE for the test conversation
    const convId = generateULID();
    const setBResult = db.setBoundaryRelation({
        source_id: convId,
        scope: 'test-scope',
        boundary_state: 'OBSERVE_AND_ARCHIVE',
        inherited_from_event_ids: []
    });
    assert(setBResult.success === true, 'Boundary OBSERVE_AND_ARCHIVE set successfully');

    const enqueueResult = engine.enqueueDigest(convId, ['evt-001', 'evt-002']);
    assert(enqueueResult.duplicated === false, 'First enqueue is not duplicated');
    assert(enqueueResult.status === 'queued', 'Job status is queued');

    const runResult = await engine.runDigest({
        job_id: enqueueResult.job_id,
        conversation_id: convId,
        event_ids: ['evt-001', 'evt-002']
    }, '测试材料内容：用户讨论了事件溯源架构设计。');

    assert(runResult.success === true, 'runDigest returns success=true');
    assert(runResult.source_level === 'api', 'Source level is api');
    assert(runResult.products.length === 2, 'Two products produced (card + task)');

    // 2e. Products are persisted in DB
    const cards = db.getAllAiCards();
    const tasks = db.getAllAiMaintenanceTasks();
    assert(cards.length === 1, 'One card in DB');
    assert(tasks.length === 1, 'One maintenance task in DB');

    // 2f. Card has correct fields
    const card = cards[0];
    assert(card.title === '对话关键决策记录', 'Card title correct');
    assert(card.attribution_state === 'ai_proposed', 'Card attribution_state is ai_proposed');
    assert(card.boundary_inherit === 'OBSERVE_AND_ARCHIVE', 'Card boundary_inherit correct');
    assert(card.source_conversation === convId, 'Card source_conversation correct');
    assert(card.markdown_body != null, 'Card has markdown_body');
    assert(card.json_body != null, 'Card has json_body');

    // 2g. Maintenance task has correct fields
    const task = tasks[0];
    assert(task.task === '更新架构文档以反映事件溯源决策', 'Task description correct');
    assert(task.priority === 3, 'Task priority is 3');
    assert(task.attribution_state === 'ai_proposed', 'Task attribution_state is ai_proposed');
    assert(task.risk !== null, 'Task has risk field');

    // 2h. Job is done in DB
    const job = db.getDigestJob(enqueueResult.job_id);
    assert(job.status === 'done', 'Job status is done');
    assert(job.source_level === 'api', 'Job source_level is api');

    // 2i. Schema validation tests
    const cardCheck = validateCardProduct(validProducts[0]);
    assert(cardCheck.valid === true, 'Card product passes schema validation');

    const taskCheck = validateMaintenanceTaskProduct(validProducts[1]);
    assert(taskCheck.valid === true, 'Maintenance task product passes schema validation');

    // 2j. NOT_OBSERVE boundary blocks product creation
    // Add a NOT_OBSERVE boundary for a conversation (using valid ULID)
    const notObserveConvId = generateULID();
    const setNotObsResult = db.setBoundaryRelation({
        source_id: notObserveConvId,
        scope: 'test-scope-no',
        boundary_state: 'NOT_OBSERVE',
        inherited_from_event_ids: []
    });
    assert(setNotObsResult.success === true, 'NOT_OBSERVE boundary set successfully');

    const blockedJobId = generateULID();
    db.insertDigestJob({ job_id: blockedJobId, conversation_id: notObserveConvId });
    const blockedResult = await engine.runDigest({
        job_id: blockedJobId,
        conversation_id: notObserveConvId,
        event_ids: []
    });
    assert(blockedResult.success === false, 'NOT_OBSERVE conversation blocks digest');
    assert(blockedResult.products.length === 0, 'No products from NOT_OBSERVE source');
    assert(blockedResult.error && blockedResult.error.includes('NOT_OBSERVE'), 'Error mentions NOT_OBSERVE');

    // Cleanup
    mockAI.server.close();
    db.close();
}

// ============================================================================
// Test Suite 3: API Failure → Local Fallback → All Fail
// ============================================================================
async function testApiFailureFallback() {
    console.log('\n📋 Test Suite 3: API Failure → Local Fallback');

    const mockAI = await createMockAIServer();
    const mockLocal = await createMockAIServer();
    const configPath = writeTempConfig({
        api_endpoint: `http://127.0.0.1:${mockAI.port}/v1/chat/completions`,
        api_key: 'test-key',
        model: 'test-model',
        local_fallback: { ollama_url: `http://127.0.0.1:${mockLocal.port}/api/chat`, model: 'local-model' },
        opencode_fallback: false
    });

    const db = new CompanionDB(':memory:');
    await db.initialize();
    const engine = new AIDigestEngine({ db, configPath });

    // 3a. API returns 500 → fallback to local (success)
    mockAI.setResponse(500, '{"error":"Internal Server Error"}');
    const validProducts = [{
        type: 'card',
        title: '降级卡片',
        summary: '本地模型降级后产出的卡片。这是一个足够长的摘要用于通过校验。',
        evidence: ['本地模型证据'],
        boundary_inherit: 'OBSERVE_AND_ARCHIVE',
        source_conversation: 'conv-fallback-001'
    }];
    mockLocal.setResponse(200, buildMockOllamaResponse(buildDualOutput('降级卡片', validProducts)));

    const jobId1 = generateULID();
    db.insertDigestJob({ job_id: jobId1, conversation_id: 'conv-fallback-001' });
    const result1 = await engine.runDigest({
        job_id: jobId1,
        conversation_id: 'conv-fallback-001',
        event_ids: []
    }, '测试降级材料');

    assert(result1.success === true, 'API fail → local fallback succeeds');
    assert(result1.source_level === 'local', 'Source level is local');
    assert(result1.products.length === 1, 'One product from local fallback');

    // 3b. Verify product persisted
    const cards = db.getAllAiCards();
    assert(cards.length === 1, 'Card from local fallback in DB');
    assert(cards[0].title === '降级卡片', 'Card title from local model correct');

    // 3c. Both API and local fail → no fabricated products
    mockAI.setResponse(500, '{"error":"API down"}');
    mockLocal.setResponse(500, '{"error":"Local down"}');

    const jobId2 = generateULID();
    db.insertDigestJob({ job_id: jobId2, conversation_id: 'conv-all-fail' });
    const result2 = await engine.runDigest({
        job_id: jobId2,
        conversation_id: 'conv-all-fail',
        event_ids: []
    }, '测试全失败材料');

    assert(result2.success === false, 'All fail → success=false');
    assert(result2.products.length === 0, 'All fail → no fabricated products');
    assert(result2.source_level === 'none', 'All fail → source_level=none');

    // 3d. Job status is failed
    const failedJob = db.getDigestJob(jobId2);
    assert(failedJob.status === 'failed', 'Failed job status is failed');
    assert(failedJob.error_message != null, 'Failed job has error_message');

    // 3e. No new products from failed digest
    const cardsAfterFail = db.getAllAiCards();
    assert(cardsAfterFail.length === 1, 'No new cards after total failure');

    // Cleanup
    mockAI.server.close();
    mockLocal.server.close();
    db.close();
}

// ============================================================================
// Test Suite 4: Idempotency
// ============================================================================
async function testIdempotency() {
    console.log('\n📋 Test Suite 4: Idempotency');

    const mockAI = await createMockAIServer();
    const configPath = writeTempConfig({
        api_endpoint: `http://127.0.0.1:${mockAI.port}/v1/chat/completions`,
        api_key: 'test-key',
        model: 'test-model'
    });

    const validProducts = [{
        type: 'card',
        title: '幂等测试卡片',
        summary: '重复触发不应产生重复产物。这是一个足够长的摘要用于通过校验。',
        evidence: ['证据1'],
        boundary_inherit: 'OBSERVE_AND_ARCHIVE',
        source_conversation: 'conv-idempotent'
    }];
    mockAI.setResponse(200, buildMockAPIResponse(buildDualOutput('幂等测试', validProducts)));

    const db = new CompanionDB(':memory:');
    await db.initialize();
    const engine = new AIDigestEngine({ db, configPath });

    // 4a. First trigger
    const r1 = engine.enqueueDigest('conv-idempotent', ['evt-1']);
    assert(r1.duplicated === false, 'First enqueue not duplicated');

    await engine.runDigest({
        job_id: r1.job_id,
        conversation_id: 'conv-idempotent',
        event_ids: ['evt-1']
    }, '幂等测试材料');

    const cardsAfter1 = db.getAllAiCards();
    assert(cardsAfter1.length === 1, 'One card after first trigger');

    // 4b. Second trigger — should be idempotent (done job exists)
    const r2 = engine.enqueueDigest('conv-idempotent', ['evt-1']);
    assert(r2.duplicated === true, 'Second enqueue is duplicated');
    assert(r2.status === 'done', 'Second enqueue returns done status');

    // 4c. No new products
    const cardsAfter2 = db.getAllAiCards();
    assert(cardsAfter2.length === 1, 'Still one card after second trigger (idempotent)');

    // 4d. No duplicate jobs
    const jobs = db.getDigestJobsByConversation('conv-idempotent');
    assert(jobs.length === 1, 'Only one job for this conversation');

    // 4e. Different conversation — new job
    const r3 = engine.enqueueDigest('conv-other', []);
    assert(r3.duplicated === false, 'Different conversation enqueues new job');

    // Cleanup
    mockAI.server.close();
    db.close();
}

// ============================================================================
// Test Suite 5: Schema Validation Edge Cases
// ============================================================================
async function testSchemaValidation() {
    console.log('\n📋 Test Suite 5: Schema Validation Edge Cases');

    // 5a. Invalid card — missing title
    const invalidCard = { type: 'card', summary: 'test', evidence: [], boundary_inherit: 'OBSERVE_AND_ARCHIVE', source_conversation: 'x' };
    const cardCheck = validateCardProduct(invalidCard);
    assert(cardCheck.valid === false, 'Card without title fails validation');

    // 5b. Invalid card — invalid boundary
    const invalidBoundary = { type: 'card', title: 'x', summary: 'x', evidence: [], boundary_inherit: 'INVALID', source_conversation: 'x' };
    const boundaryCheck = validateCardProduct(invalidBoundary);
    assert(boundaryCheck.valid === false, 'Card with invalid boundary fails validation');

    // 5c. Invalid task — priority out of range
    const invalidPriority = { type: 'maintenance_task', task: 'x', criteria: [], priority: 15, boundary_inherit: 'OBSERVE_AND_ARCHIVE', source_conversation: 'x' };
    const priorityCheck = validateMaintenanceTaskProduct(invalidPriority);
    assert(priorityCheck.valid === false, 'Task with priority > 9 fails validation');

    // 5d. Invalid product type
    const invalidType = { type: 'unknown', title: 'x' };
    const typeCheck = validateProduct(invalidType);
    assert(typeCheck.valid === false, 'Unknown product type fails validation');

    // 5e. parseAIResponse — valid dual output
    const validResponse = '<<<MARKDOWN>>>\n# Title\n\nContent\n<<<JSON>>>\n[{"type":"card","title":"x"}]';
    const parsed = parseAIResponse(validResponse);
    assert(parsed.markdown.includes('# Title'), 'Parsed markdown contains title');
    assert(parsed.products.length === 1, 'Parsed products array has 1 item');
    assert(parsed.parseError === null, 'No parse error for valid response');

    // 5f. parseAIResponse — no delimiters (fallback)
    const noDelimiters = 'Just some raw text without delimiters';
    const fallback = parseAIResponse(noDelimiters);
    assert(fallback.markdown === noDelimiters, 'No-delimiter response returns raw text as markdown');
    assert(fallback.products.length === 0, 'No-delimiter response has empty products');

    // 5g. parseAIResponse — invalid JSON
    const invalidJson = '<<<MARKDOWN>>>\n# Title\n<<<JSON>>>\nnot valid json';
    const invalidParsed = parseAIResponse(invalidJson);
    assert(invalidParsed.products.length === 0, 'Invalid JSON produces empty products');
    assert(invalidParsed.parseError !== null, 'Parse error is set for invalid JSON');
}

// ============================================================================
// Test Suite 6: HTTP RPC Endpoints (integration via startTestServer)
// ============================================================================
async function testHttpEndpoints() {
    console.log('\n📋 Test Suite 6: HTTP RPC Endpoints');

    testCtx = await startTestServer({ port: 0, dbPath: ':memory:' });
    const base = `http://127.0.0.1:${testCtx.port}`;

    function rpc(method, urlPath, payload) {
        return new Promise((resolve, reject) => {
            const data = payload ? JSON.stringify(payload) : null;
            const req = http.request(base + urlPath, {
                method,
                headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
            }, res => {
                let raw = '';
                res.on('data', c => raw += c);
                res.on('end', () => {
                    let body = null;
                    try { body = JSON.parse(raw); } catch (_) {}
                    resolve({ status: res.statusCode, body });
                });
            });
            req.on('error', reject);
            if (data) req.write(data);
            req.end();
        });
    }

    // 6a. GET /rpc/ai/status — should return unconfigured (no config in test env)
    const statusRes = await rpc('GET', '/rpc/ai/status');
    assert(statusRes.status === 200, 'GET /rpc/ai/status returns 200');
    assert(statusRes.body.result != null, 'Response has result');
    assert(statusRes.body.result.level === 'unconfigured' || statusRes.body.result.level === 'api' || statusRes.body.result.level === 'local',
        'AI status has a valid level');

    // 6b. POST /rpc/ai/digest/trigger — unconfigured → repair task
    const triggerRes = await rpc('POST', '/rpc/ai/digest/trigger', {
        conversation_id: 'conv-http-test'
    });
    assert(triggerRes.status === 200, 'POST /rpc/ai/digest/trigger returns 200');
    assert(triggerRes.body.result.configured === false || triggerRes.body.result.success === true,
        'Trigger returns configured=false or success=true');

    // 6c. GET /rpc/cards — empty initially or has repair task
    const cardsRes = await rpc('GET', '/rpc/cards');
    assert(cardsRes.status === 200, 'GET /rpc/cards returns 200');
    assert(cardsRes.body.result.cards != null, 'Cards response has cards array');

    // 6d. GET /rpc/maintenance-tasks — may have repair task
    const tasksRes = await rpc('GET', '/rpc/maintenance-tasks');
    assert(tasksRes.status === 200, 'GET /rpc/maintenance-tasks returns 200');
    assert(tasksRes.body.result.tasks != null, 'Tasks response has tasks array');

    // 6e. POST /rpc/ai/digest/trigger — missing conversation_id → 400
    const badRes = await rpc('POST', '/rpc/ai/digest/trigger', {});
    assert(badRes.status === 400, 'Missing conversation_id returns 400');

    await stopTestServer();
}

// ============================================================================
// Main
// ============================================================================
async function main() {
    console.log('══════════════════════════════════════════════════');
    console.log('  G4 AI Digest Unit Tests — Phase 4');
    console.log('══════════════════════════════════════════════════');

    try {
        await testConfigMissing();
        await testConfigPresent();
        await testApiFailureFallback();
        await testIdempotency();
        await testSchemaValidation();
        await testHttpEndpoints();
    } catch (err) {
        console.error('\n💥 Test suite crashed:', err);
        testsFailed++;
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('══════════════════════════════════════════════════');

    process.exit(testsFailed > 0 ? 1 : 0);
}

main();
