'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');
assert(!/await\s+sendArtifact|sendArtifact\([^\n]*\)\.catch/.test(code), 'sendArtifact is never treated as a Promise');
const start = code.indexOf('function controlAck(');
const end = code.indexOf('function shellShadow()', start);
assert(start >= 0 && end > start, 'control implementation is extractable');

function controlHarness({ stage = 'running', active = true, enqueueReturns = true } = {}) {
  const artifacts = [];
  let aborts = 0;
  const job = { request: { id: 'req-control', return_mode: 'final' }, session_id: 'ses_control', started_at: Date.now() - 1000, last_activity_at: Date.now() - 100, last_snapshot: { status_type: 'idle', messages: [], todo: [], diff: [], permissions: [], questions: [] }, config: {} };
  const state = { stage, status: '', control_plane: { seq: 0, changed_files: 0, blocked_reason: '', permission_id: '' }, completed_commands: [], last_terminal: null, settings: { poll_interval_ms: 1 } };
  const factory = new Function('activeJob', 'state', 'queue', 'sendArtifact', 'artifact', 'MARKERS', 'structuredErrorPayload', 'progressState', 'snapshot', 'latestAssistantText', 'request', 'render', 'persist', 'sleep', `${code.slice(start, end)}\nreturn { executeControl };`);
  const api = factory(active ? job : null, state, [], (value) => { artifacts.push(value); return enqueueReturns; }, (_markers, value) => JSON.stringify(value), { progress: ['start', 'end'] }, (kind, message, extra) => ({ schema: 'dcf.local-agent.progress.v1', error: { kind, message }, ...extra }), () => 'running', async () => job.last_snapshot, () => '', async (pathname) => { if (pathname.includes('/abort')) aborts += 1; return {}; }, () => {}, async () => {}, async () => {});
  return { api, state, job, artifacts, aborts: () => aborts };
}

(async () => {
  const first = controlHarness();
  await first.api.executeControl({ command: 'status', command_id: 'status-1', target: 'current' });
  assert.strictEqual(first.artifacts.length, 1, 'synchronous sendArtifact accepts status ACK without TypeError');

  const degraded = controlHarness({ enqueueReturns: false });
  await degraded.api.executeControl({ command: 'status', command_id: 'status-degraded', target: 'current' });
  await degraded.api.executeControl({ command: 'cancel', command_id: 'cancel-after-degraded', target: 'current' });
  assert.strictEqual(degraded.aborts(), 1, 'status delivery degradation does not prevent subsequent cancel');

  const failed = controlHarness({ stage: 'failed' });
  await failed.api.executeControl({ command: 'status', command_id: 'status-failed', target: 'current' });
  await failed.api.executeControl({ command: 'cancel', command_id: 'cancel-failed', target: 'current' });
  assert.strictEqual(failed.aborts(), 1, 'failed UI state with active job still performs real cancel');

  const isolated = controlHarness();
  await assert.rejects(() => isolated.api.executeControl({ command: 'steer', command_id: 'bad-steer', target: 'current', instruction: '' }));
  await isolated.api.executeControl({ command: 'cancel', command_id: 'cancel-after-error', target: 'current' });
  assert.strictEqual(isolated.aborts(), 1, 'one invalid command does not prevent later cancel');
  await isolated.api.executeControl({ command: 'cancel', command_id: 'cancel-repeat', target: 'current' });
  assert.strictEqual(isolated.aborts(), 1, 'repeat cancel is idempotent after confirmation');
  console.log(JSON.stringify({ ok: true, sync_enqueue_status: true, degraded_status_then_cancel_survives: true, failed_state_cancel_survives: true, invalid_command_isolated: true, repeated_cancel_idempotent: true, delivery_degraded_not_module_fatal: code.includes("state.delivery_state = 'delivery_degraded'") && code.includes("state.failure_kind = 'module_fatal'") }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
