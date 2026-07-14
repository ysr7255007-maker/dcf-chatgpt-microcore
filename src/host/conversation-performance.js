'use strict';

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

  function revealPreviousBatch() {
    if (policy.mode !== 'window' || !lastHiddenCount) return diagnostics();
    revealedOlder += policy.reveal_batch;
    return applyNow({ preserveTop: true });
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
        const routeChanged = href !== lastHref;
        if (routeChanged) {
          lastHref = href;
          restoreAllManaged();
          revealedOlder = 0;
          if (observer) observer.disconnect();
          observer = null;
          observedRoot = null;
        }
        const previousRoot = observedRoot;
        attachRoot();
        const rootChanged = observedRoot !== previousRoot;
        if (routeChanged || rootChanged) scheduleApply(0);
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
