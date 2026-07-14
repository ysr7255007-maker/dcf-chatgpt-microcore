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

function createEffectRunner(host, receiptStore, performanceController) {
  async function run(effect, context = {}) {
    const started = Date.now();
    try {
      let result;
      if (effect.type === 'composer.insert') result = await host.insertComposer(String(effect.text || ''), { send: false });
      else if (effect.type === 'composer.send') result = await host.insertComposer(String(effect.text || ''), { send: true });
      else if (effect.type === 'clipboard.write') result = await host.copy(String(effect.text || ''));
      else if (effect.type === 'notification') result = await host.notify(String(effect.text || 'DCF'));
      else if (effect.type === 'conversation.performance.reveal') {
        if (!performanceController) throw new Error('conversation performance controller unavailable');
        result = performanceController.revealPreviousBatch();
      } else if (effect.type === 'conversation.performance.report') {
        if (!performanceController) throw new Error('conversation performance controller unavailable');
        const report = `<<<DCF_CONVERSATION_PERFORMANCE\n${JSON.stringify(performanceController.diagnostics(), null, 2)}\nDCF_CONVERSATION_PERFORMANCE>>>`;
        result = await host.copy(report);
      } else if (effect.type === 'conversation.performance.attribution.start') {
        if (!performanceController) throw new Error('conversation performance controller unavailable');
        result = performanceController.startAttribution({ duration_ms: Number(effect.duration_ms || 60000) });
      } else if (effect.type === 'conversation.performance.attribution.report') {
        if (!performanceController) throw new Error('conversation performance controller unavailable');
        const attribution = effect.finish === false ? performanceController.attributionReport() : performanceController.finishAttribution('manual');
        const report = `<<<DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION\n${JSON.stringify(attribution, null, 2)}\nDCF_CONVERSATION_PERFORMANCE_ATTRIBUTION>>>`;
        result = await host.copy(report);
      } else throw new Error(`unsupported effect ${effect.type}`);
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
