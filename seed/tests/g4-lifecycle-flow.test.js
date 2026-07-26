/**
 * G4 Lifecycle Flow - HTTP-level end-to-end test (temporary companion)
 *
 * Full core life cycle over the wire, zero npm dependencies:
 *   1. adapter capture path seeds a session (conversation.* w/ conversation_id)
 *   2. material seeded (revision candidate -> projection exists)
 *   3. manual recommendation.proposed via /rpc/events/ingest
 *      (source_reasoning + source_material_refs mandatory in the builder)
 *   4. 接住: /rpc/recommendation/accept with EXPLICIT binding_context
 *      (builder refuses missing binding / execution_agent / user_confirmed_at)
 *   5. task progression proposed -> accepted -> in_progress (five-state machine)
 *   6. checkpoint persisted + projection pointer updated
 *   7. completion with feedback_to_materials -> material.attribution.transitioned
 *      chain asserted (to_state=reality_verified, evidence_ref, provenance)
 *   8. regression -> 400 + error.data.{rejected, rejection_event_id} + logged
 *   9. ingest-path back-propagation (task.failure_recorded -> user_tentative)
 *  10. dismiss requires flow: reason recorded verbatim
 *  11. ~/.dcf untouched (temp --dcf-dir isolation)
 *
 * Run: node seed/tests/g4-lifecycle-flow.test.js
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = require('../surface/g4-lifecycle-core');

const PORT = 18476;
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMPANION_ENTRY = path.join(REPO_ROOT, 'seed', 'companion', 'index.js');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-lifecycle-flow-'));
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

async function runAllTests() {
    console.log('\n🧪 G4 Lifecycle Flow - HTTP-level tests (temporary companion @' + PORT + ')\n');

    companion = spawn('node', [COMPANION_ENTRY, `--port=${PORT}`, `--db=${DB_PATH}`, `--dcf-dir=${DCF_DIR}`], {
        stdio: 'ignore'
    });
    await waitForHealth();
    console.log('✓ temporary companion up (db + dcf-dir in ' + tmpBase + ')');

    // -------------------------------------------------------------
    console.log('\n📦 Step 0: core builders enforce explicit binding (no defaults, no guessing)');
    const someRec = CORE.generateULID();
    let threw = false;
    try { CORE.buildAcceptPayload(someRec, null); } catch (_) { threw = true; }
    assert(threw, 'buildAcceptPayload refuses missing binding_context');
    threw = false;
    try { CORE.buildAcceptPayload(someRec, { conversation_id: CORE.generateULID(), user_confirmed_at: new Date().toISOString() }); } catch (_) { threw = true; }
    assert(threw, 'buildAcceptPayload refuses missing execution_agent');
    threw = false;
    try { CORE.buildAcceptPayload(someRec, { conversation_id: CORE.generateULID(), execution_agent: 'u' }); } catch (_) { threw = true; }
    assert(threw, 'buildAcceptPayload refuses missing user_confirmed_at (explicit confirmation timestamp)');
    threw = false;
    try { CORE.buildRecommendationProposedEvent({ source_entity_type: 'card', source_entity_id: CORE.generateULID(), recommendation_text: 'x', source_reasoning: '' }); } catch (_) { threw = true; }
    assert(threw, 'buildRecommendationProposedEvent refuses empty source_reasoning');
    const urlOnly = CORE.buildAcceptPayload(someRec, {
        conversation_url: 'https://chatgpt.com/c/manual-paste',
        execution_agent: 'looy', user_confirmed_at: new Date().toISOString()
    });
    assert(urlOnly.binding_context.conversation_url === 'https://chatgpt.com/c/manual-paste',
        'manual conversation_url path is a valid explicit binding alternative');

    // -------------------------------------------------------------
    console.log('\n📦 Step 1: adapter capture seeds a session (conversation_id in payload)');
    const sessionSourceId = CORE.generateULID();
    const chatgptUuid = 'a1b2c3d4-e5f6-4a1b-9c2d-1234567890ab';
    const captured = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: CORE.generateULID(),
            source_id: sessionSourceId,
            event_type: 'conversation.message.received',
            payload_json: {
                role: 'assistant', message_id: 'uuid-msg-1',
                text: 'g4flow assistant reply held for binding',
                conversation_id: chatgptUuid,
                conversation_path: '/c/' + chatgptUuid,
                observed_at: new Date().toISOString()
            },
            created_at: new Date().toISOString(), sequence_number: 1
        }
    });
    assert(captured.status === 200, 'conversation.message.received ingested (adapter payload w/ conversation_id)');

    const sessions = await request('GET', '/rpc/adapter/sessions');
    assert(sessions.status === 200 && Array.isArray(sessions.body.result.sessions), '/rpc/adapter/sessions returns list');
    const session = sessions.body.result.sessions.find(s => s.conversation_id === sessionSourceId);
    assert(!!session, 'captured conversation aggregated into session list (conversation_id = source_id)');
    assert(session && session.event_count === 1, 'session event_count honest');

    // -------------------------------------------------------------
    console.log('\n📦 Step 2: material seeded (projection target for back-propagation)');
    const materialId = CORE.generateULID();
    const materialSeed = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: CORE.generateULID(),
            source_id: materialId,
            event_type: 'material.revision_candidate.created',
            payload_json: {
                entity_id: materialId,
                candidate_body: 'g4flow material body v1',
                source_ref: 'chat://g4flow/1',
                assertion_attribution: 'ai_proposed'
            },
            created_at: new Date().toISOString()
        }
    });
    assert(materialSeed.status === 200, 'material revision candidate ingested');
    const matQ = await request('GET', '/rpc/material/query?entity_id=' + materialId);
    assert(matQ.status === 200 && matQ.body.result.projection
        && matQ.body.result.projection.attribution_state === 'ai_proposed',
        'material projection exists at ai_proposed');

    // -------------------------------------------------------------
    console.log('\n📦 Step 3: manual recommendation.proposed via /rpc/events/ingest');
    const envelope = CORE.buildRecommendationProposedEvent({
        source_entity_type: 'system',
        source_entity_id: CORE.generateULID(),
        recommendation_text: 'g4flow: consolidate the intro material into one canonical doc',
        source_reasoning: 'material has 3 divergent candidates; user asked twice about intro',
        target_material_refs: [materialId],
        materiality_score: 0.8,
        priority_level: 2
    });
    const recId = envelope.event.payload_json.recommendation_id;
    assert(CORE.isValidULID(recId), 'builder generated a valid recommendation_id ULID');
    assert(envelope.event.source_id === recId, 'envelope source_id === recommendation_id (provenance queryable)');
    const proposed = await request('POST', '/rpc/events/ingest', envelope);
    assert(proposed.status === 200, 'recommendation.proposed accepted by ingest');

    const pending = await request('POST', '/rpc/recommendation/query', { status: 'pending' });
    assert(pending.status === 200 && pending.body.result.recommendations.some(r => r.recommendation_id === recId),
        'recommendation visible as pending via POST /rpc/recommendation/query');
    const pendingRow = pending.body.result.recommendations.find(r => r.recommendation_id === recId);
    assert(pendingRow.priority_level === 2 && Number(pendingRow.materiality_score) === 0.8,
        'priority_level + materiality_score persisted in projection');

    // source_reasoning lives in the event log (projection has no column)
    const prov = await request('GET', '/rpc/events/query?source_id=' + recId + '&limit=50');
    const provEvent = prov.body.result.events.find(e => e.event_type === 'recommendation.proposed');
    const provPayload = JSON.parse(provEvent.payload_json);
    assert(provPayload.source_reasoning.includes('3 divergent candidates'),
        'source_reasoning retrievable verbatim from recommendation.proposed event payload');
    assert(Array.isArray(provPayload.target_material_ids) && provPayload.target_material_ids[0] === materialId,
        'source_material_refs recorded in event payload');

    // -------------------------------------------------------------
    console.log('\n📦 Step 4: 接住 - accept with explicit session binding');
    const acceptPayload = CORE.buildAcceptPayload(recId, {
        conversation_id: session.conversation_id,
        conversation_url: session.conversation_url || null,
        execution_agent: 'g4flow-user',
        user_confirmed_at: new Date().toISOString()
    });
    const accept = await request('POST', '/rpc/recommendation/accept', acceptPayload);
    assert(accept.status === 200, 'accept -> 200');
    const taskId = accept.body.result.task_id;
    assert(CORE.isValidULID(taskId), 'accept materialized a task_id (ULID)');
    assert(CORE.isValidULID(accept.body.result.task_event_id), 'task.created event id returned');

    const tq1 = await request('GET', '/rpc/task/query?task_id=' + taskId);
    const task1 = tq1.body.result.tasks[0];
    assert(task1.source_ref === recId, 'task source_ref traces back to recommendation');
    assert(task1.bound_conversation_id === sessionSourceId, 'bound_conversation_id = explicitly selected session');
    assert(task1.bound_execution_agent === 'g4flow-user', 'bound_execution_agent persisted');
    assert(task1.current_status === 'proposed', 'materialized task starts at proposed');

    const doubleAccept = await request('POST', '/rpc/recommendation/accept', acceptPayload);
    assert(doubleAccept.status === 400, 'double-accept rejected (only pending accepts)');

    // -------------------------------------------------------------
    console.log('\n📦 Step 5: five-state progression proposed -> accepted -> in_progress');
    const adv1 = await request('POST', '/rpc/task/status',
        CORE.buildTaskProgressionPayload(taskId, 'proposed', 'accepted'));
    assert(adv1.status === 200 && adv1.body.result.to_state === 'accepted', 'proposed -> accepted');
    const adv2 = await request('POST', '/rpc/task/status',
        CORE.buildTaskProgressionPayload(taskId, 'accepted', 'in_progress'));
    assert(adv2.status === 200 && adv2.body.result.to_state === 'in_progress', 'accepted -> in_progress');
    const tq2 = await request('GET', '/rpc/task/query?task_id=' + taskId);
    assert(tq2.body.result.tasks[0].current_status === 'in_progress', 'projection tracks in_progress');

    // -------------------------------------------------------------
    console.log('\n📦 Step 6: checkpoint persisted + projection pointer');
    const cpPayload = CORE.buildCheckpointPayload(taskId, CORE.generateULID(), 'manual',
        JSON.stringify({ note: 'halfway', saved_at: new Date().toISOString() }));
    const cp = await request('POST', '/rpc/task/checkpoint', cpPayload);
    assert(cp.status === 200 && cp.body.result.checkpoint_id === cpPayload.checkpoint_id, 'checkpoint saved');
    assert(CORE.isValidULID(cp.body.result.event_id), 'checkpoint event id is ULID');
    const tq3 = await request('GET', '/rpc/task/query?task_id=' + taskId);
    assert(tq3.body.result.tasks[0].checkpoint_event_id === cp.body.result.event_id,
        'projection checkpoint_event_id points at latest checkpoint event');

    // -------------------------------------------------------------
    console.log('\n📦 Step 7: completion with feedback -> attribution chain (reality_verified)');
    const done = await request('POST', '/rpc/task/status',
        CORE.buildTaskProgressionPayload(taskId, 'in_progress', 'completed', {
            feedback_to_materials: CORE.buildMaterialFeedbackBundle(materialId, 'reality_verified')
        }));
    assert(done.status === 200, 'in_progress -> completed with feedback_to_materials');
    const doneEventId = done.body.result.event_id;

    const chainQ = await request('GET', '/rpc/events/query?source_id=' + materialId + '&limit=100');
    const chain = chainQ.body.result.events.filter(e => {
        if (e.event_type !== 'material.attribution.transitioned') return false;
        const p = JSON.parse(e.payload_json);
        return p.evidence_ref === doneEventId;
    });
    assert(chain.length === 1, 'exactly one material.attribution.transitioned chain event generated');
    const chainPayload = JSON.parse(chain[0].payload_json);
    assert(chainPayload.from_state === 'ai_proposed' && chainPayload.to_state === 'reality_verified',
        'chain transitions ai_proposed -> reality_verified (success path)');
    assert(chainPayload.provenance && chainPayload.provenance.originating_task_event_id === doneEventId,
        'chain provenance names the originating task event');
    const matQ2 = await request('GET', '/rpc/material/query?entity_id=' + materialId);
    assert(matQ2.body.result.projection.attribution_state === 'reality_verified',
        'material projection advanced to reality_verified');

    // -------------------------------------------------------------
    console.log('\n📦 Step 8: regression honestly rejected (400 + rejection event)');
    const back = await request('POST', '/rpc/task/status',
        CORE.buildTaskProgressionPayload(taskId, 'completed', 'in_progress'));
    assert(back.status === 400, 'completed -> in_progress regression -> 400');
    assert(back.body.error.data && back.body.error.data.rejected === true, 'error.data.rejected === true');
    const rejId = back.body.error.data.rejection_event_id;
    assert(CORE.isValidULID(rejId), 'rejection_event_id is a valid ULID');
    const taskEvents = await request('GET', '/rpc/events/query?source_id=' + taskId + '&limit=100');
    assert(taskEvents.body.result.events.some(e => e.event_id === rejId && e.event_type === 'task.transition_rejected'),
        'rejection recorded as task.transition_rejected in the append-only log');
    const tq4 = await request('GET', '/rpc/task/query?task_id=' + taskId);
    assert(tq4.body.result.tasks[0].current_status === 'completed', 'projection unchanged after rejection');

    // DB-state second line of defense: claimed from_state forward-valid but stale
    const stale = await request('POST', '/rpc/task/status',
        CORE.buildTaskProgressionPayload(taskId, 'accepted', 'in_progress'));
    assert(stale.status === 400 && stale.body.error.data.rejected === true,
        'stale from_state (behind DB projection) also rejected with rejected=true');

    // -------------------------------------------------------------
    console.log('\n📦 Step 9: ingest-path back-propagation (failure -> user_tentative)');
    const material2 = CORE.generateULID();
    await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: CORE.generateULID(), source_id: material2,
            event_type: 'material.revision_candidate.created',
            payload_json: {
                entity_id: material2, candidate_body: 'g4flow material 2',
                source_ref: 'chat://g4flow/2', assertion_attribution: 'ai_proposed'
            }
        }
    });
    const task2 = CORE.generateULID();
    await request('POST', '/rpc/task/status', CORE.buildTaskProgressionPayload(task2, 'proposed', 'in_progress'));
    const failEventId = CORE.generateULID();
    const failIngest = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: failEventId,
            source_id: task2,
            event_type: 'task.failure_recorded',
            payload_json: {
                task_id: task2,
                failure_path_event_id: failEventId, // honest self-reference
                feedback_to_materials: CORE.buildMaterialFeedbackBundle(material2, 'user_tentative')
            },
            created_at: new Date().toISOString()
        }
    });
    assert(failIngest.status === 200, 'task.failure_recorded ingested via /rpc/events/ingest (Surface 回灌通路)');
    const chain2Q = await request('GET', '/rpc/events/query?source_id=' + material2 + '&limit=100');
    const chain2 = chain2Q.body.result.events.filter(e =>
        e.event_type === 'material.attribution.transitioned' && JSON.parse(e.payload_json).evidence_ref === failEventId);
    assert(chain2.length === 1 && JSON.parse(chain2[0].payload_json).to_state === 'user_tentative',
        'failure path chain -> user_tentative (reality NOT confirmed)');

    // Regressive chain honestly skipped: insight on the reality_verified material
    const insightId = CORE.generateULID();
    const insight = await request('POST', '/rpc/events/ingest', {
        event: {
            event_id: insightId, source_id: taskId,
            event_type: 'task.insight_changed',
            payload_json: {
                task_id: taskId,
                feedback_to_materials: CORE.buildMaterialFeedbackBundle(materialId, 'user_tentative')
            }
        }
    });
    assert(insight.status === 200, 'task.insight_changed ingested (no state transition target)');
    const chain3Q = await request('GET', '/rpc/events/query?source_id=' + materialId + '&limit=100');
    const chain3 = chain3Q.body.result.events.filter(e =>
        e.event_type === 'material.attribution.transitioned' && JSON.parse(e.payload_json).evidence_ref === insightId);
    assert(chain3.length === 0, 'regressive chain (reality_verified -> user_tentative) honestly skipped, not faked');

    // -------------------------------------------------------------
    console.log('\n📦 Step 10: dismiss requires a reason and records it verbatim');
    const envelope2 = CORE.buildRecommendationProposedEvent({
        source_entity_type: 'system',
        source_entity_id: CORE.generateULID(),
        recommendation_text: 'g4flow: second recommendation to dismiss',
        source_reasoning: 'testing dismiss path',
        target_material_refs: [materialId]
    });
    const rec2 = envelope2.event.payload_json.recommendation_id;
    await request('POST', '/rpc/events/ingest', envelope2);
    const dismissed = await request('POST', '/rpc/recommendation/dismiss',
        CORE.buildDismissPayload(rec2, '与当前目标无关'));
    assert(dismissed.status === 200 && dismissed.body.result.reason === '与当前目标无关',
        'dismiss with reason -> 200, reason echoed verbatim');
    const dq = await request('POST', '/rpc/recommendation/query', { status: 'dismissed' });
    assert(dq.body.result.recommendations.some(r => r.recommendation_id === rec2),
        'recommendation projected as dismissed');

    // -------------------------------------------------------------
    console.log('\n📦 Step 11: ~/.dcf untouched by this test');
    const userPortAfter = fs.existsSync(userPortFile) ? fs.readFileSync(userPortFile, 'utf8') : null;
    assert(userPortAfter === userPortBefore, '~/.dcf/companion.port unchanged (temp --dcf-dir isolation)');
}

async function main() {
    try {
        await runAllTests();
    } catch (error) {
        testsFailed++;
        console.error('\n💥 Test run crashed:', error.message);
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
