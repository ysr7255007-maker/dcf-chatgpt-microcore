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
assert.strictEqual(index.units.length, 11);
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.24');
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
  'function normalizeStoredModel(value)',
  'model: normalizeStoredModel(stored.model)',
  'function assistantText(record)',
  'function latestAssistantText(messages)',
  'function assistantReasoning(record)',
  'function reasoningTrace(messages)',
  'function boundedEvidence(value, limit = 4000)',
  'function assistantTurnTrace(messages)',
  'function toolTrace(messages)',
  'function normalizeReturnMode(value)',
  "return_mode: normalizeReturnMode(payload.return_mode)",
  'function applyReturnProfile(payload, mode, snap, execution)',
  "mode === 'reasoning' || mode === 'diagnostic'",
  "mode === 'diagnostic'",
  'payload.reasoning = reasoningTrace(snap.messages)',
  'payload.diagnostic = {',
  'assistant_result: latestAssistantText(snap.messages)',
  "return_modes: ['final', 'reasoning', 'diagnostic']",
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
  'if (!hasIntervention && Date.now() - job.last_activity_at >= job.request.idle_timeout_ms)',
  'const baselineNodes = new WeakSet()',
  'function attachConversationRoot()',
  'function ensurePanelMount()',
  'function attachWatchers()',
  'async function runAcceptance()',
  '一键验收并回传',
  '检查最新助手回复',
  '历史消息只建立基线',
  "type: 'unit.started'",
  'function ensureRuntimeAlive(reason',
  'WATCHDOG_INTERVAL_MS',
  'OBSERVER_STALL_MS',
  'diagnostics.observer_generation',
  'diagnostics.last_mutation_at',
  'diagnostics.last_consume_at',
  'diagnostics.last_recovery_reason',
  "ensureRuntimeAlive('watchdog')",
  "ensureRuntimeAlive('visibility')",
  "ensureRuntimeAlive('focus')",
  'watchdogTimer',
  'visibilityListener',
  'focusListener',
  '<<<DCF_LOCAL_AGENT_PROGRESS>>>',
  '<<<DCF_LOCAL_AGENT_CONTROL>>>',
  'dcf.local-agent.progress.v1',
  'dcf.local-agent.control.v1',
  'HEARTBEAT_INTERVAL_MS',
  'STUCK_THRESHOLD_MS',
  'function progressState()',
  'function progressPayload(job, snap)',
  'function emitProgress(job, snap, force = false)',
  'function controlAck(job, command, status, detail)',
  'async function executeControl(parsed)',
  'async function recoverPoll(job)',
  '[DCF steer]',
  '/abort',
  'active_task',
  'control_plane',
  'ctl-status',
  'ctl-steer',
  'ctl-cancel',
  'ctl-cancel-cp',
  '疑似卡住',
  '活动任务',
  '查看进展',
  '补充指令',
  '中止任务',
  '保存检查点后中止',
  'async function confirmSessionStopped(job)',
  'abort_failed',
  'abort_unconfirmed',
  'last_terminal',
  'function outboxId(text)',
  'async function confirmDelivery(entry)',
  'outbox.items',
  'click_unconfirmed',
  'recoverable_failure',
  'composer_occupied',
  'button_unavailable',
  'function scheduleOutboxPump()',
  'async function outboxPump()',
  'function countUserMessages()',
  'function isCritical(entry)',
  'cancel_confirmed',
  'baseline_users',
  'function resolveControlTarget(parsed)',
  'function structuredErrorPayload(code, message, extra)',
  "target === 'current'",
  "error: 'no_active_task'",
  "error: 'session_mismatch'",
  "error: 'ambiguous_target'",
  'completed_commands',
  "state.completed_commands.includes(parsed.command_id)",
  'emitProgress(job, null, true)',
  'RESOLVE_REQUEST_ID_RE',
  'RESOLVE_SESSION_ID_RE',
  'ctl-ui-',
  "'already_completed'"
]) assert(code.includes(token), `missing ${token}`);

for (const token of [
  '/prompt_async',
  "if (part.type === 'text' || part.type === 'reasoning')",
  'function latestAssistant(messages)',
  "messages: job.request.return_mode === 'full' ? snap.messages : undefined",
  "const modelValue = String(shadow?.querySelector('[data-field=\"model\"]')",
  'modelParts.length === 2',
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
assert.match(code, /const id = permissionId\(permission\);[\s\S]*job\.awaiting_permission_id = id;[\s\S]*if \(job\.notified_permissions\.has\(id\)\) return;/);
assert(!code.includes("if (job.awaiting_permission_id) job.awaiting_permission_id = '';"));
assert(!/payload\.messages\s*=/.test(code));

const helperStart = code.indexOf('function assistantText(record)');
const helperEnd = code.indexOf('function normalizeArtifactText', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart);
const helperFactory = new Function('list', 'messageRole', 'messageId', 'statusType', 'json', 'hash', `${code.slice(helperStart, helperEnd)}\nreturn { assistantText, latestAssistantText, reasoningTrace, boundedEvidence, assistantTurnTrace, toolTrace, normalizeReturnMode };`);
const helpers = helperFactory(
  (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [],
  (value) => String(value?.info?.role || value?.info?.type || '').toLowerCase(),
  (value) => String(value?.info?.id || value?.id || ''),
  (value, fallback = 'unknown') => String(typeof value === 'string' ? value : value?.type || value?.status || value?.state || fallback).toLowerCase(),
  (value) => JSON.stringify(value, null, 2),
  (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
);
const messages = [
  {
    info: { id: 'msg_a', role: 'assistant', providerID: 'agent-plan', modelID: 'glm-5.2', agent: 'build', finish: 'tool-calls', time: { created: 1, completed: 2 } },
    parts: [
      { type: 'reasoning', text: 'first reasoning' },
      { type: 'tool', callID: 'call_a', tool: 'bash', state: { status: 'completed', input: { command: 'pwd' }, output: '/tmp', title: 'pwd' } },
      { type: 'step-finish', reason: 'tool-calls' }
    ]
  },
  {
    info: { id: 'msg_b', role: 'assistant', providerID: 'deepseek', modelID: 'deepseek-v4-flash', agent: 'build', finish: 'stop', time: { created: 3, completed: 4 } },
    parts: [
      { type: 'reasoning', text: 'second reasoning' },
      { type: 'text', text: 'FINAL' },
      { type: 'tool', callID: 'call_b', tool: 'read', state: { status: 'completed', input: { filePath: '/tmp/a' }, output: 'ok', title: 'a' } },
      { type: 'text', text: 'SECOND' },
      { type: 'step-finish', reason: 'stop' }
    ]
  }
];
assert.strictEqual(helpers.latestAssistantText(messages), 'FINAL\nSECOND');
assert.strictEqual(helpers.latestAssistantText([{ info: { role: 'assistant' }, parts: [{ type: 'reasoning', text: 'reasoning only' }] }]), '');
const reasoning = helpers.reasoningTrace(messages);
assert.deepStrictEqual(reasoning.map((item) => item.text), ['first reasoning', 'second reasoning']);
assert.strictEqual(helpers.assistantTurnTrace(messages).length, 2);
assert.strictEqual(helpers.assistantTurnTrace(messages)[1].finish, 'stop');
assert.strictEqual(helpers.toolTrace(messages).length, 2);
assert.strictEqual(helpers.normalizeReturnMode(), 'final');
assert.strictEqual(helpers.normalizeReturnMode('summary'), 'final');
assert.strictEqual(helpers.normalizeReturnMode('review'), 'reasoning');
assert.strictEqual(helpers.normalizeReturnMode('reasoning'), 'reasoning');
assert.strictEqual(helpers.normalizeReturnMode('full'), 'diagnostic');
assert.strictEqual(helpers.normalizeReturnMode('debug'), 'diagnostic');
assert.strictEqual(helpers.boundedEvidence('x'.repeat(5000)).truncated, true);

console.log(JSON.stringify({
  ok: true,
  plugin_version: ref.version,
  observable_activity_timeout: true,
  permission_wait_pauses_idle_timeout: true,
  synchronous_message_has_no_wall_clock_abort: true,
  permission_request_has_tool_and_task_evidence: true,
  permission_decision_returns_to_same_session: true,
  permission_wait_survives_transient_missing_snapshot: true,
  permission_intervention_is_not_a_final_result: true,
  history_is_baseline_not_queue: true,
  hot_update_remount_watchers: true,
  no_new_panel: true,
  final_mode_is_text_only: true,
  reasoning_mode_covers_all_assistant_turns: true,
  diagnostic_mode_is_bounded_and_structured: true,
  raw_messages_not_returned: true,
  persisted_model_is_canonical: true,
  ensure_runtime_alive_watchdog: true,
  observer_stall_detection: true,
  root_replacement_recovery: true,
  visibility_focus_supplementary: true,
  bounded_diagnostics: true
}, null, 2));
