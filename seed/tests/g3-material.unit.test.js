/**
 * G3 Material Metabolism - Unit Tests
 * - assertion_attribution mandatory (missing -> honest rejection)
 * - four-state forward-only transitions (regression rejected + recorded)
 * - revision candidates never overwrite (append-only log)
 * - projection recompute === incremental result (shared pure reducer)
 *
 * Zero dependencies; run: node seed/tests/g3-material.unit.test.js
 */

const fs = require('fs');
const path = require('path');

const { CompanionDB } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { MaterialProcessor, reduceMaterialEvents, applyMaterialEvent } = require('../companion/materials');
const { generateULID } = require('../companion/ulid');
const { ATTRIBUTION_STATES } = require('../companion/types');

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

const tmpBase = '/tmp/test-g3-material-' + Date.now();
fs.mkdirSync(tmpBase, { recursive: true });
const dbPath = path.join(tmpBase, 'g3.db');

function clearProjections(cdb) {
    if (cdb.db.isMock) {
        cdb.db.data.materials_projection = [];
    } else {
        cdb.db.prepare('DELETE FROM materials_projection').run();
    }
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        entity_id: row.entity_id,
        latest_candidate_sha256: row.latest_candidate_sha256 || null,
        latest_candidate_body: row.latest_candidate_body || null,
        attribution_state: row.attribution_state,
        assertion_attribution: row.assertion_attribution,
        source_ref: row.source_ref || null,
        continuation_points_json: row.continuation_points_json || null
    };
}

async function runAllTests() {
    console.log('\n🧪 G3 Material Metabolism - Unit Tests\n');

    const db = new CompanionDB(dbPath);
    await db.initialize();
    const ep = new EventProcessor(db);
    const mp = new MaterialProcessor({ db, eventProcessor: ep });

    const entityA = generateULID();
    const entityB = generateULID();

    // -------------------------------------------------------------
    console.log('\n📦 Test 1: assertion_attribution is mandatory');
    {
        const result = await ep.ingestEvent({
            event_id: generateULID(),
            source_id: entityA,
            event_type: 'material.revision_candidate.created',
            payload_json: {
                entity_id: entityA,
                candidate_body: 'draft v1',
                source_ref: 'chat://test/1'
                // assertion_attribution intentionally missing
            }
        });
        assert(result.success === false, 'ingest rejected without assertion_attribution');
        assert(/assertion_attribution/.test(result.error || ''), 'error truthfully names the missing field');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 2: invalid assertion_attribution value rejected');
    {
        const result = await ep.ingestEvent({
            event_id: generateULID(),
            source_id: entityA,
            event_type: 'material.revision_candidate.created',
            payload_json: {
                entity_id: entityA,
                candidate_body: 'draft v1',
                source_ref: 'chat://test/1',
                assertion_attribution: 'definitely_true'
            }
        });
        assert(result.success === false, 'ingest rejected with invalid state value');
        assert(ATTRIBUTION_STATES.every(s => (result.error || '').includes(s)), 'error lists the four valid states');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 3: revision candidate creates projection (never overwrites log)');
    {
        const r1 = await mp.submitRevisionCandidate({
            entity_id: entityA,
            candidate_body: 'draft v1',
            source_ref: 'chat://test/1',
            assertion_attribution: 'ai_proposed'
        });
        assert(r1.success === true, 'first candidate accepted');
        assert(typeof r1.candidate_sha256 === 'string' && r1.candidate_sha256.length === 64, 'sha256 computed server-side');

        const r2 = await mp.submitRevisionCandidate({
            entity_id: entityA,
            candidate_body: 'draft v2',
            source_ref: 'chat://test/2',
            assertion_attribution: 'ai_proposed'
        });
        assert(r2.success === true, 'second candidate accepted');

        const proj = db.getMaterialProjection(entityA);
        assert(proj && proj.latest_candidate_body === 'draft v2', 'projection points at latest candidate');

        const events = db.getAllRawEventsOfType('material.revision_candidate.created');
        assert(events.length === 2, 'both candidates preserved in append-only log (no overwrite)');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 4: forward transition (skip allowed)');
    {
        const result = await mp.transitionAttribution({
            entity_id: entityA,
            target_ref: `material://${entityA}`,
            from_state: 'ai_proposed',
            to_state: 'user_confirmed'
        });
        assert(result.success === true, 'ai_proposed -> user_confirmed (skip) accepted');

        const proj = db.getMaterialProjection(entityA);
        assert(proj.attribution_state === 'user_confirmed', 'projection state advanced');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 5: regression rejected AND recorded as independent event');
    {
        const result = await mp.transitionAttribution({
            entity_id: entityA,
            target_ref: `material://${entityA}`,
            from_state: 'user_confirmed',
            to_state: 'ai_proposed'
        });
        assert(result.success === false, 'regression rejected');
        assert(result.rejected === true, 'flagged as rejection');
        assert(typeof result.rejection_event_id === 'string', 'rejection recorded as event');

        const rejections = db.getAllRawEventsOfType('material.attribution.transition_rejected');
        assert(rejections.length === 1, 'rejection event present in log');

        const proj = db.getMaterialProjection(entityA);
        assert(proj.attribution_state === 'user_confirmed', 'projection state unchanged after rejection');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 6: from_state must match current projection state');
    {
        const result = await mp.transitionAttribution({
            entity_id: entityA,
            target_ref: `material://${entityA}`,
            from_state: 'ai_proposed', // stale claim; actual is user_confirmed
            to_state: 'reality_verified'
        });
        assert(result.success === false, 'stale from_state rejected');
        assert(/mismatch/.test(result.error || ''), 'error explains the mismatch');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 7: continuation points accumulate in projection');
    {
        const fromEvent = db.getAllRawEventsOfType('material.')[0];
        const r = await mp.createContinuationPoint({
            entity_id: entityA,
            from_event_id: fromEvent.event_id,
            context_ref: 'surface://cards/42',
            assertion_attribution: 'user_tentative'
        });
        assert(r.success === true, 'continuation point accepted');

        const proj = db.getMaterialProjection(entityA);
        const points = JSON.parse(proj.continuation_points_json || '[]');
        assert(points.length === 1 && points[0].context_ref === 'surface://cards/42', 'point stored in projection');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 8: recompute result === incremental result');
    {
        // Add a second entity with its own chain to make the check meaningful
        await mp.submitRevisionCandidate({
            entity_id: entityB,
            candidate_body: 'B draft',
            source_ref: 'chat://test/b',
            assertion_attribution: 'user_tentative'
        });
        await mp.transitionAttribution({
            entity_id: entityB,
            target_ref: `material://${entityB}`,
            from_state: 'user_tentative',
            to_state: 'reality_verified',
            evidence_ref: 'test://evidence'
        });

        const incremental = db.getAllMaterialProjections()
            .map(normalizeRow)
            .sort((a, b) => a.entity_id.localeCompare(b.entity_id));

        clearProjections(db);
        assert(db.getAllMaterialProjections().length === 0, 'projection table cleared');

        const recompute = db.recomputeMaterialsProjection();
        assert(recompute.success === true, 'recompute succeeded');

        const recomputed = db.getAllMaterialProjections()
            .map(normalizeRow)
            .sort((a, b) => a.entity_id.localeCompare(b.entity_id));

        assert(JSON.stringify(incremental) === JSON.stringify(recomputed),
            'recomputed projections identical to incremental projections');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 9: pure reducer determinism (unit level)');
    {
        const events = db.getAllRawEventsOfType('material.');
        const m1 = reduceMaterialEvents(events);
        const m2 = reduceMaterialEvents(events);
        assert(JSON.stringify([...m1.entries()]) === JSON.stringify([...m2.entries()]),
            'reduceMaterialEvents is deterministic');

        const noop = applyMaterialEvent(null, { event_type: 'material.sync.pushed', payload_json: null });
        assert(noop === null, 'events without payload/entity_id are projection no-ops');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 10: batch ingest enforces the same material rules');
    {
        const result = await ep.batchIngestEvents([{
            event_id: generateULID(),
            source_id: entityB,
            event_type: 'material.continuation_point.created',
            payload_json: {
                entity_id: entityB,
                from_event_id: generateULID(),
                context_ref: 'x'
                // missing assertion_attribution
            }
        }]);
        assert(result.success === false, 'batch rejected material event without attribution');
    }

    db.close();
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) { /* best effort */ }

    console.log(`\n\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
});
