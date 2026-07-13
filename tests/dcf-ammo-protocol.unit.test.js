'use strict';

const assert = require('assert');
const { createAmmoModule, buildAmmoInvocation, buildAmmoUpdateRequest } = require('../src/modules/ammo');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

const ammoPack = STANDARD_PACKS.find((pack) => pack.pack_id === 'dcf.standard.ammo');
assert(ammoPack, 'standard ammo package missing');
assert.strictEqual(ammoPack.revision, '1.2.0');
const protocol = ammoPack.contributes.policies.ammo_protocol;
const item = {
  id: 'method.complete-candidates',
  title: '完整候选方案',
  purpose: '避免用陪衬方案制造强迫选择',
  body: '候选方案必须是真正完整、同层级、可以独立成立的方案。'
};

const invocation = buildAmmoInvocation(item, protocol);
assert.strictEqual(invocation, `〔DCF·语言弹药〕\n\n${item.body}`);
assert(!invocation.includes('请先'), 'invocation should stay lightweight and rely on the marker semantics');

const updateRequest = buildAmmoUpdateRequest(item, protocol);
assert(updateRequest.startsWith('〔DCF·弹药更新〕\n\n'));
assert(updateRequest.includes('当前对话作为本次修订的语境和依据'));
assert(updateRequest.includes('不要只做措辞润色'));
assert(updateRequest.includes('必须保留原有 id'));
assert(updateRequest.includes('返回且只返回一份完整的 DCF_AMMO 工件'));
assert(updateRequest.includes(JSON.stringify(item, null, 2)));

const effects = [];
const engine = {
  getRegistry() { return { content: { ammo: { [item.id]: item } }, policies: { ammo_protocol: protocol } }; },
  getRoot() { return { user: { preferences: { ammo_fire_mode: 'send' } } }; }
};
const effectRunner = {
  async run(effect, context) {
    effects.push({ effect, context });
    return { ok: true };
  }
};
const ammo = createAmmoModule(engine, effectRunner);

(async () => {
  await ammo.fire(item);
  assert.strictEqual(effects[0].effect.type, 'composer.send');
  assert.strictEqual(effects[0].effect.text, invocation);
  assert.strictEqual(effects[0].context.action, 'invoke');

  await ammo.requestUpdate(item);
  assert.strictEqual(effects[1].effect.type, 'composer.send');
  assert.strictEqual(effects[1].effect.text, updateRequest);
  assert.strictEqual(effects[1].context.action, 'update');

  await ammo.copy(item);
  assert.strictEqual(effects[2].effect.type, 'clipboard.write');
  assert.strictEqual(effects[2].effect.text, item.body, 'copy remains a raw-body export rather than an invocation');

  console.log(JSON.stringify({
    ok: true,
    lightweight_invocation_marker: true,
    contextual_reinterpretation_protocol: true,
    substantive_update_contract: true,
    package_owned_protocol_policy: true,
    raw_copy_preserved: true
  }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
