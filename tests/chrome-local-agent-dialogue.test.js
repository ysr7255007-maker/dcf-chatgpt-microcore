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
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.11');
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

// === Compact result: formal Assistant text extraction ===
function extractFunction(source, name) {
  const header = `function ${name}(`;
  const start = source.indexOf(header);
  assert(start >= 0, `function ${name} not found in source`);
  let i = source.indexOf('{', start);
  assert(i >= 0, `function ${name} body not found`);
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (char === '\\') { i += 1; continue; }
      if (char === stringChar) inString = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { inString = true; stringChar = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated function ${name}`);
}

const listImpl = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const messageRoleImpl = (value) => String(value?.info?.role || value?.info?.type || '').toLowerCase();
const formalSandbox = {};
const formalFactory = new Function('sandbox', 'list', 'messageRole',
  `${extractFunction(code, 'formalAssistantText')}\n${extractFunction(code, 'latestAssistantFormalText')}\n` +
  'sandbox.formalAssistantText = formalAssistantText;\nsandbox.latestAssistantFormalText = latestAssistantFormalText;'
);
formalFactory(formalSandbox, listImpl, messageRoleImpl);

const sampleMessages = [
  { info: { id: 'm1', role: 'user' }, parts: [{ type: 'text', text: '请帮我做一件事' }] },
  { info: { id: 'm2', role: 'assistant' }, parts: [
    { type: 'reasoning', text: '我需要先思考一下' },
    { type: 'tool', tool: 'bash', state: { type: 'running', title: '执行中' } },
    { type: 'text', text: '第一段正式回复' }
  ] },
  { info: { id: 'm3', role: 'assistant' }, parts: [
    { type: 'reasoning', text: '继续推理' },
    { type: 'step-start' },
    { type: 'tool', tool: 'edit', state: { type: 'completed' } },
    { type: 'step-finish', reason: 'done' },
    { type: 'patch', content: 'diff --git a/... b/...' }
  ] }
];

// 1. 最后正式 text 被提取；2. reasoning/tool/step-finish 不进入 assistant_result
const formalOnly = formalSandbox.latestAssistantFormalText(sampleMessages);
assert.strictEqual(formalOnly, '第一段正式回复', 'latestAssistantFormalText returns last assistant text, skipping reasoning/tool-only tail');
assert(!formalOnly.includes('思考'), 'reasoning excluded from formal text');
assert(!formalOnly.includes('bash'), 'tool excluded from formal text');
assert(!formalOnly.includes('执行中'), 'tool state title excluded from formal text');
assert(!formalOnly.includes('步骤结束'), 'step-finish excluded from formal text');
assert(!formalOnly.includes('diff --git'), 'patch excluded from formal text');
assert.strictEqual(formalSandbox.formalAssistantText(sampleMessages[2]), '', 'formalAssistantText drops reasoning/tool/step/patch when no text part');

// 3. result payload 不含 messages；4. return_mode: full 也不会带 raw messages
assert(!code.includes('messages: job.request.return_mode'), 'resultPayload no longer gates raw messages on return_mode');
const resultPayloadSrc = extractFunction(code, 'resultPayload');
assert(!/\bmessages\s*:/.test(resultPayloadSrc), 'resultPayload has no messages key (raw messages never embedded)');
assert(!resultPayloadSrc.includes('return_mode'), 'resultPayload no longer references return_mode, so full mode cannot bring raw messages back');
assert(code.includes("return_mode: payload.return_mode === 'full' ? 'full' : 'summary'"), 'return_mode field still parsed for schema compatibility');
assert(code.includes('assistant_result: latestAssistantFormalText(snap.messages)'), 'resultPayload assistant_result uses formal text');
assert(code.includes('recent_assistant_output: latestAssistantFormalText(snap.messages).slice(-6000)'), 'permission request recent_assistant_output uses formal text');

// 5. 无正式 text 时不会误判 completed（latestAssistantFormalText 返回 '' 为 falsy，poll 的 && assistantResult 守卫保持 false）
const reasoningOnlyMessages = [
  { info: { id: 'm1', role: 'user' }, parts: [{ type: 'text', text: 'task' }] },
  { info: { id: 'm2', role: 'assistant' }, parts: [
    { type: 'reasoning', text: 'only reasoning here' },
    { type: 'tool', tool: 'bash', state: { type: 'completed' } },
    { type: 'step-finish', reason: 'done' }
  ] }
];
assert.strictEqual(formalSandbox.latestAssistantFormalText(reasoningOnlyMessages), '', 'no formal text -> empty, so poll completion guard (&& assistantResult) stays false');
assert.match(code, /const assistantResult = latestAssistantFormalText\(snap\.messages\);[\s\S]*&& assistantResult\)/);

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
  no_new_panel: true,
  result_carries_only_formal_assistant_text: true,
  reasoning_tool_step_excluded_from_result: true,
  result_payload_has_no_messages_field: true,
  return_mode_full_no_longer_returns_raw_messages: true,
  no_formal_text_does_not_complete: true
}, null, 2));
