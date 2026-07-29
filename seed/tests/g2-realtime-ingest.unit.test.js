#!/usr/bin/env node
/**
 * G2 Real-Time Ingest Unit Tests — 新对话实时采集验收
 *
 * Runs in Node without dependencies (offline).
 * Focus (per leader C1-C4 correction):
 *   (a) every newly opened conversation establishes a first baseline
 *       (content-free: message ids only, never text);
 *   (b) delivery cursor persisted on the adapter side (per-source highest
 *       sequence confirmed delivered to companion);
 *   (c) when continuity cannot be proven, a content-free gap event with
 *       explicit missing_sequence_ids is synthesized into the batch;
 *   (+) first_observed_at / freshness retained as supplementary info only —
 *       baseline membership is the primary old/new discriminator;
 *   (+) G1 red lines stay intact (NOT_OBSERVE zero residue re-checked here,
 *       full g1-redline.test.js must stay green separately).
 */

const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const { OutboxCore } = require('../adapters/chrome/outbox-core.js');

// ──────────────────────────────────────────────────────
// Shared utilities
// ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; failures.push(msg); console.log(`  ❌ FAIL: ${msg}`); }
}
function assertEqual(actual, expected, msg) {
    if (actual === expected) { passed++; }
    else {
        const detail = `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        failed++; failures.push(detail); console.log(`  ❌ FAIL: ${detail}`);
    }
}

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

// Same deterministic ULID shim as g1-redline.test.js
const ulidShim = {
    stableIdFromString(input) {
        const hash = crypto.createHash('sha256').update(input).digest('hex');
        const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        let id = '';
        for (let i = 0; i < 26; i++) {
            const nibble = parseInt(hash.substring(i * 2, i * 2 + 2), 16) % 32;
            id += chars[nibble];
        }
        return Promise.resolve(id);
    }
};

const tick = () => new Promise((r) => setImmediate(r));

// ──────────────────────────────────────────────────────
// Content script harness (vm sandbox around content.js)
// ──────────────────────────────────────────────────────
function makeNode(role, id, text) {
    return {
        getAttribute(name) {
            if (name === 'data-message-author-role') return role;
            if (name === 'data-message-id') return id;
            return null;
        },
        textContent: text
    };
}

function createContentHarness(opts = {}) {
    const sent = [];
    const loc = { host: 'chatgpt.com', pathname: opts.pathname || '/c/conv-1' };
    let nodes = opts.nodes || [];
    let boundary = opts.boundary || 'OBSERVE_CURRENT_ONLY';
    const intervals = [];

    const ctx = vm.createContext({
        location: loc,
        document: {
            querySelectorAll: () => nodes.slice(),
            documentElement: {}
        },
        MutationObserver: class { observe() {} disconnect() {} },
        setInterval: (fn) => { intervals.push(fn); return intervals.length; },
        setTimeout: () => 0,
        console: { log: () => {} },
        Date: Date,
        chrome: {
            runtime: {
                lastError: null,
                sendMessage: (msg, cb) => {
                    sent.push(msg);
                    if (!cb) return;
                    if (msg.type === 'dcf.get_boundary') cb({ boundary_state: boundary });
                    else cb({ enqueued: true, sequence_number: sent.length, event_id: 'A'.repeat(26) });
                }
            }
        }
    });

    const contentCode = fs.readFileSync(require.resolve('../adapters/chrome/content.js'), 'utf-8');
    vm.runInNewContext(contentCode, ctx);

    return {
        // first setInterval registered by content.js is scan()
        scan: () => intervals[0](),
        setNodes: (n) => { nodes = n; },
        setPath: (p) => { loc.pathname = p; },
        setBoundary: (b) => { boundary = b; },
        observations: () => sent.filter((m) => m.type === 'dcf.observation'),
        allSent: () => sent.slice()
    };
}

// ──────────────────────────────────────────────────────
// Background worker harness (vm sandbox around background.js)
// ──────────────────────────────────────────────────────
function createBgHarness(storage, fetchMock = null) {
    const messageHandlers = {};
    const alarms = [];
    let postCount = 0;
    const batchContents = [];

    if (!fetchMock) {
        fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { inserted: 1, duplicated: 0 } }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { events: [] } }) });
        };
    }
    const innerFetch = fetchMock;
    const trackingFetch = (url, opts) => {
        if (opts && opts.method === 'POST' && String(url).includes('/rpc/events/batch')) {
            postCount++;
            try {
                const parsed = JSON.parse(opts.body);
                batchContents.push(parsed.events || []);
            } catch (e) {}
        }
        return innerFetch(url, opts);
    };

    const context = vm.createContext({
        chrome: {
            runtime: {
                onInstalled: { addListener: () => {} },
                onStartup: { addListener: () => {} },
                onMessage: { addListener: (h) => { messageHandlers.onMessage = h; } },
                sendMessage: () => {},
                lastError: null
            },
            storage: {
                local: {
                    get: (keys) => {
                        const result = {};
                        for (const k of keys) result[k] = storage._raw[k];
                        return Promise.resolve(result);
                    },
                    set: (obj) => {
                        Object.assign(storage._raw, obj);
                        return Promise.resolve();
                    }
                }
            },
            alarms: {
                onAlarm: { addListener: (h) => alarms.push(h) },
                get: (name, cb) => cb(null),
                create: () => {}
            }
        },
        importScripts: () => {},
        console: { log: () => {}, warn: () => {}, error: () => {} },
        fetch: (...args) => trackingFetch(...args),
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        TextEncoder: TextEncoder,
        crypto: require('crypto').webcrypto,
        Date: global.Date
    });

    const ulidCode = fs.readFileSync(require.resolve('../adapters/chrome/ulid.js'), 'utf-8');
    const outboxCode = fs.readFileSync(require.resolve('../adapters/chrome/outbox-core.js'), 'utf-8');
    const bgCode = fs.readFileSync(require.resolve('../adapters/chrome/background.js'), 'utf-8');
    vm.runInNewContext(ulidCode, context);
    vm.runInNewContext(outboxCode, context);
    vm.runInNewContext(bgCode, context);

    return {
        dispatchObservation: (data) => new Promise((resolve) => {
            messageHandlers.onMessage({ type: 'dcf.observation', ...data }, {}, resolve);
        }),
        simulateAlarm: async () => {
            // alarm listener is fire-and-forget; give the flush time to finish
            for (const al of alarms) al({ name: 'dcf-outbox-flush' });
            await new Promise((r) => setTimeout(r, 50));
        },
        getPostCount: () => postCount,
        getBatchContents: () => batchContents.slice()
    };
}

// ──────────────────────────────────────────────────────
// Test 1: opening a new conversation establishes a baseline
// ──────────────────────────────────────────────────────
async function test1_newConversationEstablishesBaseline() {
    console.log('\n🧪 Test 1: New conversation establishes a content-free baseline first');

    const preExisting = [
        makeNode('user', 'old-u1', 'old question'),
        makeNode('assistant', 'old-a1', 'old answer')
    ];
    const h = createContentHarness({ nodes: preExisting, pathname: '/c/conv-1' });
    await tick(); // let the initial refreshBoundary settle

    h.scan();
    await tick();

    const obs1 = h.observations();
    assert(obs1.length >= 1, 'Test 1a: first scan emits at least the baseline observation');
    const baseline = obs1[0];
    assertEqual(baseline.event_type, 'conversation.baseline.established',
        'Test 1b: baseline event is the FIRST observation of the conversation');
    assertEqual(baseline.observation_key, 'chatgpt.com/c/conv-1:baseline',
        'Test 1c: baseline observation_key derived from conversation key');
    assert(Array.isArray(baseline.payload.message_ids)
        && baseline.payload.message_ids.includes('old-u1')
        && baseline.payload.message_ids.includes('old-a1'),
        'Test 1d: baseline lists pre-existing message ids');
    assertEqual(baseline.payload.message_count, 2, 'Test 1e: baseline message_count correct');
    assert(!('text' in baseline.payload),
        'Test 1f: baseline is content-free (no text field)');
    assert(!JSON.stringify(baseline.payload).includes('old question'),
        'Test 1g: baseline carries no message content');
    assertEqual(baseline.payload.conversation_id, 'conv-1',
        'Test 1h: baseline binds platform conversation id');

    // Pre-existing messages become stable and are reported with
    // baseline_member=true; a live message arriving later is not a member.
    h.scan(); h.scan(); // reach STABLE_SCANS_REQUIRED
    await tick();
    const oldReport = h.observations().find((o) => o.payload && o.payload.message_id === 'old-u1');
    assert(oldReport && oldReport.payload.baseline_member === true,
        'Test 1i: pre-existing message reported with baseline_member=true');

    h.setNodes(preExisting.concat([makeNode('assistant', 'live-a2', 'fresh reply')]));
    h.scan(); h.scan(); h.scan();
    await tick();
    const liveReport = h.observations().find((o) => o.payload && o.payload.message_id === 'live-a2');
    assert(liveReport && liveReport.payload.baseline_member === false,
        'Test 1j: live message reported with baseline_member=false');
    assert(liveReport && typeof liveReport.payload.first_observed_at === 'string',
        'Test 1k: first_observed_at kept as supplementary info');
    assertEqual(liveReport && liveReport.payload.freshness, 'fresh',
        'Test 1l: freshness kept as supplementary info (fresh within window)');
}

// ──────────────────────────────────────────────────────
// Test 2: navigating to another conversation re-baselines
// ──────────────────────────────────────────────────────
async function test2_navigationRebaselines() {
    console.log('\n🧪 Test 2: Navigation to another conversation re-establishes the baseline');

    const h = createContentHarness({
        nodes: [makeNode('user', 'c1-u1', 'hello one')],
        pathname: '/c/conv-1'
    });
    await tick();
    h.scan();
    await tick();
    assertEqual(h.observations().filter((o) => o.event_type === 'conversation.baseline.established').length,
        1, 'Test 2a: first conversation gets one baseline');

    // SPA navigation to a different conversation
    h.setPath('/c/conv-2');
    h.setNodes([makeNode('user', 'c2-u1', 'hello two')]);
    h.scan(); // detects navigation, resets tracking
    h.scan(); // first scan of the new conversation -> new baseline
    await tick();

    const baselines = h.observations().filter((o) => o.event_type === 'conversation.baseline.established');
    assertEqual(baselines.length, 2, 'Test 2b: new conversation gets its own baseline');
    assertEqual(baselines[1].observation_key, 'chatgpt.com/c/conv-2:baseline',
        'Test 2c: second baseline keyed to the new conversation');
    assert(baselines[1].payload.message_ids.includes('c2-u1'),
        'Test 2d: second baseline lists the new conversation ids');
}

// ──────────────────────────────────────────────────────
// Test 3: delivery cursor persisted and advanced on confirmed delivery
// ──────────────────────────────────────────────────────
async function test3_deliveryCursorPersistence() {
    console.log('\n🧪 Test 3: Delivery cursor persisted per source, advanced only on confirmed delivery');

    const storage = createMemStorage();
    const okFetch = (url, opts) => {
        if (opts && opts.method === 'POST') {
            const body = JSON.parse(opts.body);
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { inserted: body.events.length, duplicated: 0 } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { events: [] } }) });
    };
    const outbox = new OutboxCore({ storage, fetchFn: okFetch, ulid: ulidShim });
    const sourceId = await outbox.ensureSource('cursor-convo');

    await outbox.recordObservation({
        conversation_key: 'cursor-convo', observation_key: 'm1:sent',
        event_type: 'conversation.message.sent', payload: { text: 'one' }
    });
    await outbox.recordObservation({
        conversation_key: 'cursor-convo', observation_key: 'm2:sent',
        event_type: 'conversation.message.sent', payload: { text: 'two' }
    });

    const before = await outbox.getDeliveryCursors();
    assertEqual(before[sourceId], undefined, 'Test 3a: cursor absent before any confirmed delivery');

    const report = await outbox.flush();
    assertEqual(report.delivered, 2, 'Test 3b: both events delivered');
    const after = await outbox.getDeliveryCursors();
    assertEqual(after[sourceId], 2, 'Test 3c: cursor advanced to highest confirmed sequence');

    // Cursor survives a "service worker restart" (new core, same storage)
    const outbox2 = new OutboxCore({ storage, fetchFn: okFetch, ulid: ulidShim });
    const persisted = await outbox2.getDeliveryCursors();
    assertEqual(persisted[sourceId], 2, 'Test 3d: cursor persisted across core restart');

    const stats = await outbox2.getStats();
    assertEqual(stats.delivery_cursors[sourceId], 2, 'Test 3e: cursor visible in getStats');

    // Failed delivery must NOT advance the cursor
    const failCore = new OutboxCore({
        storage, ulid: ulidShim,
        fetchFn: () => Promise.reject(new Error('ECONNREFUSED'))
    });
    await failCore.recordObservation({
        conversation_key: 'cursor-convo', observation_key: 'm3:sent',
        event_type: 'conversation.message.sent', payload: { text: 'three' }
    });
    const failReport = await failCore.flush();
    assertEqual(failReport.delivered, 0, 'Test 3f: flush fails while companion down');
    const unchanged = await failCore.getDeliveryCursors();
    assertEqual(unchanged[sourceId], 2, 'Test 3g: cursor NOT advanced on failed delivery');
}

// ──────────────────────────────────────────────────────
// Test 4: honest gap synthesis when continuity cannot be proven
// ──────────────────────────────────────────────────────
async function test4_gapSynthesisWhenContinuityUnproven() {
    console.log('\n🧪 Test 4: Content-free gap event with missing_sequence_ids when continuity unproven');

    const storage = createMemStorage();
    const capturedBatches = [];
    let failFirst = true;
    const fetchFn = (url, opts) => {
        if (opts && opts.method === 'POST') {
            const body = JSON.parse(opts.body);
            capturedBatches.push(body.events);
            if (failFirst) {
                failFirst = false;
                return Promise.reject(new Error('ECONNREFUSED'));
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { inserted: body.events.length, duplicated: 0 } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { events: [] } }) });
    };
    const outbox = new OutboxCore({
        storage, fetchFn, ulid: ulidShim,
        config: { OUTBOX_CAPACITY: 3 } // force eviction => seq 1,2 lost pre-delivery
    });
    const sourceId = await outbox.ensureSource('gap-convo');

    for (let i = 1; i <= 5; i++) {
        await outbox.recordObservation({
            conversation_key: 'gap-convo', observation_key: `g${i}:sent`,
            event_type: 'conversation.message.sent', payload: { text: 'msg ' + i }
        });
    }
    const stats = await outbox.getStats();
    assertEqual(stats.outbox_size, 3, 'Test 4a: outbox bounded, oldest evicted to tombstones');
    assert(stats.tombstone_count >= 2, 'Test 4b: evictions honestly tombstoned');

    // First flush fails at network level: gap event built but nothing delivered
    const r1 = await outbox.flush();
    assertEqual(r1.delivered, 0, 'Test 4c: first flush fails honestly');
    const gap1 = capturedBatches[0].find((e) => e.event_type === 'conversation.gap.detected');
    assert(!!gap1, 'Test 4d: batch carries synthesized gap event');
    assert(gap1 && JSON.stringify(gap1.payload_json.missing_sequence_ids) === '[1,2]',
        'Test 4e: missing_sequence_ids lists exactly the unprovable sequences');
    assertEqual(gap1 && gap1.payload_json.reason, 'continuity_unproven',
        'Test 4f: gap reason is continuity_unproven');
    assert(gap1 && !JSON.stringify(gap1.payload_json).includes('msg '),
        'Test 4g: gap event is content-free (no message text)');
    assert(gap1 && gap1.event_id && gap1.event_id.length === 26,
        'Test 4h: gap event_id is ULID-format');

    // Retry succeeds: same gap event_id resent (idempotent absorption)
    const r2 = await outbox.flush();
    assertEqual(r2.delivered, 3, 'Test 4i: retry delivers the pending events');
    assertEqual(r2.gaps_reported, 1, 'Test 4j: flush report counts the gap');
    const gap2 = capturedBatches[1].find((e) => e.event_type === 'conversation.gap.detected');
    assertEqual(gap2 && gap2.event_id, gap1.event_id,
        'Test 4k: gap event_id stable across retries (idempotent)');

    // Cursor now at 5; a contiguous follow-up event produces NO gap
    const cursors = await outbox.getDeliveryCursors();
    assertEqual(cursors[sourceId], 5, 'Test 4l: cursor advanced past the gap');
    await outbox.recordObservation({
        conversation_key: 'gap-convo', observation_key: 'g6:sent',
        event_type: 'conversation.message.sent', payload: { text: 'msg 6' }
    });
    const r3 = await outbox.flush();
    assertEqual(r3.gaps_reported, 0, 'Test 4m: contiguous delivery reports no gap');
    const gap3 = capturedBatches[2].find((e) => e.event_type === 'conversation.gap.detected');
    assert(!gap3, 'Test 4n: no spurious gap when continuity is proven');
}

// ──────────────────────────────────────────────────────
// Test 5: background worker end-to-end (intake -> failure -> alarm retry)
// ──────────────────────────────────────────────────────
async function test5_backgroundIntakeAndAlarmRetry() {
    console.log('\n🧪 Test 5: Background intake, honest failure, alarm retry with same event_id');

    const storage = createMemStorage();
    let postSeq = 0;
    const mockFetch = (url, opts) => {
        if (opts && opts.method === 'POST') {
            postSeq++;
            if (postSeq === 1) return Promise.reject(new Error('ECONNREFUSED'));
            const body = JSON.parse(opts.body);
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { inserted: body.events.length, duplicated: 0 } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { events: [] } }) });
    };
    const harness = createBgHarness(storage, mockFetch);

    const res = await harness.dispatchObservation({
        conversation_key: 'bg-convo', observation_key: 'bg1:baseline',
        event_type: 'conversation.baseline.established',
        payload: { message_ids: ['m1'], message_count: 1 }
    });
    assertEqual(res.enqueued, true, 'Test 5a: baseline observation accepted by worker');

    await new Promise((r) => setTimeout(r, 100)); // opportunistic flush fails
    const s1 = await storage.get(['events_outbox']);
    assertEqual((s1.events_outbox || []).length, 1, 'Test 5b: event retained after failed opportunistic flush');

    await harness.simulateAlarm();
    const s2 = await storage.get(['events_outbox']);
    assertEqual((s2.events_outbox || []).length, 0, 'Test 5c: alarm retry clears outbox');

    const batches = harness.getBatchContents();
    assert(batches.length >= 2, 'Test 5d: both attempts hit the batch endpoint');
    const firstId = batches[0][0] && batches[0][0].event_id;
    const retryId = batches[batches.length - 1][0] && batches[batches.length - 1][0].event_id;
    assertEqual(retryId, firstId, 'Test 5e: retry resends the SAME event_id (idempotent)');
    assertEqual(res.event_id, firstId, 'Test 5f: worker-reported event_id matches delivered one');

    const cursors = storage._raw.delivery_cursors || {};
    const cursorValues = Object.values(cursors);
    assertEqual(cursorValues.length, 1, 'Test 5g: delivery cursor persisted after alarm flush');
    assertEqual(cursorValues[0], 1, 'Test 5h: cursor at the confirmed sequence');
}

// ──────────────────────────────────────────────────────
// Test 6: NOT_OBSERVE => zero residue (red line re-check)
// ──────────────────────────────────────────────────────
async function test6_notObserveZeroResidue() {
    console.log('\n🧪 Test 6: NOT_OBSERVE boundary yields zero residue (baseline included)');

    // Content level: no observation at all is emitted, not even the baseline
    const h = createContentHarness({
        nodes: [makeNode('user', 'sec-u1', 'SECRET_DOM_CANARY_2026')],
        boundary: 'NOT_OBSERVE'
    });
    await tick(); // boundary reaches the content script
    h.scan(); h.scan(); h.scan();
    await tick();
    assertEqual(h.observations().length, 0,
        'Test 6a: content script emits nothing under NOT_OBSERVE (no baseline, no messages)');
    assert(!JSON.stringify(h.allSent()).includes('SECRET_DOM_CANARY_2026'),
        'Test 6b: no message content leaves the page under NOT_OBSERVE');

    // Core level: recordObservation drops before anything touches storage
    const storage = createMemStorage();
    const outbox = new OutboxCore({ storage, fetchFn: () => {}, ulid: ulidShim });
    const sourceId = await ulidShim.stableIdFromString('dcf.source:not-observe-convo');
    await outbox.setBoundary(sourceId, 'NOT_OBSERVE');

    const MARKER = 'SECRET_STORAGE_CANARY_2026';
    const res = await outbox.recordObservation({
        conversation_key: 'not-observe-convo',
        observation_key: 'secret:sent',
        event_type: 'conversation.message.sent',
        payload: { text: MARKER, role: 'user' }
    });
    assertEqual(res.enqueued, false, 'Test 6c: recordObservation rejects under NOT_OBSERVE');
    assertEqual(res.reason, 'boundary_not_observe', 'Test 6d: reason names the boundary');
    assert(!JSON.stringify(storage._raw).includes(MARKER),
        'Test 6e: secret marker absent from storage (content zero residue)');
}

// ──────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────
async function main() {
    console.log('\n🚀 G2 Real-Time Ingest Unit Tests (baseline / cursor / gap)\n');

    await test1_newConversationEstablishesBaseline();
    await test2_navigationRebaselines();
    await test3_deliveryCursorPersistence();
    await test4_gapSynthesisWhenContinuityUnproven();
    await test5_backgroundIntakeAndAlarmRetry();
    await test6_notObserveZeroResidue();

    console.log('\n═══════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    if (failures.length > 0) {
        console.log('\n  Failures:');
        failures.forEach((f) => console.log(`    • ${f}`));
    }
    console.log('═══════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
