'use strict';

function createAmmoModule(engine, effectRunner) {
  function items() {
    const registry = engine.getRegistry();
    return Object.values(registry.content && registry.content.ammo || {}).sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
  }

  function fire(item) {
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    return effectRunner.run({ type: mode === 'send' ? 'composer.send' : 'composer.insert', text: String(item.body || '') }, { module: 'ammo', item_id: item.id });
  }

  function copy(item) {
    return effectRunner.run({ type: 'clipboard.write', text: String(item.body || '') }, { module: 'ammo', item_id: item.id });
  }

  function requestUpdate(item) {
    const prompt = [
      '请根据当前对话更新下面这条 DCF 语言弹药。',
      '保留相同 id，返回且只返回一份完整的 DCF_AMMO 工件；DCF 会在回复完成后自动装填。',
      '',
      JSON.stringify(item, null, 2)
    ].join('\n');
    return effectRunner.run({ type: 'composer.send', text: prompt }, { module: 'ammo', action: 'update', item_id: item.id });
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

module.exports = { createAmmoModule };
