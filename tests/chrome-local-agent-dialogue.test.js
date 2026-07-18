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
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.6');
assert.strictEqual(ref.phase, 57);
assert.strictEqual(ref.world_id, 'dcf-firstparty-local-agent-dialogue');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
for (const token of [
  '<<<DCF_LOCAL_AGENT_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_RESULT>>>',
  'dcf.local-agent.request.v1',
  'dcf.local-agent.result.v1',
  "intake_model: 'new-assistant-event-stream'",
  'const baselineNodes = new WeakSet()',
  'function baselineConversation(root)',
  'function considerNewAssistant(node)',
  'function inspectLatestAssistant()',
  '检查最新助手回复',
  '历史消息仍不会自动执行',
  'function escapeJsonStringControls(source)',
  'function attachHotRefreshWatchers()',
  'function schedulePanelMount()',
  'documentObserver.observe(document.documentElement',
  'async function waitForPanelMount',
  'await waitForPanelMount(5000)',
  "request(`/session/${encodeURIComponent(session_id)}/message`",
  "response_state: 'pending'",
  "'message-pending'",
  'message_request:',
  'mountTimer = setInterval(ensurePanelMount, 1200)',
  'processed_ids',
  'unit.started'
]) assert(code.includes(token), `missing ${token}`);
for (const forbidden of [
  '/prompt_async',
  '重新扫描当前对话',
  '.slice(-30)',
  'scan(document',
  'scanTimer',
  'data-dcf-panel-root',
  'shadow.append(next)',
  '.onclick ='
]) assert(!code.includes(forbidden), `forbidden ${forbidden}`);
console.log(JSON.stringify({
  ok: true,
  plugin_count: 10,
  history_is_baseline_not_queue: true,
  new_assistant_event_stream: true,
  latest_only_manual_recovery: true,
  tolerant_artifact_parser: true,
  synchronous_message_completion: true,
  parallel_intervention_observation: true,
  hot_update_remount_watchers: true,
  startup_waits_for_mount: true,
  no_new_panel: true
}, null, 2));
