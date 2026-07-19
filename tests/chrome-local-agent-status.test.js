'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent');
assert(ref);
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent.3');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent/main.js'), 'utf8');
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
for (const token of [
  'function statusCollection(value)',
  'value.sessions',
  'value.data?.sessions',
  'function sessionStatusFrom(value, id)',
  'function currentStatusType()',
  "return 'unavailable'",
  "return statusType(state.session_status, 'idle')",
  "none: '未选择会话'",
  "idle: '空闲'",
  "busy: '运行中'",
  "unavailable: '状态不可用'",
  'state.session_status = sessionStatusFrom(statuses.value, id)',
  'state.endpoint_errors.status'
]) assert(code.includes(token), `missing ${token}`);
assert(!code.includes("statuses.value && statuses.value[id]"));
assert(!code.includes("return 'unknown'"));
console.log(JSON.stringify({
  ok: true,
  wrapped_status_maps: true,
  missing_active_status_is_idle: true,
  endpoint_failure_is_explicit: true,
  localized_status_display: true
}, null, 2));
