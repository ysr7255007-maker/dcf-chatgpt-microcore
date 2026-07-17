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
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent-dialogue.2');
assert.strictEqual(ref.phase, 57);
assert.strictEqual(ref.world_id, 'dcf-firstparty-local-agent-dialogue');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
for (const token of [
  '<<<DCF_LOCAL_AGENT_REQUEST>>>',
  '<<<DCF_LOCAL_AGENT_RESULT>>>',
  'dcf.local-agent.request.v1',
  'dcf.local-agent.result.v1',
  'value.startsWith(REQUEST_START)',
  'value.endsWith(REQUEST_END)',
  '[data-message-author-role="assistant"]',
  "plugin_id: LOCAL_AGENT_ID",
  "request('/global/health'",
  "request('/session'",
  '/prompt_async',
  "optional('/session/status'",
  '/message?limit=',
  "optionalFallback(['/permission/', '/permission']",
  "optionalFallback(['/question/', '/question']",
  "payload(job, 'needs_user'",
  "state.status = '用户处理完成，继续执行'",
  'interventionKey',
  'streaming()',
  'fillComposer',
  'clickSend',
  'processed_ids',
  'unit.started',
  '允许对话自动委派',
  '结果自动发送回对话'
]) assert(code.includes(token), `missing ${token}`);
assert(!code.includes('data-dcf-panel-root'));
console.log(JSON.stringify({ok:true,plugin_count:10,exact_artifact:true,intervention_continuation:true,automatic_return:true,no_new_panel:true}, null, 2));
