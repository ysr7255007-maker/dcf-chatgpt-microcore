from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


controller = r'''\'use strict\';

const { nowIso } = require('../core/utils');

const MODES = new Set(['off', 'safe', 'window']);

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function normalizePerformancePolicy(value) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = MODES.has(String(source.mode || '')) ? String(source.mode) : 'safe';
  return {
    schema: 'dcf.conversation-performance.policy.v1',
    mode,
    activation_turns: clamp(source.activation_turns, 4, 500, 24),
    keep_recent: clamp(source.keep_recent, 8, 240, 40),
    reveal_batch: clamp(source.reveal_batch, 4, 120, 20),
    settle_ms: clamp(source.settle_ms, 200, 5000, 1000),
    top_reveal_px: clamp(source.top_reveal_px, 40, 800, 220),
    intrinsic_block_px: clamp(source.intrinsic_block_px, 80, 2000, 480)
  };
}

function planTurnWindow(turnCount, keepRecent, revealedOlder = 0) {
  const count = Math.max(0, Number(turnCount) || 0);
  const keep = Math.max(0, Number(keepRecent) || 0);
  const revealed = Math.max(0, Number(revealedOlder) || 0);
  const hidden = Math.max(0, count - keep - revealed);
  return { turn_count: count, hidden_count: hidden, visible_start: hidden, visible_count: count - hidden };
}

function createConversationPerformanceController(windowObject = window, options = {}) {
  const doc = windowObject.document;
  const findConversationRoot = typeof options.findConversationRoot === 'function' ? options.findConversationRoot : () => doc.querySelector('main,[role="main"]');
  const isStreaming = typeof options.isStreaming === 'function' ? options.isStreaming : () => false;
  let policy = normalizePerformancePolicy(options.policy || {});
  let observer = null;
  let observedRoot = null;
  let routeTimer = null;
  let settleTimer = null;
  let scrollElement = null;
  let scrollHandler = null;
  let lastHref = String(windowObject.location && windowObject.location.href || '');
  let revealedOlder = 0;
  let selectorStrategy = 'none';
  let lastApplyAt = null;
  let lastApplyDurationMs = 0;
  let lastTurnCount = 0;
  let lastHiddenCount = 0;
  let lastOptimizedCount = 0;
  let longTaskObserver = null;
  let longTasks = [];
  const originalStyles = new WeakMap();
  const managedNodes = new Set();
  const hiddenNodes = new Set();

  function routeKind() {
    const pathname = String(windowObject.location && windowObject.location.pathname || '/');
    if (/^\/c\/[^/]+/.test(pathname)) return '/c/:conversation';
    if (/^\/g\/[^/]+\/c\/[^/]+/.test(pathname)) return '/g/:gpt/c/:conversation';
    return pathname.replace(/[0-9a-f]{8,}/gi, ':id');
  }

  function topmostUnique(nodes) {
    const unique = Array.from(new Set((nodes || []).filter((node) => node && node.nodeType === 1 && node.isConnected)));
    return unique.filter((node) => !unique.some((other) => other !== node && other.contains(node)));
  }

  function findTurns() {
    const root = findConversationRoot();
    if (!root) {
      selectorStrategy = 'none';
      return [];
    }
    const candidates = [
      ['article-testid', 'article[data-testid^="conversation-turn-"],article[data-testid*="conversation-turn"]'],
      ['testid', '[data-testid^="conversation-turn-"],[data-testid*="conversation-turn"]'],
      ['role-article', 'article']
    ];
    for (const [strategy, selector] of candidates) {
      let nodes = Array.from(root.querySelectorAll(selector));
      if (strategy === 'role-article') nodes = nodes.filter((node) => node.querySelector('[data-message-author-role="user"],[data-message-author-role="assistant"]'));
      nodes = topmostUnique(nodes);
      if (nodes.length >= 2) {
        selectorStrategy = strategy;
        return nodes;
      }
    }
    const roles = Array.from(root.querySelectorAll('[data-message-author-role="user"],[data-message-author-role="assistant"]'));
    const wrappers = topmostUnique(roles.map((node) => node.closest('article') || node.parentElement || node));
    selectorStrategy = wrappers.length ? 'role-wrapper' : 'none';
    return wrappers;
  }

  function findScrollableAncestor(node) {
    let cursor = node && node.parentElement;
    while (cursor && cursor !== doc.body) {
      const style = windowObject.getComputedStyle ? windowObject.getComputedStyle(cursor) : null;
      const overflowY = style && style.overflowY || '';
      if ((overflowY === 'auto' || overflowY === 'scroll') && cursor.scrollHeight > cursor.clientHeight + 80) return cursor;
      cursor = cursor.parentElement;
    }
    return doc.scrollingElement || doc.documentElement;
  }

  function captureOriginal(node) {
    if (originalStyles.has(node)) return;
    const names = ['content-visibility', 'contain-intrinsic-size', 'display'];
    const values = {};
    for (const name of names) values[name] = { value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name) };
    originalStyles.set(node, values);
  }

  function restoreProperty(node, name) {
    const original = originalStyles.get(node);
    const entry = original && original[name];
    if (entry && entry.value) node.style.setProperty(name, entry.value, entry.priority || '');
    else node.style.removeProperty(name);
  }

  function applySafe(node) {
    captureOriginal(node);
    restoreProperty(node, 'display');
    node.style.setProperty('content-visibility', 'auto');
    node.style.setProperty('contain-intrinsic-size', `auto ${policy.intrinsic_block_px}px`);
    node.dataset.dcfPerformanceState = 'safe';
    managedNodes.add(node);
    hiddenNodes.delete(node);
  }

  function applyHidden(node) {
    captureOriginal(node);
    node.style.setProperty('content-visibility', 'hidden');
    node.style.setProperty('contain-intrinsic-size', `auto ${policy.intrinsic_block_px}px`);
    node.style.setProperty('display', 'none', 'important');
    node.dataset.dcfPerformanceState = 'window-hidden';
    managedNodes.add(node);
    hiddenNodes.add(node);
  }

  function restoreNode(node) {
    if (!node) return;
    for (const name of ['content-visibility', 'contain-intrinsic-size', 'display']) restoreProperty(node, name);
    if (node.dataset) delete node.dataset.dcfPerformanceState;
    managedNodes.delete(node);
    hiddenNodes.delete(node);
  }

  function restoreAllManaged() {
    for (const node of Array.from(managedNodes)) restoreNode(node);
    lastHiddenCount = 0;
    lastOptimizedCount = 0;
  }

  function pruneManaged(currentTurns) {
    const current = new Set(currentTurns);
    for (const node of Array.from(managedNodes)) if (!node.isConnected || !current.has(node)) restoreNode(node);
  }

  function bindScroll(turns) {
    const next = turns.length ? findScrollableAncestor(turns[turns.length - 1]) : null;
    if (scrollElement === next && scrollHandler) return;
    if (scrollElement && scrollHandler) scrollElement.removeEventListener('scroll', scrollHandler);
    scrollElement = next;
    scrollHandler = () => {
      if (policy.mode !== 'window' || !scrollElement || !lastHiddenCount || isStreaming()) return;
      if (scrollElement.scrollTop > policy.top_reveal_px) return;
      revealPreviousBatch({ automatic: true });
    };
    if (scrollElement) scrollElement.addEventListener('scroll', scrollHandler, { passive: true });
  }

  function applyNow(options = {}) {
    const started = Date.now();
    const turns = findTurns();
    lastTurnCount = turns.length;
    pruneManaged(turns);
    bindScroll(turns);
    if (policy.mode === 'off' || turns.length < policy.activation_turns) {
      restoreAllManaged();
      lastApplyAt = nowIso();
      lastApplyDurationMs = Date.now() - started;
      return diagnostics();
    }
    if (isStreaming() && !options.force) {
      scheduleApply(policy.settle_ms);
      return diagnostics();
    }
    const scroll = scrollElement;
    const beforeHeight = scroll && Number(scroll.scrollHeight || 0);
    const beforeTop = scroll && Number(scroll.scrollTop || 0);
    const beforeBottom = scroll && Math.max(0, Number(scroll.scrollHeight || 0) - Number(scroll.scrollTop || 0) - Number(scroll.clientHeight || 0));
    const plan = policy.mode === 'window' ? planTurnWindow(turns.length, policy.keep_recent, revealedOlder) : planTurnWindow(turns.length, turns.length, 0);
    turns.forEach((node, index) => {
      if (policy.mode === 'window' && index < plan.hidden_count) applyHidden(node);
      else applySafe(node);
    });
    lastHiddenCount = plan.hidden_count;
    lastOptimizedCount = turns.length;
    lastApplyAt = nowIso();
    lastApplyDurationMs = Date.now() - started;
    if (scroll && options.preserveTop) {
      windowObject.requestAnimationFrame(() => {
        const delta = Number(scroll.scrollHeight || 0) - beforeHeight;
        scroll.scrollTop = Math.max(0, beforeTop + delta);
      });
    } else if (scroll && policy.mode === 'window') {
      windowObject.requestAnimationFrame(() => {
        scroll.scrollTop = Math.max(0, Number(scroll.scrollHeight || 0) - Number(scroll.clientHeight || 0) - beforeBottom);
      });
    }
    return diagnostics();
  }

  function scheduleApply(delay = policy.settle_ms) {
    if (settleTimer) windowObject.clearTimeout(settleTimer);
    settleTimer = windowObject.setTimeout(() => {
      settleTimer = null;
      applyNow();
    }, Math.max(0, Number(delay) || 0));
  }

  function revealPreviousBatch(options = {}) {
    if (policy.mode !== 'window' || !lastHiddenCount) return diagnostics();
    revealedOlder += policy.reveal_batch;
    return applyNow({ preserveTop: true, force: options.automatic !== true });
  }

  function attachRoot() {
    const root = findConversationRoot();
    if (root === observedRoot && observer) return true;
    if (observer) observer.disconnect();
    observer = null;
    observedRoot = root;
    if (!root) return false;
    observer = new windowObject.MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length || mutation.removedNodes && mutation.removedNodes.length)) scheduleApply();
    });
    observer.observe(root, { childList: true, subtree: true });
    return true;
  }

  function startLongTaskObservation() {
    const PerformanceObserverCtor = windowObject.PerformanceObserver;
    const supported = PerformanceObserverCtor && Array.isArray(PerformanceObserverCtor.supportedEntryTypes) && PerformanceObserverCtor.supportedEntryTypes.includes('longtask');
    if (!supported || longTaskObserver) return;
    try {
      longTaskObserver = new PerformanceObserverCtor((list) => {
        const now = Date.now();
        for (const entry of list.getEntries()) longTasks.push({ at: now, duration: Math.round(Number(entry.duration || 0)) });
        longTasks = longTasks.filter((item) => item.at >= now - 60000).slice(-200);
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      longTaskObserver = null;
    }
  }

  function ensureStarted() {
    attachRoot();
    startLongTaskObservation();
    if (!routeTimer) {
      routeTimer = windowObject.setInterval(() => {
        const href = String(windowObject.location && windowObject.location.href || '');
        if (href !== lastHref) {
          lastHref = href;
          restoreAllManaged();
          revealedOlder = 0;
          if (observer) observer.disconnect();
          observer = null;
          observedRoot = null;
        }
        attachRoot();
        scheduleApply();
      }, 1200);
    }
  }

  function syncPolicy(value) {
    const next = normalizePerformancePolicy(value);
    if (next.mode !== policy.mode || next.keep_recent !== policy.keep_recent) revealedOlder = 0;
    policy = next;
    ensureStarted();
    if (policy.mode === 'off') restoreAllManaged();
    else scheduleApply(0);
    return diagnostics();
  }

  function diagnostics() {
    const now = Date.now();
    longTasks = longTasks.filter((item) => item.at >= now - 60000);
    const root = findConversationRoot();
    return {
      schema: 'dcf.conversation-performance.runtime.v1',
      route_kind: routeKind(),
      mode: policy.mode,
      activation_turns: policy.activation_turns,
      keep_recent: policy.keep_recent,
      reveal_batch: policy.reveal_batch,
      conversation_root_found: !!root,
      observed_root_connected: !!(observedRoot && observedRoot.isConnected),
      selector_strategy: selectorStrategy,
      turn_count: lastTurnCount,
      optimized_count: lastOptimizedCount,
      hidden_count: lastHiddenCount,
      revealed_older: revealedOlder,
      streaming: !!isStreaming(),
      content_visibility_supported: !!(windowObject.CSS && typeof windowObject.CSS.supports === 'function' && windowObject.CSS.supports('content-visibility', 'auto')),
      long_task_observer_supported: !!(windowObject.PerformanceObserver && Array.isArray(windowObject.PerformanceObserver.supportedEntryTypes) && windowObject.PerformanceObserver.supportedEntryTypes.includes('longtask')),
      long_tasks_60s: longTasks.length,
      long_task_duration_ms_60s: longTasks.reduce((sum, item) => sum + item.duration, 0),
      last_apply_at: lastApplyAt,
      last_apply_duration_ms: lastApplyDurationMs,
      mutation_strategy: 'style-only; no ChatGPT node removal or replacement'
    };
  }

  function destroy() {
    restoreAllManaged();
    if (observer) observer.disconnect();
    if (routeTimer) windowObject.clearInterval(routeTimer);
    if (settleTimer) windowObject.clearTimeout(settleTimer);
    if (scrollElement && scrollHandler) scrollElement.removeEventListener('scroll', scrollHandler);
    if (longTaskObserver) longTaskObserver.disconnect();
    observer = null;
    routeTimer = null;
    settleTimer = null;
    scrollElement = null;
    scrollHandler = null;
    longTaskObserver = null;
  }

  ensureStarted();
  return { syncPolicy, applyNow, revealPreviousBatch, diagnostics, destroy, findTurns };
}

module.exports = { createConversationPerformanceController, normalizePerformancePolicy, planTurnWindow };
'''.replace("\\'use strict\\';", "'use strict';", 1)
write('src/host/conversation-performance.js', controller)

# Version and test entry.
constants = read('src/core/constants.js').replace("const VERSION = '0.15.0';", "const VERSION = '0.16.0';")
write('src/core/constants.js', constants)

package = json.loads(read('package.json'))
package['version'] = '0.16.0'
needle = 'node tests/dcf-supersession-health.unit.test.js && '
if needle not in package['scripts']['test']:
    raise RuntimeError('package test insertion point missing')
package['scripts']['test'] = package['scripts']['test'].replace(needle, needle + 'node tests/dcf-conversation-performance.unit.test.js && ', 1)
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')

# First-party package and policy.
packs = read('src/modules/standard-packages.js')
packs = replace_once(
    packs,
    "const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management', 'dcf.ui.runtime-workspace'];",
    "const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management', 'dcf.ui.runtime-workspace', 'dcf.standard.conversation-performance'];",
    'required performance package'
)
performance_pack = r'''  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.conversation-performance',
    revision: '1.0.0',
    title: '长对话减负',
    description: '降低 ChatGPT 长对话的浏览器渲染负担，并提供可逆的历史消息窗口。',
    contributes: {
      policies: {
        conversation_performance: {
          mode: 'safe', activation_turns: 24, keep_recent: 40, reveal_batch: 20,
          settle_ms: 1000, top_reveal_px: 220, intrinsic_block_px: 480
        }
      },
      module_display: { 'dcf.standard.conversation-performance': { area: 'work', role: 'daily', order: 40 } }
    },
    modules: [{
      id: 'dcf.standard.conversation-performance', title: '长对话减负', version: '1.0.0', kind: 'conversation-performance',
      blocks: [
        { id: 'mode', title: '减负模式', commands: [
          { id: 'safe', label: '透明减负（推荐）', steps: [{ call: 'conversation.performance.configure', with: { mode: 'safe' } }] },
          { id: 'window40', label: '窗口化：最近 40 条', steps: [{ call: 'conversation.performance.configure', with: { mode: 'window', keep_recent: 40 } }] },
          { id: 'window20', label: '窗口化：最近 20 条', steps: [{ call: 'conversation.performance.configure', with: { mode: 'window', keep_recent: 20 } }] },
          { id: 'off', label: '恢复全部并关闭', steps: [{ call: 'conversation.performance.configure', with: { mode: 'off' } }] }
        ] },
        { id: 'history', title: '历史消息与观察', commands: [
          { id: 'reveal', label: '展开上一批', steps: [{ call: 'conversation.performance.reveal' }] },
          { id: 'report', label: '复制性能摘要', steps: [{ call: 'conversation.performance.report' }] }
        ] }
      ]
    }]
  },
'''
marker = "  {\n    schema: 'dcf.module_pack.v1',\n    pack_id: 'dcf.standard.shell-adjuster',"
packs = replace_once(packs, marker, performance_pack + marker, 'insert performance pack')
write('src/modules/standard-packages.js', packs)

# Command and effect capabilities.
commands = read('src/runtime/commands.js')
old = "    } else if (call === 'content.remove') {\n      result = environmentIntent({ type: 'environment.resource.remove', resource_type: String(args.type || 'ammo'), resource_id: String(args.id || ''), source: { module_id: context.module_id, command_id: context.command_id } });\n    } else if (call === 'composer.replace' || call === 'composer.insert') {"
new = "    } else if (call === 'content.remove') {\n      result = environmentIntent({ type: 'environment.resource.remove', resource_type: String(args.type || 'ammo'), resource_id: String(args.id || ''), source: { module_id: context.module_id, command_id: context.command_id } });\n    } else if (call === 'conversation.performance.configure') {\n      const current = clone(engine.getRoot().user.preferences && engine.getRoot().user.preferences.conversation_performance || engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});\n      result = environmentIntent({ type: 'environment.user.set', path: ['preferences', 'conversation_performance'], source: { module_id: context.module_id, command_id: context.command_id } }, { value: Object.assign(current, args) });\n    } else if (call === 'conversation.performance.reveal') {\n      result = await effectRunner.run({ type: 'conversation.performance.reveal' }, context);\n    } else if (call === 'conversation.performance.report') {\n      result = await effectRunner.run({ type: 'conversation.performance.report' }, context);\n    } else if (call === 'composer.replace' || call === 'composer.insert') {"
commands = replace_once(commands, old, new, 'performance commands')
write('src/runtime/commands.js', commands)

effects = read('src/runtime/effects.js')
effects = replace_once(effects, 'function createEffectRunner(host, receiptStore) {', 'function createEffectRunner(host, receiptStore, performanceController) {', 'effect runner signature')
old = "      else if (effect.type === 'notification') result = await host.notify(String(effect.text || 'DCF'));\n      else throw new Error(`unsupported effect ${effect.type}`);"
new = "      else if (effect.type === 'notification') result = await host.notify(String(effect.text || 'DCF'));\n      else if (effect.type === 'conversation.performance.reveal') {\n        if (!performanceController) throw new Error('conversation performance controller unavailable');\n        result = performanceController.revealPreviousBatch();\n      } else if (effect.type === 'conversation.performance.report') {\n        if (!performanceController) throw new Error('conversation performance controller unavailable');\n        const report = `<<<DCF_CONVERSATION_PERFORMANCE\\n${JSON.stringify(performanceController.diagnostics(), null, 2)}\\nDCF_CONVERSATION_PERFORMANCE>>>`;\n        result = await host.copy(report);\n      } else throw new Error(`unsupported effect ${effect.type}`);"
effects = replace_once(effects, old, new, 'performance effects')
write('src/runtime/effects.js', effects)

# Boot integration and live policy sync.
index = read('src/index.js')
index = replace_once(index, "const { createChatGPTHost } = require('./host/chatgpt');", "const { createChatGPTHost } = require('./host/chatgpt');\nconst { createConversationPerformanceController } = require('./host/conversation-performance');", 'performance import')
index = replace_once(index, "  const host = createChatGPTHost(windowObject);\n  const effects = createEffectRunner(host, receiptStore);", "  const host = createChatGPTHost(windowObject);\n  const conversationPerformance = createConversationPerformanceController(windowObject, { findConversationRoot: host.findConversationRoot, isStreaming: host.isStreaming });\n  conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});\n  const effects = createEffectRunner(host, receiptStore, conversationPerformance);", 'performance controller boot')
index = replace_once(index, "    onCommitted: () => { if (app) app.render(); }", "    onCommitted: () => {\n      conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});\n      if (app) app.render();\n    }", 'performance policy sync')
index = replace_once(index, "    getRuntime: () => api.__DCF_RUNTIME__ || null\n  });", "    getRuntime: () => api.__DCF_RUNTIME__ || null,\n    getPerformance: () => conversationPerformance.diagnostics()\n  });", 'health performance source')
index = replace_once(index, "  const runtime = { version: VERSION, engine, getEnvironment: () => engine.getEnvironment(), host, app, catalog, reconciler, receiptStore, health, maintenance };", "  const runtime = { version: VERSION, engine, getEnvironment: () => engine.getEnvironment(), host, conversationPerformance, app, catalog, reconciler, receiptStore, health, maintenance };", 'runtime performance export')
write('src/index.js', index)

# Runtime health includes privacy-safe performance state and checks controller presence.
health = read('src/modules/health.js')
health = replace_once(health, "    const app = typeof runtime.getApp === 'function' ? runtime.getApp() : null;\n    const deviations = [];", "    const app = typeof runtime.getApp === 'function' ? runtime.getApp() : null;\n    const performanceState = typeof runtime.getPerformance === 'function' ? runtime.getPerformance() : null;\n    const deviations = [];", 'health performance state')
health_anchor = "    if (!runtimeObject) {\n      add('runtime_global_missing', 'error', '__DCF_RUNTIME__', 'the current userscript instance publishes its runtime object', 'missing', null, 'The browser page does not expose the runtime object created at the end of DCF boot.');\n    } else if (runtimeObject.version !== VERSION) {\n      add('runtime_version_mismatch', 'error', '__DCF_RUNTIME__.version', VERSION, runtimeObject.version || null, null, 'The in-memory runtime and the installed userscript source are not the same version.');\n    }"
health_new = health_anchor + "\n    if (!performanceState) {\n      add('runtime_conversation_performance_missing', 'error', 'conversation-performance', 'the current Runtime exposes the long-conversation performance controller', 'missing', null, 'The required performance package exists without its trusted Host controller.');\n    } else if (performanceState.mode !== 'off' && performanceState.turn_count >= performanceState.activation_turns && !performanceState.content_visibility_supported) {\n      add('runtime_content_visibility_unsupported', 'warning', 'conversation-performance', 'the browser supports content-visibility:auto', false, { mode: performanceState.mode }, 'The safe rendering optimization cannot be applied by this browser; window mode remains reversible but may provide less benefit.');\n    }"
health = replace_once(health, health_anchor, health_new, 'health controller check')
health = replace_once(health, "        current_tab: ui && ui.current_tab || null\n      },", "        current_tab: ui && ui.current_tab || null,\n        conversation_performance: performanceState ? {\n          mode: performanceState.mode, turn_count: performanceState.turn_count, optimized_count: performanceState.optimized_count, hidden_count: performanceState.hidden_count,\n          selector_strategy: performanceState.selector_strategy, long_tasks_60s: performanceState.long_tasks_60s, long_task_duration_ms_60s: performanceState.long_task_duration_ms_60s\n        } : null\n      },", 'health runtime summary')
health = replace_once(health, "        authentication_data_included: false", "        authentication_data_included: false,\n        message_bodies_included: false", 'health privacy')
write('src/modules/health.js', health)

# Regression test.
test = r'''\'use strict\';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizePerformancePolicy, planTurnWindow } = require('../src/host/conversation-performance');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('../src/modules/standard-packages');

assert.deepStrictEqual(planTurnWindow(100, 40, 0), { turn_count: 100, hidden_count: 60, visible_start: 60, visible_count: 40 });
assert.deepStrictEqual(planTurnWindow(100, 40, 20), { turn_count: 100, hidden_count: 40, visible_start: 40, visible_count: 60 });
assert.deepStrictEqual(planTurnWindow(12, 40, 0), { turn_count: 12, hidden_count: 0, visible_start: 0, visible_count: 12 });

let policy = normalizePerformancePolicy({ mode: 'window', keep_recent: 1, reveal_batch: 999, activation_turns: 0, settle_ms: 1 });
assert.strictEqual(policy.mode, 'window');
assert.strictEqual(policy.keep_recent, 8);
assert.strictEqual(policy.reveal_batch, 120);
assert.strictEqual(policy.activation_turns, 4);
assert.strictEqual(policy.settle_ms, 200);
policy = normalizePerformancePolicy({ mode: 'unknown' });
assert.strictEqual(policy.mode, 'safe');

const pack = STANDARD_PACKS.find((item) => item.pack_id === 'dcf.standard.conversation-performance');
assert(pack, 'conversation performance package missing');
assert(REQUIRED_PRODUCT_PACKAGES.includes(pack.pack_id), 'conversation performance package is not in product baseline');
assert.strictEqual(pack.revision, '1.0.0');
assert.strictEqual(pack.contributes.policies.conversation_performance.mode, 'safe');
const commands = pack.modules[0].blocks.flatMap((block) => block.commands).map((command) => command.id);
for (const id of ['safe', 'window40', 'window20', 'off', 'reveal', 'report']) assert(commands.includes(id), `missing performance command ${id}`);

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'host', 'conversation-performance.js'), 'utf8');
assert(source.includes("content-visibility', 'auto"), 'safe content-visibility mode missing');
assert(source.includes("display', 'none', 'important"), 'windowed rendering control missing');
assert(source.includes('PerformanceObserver'), 'long-task observation missing');
assert(source.includes('isStreaming()'), 'streaming guard missing');
assert(source.includes('revealPreviousBatch'), 'batch reveal missing');
assert(!source.includes('.replaceWith('), 'controller replaces ChatGPT-managed nodes');
assert(!source.includes('.removeChild('), 'controller removes ChatGPT-managed nodes');
assert(!source.includes('.remove()'), 'controller removes ChatGPT-managed nodes');
assert(!source.includes('innerHTML'), 'controller rewrites ChatGPT-managed markup');

const commandSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'commands.js'), 'utf8');
assert(commandSource.includes('conversation.performance.configure'));
assert(commandSource.includes("path: ['preferences', 'conversation_performance']"), 'performance mode bypasses Environment Reconciler');
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'effects.js'), 'utf8');
assert(effectSource.includes('DCF_CONVERSATION_PERFORMANCE'));

console.log(JSON.stringify({
  ok: true,
  safe_render_skipping: true,
  reversible_window_mode: true,
  streaming_aware: true,
  batch_reveal: true,
  long_task_observation: true,
  no_react_node_removal: true,
  reconciled_policy: true
}, null, 2));
'''.replace("\\'use strict\\';", "'use strict';", 1)
write('tests/dcf-conversation-performance.unit.test.js', test)

# Documentation and ADR.
readme = read('README.md')
readme = readme.replace('DCF `0.14.0` keeps a generic modular kernel', 'DCF `0.16.0` keeps a generic modular kernel', 1)
readme = readme.replace('Marker text and update rules are owned by `dcf.standard.ammo@1.2.0`', 'Marker text and update rules are owned by `dcf.standard.ammo@1.3.0`', 1)
readme += '''\n\n## Long-conversation browser performance\n\nDCF `0.16.0` adds a trusted Host-side conversation performance governor owned by `dcf.standard.conversation-performance@1.0.0`. Its default safe mode applies browser-native `content-visibility:auto` only after a conversation reaches the configured turn threshold. Optional window modes keep the newest 40 or 20 message turns rendered and reversibly hide older turns without removing, replacing, cloning, or rewriting ChatGPT-managed nodes. Scrolling near the top or using “展开上一批” restores history in batches; “恢复全部并关闭” restores every original inline style. A privacy-safe report includes only counts, selector strategy, mode, apply duration and Long Tasks API aggregates. This addresses browser layout/paint cost, not model context limits, backend latency, outages, or unrelated extension conflicts.\n'''
write('README.md', readme)

architecture = read('docs/architecture-current.md').replace('Current release: `0.15.0`', 'Current release: `0.16.0`', 1)
architecture += '''\n\n## 13. 长对话浏览器减负（0.16.0）\n\n社区应对长对话卡顿的实践主要分为两层：浏览器原生的 `content-visibility` 离屏跳过，以及把旧消息节点替换成占位符的激进虚拟化。前者能跳过离屏内容的布局和绘制，并在 `auto` 模式下保留查找、键盘导航与可访问性；后者减负更强，但会把 React 管理节点移出 DOM，存在恢复、流式输出和宿主更新冲突。\n\nDCF 采用分级治理：\n\n- 默认 `safe`：达到 24 个消息 turn 后，仅对稳定的顶层 turn 应用 `content-visibility:auto` 与 `contain-intrinsic-size`；\n- 显式 `window`：用户选择保留最近 40 或 20 条，旧 turn 仅被可逆地设为不参与显示，不被删除、替换、克隆或改写；\n- 流式输出期间不执行窗口重排，静默期后再协调；\n- 滚动到顶部自动展开一批，也可从 DCF 功能页手动展开或恢复全部；\n- 所有持久模式选择写入 `preferences.conversation_performance`，经 Environment Reconciler 原子提交；Host controller 只是确定性执行投影；\n- Runtime 观察只记录 turn 数、隐藏数、选择器策略、执行耗时和最近 60 秒 long-task 聚合，不读取或输出消息正文。\n\n该能力只处理浏览器端布局/绘制与交互负担。模型上下文压缩、对话总长度上限、服务端首 token 延迟、网络或第三方扩展冲突仍属于其他问题。\n\nResearch basis: MDN `content-visibility` documentation; web.dev rendering guidance; community projects `povariha123/chatgpt-long-chat-lag-fix` and `YashRana738/GptOptimum`.\n'''
write('docs/architecture-current.md', architecture)

maintenance = read('docs/dcf-maintenance-skill.md')
maintenance += '''\n\n## 十二、长对话性能治理\n\n处理 ChatGPT 网页卡顿时先区分浏览器渲染、服务端延迟、模型上下文和扩展冲突。DCF 只对自己可观察且可逆的浏览器渲染层负责。默认优先使用 `content-visibility:auto`；只有用户显式选择窗口模式时才让旧 turn 退出显示。不得删除、替换、克隆或重写 ChatGPT 管理的消息节点，不得在流式生成期间重排历史 turn。\n\nHost DOM 选择器是可变适配层，不得写进权威状态。持久模式、阈值和窗口大小属于 package policy / user preference，经 Environment Reconciler 变化。性能报告不得包含消息正文、代码、附件、标题或用户输入，只保留数量、支持性、选择器策略、long-task 聚合和控制器状态。宿主结构无法可靠识别时应退化为不操作，而不是扩大选择器范围。\n'''
write('docs/dcf-maintenance-skill.md', maintenance)

consensus = read('docs/dcf-basic-consensus-prompt.md')
consensus += '''\n\n长对话减负只治理浏览器渲染层：默认使用可访问性友好的离屏渲染跳过；更强窗口化必须显式开启且完全可逆。DCF 不删除或替换 ChatGPT 管理的消息节点，不在流式输出时重排历史，不把浏览器减负宣传成模型上下文或服务端延迟解决方案。\n'''
write('docs/dcf-basic-consensus-prompt.md', consensus)

status = read('docs/adr/status-index.md')
status = status.replace('## Current\n', '## Current\n\n- `2026-07-14-dcf-conversation-performance-governor.md` — **accepted**\n', 1)
write('docs/adr/status-index.md', status)

adr = '''# ADR: Conversation performance governor\n\nDate: 2026-07-14  \nStatus: accepted\n\n## Context\n\nLong ChatGPT conversations can become browser-bound: many rich message turns remain mounted, increasing layout, paint and interaction work. Community scripts converge on two mitigations: `content-visibility` for off-screen rendering and stronger virtualization that replaces old message nodes with placeholders and restores them in batches. Users also commonly split work into new chats, which helps context and total-chat limits but sacrifices local continuity and does not directly repair the current page.\n\n## Decision\n\n- Add required package `dcf.standard.conversation-performance@1.0.0` and a trusted Host controller.\n- Default to `safe` mode after 24 top-level message turns, using `content-visibility:auto` and intrinsic-size reservation.\n- Offer explicit window presets retaining the newest 40 or 20 turns. Older turns remain in their original DOM positions and React ownership; DCF changes only reversible inline style properties.\n- Never use `replaceWith`, `remove`, `removeChild`, `innerHTML`, cloned messages or stored message bodies.\n- Pause window reconciliation while ChatGPT is streaming.\n- Reveal history in batches manually or when the user scrolls near the top; preserve viewport position.\n- Persist only policy preferences through Environment Reconciler. Runtime counters and revealed-batch state are disposable.\n- Expose a privacy-safe performance report and include its summary in Runtime health.\n\n## Rejected\n\n- Removing/replacing ChatGPT message nodes with placeholders: stronger DOM reduction but violates Host ownership and risks React reconciliation failure.\n- Automatically hiding old turns by default: performance benefit is plausible, but find-in-page and history visibility change; therefore window mode remains explicit.\n- Claiming to solve model context or backend latency: these are outside the browser rendering boundary.\n\n## Reconsideration\n\nMore aggressive virtualization may be reconsidered only if ChatGPT exposes a stable supported turn API, or controlled browser evidence proves a safe detach/restore contract across navigation, streaming, editing, retry, branching and attachment cases.\n'''
write('docs/adr/2026-07-14-dcf-conversation-performance-governor.md', adr)

current = read('docs/current-state.md')
current = current.replace('当前正式版本：`0.15.0`', '当前正式版本：`0.16.0`', 1)
current = current.replace('`0.15.0` 增加显式模块替代生命周期，把三个迁移期弹药工作台收口为一个完整工作台，并将纯历史包折叠收纳。', '`0.15.0` 增加显式模块替代生命周期，把三个迁移期弹药工作台收口为一个完整工作台，并将纯历史包折叠收纳。`0.16.0` 增加长对话浏览器减负控制器、透明离屏优化、显式历史窗口和性能观察。', 1)
current += '''\n\n## 0.16.0 长对话浏览器减负\n\n- 新增必需包 `dcf.standard.conversation-performance@1.0.0`，功能页提供透明减负、最近 40/20 条窗口、展开上一批、恢复全部和复制性能摘要。\n- 默认安全模式只在达到 24 个顶层消息 turn 后应用 `content-visibility:auto`，不隐藏历史。\n- 窗口模式只修改可恢复的 inline style；不删除、替换、克隆或改写 ChatGPT 消息节点。\n- 流式输出期间不执行历史窗口重排；顶部滚动会按批恢复并补偿滚动位置。\n- Runtime health 增加 mode、turn/optimized/hidden 数和 60 秒 long-task 聚合，不包含消息正文。\n- 该功能不解决模型上下文、服务器延迟、服务中断或第三方扩展冲突。\n- 用户浏览器尚未完成 0.16.0 的现场性能与兼容验收。\n'''
write('docs/current-state.md', current)

print(json.dumps({'ok': True, 'version': '0.16.0'}, ensure_ascii=False))
