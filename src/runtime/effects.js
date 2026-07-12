'use strict';

const { hash } = require('../core/utils');

function safeEffect(effect) {
  const copy = Object.assign({}, effect);
  if ('text' in copy) {
    const text = String(copy.text || '');
    copy.text = { redacted: true, length: text.length, hash: hash(text) };
  }
  return copy;
}

function createEffectRunner(host, receiptStore) {
  async function run(effect, context = {}) {
    const started = Date.now();
    try {
      let result;
      if (effect.type === 'composer.insert') result = await host.insertComposer(String(effect.text || ''), { send: false });
      else if (effect.type === 'composer.send') result = await host.insertComposer(String(effect.text || ''), { send: true });
      else if (effect.type === 'clipboard.write') result = await host.copy(String(effect.text || ''));
      else if (effect.type === 'notification') result = await host.notify(String(effect.text || 'DCF'));
      else throw new Error(`unsupported effect ${effect.type}`);
      receiptStore.append({ schema: 'dcf.effect.receipt.v1', effect: safeEffect(effect), context, status: 'ok', result, duration_ms: Date.now() - started });
      return { ok: true, result };
    } catch (error) {
      receiptStore.append({ schema: 'dcf.effect.receipt.v1', effect: safeEffect(effect), context, status: 'error', error: String(error && error.message || error), duration_ms: Date.now() - started });
      return { ok: false, error };
    }
  }
  return { run };
}

module.exports = { createEffectRunner };
