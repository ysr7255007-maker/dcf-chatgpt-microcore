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
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.3');
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
  'scan(document, true)',
  '这里显示识别、提交与执行进度',
  'dcf-dialogue-progress',
  '最近本机输出',
  '查看执行会话',
  'shadow.append(next)',
  'setInterval(ensurePanelMount, 700)',
  'processed_ids',
  'unit.started'
]) assert(code.includes(token), `missing ${token}`);
assert(!code.includes('data-dcf-panel-root'));
assert(!code.includes('content.append(next)'));
console.log(JSON.stringify({ok:true,plugin_count:10,streaming_completion_detection:true,manual_rescan:true,visible_progress:true,repaint_resilient_card:true,no_new_panel:true}, null, 2));
