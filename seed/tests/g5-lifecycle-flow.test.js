/**
 * G5 Lifecycle Flow - HTTP-level end-to-end test (temporary companion)
 *
 * Cross-executor collaboration over the wire, zero npm dependencies:
 *   1. Seed: adapter session + material + recommendation + accept -> task materialized
 *   2. Core builder validation: buildRebindPayload enforces required fields
 *   3. Rebind success: POST /rpc/task/rebind -> 200 {event_id, new_binding, previous_agent}
 *   4. Rebind chain: second rebind, verify binding_history via include_binding_history=true
 *   5. binding_history ordering: entries sorted by created_at ASC, each with full fields
 *   6. Terminal-state rejection: complete task -> rebind -> 400 (contains "terminal")
 *   7. Not-found rejection: rebind non-existent task_id -> 400
 *   8. Missing-field rejection: rebind without execution_agent / user_confirmed_at -> 400
 *   9. execution_agent filter: GET /rpc/task/query?execution_agent=X returns only that agent's tasks
 *  10. Overreach audit event: ingest task.overreach_detected -> query back via events/query
 *  11. Expansion audit event: ingest pending -> approve via new event -> query latest = approved
 *  12. Divergence audit event: ingest task.value_divergence_reported -> query back
 *  13. ~/.dcf untouched (temp --dcf-dir isolation)
 *
 * Run: node seed/tests/g5-lifecycle-flow.test.js
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = require('../surface/g4-lifecycle-core');

const PORT = 18477;
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMPANION_ENTRY = path.join(REPO_ROOT, 'seed', 'companion', 'index.js');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-lifecycle-flow-'));
const DB_PATH = path.join(tmpBase, 'test.db');
const DCF_DIR = path.join(tmpBase, 'dcf-dir'); // keeps ~/.dcf completely untouched

const userPortFile = path.join(process.env.HOME || '', '.dcf', 'companion.port');
const userPortBefore = fs.existsSync(userPortFile) ? fs.readFileSync(userPortFile, 'utf8') : null;

let testsPassed = 0;
let testsFailed = 0;
let companion = null;

function assert(condition, message) {
    if (!condition) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message}`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

function request(method, urlPath, payload) {
    return new Promise((resolve, reject) => {
        const data = payload !== undefined ? JSON.stringify(payload) : null;
        const req = http.request(BASE + urlPath, {
            method,
            headers: data
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                : {}
        }, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                let body = null;
                try { body = JSON.parse(raw); } catch (_) { /* keep null */ }
                resolve({ status: res.statusCode, body });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await request('GET', '/rpc/health');
            if (res.status === 200) return true;
        } catch (_) { /* not up yet */ }
        await sleep(300);
    }
    throw new Error('companion did not become healthy in time');
}

/**
 * Helper: ingest a material revision candidate (G4 seed path)
 */
async function seedMaterial(materialId) {
    await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: CORE.generateULID(), source_id: materialId,
            event_type: 'material.revision_candidate.created',
            payload_json: {
                entity_id: materialId,
                candidate_body: 'g5flow material body',
                source_ref: 'chat://g5flow/1',
                assertion_attribution: 'ai_proposed'
            },
            created_at: new Date().toISOString()
        }
    });
}

/**
 * Helper: create a recommendation + accept it to materialize a task
 */
async function createTask(materialId, agentName) {
    const envelope = CORE.buildRecommendationProposedEvent({
        source_entity_type: 'system',
        source_entity_id: CORE.generateULID(),
        recommendation_text: 'g5flow: test task for cross-executor rebind',
        source_reasoning: 'g5flow test seed',
        target_material_refs: [materialId]
    });
    const recId = envelope.event.payload_json.recommendation_id;
    await request('POST', '/rpc/events/ingest', envelope);

    const acceptPayload = CORE.buildAcceptPayload(recId, {
        conversation_url: 'https://chatgpt.com/c/g5flow-init',
        execution_agent: agentName,
        user_confirmed_at: new Date().toISOString()
    });
    const accept = await request('POST', '/rpc/recommendation/accept', acceptPayload);
    return accept.body.result.task_id;
}

async function runAllTests() {
    console.log('\n🧪 G5 Lifecycle Flow - HTTP-level tests (temporary companion @' + PORT + ')\n');

    companion = spawn('node', [COMPANION_ENTRY, `--port=${PORT}`, `--db=${DB_PATH}`, `--dcf-dir=${DCF_DIR}`], {
        stdio: 'ignore'
    });
    await waitForHealth();
    console.log('✓ temporary companion up (db + dcf-dir in ' + tmpBase + ')');

    // -------------------------------------------------------------
    console.log('\n📦 Step 0: buildRebindPayload enforces required fields');
    const someTask = CORE.generateULID();
    let threw = false;
    try { CORE.buildRebindPayload(someTask, null); } catch (_) { threw = true; }
    assert(threw, 'buildRebindPayload refuses missing new_binding');
    threw = false;
    try { CORE.buildRebindPayload(someTask, { user_confirmed_at: new Date().toISOString() }); } catch (_) { threw = true; }
    assert(threw, 'buildRebindPayload refuses missing execution_agent');
    threw = false;
    try { CORE.buildRebindPayload(someTask, { execution_agent: 'agent-x' }); } catch (_) { threw = true; }
    assert(threw, 'buildRebindPayload refuses missing user_confirmed_at');
    // Valid payload with optional fields
    const validPayload = CORE.buildRebindPayload(someTask, {
        execution_agent: 'agent-x',
        user_confirmed_at: new Date().toISOString(),
        conversation_url: 'https://chatgpt.com/c/test',
        reason: 'testing rebind'
    });
    assert(validPayload.new_binding.execution_agent === 'agent-x', 'valid rebind payload has execution_agent');
    assert(validPayload.new_binding.reason === 'testing rebind', 'valid rebind payload preserves optional reason');

    // -------------------------------------------------------------
    console.log('\n📦 Step 1: seed material + create task (agent-A)');
    const materialId = CORE.generateULID();
    await seedMaterial(materialId);
    const taskId = await createTask(materialId, 'agent-A');
    assert(CORE.isValidULID(taskId), 'task materialized with valid ULID');

    // Verify initial binding
    const tq0 = await request('GET', '/rpc/task/query?task_id=' + taskId);
    assert(tq0.body.result.tasks[0].bound_execution_agent === 'agent-A', 'initial bound_execution_agent = agent-A');

    // -------------------------------------------------------------
    console.log('\n📦 Step 2: rebind success (agent-A → agent-B)');
    const rebind1 = await request('POST', '/rpc/task/rebind', CORE.buildRebindPayload(taskId, {
        execution_agent: 'agent-B',
        user_confirmed_at: new Date().toISOString(),
        conversation_url: 'https://chatgpt.com/c/rebind-1',
        reason: 'agent-A handoff to agent-B'
    }));
    assert(rebind1.status === 200, 'rebind -> 200');
    assert(CORE.isValidULID(rebind1.body.result.event_id), 'rebind returns event_id (ULID)');
    assert(rebind1.body.result.previous_agent === 'agent-A', 'rebind returns previous_agent = agent-A');
    assert(rebind1.body.result.new_binding.execution_agent === 'agent-B', 'rebind returns new_binding.execution_agent = agent-B');

    // Verify projection updated
    const tq1 = await request('GET', '/rpc/task/query?task_id=' + taskId);
    assert(tq1.body.result.tasks[0].bound_execution_agent === 'agent-B', 'projection bound_execution_agent updated to agent-B');
    assert(tq1.body.result.tasks[0].bound_conversation_url === 'https://chatgpt.com/c/rebind-1', 'projection bound_conversation_url updated');

    // -------------------------------------------------------------
    console.log('\n📦 Step 3: second rebind (agent-B → agent-C) + binding_history');
    await sleep(100); // ensure distinct timestamps
    const rebind2 = await request('POST', '/rpc/task/rebind', CORE.buildRebindPayload(taskId, {
        execution_agent: 'agent-C',
        user_confirmed_at: new Date().toISOString(),
        reason: 'agent-B unavailable, handoff to agent-C'
    }));
    assert(rebind2.status === 200, 'second rebind -> 200');
    assert(rebind2.body.result.previous_agent === 'agent-B', 'second rebind previous_agent = agent-B');

    // Query binding_history
    const bhQ = await request('GET', '/rpc/task/query?task_id=' + taskId + '&include_binding_history=true');
    assert(bhQ.status === 200, 'include_binding_history=true -> 200');
    const history = bhQ.body.result.binding_history;
    assert(Array.isArray(history), 'binding_history is an array');
    assert(history.length === 2, 'binding_history has 2 entries (two rebinds)');

    // Verify ordering: ascending by created_at
    const t0 = new Date(history[0].created_at).getTime();
    const t1 = new Date(history[1].created_at).getTime();
    assert(t0 <= t1, 'binding_history sorted by created_at ASC');

    // Verify each entry has required fields
    assert(history[0].new_binding.execution_agent === 'agent-B', 'first history entry: to agent-B');
    assert(history[0].previous_agent === 'agent-A', 'first history entry: from agent-A');
    assert(history[1].new_binding.execution_agent === 'agent-C', 'second history entry: to agent-C');
    assert(history[1].previous_agent === 'agent-B', 'second history entry: from agent-B');
    assert(CORE.isValidULID(history[0].event_id), 'history entry has valid event_id');
    assert(typeof history[0].rebind_timestamp === 'string', 'history entry has rebind_timestamp');

    // -------------------------------------------------------------
    console.log('\n📦 Step 4: binding_history empty for task with no rebinds');
    const taskId2 = await createTask(materialId, 'agent-fresh');
    const bhQ2 = await request('GET', '/rpc/task/query?task_id=' + taskId2 + '&include_binding_history=true');
    assert(bhQ2.body.result.binding_history.length === 0, 'task with no rebinds -> empty binding_history array');

    // -------------------------------------------------------------
    console.log('\n📦 Step 5: terminal-state rejection (complete task -> rebind -> 400)');
    // Advance task2 to completed
    await request('POST', '/rpc/task/status', CORE.buildTaskProgressionPayload(taskId2, 'proposed', 'accepted'));
    await request('POST', '/rpc/task/status', CORE.buildTaskProgressionPayload(taskId2, 'accepted', 'in_progress'));
    await request('POST', '/rpc/task/status', CORE.buildTaskProgressionPayload(taskId2, 'in_progress', 'completed'));

    const rebindTerminal = await request('POST', '/rpc/task/rebind', CORE.buildRebindPayload(taskId2, {
        execution_agent: 'agent-late',
        user_confirmed_at: new Date().toISOString()
    }));
    assert(rebindTerminal.status === 400, 'rebind on completed task -> 400');
    assert(rebindTerminal.body.error.message.includes('terminal') || rebindTerminal.body.error.message.includes('completed'),
        'terminal rejection message contains "terminal" or "completed"');

    // -------------------------------------------------------------
    console.log('\n📦 Step 6: not-found rejection');
    const fakeTaskId = CORE.generateULID();
    const rebindNotFound = await request('POST', '/rpc/task/rebind', CORE.buildRebindPayload(fakeTaskId, {
        execution_agent: 'agent-x',
        user_confirmed_at: new Date().toISOString()
    }));
    assert(rebindNotFound.status === 400, 'rebind non-existent task -> 400');
    assert(rebindNotFound.body.error.message.includes('not found') || rebindNotFound.body.error.message.includes('Task not found'),
        'not-found rejection message contains "not found"');

    // -------------------------------------------------------------
    console.log('\n📦 Step 7: missing-field rejection');
    const rebindNoAgent = await request('POST', '/rpc/task/rebind', {
        task_id: taskId,
        new_binding: { user_confirmed_at: new Date().toISOString() }
    });
    assert(rebindNoAgent.status === 400, 'rebind without execution_agent -> 400');

    const rebindNoConfirm = await request('POST', '/rpc/task/rebind', {
        task_id: taskId,
        new_binding: { execution_agent: 'agent-x' }
    });
    assert(rebindNoConfirm.status === 400, 'rebind without user_confirmed_at -> 400');

    const rebindNoBinding = await request('POST', '/rpc/task/rebind', {
        task_id: taskId
    });
    assert(rebindNoBinding.status === 400, 'rebind without new_binding -> 400');

    // -------------------------------------------------------------
    console.log('\n📦 Step 8: execution_agent filter');
    const filterA = await request('GET', '/rpc/task/query?execution_agent=agent-A');
    assert(filterA.status === 200, 'execution_agent filter -> 200');
    const tasksA = filterA.body.result.tasks;
    assert(tasksA.every(t => t.bound_execution_agent === 'agent-A'), 'all filtered tasks have agent-A');
    // agent-A was rebound away, so taskId should NOT be in the results
    assert(!tasksA.some(t => t.task_id === taskId), 'taskId (now agent-C) not in agent-A filter');

    const filterC = await request('GET', '/rpc/task/query?execution_agent=agent-C');
    const tasksC = filterC.body.result.tasks;
    assert(tasksC.some(t => t.task_id === taskId), 'taskId (agent-C) in agent-C filter');

    // -------------------------------------------------------------
    console.log('\n📦 Step 9: overreach audit event ingest + query back');
    const overreachEventId = CORE.generateULID();
    const overreachIngest = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: overreachEventId,
            source_id: taskId,
            event_type: 'task.overreach_detected',
            payload_json: {
                task_id: taskId,
                objective: 'original task objective',
                executed_action: 'modified files outside task boundary',
                detection_evidence: { files: ['outside/scope.js'] },
                detected_at: new Date().toISOString(),
                detected_by: 'boundary-guard',
                severity: 'critical'
            },
            created_at: new Date().toISOString()
        }
    });
    assert(overreachIngest.status === 200, 'task.overreach_detected ingested -> 200');

    // Query back via events/query
    const overreachQ = await request('GET', '/rpc/events/query?source_id=' + taskId + '&limit=200');
    const overreachEvents = overreachQ.body.result.events.filter(e => e.event_type === 'task.overreach_detected');
    assert(overreachEvents.length === 1, 'overreach event queryable via events/query');
    const orPayload = JSON.parse(overreachEvents[0].payload_json);
    assert(orPayload.severity === 'critical', 'overreach payload severity = critical');
    assert(orPayload.executed_action === 'modified files outside task boundary', 'overreach payload executed_action preserved');

    // Verify audit event does NOT change task state
    const tqAfterAudit = await request('GET', '/rpc/task/query?task_id=' + taskId);
    assert(tqAfterAudit.body.result.tasks[0].current_status === 'proposed', 'overreach event does not change task state (still proposed)');

    // -------------------------------------------------------------
    console.log('\n📦 Step 10: expansion audit event (pending → approved via new event)');
    const expansionEventId = CORE.generateULID();
    const expansionIngest = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: expansionEventId,
            source_id: taskId,
            event_type: 'task.privilege_expansion_requested',
            payload_json: {
                task_id: taskId,
                current_boundary: 'read-only',
                requested_boundary: 'read-write',
                justification: 'need to fix a typo in the doc',
                requested_by: 'agent-C',
                user_decision: 'pending'
            },
            created_at: new Date().toISOString()
        }
    });
    assert(expansionIngest.status === 200, 'task.privilege_expansion_requested (pending) ingested -> 200');

    // User approves via a new expansion event with user_decision=approved
    const approveEnvelope = CORE.buildExpansionDecisionEvent(taskId, {
        current_boundary: 'read-only',
        requested_boundary: 'read-write',
        justification: 'need to fix a typo in the doc',
        requested_by: 'agent-C'
    }, 'approved');
    const approveRes = await request('POST', '/rpc/events/ingest', approveEnvelope);
    assert(approveRes.status === 200, 'expansion decision (approved) ingested -> 200');

    // Query back: latest expansion event should be approved
    const expQ = await request('GET', '/rpc/events/query?source_id=' + taskId + '&limit=200');
    const expEvents = expQ.body.result.events.filter(e => e.event_type === 'task.privilege_expansion_requested');
    assert(expEvents.length === 2, 'two expansion events (pending + approved)');
    // Latest by created_at
    const latest = expEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const latestPayload = JSON.parse(latest.payload_json);
    assert(latestPayload.user_decision === 'approved', 'latest expansion event user_decision = approved');

    // -------------------------------------------------------------
    console.log('\n📦 Step 11: divergence audit event ingest + query back');
    const divergenceIngest = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: CORE.generateULID(),
            source_id: taskId,
            event_type: 'task.value_divergence_reported',
            payload_json: {
                task_id: taskId,
                objective: 'fix typo in doc',
                execution_divergence: 'agent rewrote entire section instead of fixing typo',
                execution_rationale: 'thought the section needed restructuring',
                reported_by: 'value-monitor',
                category: 'scope'
            },
            created_at: new Date().toISOString()
        }
    });
    assert(divergenceIngest.status === 200, 'task.value_divergence_reported ingested -> 200');

    const divQ = await request('GET', '/rpc/events/query?source_id=' + taskId + '&limit=200');
    const divEvents = divQ.body.result.events.filter(e => e.event_type === 'task.value_divergence_reported');
    assert(divEvents.length === 1, 'divergence event queryable via events/query');
    const divPayload = JSON.parse(divEvents[0].payload_json);
    assert(divPayload.category === 'scope', 'divergence payload category = scope');

    // -------------------------------------------------------------
    console.log('\n📦 Step 12: invalid audit event payload -> 400');
    const invalidOverreach = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: CORE.generateULID(),
            source_id: taskId,
            event_type: 'task.overreach_detected',
            payload_json: {
                task_id: taskId,
                objective: 'test',
                executed_action: 'test',
                detection_evidence: 'test',
                detected_at: new Date().toISOString(),
                detected_by: 'test',
                severity: 'invalid_severity'  // not in ['critical', 'warning']
            },
            created_at: new Date().toISOString()
        }
    });
    assert(invalidOverreach.status === 400, 'invalid severity overreach -> 400');

    // -------------------------------------------------------------
    console.log('\n📦 Step 13: ~/.dcf untouched by this test');
    const userPortAfter = fs.existsSync(userPortFile) ? fs.readFileSync(userPortFile, 'utf8') : null;
    assert(userPortAfter === userPortBefore, '~/.dcf/companion.port unchanged (temp --dcf-dir isolation)');
}

async function main() {
    try {
        await runAllTests();
    } catch (error) {
        testsFailed++;
        console.error('\n💥 Test run crashed:', error.message);
        console.error(error.stack);
    } finally {
        if (companion) companion.kill('SIGKILL');
        try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Passed: ${testsPassed}  ❌ Failed: ${testsFailed}`);
    console.log('═'.repeat(60) + '\n');
    process.exit(testsFailed > 0 ? 1 : 0);
}

main();
