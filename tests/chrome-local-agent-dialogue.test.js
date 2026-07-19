'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent-dialogue');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');

assert(ref);
assert(index.defaults.includes(ref.id));
assert.strictEqual(index.units.length, 10);
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.10');
assert.strictEqual(ref.phase, 57);
assert.strictEqual(ref.world_id, 'dcf-firstparty-local-agent-dialogue');
assert.doesNotThrow(() => new Function(code));
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);

for (const token of [
  '<<<DCF_LOCAL_AGENT_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_RESULT>>>',
  '<<<DCF_LOCAL_AGENT_PERMISSION_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_PERMISSION_DECISION>>>',
  'dcf.local-agent.request.v1',
  'dcf.local-agent.result.v1',
  'dcf.local-agent.permission-request.v1',
  'dcf.local-agent.permission-decision.v1',
  'dcf.local-agent-dialogue.acceptance.v1',
  "intake_model: 'new-assistant-event-stream'",
  "timeout_basis: 'observable-idle-time'",
  'permission_wait_pauses_idle_timeout: true',
  'idle_timeout_ms',
  'function activityFingerprint(snap, job)',
  'function noteActivity(job, fingerprint)',
  'async function confirmInactive(job, fingerprint)',
  "resultPayload(job, 'inactive_timeout'",
  'timeout: 0',
  'function permissionRequestPayload(job, permission, snap)',
  'raw_permission: permission',
  'original_task: job.request.task',
  "allowed_decisions: ['once', 'always', 'reject']",
  'function findToolEvidence(messages, permission)',
  'async function applyPermissionDecision(decision)',
  'async function replyPermissionNative(job, decision)',
  '/permission/${encodeURIComponent(decision.permission_id)}/reply',
  '/api/session/${encodeURIComponent(job.session_id)}/permission/${encodeURIComponent(decision.permission_id)}/reply',
  "['once', 'always', 'reject'].includes(decision.decision)",
  "state.stage = 'permission_reply'",
  "state.stage = job.response_state === 'rejected' ? 'detached' : 'running'",
  'if (!hasIntervention && Date.now() - job.last_activity_at >= job.request.idle_timeout_ms)',
  'const baselineNodes = new WeakSet()',
  'function attachConversationRoot()',
  'function ensurePanelMount()',
  'function attachWatchers()',
  'async function runAcceptance()',
  '一键验收并回传',
  '检查最新助手回复',
  '历史消息只建立基线',
  "type: 'unit.started'"
]) assert(code.includes(token), `missing ${token}`);

for (const token of [
  '/prompt_async',
  "resultPayload(job, 'needs_user'",
  'Date.now() - started >= job.request.timeout_ms',
  'timeout: requestData.timeout_ms',
  "status: 'timeout'",
  '.onclick =',
  'eval(',
  'new Function('
]) assert(!code.includes(token), `forbidden ${token}`);

assert.match(code, /if \(pendingPermissions\.length\)[\s\S]*state\.stage = 'needs_user'[\s\S]*returnPermissionRequest/);
assert.match(code, /applyPermissionDecision\(parsed\)/);
assert.match(code, /replyPermissionNative\(job, decision\)/);

console.log(JSON.stringify({
  ok: true,
  plugin_version: ref.version,
  observable_activity_timeout: true,
  permission_wait_pauses_idle_timeout: true,
  synchronous_message_has_no_wall_clock_abort: true,
  permission_request_has_tool_and_task_evidence: true,
  permission_decision_returns_to_same_session: true,
  permission_intervention_is_not_a_final_result: true,
  history_is_baseline_not_queue: true,
  hot_update_remount_watchers: true,
  no_new_panel: true
}, null, 2));
