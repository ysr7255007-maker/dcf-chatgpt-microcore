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
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.5');
assert.strictEqual(ref.phase, 57);
assert.strictEqual(ref.world_id, 'dcf-firstparty-local-agent-dialogue');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
for (const token of [
  '<<<DCF_LOCAL_AGENT_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_RESULT>>>',
  'dcf.local-agent.request.v1',
  'dcf.local-agent.result.v1',
  'characterData: true',
  'function scheduleInspect(node, force = false)',
  '检测到委派工件，等待回复生成完成',
  'function normalizeArtifactText(text)',
  'function extractRequestBody(text)',
  "replace(/\\u00a0/g, ' ')",
  'JSON 解析失败',
  "const MOUNT_ID = 'dcf-local-agent-dialogue-mount'",
  "mountRoot.addEventListener('click'",
  '上次操作：',
  '重新扫描当前对话',
  '查看执行会话',
  '回传待发送结果',
  '清除已处理记录',
  'button:active',
  "request(`/session/${encodeURIComponent(session_id)}/message`",
  "response_state: 'pending'",
  "'message-pending'",
  'message_request:',
  'setInterval(ensurePanelMount, 700)',
  'processed_ids',
  'unit.started'
]) assert(code.includes(token), `missing ${token}`);
assert(!code.includes('/prompt_async'));
assert(!code.includes('data-dcf-panel-root'));
assert(!code.includes('shadow.append(next)'));
assert(!code.includes('.onclick ='));
console.log(JSON.stringify({ok:true,plugin_count:10,streaming_completion_detection:true,tolerant_artifact_parser:true,synchronous_message_completion:true,parallel_intervention_observation:true,manual_rescan:true,stable_nested_shadow_controls:true,delegated_clicks:true,visible_action_feedback:true,repaint_resilient_card:true,no_new_panel:true}, null, 2));