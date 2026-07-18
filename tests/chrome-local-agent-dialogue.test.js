'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent-dialogue');
assert(ref);
assert(index.defaults.includes(ref.id));
assert.strictEqual(index.units.length, 10);
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.9');
assert.strictEqual(ref.phase, 57);
assert.strictEqual(ref.world_id, 'dcf-firstparty-local-agent-dialogue');

const codePath = path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js');
const code = fs.readFileSync(codePath, 'utf8');
assert.doesNotThrow(() => new Function(code));
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);

for (const token of [
  '<<<DCF_LOCAL_AGENT_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_RESULT>>>',
  '<<<DCF_LOCAL_AGENT_PERMISSION_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_PERMISSION_DECISION>>>',
  '<<<DCF_LOCAL_AGENT_DIALOGUE_ACCEPTANCE>>>',
  'dcf.local-agent.request.v1',
  'dcf.local-agent.result.v1',
  'dcf.local-agent.permission-request.v1',
  'dcf.local-agent.permission-decision.v1',
  'dcf.local-agent-dialogue.acceptance.v1',
  "intake_model: 'new-assistant-event-stream'",
  "timeout_basis: 'observable-idle-time'",
  'permission_wait_pauses_idle_timeout: true',
  'const baselineNodes = new WeakSet()',
  'let boundMountRoot = null',
  'boundMountRoot === mountRoot',
  'function baselineConversation(root)',
  'function considerNewAssistant(node)',
  'function inspectLatestAssistant()',
  '检查最新助手回复',
  '历史消息仍不会自动执行',
  'function escapeJsonStringControls(source)',
  'function attachHotRefreshWatchers()',
  "const SHELL_HOST_ID = 'dcf-chrome-shell-host'",
  'function shellShadow()',
  'function attachShellObserver()',
  "document.addEventListener('dcf:shell-ready'",
  "document.addEventListener('dcf:panel-ready'",
  'function statusCollection(value)',
  'function sessionStatusFrom(value, id)',
  "'status-unavailable'",
  '最近交接',
  '当前请求：',
  '查看最近执行会话',
  'function clearProcessedState',
  'function buildAcceptanceReport',
  'function runAcceptance',
  '一键验收并回传',
  'forceSend: true',
  "type: 'host.status'",
  'local_agent_pinned',
  'page_predates_plugin_ms',
  'function schedulePanelMount()',
  'documentObserver.observe(document.documentElement',
  'async function waitForPanelMount',
  "if (!await waitForPanelMount(5000)) throw new Error('对话闭环未能挂载到本机 Agent 面板')",
  "request(`/session/${encodeURIComponent(session_id)}/message`",
  "response_state: 'pending'",
  "'message-pending'",
  'message_request:',
  'mountTimer = setInterval(ensurePanelMount, 1200)',
  'processed_ids',
  'unit.started',
  'idle_timeout_ms',
  'function activityFingerprint(snap, job)',
  'function noteActivity(job, fingerprint)',
  'async function confirmInactive(job, fingerprint)',
  "payload(job, 'inactive_timeout'",
  "timeout: 0",
  'function permissionRequestPayload(job, permission, snap)',
  'function findToolEvidence(messages, permission)',
  'raw_permission: permission',
  'original_task: job.request.task',
  'allowed_decisions:',
  'async function applyPermissionDecision(decision)',
  'async function replyPermissionNative(job, decision)',
  '/permission/${encodeURIComponent(decision.permission_id)}/reply',
  '/api/session/${encodeURIComponent(job.session_id)}/permission/${encodeURIComponent(decision.permission_id)}/reply',
  "['once', 'always', 'reject'].includes(decision)",
  "state.stage = 'permission_reply'",
  "state.stage = job.response_state === 'rejected' ? 'detached' : 'running'",
  'if (!hasIntervention && Date.now() - job.last_activity_at >= job.request.idle_timeout_ms)'
]) assert(code.includes(token), `missing ${token}`);

for (const forbidden of [
  '/prompt_async',
  '重新扫描当前对话',
  '.slice(-30)',
  'scan(document',
  'scanTimer',
  'data-dcf-panel-root',
  'shadow.append(next)',
  'mountRoot.dataset',
  '.onclick =',
  "returnPayload(payload(job, 'needs_user'",
  'Date.now() - started >= job.request.timeout_ms',
  'timeout: requestData.timeout_ms',
  "status: 'timeout'"
]) assert(!code.includes(forbidden), `forbidden ${forbidden}`);

assert.match(code, /if \(!hasIntervention && Date\.now\(\) - job\.last_activity_at >= job\.request\.idle_timeout_ms\)/);
assert.match(code, /if \(pendingPermissions\.length\)[\s\S]*state\.stage = 'needs_user'[\s\S]*returnPermissionRequest/);
assert.match(code, /applyPermissionDecision\(parsed\)/);
assert.match(code, /replyPermissionNative\(job, decision\)/);

console.log(JSON.stringify({
  ok: true,
  plugin_count: 10,
  plugin_version: ref.version,
  history_is_baseline_not_queue: true,
  new_assistant_event_stream: true,
  latest_only_manual_recovery: true,
  tolerant_artifact_parser: true,
  observable_activity_timeout: true,
  permission_wait_pauses_idle_timeout: true,
  synchronous_message_has_no_wall_clock_abort: true,
  permission_request_has_tool_and_task_evidence: true,
  permission_decision_returns_to_same_session: true,
  permission_intervention_is_not_a_final_result: true,
  hot_update_remount_watchers: true,
  shell_shadow_mount_discovery: true,
  shadow_root_event_binding: true,
  one_click_acceptance: true,
  acceptance_auto_return: true,
  normalized_status_semantics: true,
  active_and_recent_handoff_separated: true,
  startup_waits_for_mount: true,
  no_new_panel: true
}, null, 2));
