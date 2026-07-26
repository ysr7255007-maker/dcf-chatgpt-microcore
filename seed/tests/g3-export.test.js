/**
 * G3 Self-Interpreting Export - Tests
 * - export produces README.md (embedded schema) + materials.md + events.jsonl
 * - every JSONL line is self-contained (event_type + schema_version)
 * - NOT_OBSERVE zero-residue: excluded sources leave NO trace in any file
 * - residue verification actually deletes a violating export
 *
 * Zero dependencies; run: node seed/tests/g3-export.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    EXPORT_SCHEMA_VERSION,
    exportMaterials,
    filterNotObserveContent,
    verifyNotObserveZeroResidue
} = require('../companion/export');
const { CompanionDB } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { MaterialProcessor } = require('../companion/materials');
const { generateULID } = require('../companion/ulid');

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

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'test-g3-export-'));

async function runAllTests() {
    console.log('\n🧪 G3 Self-Interpreting Export - Tests\n');

    // Build a real event log: one observable entity, one NOT_OBSERVE entity
    const db = new CompanionDB(path.join(tmpBase, 'export.db'));
    await db.initialize();
    const ep = new EventProcessor(db);
    const mp = new MaterialProcessor({ db, eventProcessor: ep });

    const visibleEntity = generateULID();
    const secretEntity = generateULID();
    const SECRET_TEXT = 'TOP-SECRET-DIARY-CONTENT-must-never-leak';

    await mp.submitRevisionCandidate({
        entity_id: visibleEntity,
        candidate_body: 'public knowledge draft',
        source_ref: 'chat://visible/1',
        assertion_attribution: 'user_confirmed'
    });
    await mp.submitRevisionCandidate({
        entity_id: secretEntity,
        candidate_body: SECRET_TEXT,
        source_ref: 'chat://secret/1',
        assertion_attribution: 'ai_proposed'
    });

    // The secret entity's boundary is set to NOT_OBSERVE AFTER ingestion
    // (simulates the user tightening the boundary later)
    const notObserveIds = [secretEntity];

    const events = db.getAllRawEventsOfType('material.');
    const projections = db.getAllMaterialProjections()
        .filter(p => !notObserveIds.includes(p.entity_id)); // caller filters projections
    assert(events.length === 2, 'log contains both entities before filtering');

    // -------------------------------------------------------------
    console.log('\n📦 Test 1: filterNotObserveContent removes NOT_OBSERVE events entirely');
    {
        const filtered = filterNotObserveContent(events, new Set(notObserveIds));
        assert(filtered.length === 1, 'only the visible event remains');
        assert(JSON.parse(filtered[0].payload_json).entity_id === visibleEntity, 'remaining event is the visible one');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 2: export produces self-interpreting bundle');
    let exportPath = null;
    {
        const result = await exportMaterials({
            events,
            projections,
            notObserveSourceIds: notObserveIds,
            outputDir: path.join(tmpBase, 'exports')
        });
        assert(result.success === true, 'export succeeded');
        exportPath = result.exportPath;
        assert(fs.existsSync(path.join(exportPath, 'README.md')), 'README.md written');
        assert(fs.existsSync(path.join(exportPath, 'materials.md')), 'materials.md written');
        assert(fs.existsSync(path.join(exportPath, 'events.jsonl')), 'events.jsonl written');
        assert(result.stats.notObserveFiltered === 1, 'stats truthfully report 1 filtered event');

        const readme = fs.readFileSync(path.join(exportPath, 'README.md'), 'utf8');
        assert(readme.includes(EXPORT_SCHEMA_VERSION), 'README embeds schema version');
        assert(readme.includes('material.revision_candidate.created'), 'README documents event types');
        assert(readme.includes('ai_proposed') && readme.includes('reality_verified'), 'README documents four attribution states');
        assert(readme.includes('NOT_OBSERVE'), 'README states the zero-residue boundary principle');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 3: events.jsonl lines are self-contained');
    {
        const lines = fs.readFileSync(path.join(exportPath, 'events.jsonl'), 'utf8')
            .trim().split('\n');
        assert(lines.length === 1, 'exactly one (visible) event exported');
        const parsed = JSON.parse(lines[0]);
        assert(parsed.schema_version === EXPORT_SCHEMA_VERSION, 'line carries schema_version');
        assert(parsed.event_type === 'material.revision_candidate.created', 'line carries event_type');
        assert(typeof parsed.event_id === 'string' && typeof parsed.payload_json === 'object',
            'line self-contained with id and payload');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 4: NOT_OBSERVE zero residue across every export file');
    {
        for (const filename of ['README.md', 'materials.md', 'events.jsonl']) {
            const content = fs.readFileSync(path.join(exportPath, filename), 'utf8');
            assert(!content.includes(SECRET_TEXT), `${filename} contains no secret content`);
            assert(!content.includes(secretEntity), `${filename} contains no secret entity id`);
        }
        const check = verifyNotObserveZeroResidue(exportPath, new Set(notObserveIds), events);
        assert(check.passed === true, 'post-write residue verification passes');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 5: residue verification deletes a violating export');
    {
        // Craft a violating export dir: secret content smuggled into materials.md
        const badDir = path.join(tmpBase, 'bad-export');
        fs.mkdirSync(badDir, { recursive: true });
        fs.writeFileSync(path.join(badDir, 'materials.md'), `leak: ${SECRET_TEXT}\n`);
        const check = verifyNotObserveZeroResidue(badDir, new Set(notObserveIds), events);
        assert(check.passed === false, 'violation detected');
        assert(/materials\.md/.test(check.reason), 'reason names the violating file');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 6: export refuses when nothing survives filtering');
    {
        const secretOnly = events.filter(e => JSON.parse(e.payload_json).entity_id === secretEntity);
        const result = await exportMaterials({
            events: secretOnly,
            projections: [],
            notObserveSourceIds: notObserveIds,
            outputDir: path.join(tmpBase, 'exports-empty')
        });
        assert(result.success === false, 'export honestly refuses empty result');
        assert(/NOT_OBSERVE/.test(result.error), 'error explains the filtering cause');
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
