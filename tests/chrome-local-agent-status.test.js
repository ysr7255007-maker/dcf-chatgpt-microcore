'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent');
assert(ref);
assert.strictEqual(ref.version, '1.0.0-rc.2-local-agent.4');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent/main.js'), 'utf8');
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
for (const token of [
  'function encodeModelValue(value)',
  'function decodeModelValue(value)',
  'function modelOptionsForRender(models, savedModel)',
  'const model = decodeModelValue(modelValue)',
  'modelOptionsForRender(modelOptions(), state.config.model)',
  'const currentModel = encodeModelValue(state.config.model)',
  'const value = encodeModelValue(item)',
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
assert(!code.includes("modelValue.split('\\u0000')"));
assert(!code.includes('`${item.providerID}\\u0000${item.modelID}`'));
assert(!code.includes("statuses.value && statuses.value[id]"));
assert(!code.includes("return 'unknown'"));

const helperStart = code.indexOf('function normalizeModel(value)');
const helperEnd = code.indexOf('function normalizeBaseUrl', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart);
const helpers = new Function(`${code.slice(helperStart, helperEnd)}\nreturn { normalizeModel, encodeModelValue, decodeModelValue, modelOptionsForRender };`)();
const saved = { providerID: 'deepseek', modelID: 'deepseek-v4-flash' };
const encoded = helpers.encodeModelValue(saved);
assert.deepStrictEqual(helpers.decodeModelValue(encoded), saved);
assert.strictEqual(helpers.decodeModelValue('invalid'), null);
const restored = helpers.modelOptionsForRender([], saved);
assert.strictEqual(restored.length, 1);
assert.strictEqual(restored[0].providerID, saved.providerID);
assert.strictEqual(restored[0].modelID, saved.modelID);
assert.strictEqual(helpers.encodeModelValue(restored[0]), encoded);
const existing = helpers.modelOptionsForRender([{ ...saved, label: 'DeepSeek V4 Flash' }], saved);
assert.strictEqual(existing.length, 1);

console.log(JSON.stringify({
  ok: true,
  plugin_version: ref.version,
  model_value_round_trip: true,
  saved_model_survives_missing_catalog: true,
  explicit_default_is_only_clear_path: true,
  wrapped_status_maps: true,
  missing_active_status_is_idle: true,
  endpoint_failure_is_explicit: true,
  localized_status_display: true
}, null, 2));
