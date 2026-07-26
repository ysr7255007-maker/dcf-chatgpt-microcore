#!/usr/bin/env node
/**
 * G1 Red-Line Tests — 三条红线验收
 *
 * 1. 内容零残留：NOT_OBSERVE 边界下正文不得出现在 DB / storage / 日志
 * 2. 缺口如实性：断连/崩溃后系统不假装完整（sequence gap visible）
 * 3. outbox 非权威性：companion 恢复后事实唯一、无重复、副本清除、顺序保持
 *
 * 运行: node seed/tests/g1-redline.test.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { CompanionDB } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { generateULID } = require('../companion/ulid');

// OutboxCore is UMD — require() gives module.exports
const { OutboxCore, KEYS } = require('../adapters/chrome/outbox-core');

// ───────────────────────────────────────────────────────────
// Test Framework (minimal, zero dep)
// ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; failures.push(msg); console.log(`  ❌ FAIL: ${msg}`); }
}
function assertEqual(actual, expected, msg) {
    const ok = actual === expected;
    if (!ok) {
        const detail = `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        failed++; failures.push(detail); console.log(`  ❌ FAIL: ${detail}`);
    } else { passed++; }
}

// ───────────────────────────────────────────────────────────
// In-memory storage shim for OutboxCore (mimics chrome.storage.local)
// ───────────────────────────────────────────────────────────
function createMemStorage() {
    const store = {};
    return {
        get(keys) {
            const result = {};
            for (const k of keys) { result[k] = store[k]; }
            return Promise.resolve(result);
        },
        set(obj) {
            Object.assign(store, obj);
            return Promise.resolve();
        },
        _raw: store
    };
}

// ULID shim (deterministic from string)
const ulidShim = {
    stableIdFromString(input) {
        const hash = crypto.createHash('sha256').update(input).digest('hex');
        // return 26-char Base32 Crockford from the first 130 bits
        const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        let id = '';
        for (let i = 0; i < 26; i++) {
            const nibble = parseInt(hash.substring(i * 2, i * 2 + 2), 16) % 32;
            id += chars[nibble];
        }
        return Promise.resolve(id);
    }
};

// ───────────────────────────────────────────────────────────
// Red Line 1: 内容零残留
// ───────────────────────────────────────────────────────────
async function testContentZeroResidue() {
    console.log('\n═══════════════════════════════════════════');
    console.log('  RED LINE 1: 内容零残留 (Content Zero Residue)');
    console.log('═══════════════════════════════════════════\n');

    const MARKER = 'UNIQUE_SECRET_CANARY_2026_' + crypto.randomBytes(8).toString('hex');
    const dbPath = '/tmp/g1-redline-residue-' + Date.now() + '.db';

    // --- Test 1a: Companion rejects content when NOT_OBSERVE ---
    console.log('  📦 1a: Companion rejects content events when boundary=NOT_OBSERVE');
    {
        const db = new CompanionDB(dbPath);
        await db.initialize();
        const proc = new EventProcessor(db);

        const sourceId = generateULID();

        // Set boundary to NOT_OBSERVE
        proc.setBoundary({
            source_id: sourceId,
            scope: `OBSERVE_CURRENT_ONLY:${sourceId}`,
            boundary_state: 'NOT_OBSERVE',
            inherited_from_event_ids: []
        });

        // Attempt to ingest an event with content (text in payload)
        const result = await proc.ingestEvent({
            event_id: generateULID(),
            source_id: sourceId,
            event_type: 'conversation.message.sent',
            payload_json: { text: MARKER, role: 'user' }
        });

        assert(!result.success || result.error,
            '1a: event with content should be rejected under NOT_OBSERVE');

        // Verify marker not in DB file
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath);
            assert(!raw.includes(MARKER),
                '1a: marker string must not appear in SQLite DB file');
        } else {
            passed++; // DB not even created = no residue
        }
        db.close();
    }

    // --- Test 1b: Outbox drops observation when boundary=NOT_OBSERVE ---
    console.log('  📦 1b: Outbox drops observation when boundary=NOT_OBSERVE');
    {
        const storage = createMemStorage();
        const outbox = new OutboxCore({ storage, fetchFn: () => {}, ulid: ulidShim });

        // Set NOT_OBSERVE for the source
        const sourceId = await ulidShim.stableIdFromString('dcf.source:test-convo');
        await outbox.setBoundary(sourceId, 'NOT_OBSERVE');

        const result = await outbox.recordObservation({
            conversation_key: 'test-convo',
            observation_key: 'msg1:sent',
            event_type: 'conversation.message.sent',
            payload: { text: MARKER, role: 'user' }
        });

        assertEqual(result.enqueued, false, '1b: observation must not be enqueued');
        assertEqual(result.reason, 'boundary_not_observe', '1b: reason should be boundary_not_observe');

        // Full scan of storage: marker must not appear anywhere
        const dump = JSON.stringify(storage._raw);
        assert(!dump.includes(MARKER),
            '1b: marker must not appear in chrome.storage serialization');
    }

    // --- Test 1c: OBSERVE_CURRENT_ONLY allows events (positive control) ---
    console.log('  📦 1c: OBSERVE_CURRENT_ONLY allows observation (positive control)');
    {
        const storage = createMemStorage();
        const outbox = new OutboxCore({ storage, fetchFn: () => {}, ulid: ulidShim });

        const result = await outbox.recordObservation({
            conversation_key: 'convo-allowed',
            observation_key: 'msg2:sent',
            event_type: 'conversation.message.sent',
            payload: { text: 'hello from user', role: 'user' }
        });

        assertEqual(result.enqueued, true, '1c: observation enqueued under default boundary');
        assert(result.event_id && result.event_id.length === 26, '1c: event_id is ULID');
    }

    // Cleanup temp DB
    try { fs.unlinkSync(dbPath); } catch (e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
}

// ───────────────────────────────────────────────────────────
// Red Line 2: 缺口如实性
// ───────────────────────────────────────────────────────────
async function testGapHonesty() {
    console.log('\n═══════════════════════════════════════════');
    console.log('  RED LINE 2: 缺口如实性 (Gap Honesty)');
    console.log('═══════════════════════════════════════════\n');

    const dbPath = '/tmp/g1-redline-gap-' + Date.now() + '.db';

    // --- Test 2a: Sequence gap is visible in query results ---
    console.log('  📦 2a: Sequence gap visible after simulated disconnect');
    {
        const db = new CompanionDB(dbPath);
        await db.initialize();
        const proc = new EventProcessor(db);
        const sourceId = generateULID();

        // Insert events with seq 1, 2, 4, 5 (missing 3 = simulated crash)
        for (const seq of [1, 2, 4, 5]) {
            await proc.ingestEvent({
                event_id: generateULID(),
                source_id: sourceId,
                event_type: 'conversation.message.sent',
                payload_json: { seq },
                sequence_number: seq
            });
        }

        const result = proc.queryEventsBySource(sourceId, { orderBy: 'ASC' });
        assert(result.success, '2a: query succeeds');
        const seqs = result.events.map(e => e.sequence_number);

        // System must NOT fabricate seq 3
        assert(!seqs.includes(3), '2a: missing seq 3 is not fabricated');
        // System must expose the gap: 1,2,4,5
        assertEqual(seqs.length, 4, '2a: only 4 events stored (gap honest)');

        // Detect gap algorithmically (sequential scan for monotonicity breaks)
        let gaps = [];
        for (let i = 1; i < seqs.length; i++) {
            if (seqs[i] - seqs[i - 1] > 1) {
                gaps.push({ after: seqs[i - 1], before: seqs[i] });
            }
        }
        assert(gaps.length === 1 && gaps[0].after === 2 && gaps[0].before === 4,
            '2a: gap between seq 2 and 4 is detectable');

        db.close();
    }

    // --- Test 2b: Outbox tombstones track evicted events honestly ---
    console.log('  📦 2b: Outbox tombstones record evictions honestly');
    {
        const storage = createMemStorage();
        const outbox = new OutboxCore({
            storage,
            fetchFn: () => { throw new Error('companion unreachable'); },
            ulid: ulidShim,
            config: { OUTBOX_CAPACITY: 3 } // small capacity to force eviction
        });

        // Push 5 events into cap-3 outbox without flush
        for (let i = 1; i <= 5; i++) {
            await outbox.recordObservation({
                conversation_key: 'gap-convo',
                observation_key: `msg${i}:sent`,
                event_type: 'conversation.message.sent',
                payload: { idx: i }
            });
        }

        const stats = await outbox.getStats();
        // Outbox should contain at most 3 events (last 3)
        assert(stats.outbox_size <= 3,
            `2b: outbox bounded to capacity (size=${stats.outbox_size})`);
        // Tombstones should record evicted events
        assert(stats.tombstone_count >= 2,
            `2b: tombstones record evictions (count=${stats.tombstone_count})`);
        // Every tombstone has reason
        const allHaveReason = stats.tombstones.every(t => t.reason && t.reason.includes('evicted'));
        assert(allHaveReason, '2b: tombstones carry eviction reason');
    }

    // --- Test 2c: Companion down → failure recorded, not silenced ---
    console.log('  📦 2c: Network failure recorded, never silenced as success');
    {
        const storage = createMemStorage();
        let fetchCalls = 0;
        const failFetch = () => { fetchCalls++; return Promise.reject(new Error('ECONNREFUSED')); };

        const outbox = new OutboxCore({ storage, fetchFn: failFetch, ulid: ulidShim });
        await outbox.recordObservation({
            conversation_key: 'fail-convo',
            observation_key: 'failmsg:sent',
            event_type: 'conversation.message.sent',
            payload: { text: 'hi' }
        });

        const report = await outbox.flush();
        assert(report.delivered === 0, '2c: delivered=0 when companion down');
        assert(report.pending > 0, '2c: events still pending');
        assert(report.failure && report.failure.includes('ECONNREFUSED'),
            '2c: failure reason preserved');

        const stats = await outbox.getStats();
        assert(stats.delivery_failures.length > 0, '2c: failure log not empty');
        assert(stats.delivery_failures[0].error.includes('ECONNREFUSED'),
            '2c: failure cause in log');
    }

    try { fs.unlinkSync(dbPath); } catch (e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
}

// ───────────────────────────────────────────────────────────
// Red Line 3: outbox 非权威性
// ───────────────────────────────────────────────────────────
async function testOutboxNonAuthority() {
    console.log('\n═══════════════════════════════════════════');
    console.log('  RED LINE 3: outbox 非权威性 (Outbox Non-Authority)');
    console.log('═══════════════════════════════════════════\n');

    const dbPath = '/tmp/g1-redline-authority-' + Date.now() + '.db';

    // --- Test 3a: No duplicate event_id in companion after retry ---
    console.log('  📦 3a: Companion idempotent — duplicate event_id absorbed');
    {
        const db = new CompanionDB(dbPath);
        await db.initialize();
        const proc = new EventProcessor(db);
        const sourceId = generateULID();
        const eventId = generateULID();

        const r1 = await proc.ingestEvent({
            event_id: eventId,
            source_id: sourceId,
            event_type: 'conversation.message.sent',
            payload_json: { text: 'first' },
            sequence_number: 1
        });
        const r2 = await proc.ingestEvent({
            event_id: eventId,
            source_id: sourceId,
            event_type: 'conversation.message.sent',
            payload_json: { text: 'first' },
            sequence_number: 1
        });

        assert(r1.success && !r1.duplicated, '3a: first ingest succeeds');
        assert(r2.success && r2.duplicated, '3a: second ingest marked duplicated');

        // Query must return exactly 1
        const q = proc.queryEventsBySource(sourceId);
        assertEqual(q.events.length, 1, '3a: only 1 event in DB (no physical dup)');

        db.close();
    }

    // --- Test 3b: Outbox cleared after confirmed delivery ---
    console.log('  📦 3b: Outbox cleared after companion confirms custody');
    {
        const storage = createMemStorage();
        let batchResponse = { ok: true, json: () => Promise.resolve({ result: { inserted: 2, duplicated: 0 } }) };
        const mockFetch = (url, opts) => {
            if (opts && opts.method === 'POST') return Promise.resolve(batchResponse);
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { events: [] } }) });
        };

        const outbox = new OutboxCore({ storage, fetchFn: mockFetch, ulid: ulidShim });

        await outbox.recordObservation({
            conversation_key: 'clear-convo',
            observation_key: 'a:sent',
            event_type: 'conversation.message.sent',
            payload: { text: 'a' }
        });
        await outbox.recordObservation({
            conversation_key: 'clear-convo',
            observation_key: 'b:sent',
            event_type: 'conversation.message.sent',
            payload: { text: 'b' }
        });

        const before = await outbox.getStats();
        assertEqual(before.outbox_size, 2, '3b: 2 events pending before flush');

        const report = await outbox.flush();
        assertEqual(report.delivered, 2, '3b: 2 events delivered');

        const after = await outbox.getStats();
        assertEqual(after.outbox_size, 0, '3b: outbox empty after confirmed delivery');
    }

    // --- Test 3c: Sequence numbers monotonically increasing per source ---
    console.log('  📦 3c: Sequence numbers monotonic per source');
    {
        const storage = createMemStorage();
        const outbox = new OutboxCore({ storage, fetchFn: () => { throw new Error('no'); }, ulid: ulidShim });

        const seqNums = [];
        for (let i = 1; i <= 5; i++) {
            const res = await outbox.recordObservation({
                conversation_key: 'seq-convo',
                observation_key: `seqmsg${i}:sent`,
                event_type: 'conversation.message.sent',
                payload: { n: i }
            });
            seqNums.push(res.sequence_number);
        }

        // Must be strictly increasing
        let monotonic = true;
        for (let i = 1; i < seqNums.length; i++) {
            if (seqNums[i] <= seqNums[i - 1]) { monotonic = false; break; }
        }
        assert(monotonic, `3c: sequence numbers strictly increasing: [${seqNums}]`);
        // Must start at 1
        assertEqual(seqNums[0], 1, '3c: first sequence number is 1');
    }

    // --- Test 3d: Duplicate observation_key NOT re-enqueued ---
    console.log('  📦 3d: Duplicate observation deduped locally');
    {
        const storage = createMemStorage();
        const outbox = new OutboxCore({ storage, fetchFn: () => { throw new Error('no'); }, ulid: ulidShim });

        const r1 = await outbox.recordObservation({
            conversation_key: 'dup-convo',
            observation_key: 'same:sent',
            event_type: 'conversation.message.sent',
            payload: { text: 'hello' }
        });
        const r2 = await outbox.recordObservation({
            conversation_key: 'dup-convo',
            observation_key: 'same:sent',
            event_type: 'conversation.message.sent',
            payload: { text: 'hello' }
        });

        assert(r1.enqueued === true, '3d: first enqueue succeeds');
        assert(r2.enqueued === false && r2.reason === 'duplicate_observation',
            '3d: duplicate observation rejected locally');

        const stats = await outbox.getStats();
        assertEqual(stats.outbox_size, 1, '3d: only 1 event in outbox');
    }

    // --- Test 3e: Full flush + retry cycle preserves ordering ---
    console.log('  📦 3e: Flush → down → retry preserves event ordering');
    {
        const storage = createMemStorage();
        let callIndex = 0;
        const responses = [
            // First flush: network error
            () => Promise.reject(new Error('ECONNREFUSED')),
            // Second flush: success
            () => Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { inserted: 3, duplicated: 0 } }) })
        ];
        const mockFetch = (url, opts) => {
            const fn = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return fn();
        };

        const outbox = new OutboxCore({ storage, fetchFn: mockFetch, ulid: ulidShim });

        for (let i = 1; i <= 3; i++) {
            await outbox.recordObservation({
                conversation_key: 'order-convo',
                observation_key: `order${i}:sent`,
                event_type: 'conversation.message.sent',
                payload: { n: i }
            });
        }

        // First flush fails
        const r1 = await outbox.flush();
        assert(r1.delivered === 0, '3e: first flush fails');
        const mid = await outbox.getStats();
        assertEqual(mid.outbox_size, 3, '3e: events retained after failure');

        // Second flush succeeds
        const r2 = await outbox.flush();
        assertEqual(r2.delivered, 3, '3e: all events delivered on retry');
        const after = await outbox.getStats();
        assertEqual(after.outbox_size, 0, '3e: outbox empty after successful retry');
    }

    try { fs.unlinkSync(dbPath); } catch (e) {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
}

// ───────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────
async function main() {
    console.log('\n🔴 G1 Red-Line Acceptance Tests\n');

    await testContentZeroResidue();
    await testGapHonesty();
    await testOutboxNonAuthority();

    console.log('\n═══════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    if (failures.length > 0) {
        console.log('\n  Failures:');
        failures.forEach(f => console.log(`    • ${f}`));
    }
    console.log('═══════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
