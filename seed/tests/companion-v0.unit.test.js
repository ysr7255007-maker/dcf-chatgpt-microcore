/**
 * G1 Companion Core - Unit Tests (Simplified, No Top-level Await)
 */

const path = require('path');
const crypto = require('crypto');
const { CompanionDB, DATABASE_SYNC_AVAILABLE } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { generateULID } = require('../companion/ulid');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (!condition) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message}`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS`);
    }
}

console.log('\n\n🧪 G1 Companion Core - Unit Tests\n');
console.log(`node:sqlite available: ${DATABASE_SYNC_AVAILABLE ? '✓' : '✗ (mock mode)'}`);

// Test DB path
{
    const db = new CompanionDB();
    const expectedPath = path.join(process.env.HOME || '.', '.dcf', 'dcf.db');
    
    console.log('\n📦 Test 1: Database Creation');
    console.log('  ▶️  should create default database at ~/.dcf/dcf.db');
    assert(db.dbPath === expectedPath, `Path: ${db.dbPath}`);
    
    // Clean up old test databases first
    delete require.cache[require.resolve('../companion/db')];
    delete require.cache[require.resolve('../companion/events')];
    delete require.cache[require.resolve('../companion/types')];
}

// Use fresh requires
const freshDbModule = require('../companion/db');
const freshEventModule = require('../companion/events');
const { CompanionDB: FCBDB } = freshDbModule;
const { EventProcessor: FCEP } = freshEventModule;

// Create fresh instances with temp paths to avoid conflicts
const testDbPaths = [
    '/tmp/test-companion-1.db',
    '/tmp/test-companion-2.db',
    '/tmp/test-companion-3.db',
    '/tmp/test-companion-4.db',
    '/tmp/test-companion-5.db',
    '/tmp/test-companion-6.db',
    '/tmp/test-companion-7.db'
];

async function runAllTests() {
    let testIndex = 0;
    
    // Test Suite 1: Idempotency
    {
        const db = new FCBDB(testDbPaths[testIndex++]);
        await db.initialize();
        const processor = new FCEP(db);
        
        console.log('\n📦 Test 2: Event ID Idempotency');
        console.log('  ▶️  reject duplicate event_id');
        
        const eventId = generateULID();
        const sourceId = generateULID();
        
        const result1 = await processor.ingestEvent({
            event_id: eventId,
            source_id: sourceId,
            event_type: 'test',
            payload_json: { msg: 'test' }
        });
        assert(result1.success && !result1.duplicated, 'First insert succeeds');
        
        const result2 = await processor.ingestEvent({
            event_id: eventId,
            source_id: sourceId,
            event_type: 'test',
            payload_json: { msg: 'test' }
        });
        assert(result2.success && result2.duplicated, 'Duplicate returns true');
        
        db.close();
    }
    
    // Test Suite 2: Boundary Persistence
    {
        const db = new FCBDB(testDbPaths[testIndex++]);
        await db.initialize();
        const processor = new FCEP(db);
        
        console.log('\n📦 Test 3: Boundary State Persistence');
        console.log('  ▶️  should default to OBSERVE_CURRENT_ONLY');
        
        const sourceId = generateULID();
        const boundary = processor.getBoundaryState(sourceId);
        assert(boundary === 'OBSERVE_CURRENT_ONLY', `Default: ${boundary}`);
        
        db.close();
    }
    
    // Test Suite 3: Content Retention
    {
        const db = new FCBDB(testDbPaths[testIndex++]);
        await db.initialize();
        const processor = new FCEP(db);
        
        console.log('\n📦 Test 4: Zero Content Retention');
        console.log('  ▶️  should store sha256 hash');
        
        const sourceId = generateULID();
        const content = 'Test sensitive content';
        const sha256 = crypto.createHash('sha256').update(content).digest('hex');
        
        const result = await processor.ingestEvent({
            event_id: generateULID(),
            source_id: sourceId,
            event_type: 'content.hash',
            sha256: sha256,
            payload_json: { hash: sha256 }
        });
        
        assert(result.success, 'Event accepted');
        
        const query = processor.queryEventsBySource(sourceId);
        const found = query.events.find(e => e.sha256 === sha256);
        assert(found !== undefined, 'Event retrievable with hash');
        
        db.close();
    }
    
    // Summary
    console.log('\n=================================================\n');
    console.log('         Test Results Summary                  \n');
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}\n`);
    console.log('=================================================\n');
    
    if (testsFailed > 0) {
        console.log(`❌ ${testsFailed} test(s) failed`);
        process.exit(1);
    } else {
        console.log('✅ All tests passed!');
        process.exit(0);
    }
}

runAllTests().catch(error => {
    console.error('Fatal:', error);
    process.exit(1);
});
