/**
 * G1 Chrome Adapter - Outbox bounded behavior tests
 * Covers: durable outbox capacity/eviction, tombstones, sequence numbers,
 * idempotent event identity, NOT_OBSERVE zero residue, flush semantics.
 * Pure Node, zero dependency: OutboxCore is injected with in-memory storage
 * and a fake fetch.
 */

const { OutboxCore, KEYS } = require('../seed/adapters/chrome/outbox-core');
const ULID = require('../seed/adapters/chrome/ulid');

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

/** In-memory chrome.storage.local stand-in */
function makeStorage() {
    const data = {};
    return {
        data,
        async get(keys) {
            const out = {};
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) {
                if (k in data) out[k] = JSON.parse(JSON.stringify(data[k]));
            }
            return out;
        },
        async set(obj) {
            for (const [k, v] of Object.entries(obj)) {
                data[k] = JSON.parse(JSON.stringify(v));
            }
        }
    };
}

/** fetch stub factory: behavior = 'ok' | 'down' | 'reject-batch' */
function makeFetch(behavior) {
    const calls = [];
    const fn = async (url, options = {}) => {
        calls.push({ url, options });
        if (behavior === 'down') {
            throw new TypeError('fetch failed: ECONNREFUSED');
        }
        if (behavior === 'reject-batch' && url.includes('/rpc/events/batch')) {
            return {
                ok: false, status: 400,
                json: async () => ({ jsonrpc: '2.0', error: { code: -32000, message: 'Validation failed' } })
            };
        }
        if (behavior === 'reject-batch' && url.includes('/rpc/events/ingest')) {
            const event = JSON.parse(options.body).event;
            if (event.event_type === 'bad.event') {
                return {
                    ok: false, status: 400,
                    json: async () => ({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid event' } })
                };
            }
            return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', result: { event_id: event.event_id } }) };
        }
        const body = options.body ? JSON.parse(options.body) : {};
        const count = (body.events || []).length;
        return {
            ok: true, status: 200,
            json: async () => ({ jsonrpc: '2.0', result: { inserted: count, total: count, duplicated: 0 } })
        };
    };
    fn.calls = calls;
    return fn;
}

function makeCore(fetchFn, config) {
    const storage = makeStorage();
    const core = new OutboxCore({
        storage,
        fetchFn,
        ulid: ULID,
        config: Object.assign({ OUTBOX_CAPACITY: 5, TOMBSTONE_CAPACITY: 10 }, config || {})
    });
    return { core, storage };
}

async function run() {
    console.log('\n🧪 G1 Chrome Adapter - Outbox Bounded Behavior Tests\n');

    // 1. Stable identity
    {
        console.log('📦 Test 1: stable event/source identity (idempotency)');
        const a = await ULID.stableIdFromString('dcf.source:chatgpt.com/c/x');
        const b = await ULID.stableIdFromString('dcf.source:chatgpt.com/c/x');
        const c = await ULID.stableIdFromString('dcf.source:chatgpt.com/c/y');
        assert(a === b, 'same input -> same id');
        assert(a !== c, 'different input -> different id');
        assert(ULID.isValidULID(a), 'stable id is valid 26-char ULID format');
        assert(ULID.isValidULID(ULID.generateULID()), 'generated ULID is valid');
    }

    // 2. Source registry + sequence numbers
    {
        console.log('\n📦 Test 2: source registry and per-source sequence numbers');
        const { core } = makeCore(makeFetch('down'));
        const s1 = await core.ensureSource('chatgpt.com/c/conv1');
        const s1again = await core.ensureSource('chatgpt.com/c/conv1');
        assert(s1 === s1again, 'same conversation -> same source_id');

        const r1 = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/conv1', observation_key: 'm1:sent',
            event_type: 'conversation.message.sent', payload: { text: 'a' }
        });
        const r2 = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/conv1', observation_key: 'm2:sent',
            event_type: 'conversation.message.sent', payload: { text: 'b' }
        });
        assert(r1.sequence_number === 1 && r2.sequence_number === 2, `sequence increments per source (${r1.sequence_number}, ${r2.sequence_number})`);

        const rOther = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/conv2', observation_key: 'm1:sent',
            event_type: 'conversation.message.sent', payload: { text: 'c' }
        });
        assert(rOther.sequence_number === 1, 'independent sequence for another source');
    }

    // 3. Duplicate observation absorbed
    {
        console.log('\n📦 Test 3: duplicate observation key not enqueued twice');
        const { core, storage } = makeCore(makeFetch('down'));
        const first = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/dup', observation_key: 'm1:sent',
            event_type: 'conversation.message.sent', payload: { text: 'x' }
        });
        const second = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/dup', observation_key: 'm1:sent',
            event_type: 'conversation.message.sent', payload: { text: 'x' }
        });
        assert(first.enqueued === true, 'first observation enqueued');
        assert(second.enqueued === false && second.reason === 'duplicate_observation', 'duplicate rejected locally');
        assert((storage.data[KEYS.OUTBOX] || []).length === 1, 'outbox holds exactly one copy');
    }

    // 4. NOT_OBSERVE => content zero residue
    {
        console.log('\n📦 Test 4: NOT_OBSERVE boundary -> content zero residue');
        const { core, storage } = makeCore(makeFetch('down'));
        const sourceId = await core.ensureSource('chatgpt.com/c/private');
        await core.setBoundary(sourceId, 'NOT_OBSERVE');
        const res = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/private', observation_key: 'm1:sent',
            event_type: 'conversation.message.sent', payload: { text: 'SECRET-CONTENT' }
        });
        assert(res.enqueued === false && res.reason === 'boundary_not_observe', 'observation dropped');
        const residue = JSON.stringify(storage.data).includes('SECRET-CONTENT');
        assert(!residue, 'no content residue anywhere in storage');
    }

    // 5. Bounded outbox: oldest-first eviction with tombstones
    {
        console.log('\n📦 Test 5: bounded outbox eviction (capacity 5)');
        const { core, storage } = makeCore(makeFetch('down'));
        for (let i = 1; i <= 7; i++) {
            await core.recordObservation({
                conversation_key: 'chatgpt.com/c/full', observation_key: 'm' + i,
                event_type: 'conversation.message.sent', payload: { n: i }
            });
        }
        const outbox = storage.data[KEYS.OUTBOX];
        const tombstones = storage.data[KEYS.TOMBSTONES];
        assert(outbox.length === 5, `outbox bounded at capacity (${outbox.length})`);
        assert(tombstones.length === 2, `evicted events tombstoned (${tombstones.length})`);
        assert(tombstones[0].sequence_number === 1 && tombstones[1].sequence_number === 2, 'oldest-first eviction');
        assert(tombstones[0].reason === 'evicted_capacity', 'eviction reason recorded honestly');
        const seqs = outbox.map(e => e.sequence_number);
        assert(JSON.stringify(seqs) === JSON.stringify([3, 4, 5, 6, 7]), 'remaining events keep original sequence (gap 1-2 visible downstream)');
    }

    // 6. Tombstone cap
    {
        console.log('\n📦 Test 6: tombstone list bounded (cap 10)');
        const { core, storage } = makeCore(makeFetch('down'), { OUTBOX_CAPACITY: 2, TOMBSTONE_CAPACITY: 10 });
        for (let i = 1; i <= 20; i++) {
            await core.recordObservation({
                conversation_key: 'chatgpt.com/c/tomb', observation_key: 't' + i,
                event_type: 'conversation.message.sent', payload: { n: i }
            });
        }
        assert(storage.data[KEYS.TOMBSTONES].length === 10, `tombstones capped (${storage.data[KEYS.TOMBSTONES].length})`);
    }

    // 7. Flush success removes delivered events; request shape matches contract
    {
        console.log('\n📦 Test 7: flush success path');
        const fetchOk = makeFetch('ok');
        const { core, storage } = makeCore(fetchOk);
        await core.recordObservation({
            conversation_key: 'chatgpt.com/c/ok', observation_key: 'm1',
            event_type: 'conversation.message.sent', payload: { text: 'hi' }
        });
        const report = await core.flush();
        assert(report.delivered === 1 && report.pending === 0, `flush delivered (${JSON.stringify(report)})`);
        assert((storage.data[KEYS.OUTBOX] || []).length === 0, 'outbox emptied after confirmation');
        const batchCall = fetchOk.calls.find(c => c.url.includes('/rpc/events/batch'));
        const body = JSON.parse(batchCall.options.body);
        assert(Array.isArray(body.events), 'batch body uses {events: [...]} contract');
        assert(typeof body.events[0].payload_json === 'object', 'payload_json sent as object (companion validator contract)');
        assert(Number.isInteger(body.events[0].sequence_number), 'sequence_number field name matches companion schema');
    }

    // 8. Companion unreachable: honest failure, events retained
    {
        console.log('\n📦 Test 8: companion unreachable -> events stay + failure recorded');
        const { core, storage } = makeCore(makeFetch('down'));
        const rec = await core.recordObservation({
            conversation_key: 'chatgpt.com/c/down', observation_key: 'm1',
            event_type: 'conversation.message.sent', payload: { text: 'hi' }
        });
        const report = await core.flush();
        assert(report.delivered === 0 && report.pending === 1, 'nothing delivered, event retained');
        const failures = storage.data[KEYS.FAILURES];
        assert(failures.length === 1, 'delivery failure recorded');
        assert(failures[0].failure_event_id === rec.event_id, 'failure_event_id recorded honestly');
        assert(failures[0].error.includes('ECONNREFUSED'), 'error cause preserved');
    }

    // 9. Batch rejection -> per-event fallback, poison event tombstoned
    {
        console.log('\n📦 Test 9: batch 400 -> per-event fallback');
        const { core, storage } = makeCore(makeFetch('reject-batch'));
        await core.recordObservation({
            conversation_key: 'chatgpt.com/c/mix', observation_key: 'good1',
            event_type: 'conversation.message.sent', payload: { text: 'ok' }
        });
        await core.recordObservation({
            conversation_key: 'chatgpt.com/c/mix', observation_key: 'bad1',
            event_type: 'bad.event', payload: { text: 'poison' }
        });
        const report = await core.flush();
        assert(report.delivered === 1 && report.rejected === 1, `fallback splits good/bad (${JSON.stringify(report)})`);
        assert((storage.data[KEYS.OUTBOX] || []).length === 0, 'poison event no longer blocks queue');
        const rejected = storage.data[KEYS.TOMBSTONES].find(t => String(t.reason).startsWith('rejected'));
        assert(rejected !== undefined, 'rejected event tombstoned with reason');
    }

    // 10. Flush retry after recovery delivers retained events
    {
        console.log('\n📦 Test 10: retry after companion recovery');
        const storage = makeStorage();
        let down = true;
        const fn = async (url, options) => {
            if (down) throw new TypeError('fetch failed');
            const body = options && options.body ? JSON.parse(options.body) : {};
            const count = (body.events || []).length;
            return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', result: { inserted: count, total: count, duplicated: 0 } }) };
        };
        const core = new OutboxCore({ storage, fetchFn: fn, ulid: ULID });
        await core.recordObservation({
            conversation_key: 'chatgpt.com/c/retry', observation_key: 'm1',
            event_type: 'conversation.message.sent', payload: { text: 'later' }
        });
        const r1 = await core.flush();
        assert(r1.pending === 1, 'retained while down');
        down = false;
        const r2 = await core.flush();
        assert(r2.delivered === 1 && r2.pending === 0, 'delivered after recovery');
    }

    console.log('\n=================================================');
    console.log(`Tests passed: ${testsPassed}, failed: ${testsFailed}`);
    console.log('=================================================\n');
    process.exit(testsFailed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
