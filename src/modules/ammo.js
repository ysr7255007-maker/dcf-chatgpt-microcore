'use strict';

const DEFAULT_AMMO_PROTOCOL = {
  invocation_marker: '〔DCF·语言弹药〕',
  update_marker: '〔DCF·弹药更新〕',
  update_intro: '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
  update_rules: [
    '保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
    '吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
    '这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。'
  ],
  output_instruction: '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
};

function ammoProtocol(registry) {
  const configured = registry && registry.policies && registry.policies.ammo_protocol || {};
  return {
    invocation_marker: String(configured.invocation_marker || DEFAULT_AMMO_PROTOCOL.invocation_marker),
    update_marker: String(configured.update_marker || DEFAULT_AMMO_PROTOCOL.update_marker),
    update_intro: String(configured.update_intro || DEFAULT_AMMO_PROTOCOL.update_intro),
    update_rules: Array.isArray(configured.update_rules) && configured.update_rules.length ? configured.update_rules.map(String) : DEFAULT_AMMO_PROTOCOL.update_rules.slice(),
    output_instruction: String(configured.output_instruction || DEFAULT_AMMO_PROTOCOL.output_instruction)
  };
}

function buildAmmoInvocation(item, protocol = DEFAULT_AMMO_PROTOCOL) {
  return [String(protocol.invocation_marker || DEFAULT_AMMO_PROTOCOL.invocation_marker), '', String(item && item.body || '')].join('\n');
}

function buildAmmoUpdateRequest(item, protocol = DEFAULT_AMMO_PROTOCOL) {
  const rules = Array.isArray(protocol.update_rules) ? protocol.update_rules : DEFAULT_AMMO_PROTOCOL.update_rules;
  return [
    String(protocol.update_marker || DEFAULT_AMMO_PROTOCOL.update_marker),
    '',
    String(protocol.update_intro || DEFAULT_AMMO_PROTOCOL.update_intro),
    ...rules.map((rule) => `- ${String(rule)}`),
    '',
    String(protocol.output_instruction || DEFAULT_AMMO_PROTOCOL.output_instruction),
    '',
    '当前弹药：',
    JSON.stringify(item, null, 2)
  ].join('\n');
}

function createAmmoModule(engine, effectRunner) {
  function items() {
    const registry = engine.getRegistry();
    return Object.values(registry.content && registry.content.ammo || {}).sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
  }

  function protocol() {
    return ammoProtocol(engine.getRegistry());
  }

  function fire(item) {
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    return effectRunner.run({ type: mode === 'send' ? 'composer.send' : 'composer.insert', text: buildAmmoInvocation(item, protocol()) }, { module: 'ammo', action: 'invoke', item_id: item.id });
  }

  function copy(item) {
    return effectRunner.run({ type: 'clipboard.write', text: String(item.body || '') }, { module: 'ammo', item_id: item.id });
  }

  function requestUpdate(item) {
    return effectRunner.run({ type: 'composer.send', text: buildAmmoUpdateRequest(item, protocol()) }, { module: 'ammo', action: 'update', item_id: item.id });
  }

  function requestExtract() {
    const prompt = [
      '请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。',
      '返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
    ].join('\n');
    return effectRunner.run({ type: 'composer.send', text: prompt }, { module: 'ammo', action: 'extract' });
  }

  return { items, fire, copy, requestUpdate, requestExtract };
}

module.exports = { DEFAULT_AMMO_PROTOCOL, ammoProtocol, buildAmmoInvocation, buildAmmoUpdateRequest, createAmmoModule };