'use strict';

const { clone, hash } = require('../core/utils');

function sanitizeValue(value, key = '') {
  const lower = String(key).toLowerCase();
  if (/text|body|prompt|content|token|secret|password|authorization|cookie/.test(lower)) {
    const text = String(value == null ? '' : value);
    return { redacted: true, length: text.length, hash: hash(text) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = sanitizeValue(childValue, childKey);
    return out;
  }
  return value;
}

function commandList(module) {
  const out = [];
  for (const command of Array.isArray(module.commands) ? module.commands : []) out.push({ block: null, command });
  for (const block of Array.isArray(module.blocks) ? module.blocks : []) {
    for (const command of Array.isArray(block.commands) ? block.commands : []) out.push({ block, command });
  }
  return out;
}

function createCommandRunner(engine, effectRunner, receiptStore, shellObserver) {
  async function runStep(step, context) {
    const call = String(step.call || '');
    const args = clone(step.with || step.args || {});
    const before = {
      state_hash: engine.getRoot().state_hash,
      revision: engine.getRoot().revision,
      appearance: clone(engine.getRegistry().appearance.vars)
    };
    let result;
    if (call === 'appearance.adjust') {
      result = engine.transact({ type: 'capability.appearance.adjust', module_id: context.module_id, command_id: context.command_id }, (candidate) => {
        const vars = candidate.user.appearance.vars || (candidate.user.appearance.vars = {});
        for (const key of ['w', 'h', 'top', 'bottom']) {
          if (args[key] == null) continue;
          const current = Number.parseInt(String(vars[key] || engine.getRegistry().appearance.vars[key] || '0'), 10) || 0;
          const minimum = key === 'w' ? 240 : key === 'h' ? 300 : 0;
          vars[key] = `${Math.max(minimum, current + Number(args[key]))}px`;
        }
        if (args.offset != null) {
          const anchor = vars.anchor || engine.getRegistry().appearance.vars.anchor || 'bottom';
          const key = anchor === 'top' ? 'top' : 'bottom';
          const current = Number.parseInt(String(vars[key] || engine.getRegistry().appearance.vars[key] || (key === 'top' ? '12px' : '112px')), 10) || 0;
          vars[key] = `${Math.max(0, current + Number(args.offset))}px`;
        }
        if (args.anchor) vars.anchor = args.anchor === 'top' ? 'top' : 'bottom';
        if (args.side === 'toggle') candidate.user.appearance.side = engine.getRegistry().appearance.side === 'left' ? 'right' : 'left';
        else if (args.side) candidate.user.appearance.side = args.side === 'left' ? 'left' : 'right';
        candidate.user.revision += 1;
      });
    } else if (call === 'appearance.set') {
      result = engine.transact({ type: 'capability.appearance.set', module_id: context.module_id, command_id: context.command_id }, (candidate) => {
        if (args.side) candidate.user.appearance.side = args.side === 'left' ? 'left' : 'right';
        for (const [key, value] of Object.entries(args.vars || {})) candidate.user.appearance.vars[key] = value;
        candidate.user.revision += 1;
      });
    } else if (call === 'settings.set') {
      if (!args.key) throw new Error('settings.set requires key');
      result = engine.setUserPath(['settings', String(args.key)], args.value);
    } else if (call === 'content.upsert') {
      result = engine.upsertContent(String(args.type || 'ammo'), args.item || {}, null);
    } else if (call === 'content.remove') {
      result = engine.removeContent(String(args.type || 'ammo'), String(args.id || ''));
    } else if (call === 'composer.replace' || call === 'composer.insert') {
      result = await effectRunner.run({ type: 'composer.insert', text: String(args.text || '') }, context);
    } else if (call === 'composer.send') {
      result = await effectRunner.run({ type: 'composer.send', text: String(args.text || '') }, context);
    } else if (call === 'clipboard.write') {
      result = await effectRunner.run({ type: 'clipboard.write', text: String(args.text || '') }, context);
    } else if (call === 'notification.show') {
      result = await effectRunner.run({ type: 'notification', text: String(args.text || '') }, context);
    } else {
      throw new Error(`unknown capability ${call}`);
    }
    const after = {
      state_hash: engine.getRoot().state_hash,
      revision: engine.getRoot().revision,
      appearance: clone(engine.getRegistry().appearance.vars),
      shell: typeof shellObserver === 'function' ? shellObserver() : null
    };
    return { call, input: sanitizeValue(args), before, after, result: sanitizeValue(result, 'result') };
  }

  async function execute(module, command, block) {
    const context = { module_id: module.id, module_version: module.version || null, block_id: block && block.id || null, command_id: command.id };
    const trace = {
      schema: 'dcf.command.receipt.v3',
      trace_id: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      context,
      status: 'running',
      steps: []
    };
    try {
      for (const step of Array.isArray(command.steps) ? command.steps : []) trace.steps.push(await runStep(step, context));
      trace.status = 'ok';
    } catch (error) {
      trace.status = 'error';
      trace.error = String(error && error.message || error);
    }
    receiptStore.append(trace);
    return trace;
  }

  return { execute, commandList, sanitizeValue };
}

module.exports = { createCommandRunner, commandList, sanitizeValue };
