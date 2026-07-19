'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = 4187;
const child = childProcess.spawn(process.execPath, ['scripts/dcf-runtime-evidence-bridge.js'], {
  cwd: root,
  env: { ...process.env, DCF_RUNTIME_BRIDGE_PORT: String(port) },
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
    snapshot: { schema: 'dcf.runtime.snapshot.v1', bridge: { enabled: true }, extension: { current: { entries: [{ id: 'dcf.firstparty.shell' }] } }, shell: { mounted: true }, dialogue: { observer_generation: 'dialogue-1', recoveries: 0 }, local_agent: { connected: true }, outbox: { pending_count: 0 } },
    events: [{ schema: 'dcf.runtime.event.v1', timestamp: new Date().toISOString(), generation: 'test-generation', source: 'test', type: 'startup', summary: 'Bridge started.' }]
  };
  assert.strictEqual((await request('POST', '/dcf/runtime/publish', payload)).status, 200);
  const snapshot = await request('GET', '/dcf/runtime/snapshot?runtime_id=dcf_test_runtime_001');
  assert.strictEqual(snapshot.status, 200); assert.strictEqual(snapshot.body.snapshot.privacy, undefined);
  const events = await request('GET', '/dcf/runtime/events?runtime_id=dcf_test_runtime_001&since=0');
  assert.strictEqual(events.body.events.length, 1); assert.strictEqual(events.body.events[0].seq, 1);
  const health = await request('POST', '/dcf/runtime/checks/run?runtime_id=dcf_test_runtime_001');
  assert.strictEqual(health.body.report.status, 'passed'); assert.strictEqual(health.body.report.user_intervention_required, false);
  assert.strictEqual((await request('POST', '/dcf/runtime/diagnostic/start?runtime_id=dcf_test_runtime_001')).status, 202);
  const commands = await request('GET', '/dcf/runtime/commands?runtime_id=dcf_test_runtime_001');
  assert.strictEqual(commands.body.commands[0].type, 'diagnostic.start');
  assert.strictEqual((await request('POST', '/dcf/runtime/publish', { ...payload, runtime_id: 'bad id!' })).status, 400);
  console.log(JSON.stringify({ ok: true, snapshot: true, events: true, health_check: true, controlled_diagnostics: true, invalid_publish_rejected: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => child.kill());
