/**
 * G2 Companion Doctor - Unit Tests
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { runDoctor, checkDatabase, probePort } = require('../companion/doctor');

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

console.log('\n\n🧪 G2 Companion Doctor - Unit Tests\n');

// Test suite setup: temp directories
const tmpBase = '/tmp/test-companion-doctor-' + Date.now();
const dbPath = path.join(tmpBase, 'dcf.db');

async function runAllTests() {
    // Test 1: Directory creation
    {
        const baseDir = path.join(tmpBase, 'run-1');
        console.log('\n📦 Test 1: Directories auto-created');
        console.log('  ▶️ should create ~/.dcf and logs dir when missing');
        
        const result = await runDoctor({ port: 8472, baseDir });
        assert(fs.existsSync(baseDir), 'base dir exists');
        assert(fs.existsSync(path.join(baseDir, 'logs')), 'logs dir exists');
        assert(result.checks.directories.created.length > 0, 'created dirs listed');
    }

    // Test 2: DB repair
    {
        const baseDir = path.join(tmpBase, 'run-2');
        fs.mkdirSync(baseDir, { recursive: true });
        const corruptDb = path.join(baseDir, 'dcf.db');
        
        console.log('\n📦 Test 2: Corrupt DB repaired (evidence preserved)');
        console.log('  ▶️ invalid DB is backed up with .corrupt-*.bak suffix');
        
        // Create a corrupt DB file (garbage text)
        fs.writeFileSync(corruptDb, 'not a sqlite database\n');
        
        const result = await runDoctor({ port: 8472, dbPath: corruptDb, baseDir });
        assert(!fs.existsSync(corruptDb), 'original corrupt DB removed');
        assert(/\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.bak$/.test(
            fs.readdirSync(baseDir).find(f => f.endsWith('.bak')) || ''
        ), 'backup file created');
        assert(result.checks.database.status === 'rebuilt', 'status rebuilt');
    }

    // Test 3: Port probing (free port)
    {
        const freePort = 19472; // Use high ephemeral port
        
        console.log('\n📦 Test 3: Probe free port');
        console.log('  ▶️ ECONNREFUSED -> free');
        
        const state = await probePort(freePort);
        assert(state === 'free', `port ${freePort} is free`);
    }

    // Test 4: Port probing (occupied by non-companion)
    {
        let server = null;
        const occupiedPort = 19473;
        
        console.log('\n📦 Test 4: Probe occupied port (non-companion)');
        console.log('  ▶️ HTTP 500 /health -> occupied (safe to reassign)');
        
        await new Promise(resolve => {
            server = http.createServer((req, res) => {
                res.writeHead(500);
                res.end('error');
            }).listen(occupiedPort, resolve);
        });
        
        const state = await probePort(occupiedPort);
        assert(state === 'occupied', 'port marked occupied by non-companion');
        
        server.close();
    }

    // Test 5: Port probing (healthy companion found -> single instance exit)
    {
        let server = null;
        const healthyPort = 19474;
        
        console.log('\n📦 Test 5: Probe healthy companion on port');
        console.log('  ▶️ GET /rpc/health 200 {"result":{"status":"healthy"}} -> already-running');
        
        await new Promise(resolve => {
            server = http.createServer((req, res) => {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ jsonrpc:'2.0', result: { status:'healthy', event_count:0 }, id:null }));
            }).listen(healthyPort, resolve);
        });
        
        const state = await probePort(healthyPort);
        assert(state === 'healthy-companion', 'healthy companion detected');
        
        const result = await runDoctor({ port: healthyPort, baseDir: path.join(tmpBase, 'run-5') });
        assert(result.shouldExit, 'shouldExit=true when healthy companion running');
        assert(result.exitCode === 0, 'exitCode=0 for graceful single-instance exit');
        
        server.close();
    }

    // Test 6: Full doctor flow with temporary workspace
    {
        const baseDir = path.join(tmpBase, 'run-6');
        const testDb = path.join(baseDir, 'dcf.db');
        
        console.log('\n📦 Test 6: Full doctor flow (fresh start)');
        console.log('  ▶️ directories + DB creation + port selection');
        
        const result = await runDoctor({ port: 8472, dbPath: testDb, baseDir });
        assert(result.shouldExit === false, 'no exit condition');
        assert(result.checks.database.status === 'missing', 'DB will be created');
        assert(result.port === 8472, 'port reassigned=false');
        assert(!fs.existsSync(testDb), 'doctor does not create DB itself (normal init does)');
    }

    // Cleanup
    try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch (_) {}

    // Summary
    console.log('\n=================================================\n');
    console.log('         Test Results Summary                  \n');
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}\n`);
    console.log('=================================================\n');
    
    if (testsFailed > 0) {
        process.exit(1);
    } else {
        console.log('✅ All doctor unit tests passed!');
        process.exit(0);
    }
}

runAllTests().catch(error => {
    console.error('Fatal:', error);
    process.exit(1);
});
