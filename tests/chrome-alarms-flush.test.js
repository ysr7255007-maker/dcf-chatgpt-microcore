/**
 * G1 Chrome Adapter - Service worker glue tests (alarms + messaging)
 * Simulates the chrome extension environment (storage/alarms/runtime) in
 * Node and loads the real background.js to verify:
 *   - flush alarm registration on load
 *   - alarm ticks trigger non-blocking flush against companion URL
 *   - dcf.observation messages feed the durable outbox
 *   - dcf.get_boundary / dcf.get_stats respond correctly
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

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

const ADAPTER_DIR = path.join(__dirname, '..', 'seed', 'adapters', 'chrome');

// ---------------------------------------------------------------------------
// chrome.* environment mock
// ---------------------------------------------------------------------------
const storageData = {};
const alarms = {};
const alarmListeners = [];
const messageListeners = [];
const fetchCalls = [];
let fetchBehavior = 'down'; // start with companion unreachable

const chromeMock = {
    storage: {
        local: {
            async get(keys) {
                const out = {};
                const list = Array.isArray(keys) ? keys : [keys];
                for (const k of list) {
                    if (k in storageData) out[k] = JSON.parse(JSON.stringify(storageData[k]));
                }
                return out;
            },
            async set(obj) {
                for (const [k, v] of Object.entries(obj)) {
                    storageData[k] = JSON.parse(JSON.stringify(v));
                }
            }
        }
    },
    alarms: {
        create(name, info) { alarms[name] = info; },
        get(name, cb) { cb(alarms[name] || null); },
        onAlarm: { addListener(fn) { alarmListeners.push(fn); } }
    },
    runtime: {
        onMessage: { addListener(fn) { messageListeners.push(fn); } },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} }
    }
};

async function fakeFetch(url, options = {}) {
    fetchCalls.push({ url, options });
    if (fetchBehavior === 'down') {
        throw new TypeError('fetch failed: companion not running');
    }
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/rpc/events/batch')) {
        const count = (body.events || []).length;
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', result: { inserted: count, total: count, duplicated: 0 } }) };
    }
    if (url.includes('/rpc/events/query')) {
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', result: { events: [] } }) };
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', result: {} }) };
}

// ---------------------------------------------------------------------------
// Load background.js inside a VM context that mimics the SW global scope
// ---------------------------------------------------------------------------
const context = {
    chrome: chromeMock,
    fetch: fakeFetch,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    TextEncoder,
    crypto: require('crypto').webcrypto
};
context.globalThis = context;
context.self = context;
context.importScripts = function (...files) {
    for (const f of files) {
        const code = fs.readFileSync(path.join(ADAPTER_DIR, f), 'utf8');
        vm.runInContext(code, vmContext, { filename: f });
    }
};
const vmContext = vm.createContext(context);

function sendMessage(message) {
    return new Promise((resolve) => {
        let responded = false;
        for (const listener of messageListeners) {
            const keepOpen = listener(message, { id: 'test' }, (response) => {
                responded = true;
                resolve(response);
            });
            if (keepOpen) return; // async response expected
        }
        if (!responded) resolve(undefined);
    });
}

function fireAlarm(name) {
    for (const fn of alarmListeners) fn({ name });
}

async function run() {
    console.log('\n🧪 G1 Chrome Adapter - Alarms & Service Worker Glue Tests\n');

    console.log('📦 Test 1: background.js loads in MV3-like environment');
    const bgCode = fs.readFileSync(path.join(ADAPTER_DIR, 'background.js'), 'utf8');
    vm.runInContext(bgCode, vmContext, { filename: 'background.js' });
    assert(true, 'background.js evaluated without throwing');
    assert(typeof vmContext.DCF_ULID === 'object', 'importScripts loaded ulid.js');
    assert(typeof vmContext.DCF_OUTBOX === 'object', 'importScripts loaded outbox-core.js');

    console.log('\n📦 Test 2: flush alarm registered');
    const alarm = alarms['dcf-outbox-flush'];
    assert(alarm !== undefined, 'dcf-outbox-flush alarm created');
    assert(alarm.periodInMinutes === 0.5, `period is 0.5 min (${alarm && alarm.periodInMinutes})`);

    console.log('\n📦 Test 3: observation message feeds durable outbox');
    const res = await sendMessage({
        type: 'dcf.observation',
        conversation_key: 'chatgpt.com/c/sw-test',
        observation_key: 'msg-1:conversation.message.sent',
        event_type: 'conversation.message.sent',
        payload: { role: 'user', text: 'hello from test', message_id: 'msg-1' }
    });
    assert(res && res.enqueued === true, `observation enqueued (${JSON.stringify(res)})`);
    assert(res.sequence_number === 1, 'sequence number assigned');
    // companion is down: event must survive in chrome.storage.local
    const outbox = storageData['events_outbox'] || [];
    assert(outbox.length === 1, 'event persisted in chrome.storage.local outbox');
    assert(outbox[0].payload_json.text === 'hello from test', 'payload retained in custody');

    console.log('\n📦 Test 4: alarm tick flushes to companion after recovery');
    fetchBehavior = 'ok';
    fetchCalls.length = 0;
    fireAlarm('dcf-outbox-flush');
    await new Promise(r => setTimeout(r, 50)); // let async flush settle
    const batchCall = fetchCalls.find(c => c.url.includes('/rpc/events/batch'));
    assert(batchCall !== undefined, 'alarm triggered batch POST to companion');
    assert(batchCall.url.startsWith('http://127.0.0.1:8472'), 'targets companion default port 8472');
    const remaining = storageData['events_outbox'] || [];
    assert(remaining.length === 0, 'outbox drained after confirmed delivery');

    console.log('\n📦 Test 5: unrelated alarms ignored');
    fetchCalls.length = 0;
    fireAlarm('some-other-alarm');
    await new Promise(r => setTimeout(r, 30));
    assert(fetchCalls.length === 0, 'no flush for foreign alarm');

    console.log('\n📦 Test 6: dcf.get_boundary defaults to OBSERVE_CURRENT_ONLY');
    const boundary = await sendMessage({ type: 'dcf.get_boundary', conversation_key: 'chatgpt.com/c/sw-test' });
    assert(boundary && boundary.boundary_state === 'OBSERVE_CURRENT_ONLY', `default boundary (${JSON.stringify(boundary)})`);
    assert(typeof boundary.source_id === 'string' && boundary.source_id.length === 26, 'source_id is 26-char ULID format');

    console.log('\n📦 Test 7: dcf.get_stats reports outbox state');
    const stats = await sendMessage({ type: 'dcf.get_stats' });
    assert(stats && stats.outbox_size === 0, 'stats reflect drained outbox');
    assert(stats.sequences && Object.values(stats.sequences)[0] === 1, 'sequence state persisted');

    console.log('\n=================================================');
    console.log(`Tests passed: ${testsPassed}, failed: ${testsFailed}`);
    console.log('=================================================\n');
    process.exit(testsFailed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
