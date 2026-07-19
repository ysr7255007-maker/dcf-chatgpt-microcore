'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = 4187;
const child = childProcess.spawn(process.execPath, ['scripts/dcf-runtime-evidence-bridge.js'], {
  cwd: root,
  env: { ...process.env, DCF_RUNTIME_BRIDGE_PORT: String(port), DCF_RUNTIME_BRIDGE_STALE_MS: '100' },
  stdio: ['ignore', 'pipe', 'pipe']
});

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(payload);
  });
}
function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge did not start')), 3000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.once('error', reject);
  });
}

(async () => {
  await waitForServer();
  const payload = {
    schema: 'dcf.runtime.publish.v1', runtime_id: 'dcf_test_runtime_001', generation: 'test-generation',
    snapshot: { schema: 'dcf.runtime.snapshot.v1', generated_at: new Date().toISOString(), runtime_id: 'dcf_test_runtime_001', generation: 'test-generation', bridge: { enabled: true, endpoint: 'http://127.0.0.1:4178', client_connected: true, last_ack_at: null, last_failure_at: null, consecutive_failures: 0 }, extension: { version: 'test', user_scripts_available: true, candidate: null, current: null, last_known_good: null, plugins: [{ id: 'dcf.firstparty.shell', version: '1', hash: 'a'.repeat(64), enabled: true, registered: true, running: true, startup_generation: '1', recent_failure: null }] }, shell: { mounted: true, mount_generation: '1', active_panel: 'plugins', pinned_panels: ['plugins'], panel_count: 1 }, dialogue: { observer_generation: 'dialogue-1', last_mutation_at: null, last_consume_at: null, last_watchdog_at: null, recoveries: 0, last_recovery_reason: null, queue_length: 0, active_request_id: null, active_session_id: null, stage: 'idle', status: 'idle', waiting_permission: false, active_last_activity_at: null, last_recovery_at: null, outbox_pending_count: 0, outbox_states: [] }, local_agent: { connected: true, endpoint: 'http://127.0.0.1:4096', selected_session_id: null, session_status: 'idle', last_poll_at: null, endpoint_errors: {}, poll_failures: 0 }, outbox: { pending_count: 0, states: [] }, page_lifecycle: { visibility: 'visible', focused: true, running: false, ring_size: 0, analysis: null, summary: null }, recovery: { last_reason: null, last_recovery_at: null, count: 0 }, privacy: { conversation_text_included: false, assistant_text_included: false, credentials_included: false, cookies_included: false, raw_dom_included: false, raw_logs_included: false, reasoning_included: false } },
    events: [{ schema: 'dcf.runtime.event.v1', timestamp: new Date().toISOString(), generation: 'test-generation', source: 'test', type: 'startup', summary: 'Bridge started.' }]
  };
  assert.strictEqual((await request('POST', '/dcf/runtime/publish', payload)).status, 200);
  const snapshot = await request('GET', '/dcf/runtime/snapshot?runtime_id=dcf_test_runtime_001');
  assert.strictEqual(snapshot.status, 200); assert.strictEqual(snapshot.body.snapshot.privacy.conversation_text_included, false);
  const events = await request('GET', '/dcf/runtime/events?runtime_id=dcf_test_runtime_001&since=0');
  assert.strictEqual(events.body.events.length, 1); assert.strictEqual(events.body.events[0].seq, 1);
  const health = await request('POST', '/dcf/runtime/checks/run?runtime_id=dcf_test_runtime_001');
  assert.strictEqual(health.body.report.status, 'passed'); assert.strictEqual(health.body.report.user_intervention_required, false);
  assert.strictEqual((await request('POST', '/dcf/runtime/diagnostic/start?runtime_id=dcf_test_runtime_001')).status, 202);
  const commands = await request('GET', '/dcf/runtime/commands?runtime_id=dcf_test_runtime_001');
  assert.strictEqual(commands.body.commands[0].type, 'diagnostic.start');
  assert.strictEqual(commands.body.commands[0].state, 'delivered');
  assert.strictEqual((await request('GET', '/dcf/runtime/commands?runtime_id=dcf_test_runtime_001')).body.commands.length, 1, 'delivery does not acknowledge execution');
  assert.strictEqual((await request('POST', `/dcf/runtime/commands/${commands.body.commands[0].command_id}/ack?runtime_id=dcf_test_runtime_001`, { schema: 'dcf.runtime.command-ack.v1', command_id: commands.body.commands[0].command_id, status: 'applied', report: { analysis: 'ok' }, error: null })).status, 200);
  assert.strictEqual((await request('GET', '/dcf/runtime/commands?runtime_id=dcf_test_runtime_001')).body.commands.length, 0, 'applied command no longer redelivered');
  assert.strictEqual((await request('POST', '/dcf/runtime/publish', { ...payload, snapshot: { ...payload.snapshot, unexpected: true } })).status, 400, 'unknown snapshot field rejected');
  assert.strictEqual((await request('POST', '/dcf/runtime/publish', { ...payload, runtime_id: 'bad id!' })).status, 400);
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.strictEqual((await request('POST', '/dcf/runtime/checks/run?runtime_id=dcf_test_runtime_001')).body.report.status, 'blocked', 'stale runtime blocks health check');
  console.log(JSON.stringify({ ok: true, snapshot: true, events: true, health_check: true, stale_runtime_blocked: true, command_lifecycle: true, invalid_publish_rejected: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => child.kill());
