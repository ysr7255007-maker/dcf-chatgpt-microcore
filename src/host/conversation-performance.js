'use strict';

const { nowIso } = require('../core/utils');

const MODES = new Set(['off', 'safe', 'window']);
const MAX_LOAFS = 200;
const MAX_EVENTS = 400;
const MAX_LAYOUT_SHIFTS = 200;
const MAX_LONG_TASKS = 200;
const MAX_APPLY_EVENTS = 300;

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function round(value, digits = 1) {
  const number = Number(value || 0);
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
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

function boundedPush(list, value, limit) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function safeText(value, limit = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeScriptSource(value, pageOrigin = '') {
  const raw = String(value || '').trim();
  if (!raw) return { category: 'unknown', source: '(unknown)' };
  try {
    const url = new URL(raw, pageOrigin || undefined);
    const hostname = String(url.hostname || '').toLowerCase();
    const path = String(url.pathname || '/');
    const parts = path.split('/').filter(Boolean);
    const leaf = parts.slice(-2).join('/') || '/';
    const sameOrigin = !!pageOrigin && url.origin === pageOrigin;
    const firstParty = sameOrigin || hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com') ||
      hostname === 'openai.com' || hostname.endsWith('.openai.com') ||
      hostname === 'oaistatic.com' || hostname.endsWith('.oaistatic.com');
    return {
      category: firstParty ? 'chatgpt-page' : 'third-party',
      source: `${hostname || url.protocol.replace(':', '')}/${leaf}`.slice(0, 220)
    };
  } catch (_) {
    return { category: 'unknown', source: safeText(raw.split(/[?#]/)[0], 220) || '(unknown)' };
  }
}

function emptyAttributionEntries() {
  return { loafs: [], events: [], layout_shifts: [], long_tasks: [], dcf_applies: [], mutations: { batches: 0, added_nodes: 0, removed_nodes: 0, max_batch_nodes: 0 } };
}

function createAttributionSession(context = {}) {
  const startedEpoch = Number(context.started_epoch_ms || Date.now());
  const durationMs = clamp(context.duration_ms, 10000, 900000, 60000);
  return {
    schema: 'dcf.conversation-performance.attribution-session.v1',
    session_id: String(context.session_id || `perf-${startedEpoch.toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    status: 'running',
    started_at: context.started_at || nowIso(),
    started_epoch_ms: startedEpoch,
    duration_ms: durationMs,
    planned_end_epoch_ms: startedEpoch + durationMs,
    timeline_start_ms: Number(context.timeline_start_ms || 0),
    ended_at: null,
    ended_epoch_ms: null,
    end_reason: null,
    context: Object.assign({}, context.context || {}),
    entries: emptyAttributionEntries()
  };
}

function sum(list, selector) {
  return round((list || []).reduce((total, item) => total + Number(selector(item) || 0), 0));
}

function topBy(list, selector, limit = 10) {
  return (list || []).slice().sort((a, b) => Number(selector(b) || 0) - Number(selector(a) || 0)).slice(0, limit);
}

function aggregateScripts(loafs) {
  const grouped = new Map();
  for (const loaf of loafs || []) {
    for (const script of loaf.scripts || []) {
      const key = [script.category, script.source, script.function_name, script.invoker_type, script.invoker].join('|');
      if (!grouped.has(key)) {
        grouped.set(key, {
          category: script.category,
          source: script.source,
          function_name: script.function_name || null,
          invoker_type: script.invoker_type || null,
          invoker: script.invoker || null,
          count: 0,
          total_duration_ms: 0,
          max_duration_ms: 0,
          forced_style_layout_ms: 0,
          pause_ms: 0,
          streaming_frames: 0
        });
      }
      const item = grouped.get(key);
      item.count += 1;
      item.total_duration_ms += Number(script.duration_ms || 0);
      item.max_duration_ms = Math.max(item.max_duration_ms, Number(script.duration_ms || 0));
      item.forced_style_layout_ms += Number(script.forced_style_layout_ms || 0);
      item.pause_ms += Number(script.pause_ms || 0);
      if (loaf.streaming) item.streaming_frames += 1;
    }
  }
  return Array.from(grouped.values()).map((item) => ({
    category: item.category,
    source: item.source,
    function_name: item.function_name,
    invoker_type: item.invoker_type,
    invoker: item.invoker,
    count: item.count,
    total_duration_ms: round(item.total_duration_ms),
    max_duration_ms: round(item.max_duration_ms),
    forced_style_layout_ms: round(item.forced_style_layout_ms),
    pause_ms: round(item.pause_ms),
    streaming_frames: item.streaming_frames
  })).sort((a, b) => b.total_duration_ms - a.total_duration_ms);
}

function aggregateEvents(events) {
  const grouped = new Map();
  for (const event of events || []) {
    const name = String(event.name || 'unknown');
    if (!grouped.has(name)) grouped.set(name, { name, count: 0, total_duration_ms: 0, max_duration_ms: 0, max_input_delay_ms: 0, max_processing_ms: 0, max_presentation_delay_ms: 0, streaming_count: 0 });
    const item = grouped.get(name);
    item.count += 1;
    item.total_duration_ms += Number(event.duration_ms || 0);
    item.max_duration_ms = Math.max(item.max_duration_ms, Number(event.duration_ms || 0));
    item.max_input_delay_ms = Math.max(item.max_input_delay_ms, Number(event.input_delay_ms || 0));
    item.max_processing_ms = Math.max(item.max_processing_ms, Number(event.processing_ms || 0));
    item.max_presentation_delay_ms = Math.max(item.max_presentation_delay_ms, Number(event.presentation_delay_ms || 0));
    if (event.streaming) item.streaming_count += 1;
  }
  return Array.from(grouped.values()).map((item) => ({
    name: item.name,
    count: item.count,
    total_duration_ms: round(item.total_duration_ms),
    max_duration_ms: round(item.max_duration_ms),
    max_input_delay_ms: round(item.max_input_delay_ms),
    max_processing_ms: round(item.max_processing_ms),
    max_presentation_delay_ms: round(item.max_presentation_delay_ms),
    streaming_count: item.streaming_count
  })).sort((a, b) => b.max_duration_ms - a.max_duration_ms);
}

function aggregateApplies(applies) {
  const grouped = {};
  for (const item of applies || []) {
    const reason = String(item.reason || 'unknown');
    const bucket = grouped[reason] || (grouped[reason] = { count: 0, total_duration_ms: 0, max_duration_ms: 0 });
    bucket.count += 1;
    bucket.total_duration_ms += Number(item.duration_ms || 0);
    bucket.max_duration_ms = Math.max(bucket.max_duration_ms, Number(item.duration_ms || 0));
  }
  const byReason = {};
  for (const [reason, item] of Object.entries(grouped)) {
    byReason[reason] = { count: item.count, total_duration_ms: round(item.total_duration_ms), max_duration_ms: round(item.max_duration_ms) };
  }
  return {
    count: (applies || []).length,
    total_duration_ms: sum(applies, (item) => item.duration_ms),
    max_duration_ms: round(Math.max(0, ...(applies || []).map((item) => Number(item.duration_ms || 0)))),
    by_reason: byReason
  };
}

function summarizeAttributionSession(session, context = {}) {
  if (!session) {
    return {
      schema: 'dcf.conversation-performance.attribution.v1',
      available: false,
      status: 'not-started',
      message: 'No attribution session has been started.'
    };
  }
  const entries = session.entries || emptyAttributionEntries();
  const loafs = entries.loafs || [];
  const events = entries.events || [];
  const layoutShifts = entries.layout_shifts || [];
  const longTasks = entries.long_tasks || [];
  const scripts = aggregateScripts(loafs);
  const eventGroups = aggregateEvents(events);
  const completedEpoch = Number(session.ended_epoch_ms || Date.now());
  const elapsedMs = Math.max(0, completedEpoch - Number(session.started_epoch_ms || completedEpoch));
  return {
    schema: 'dcf.conversation-performance.attribution.v1',
    available: true,
    session: {
      session_id: session.session_id,
      status: session.status,
      started_at: session.started_at,
      ended_at: session.ended_at,
      end_reason: session.end_reason,
      requested_duration_ms: session.duration_ms,
      observed_duration_ms: elapsedMs
    },
    context: Object.assign({}, session.context || {}, context || {}),
    support: Object.assign({}, context.support || {}),
    long_animation_frames: {
      count: loafs.length,
      total_duration_ms: sum(loafs, (item) => item.duration_ms),
      total_blocking_duration_ms: sum(loafs, (item) => item.blocking_duration_ms),
      total_render_duration_ms: sum(loafs, (item) => item.render_duration_ms),
      total_style_layout_duration_ms: sum(loafs, (item) => item.style_layout_duration_ms),
      total_script_duration_ms: sum(loafs, (item) => (item.scripts || []).reduce((total, script) => total + Number(script.duration_ms || 0), 0)),
      total_forced_style_layout_ms: sum(loafs, (item) => (item.scripts || []).reduce((total, script) => total + Number(script.forced_style_layout_ms || 0), 0)),
      streaming_frame_count: loafs.filter((item) => item.streaming).length,
      interaction_frame_count: loafs.filter((item) => item.has_ui_event).length,
      unattributed_frame_count: loafs.filter((item) => !(item.scripts || []).length).length,
      top_frames: topBy(loafs, (item) => item.blocking_duration_ms || item.duration_ms, 12).map((item) => ({
        start_ms: item.start_ms,
        duration_ms: item.duration_ms,
        blocking_duration_ms: item.blocking_duration_ms,
        work_duration_ms: item.work_duration_ms,
        render_duration_ms: item.render_duration_ms,
        style_layout_duration_ms: item.style_layout_duration_ms,
        streaming: item.streaming,
        has_ui_event: item.has_ui_event,
        top_scripts: topBy(item.scripts || [], (script) => script.duration_ms, 4)
      }))
    },
    top_scripts: scripts.slice(0, 20),
    interactions: {
      count: events.length,
      slowest: topBy(events, (item) => item.duration_ms, 20),
      by_type: eventGroups
    },
    layout_shifts: {
      count: layoutShifts.length,
      unexpected_count: layoutShifts.filter((item) => !item.had_recent_input).length,
      unexpected_score: round(layoutShifts.filter((item) => !item.had_recent_input).reduce((total, item) => total + Number(item.value || 0), 0), 4),
      streaming_count: layoutShifts.filter((item) => item.streaming).length
    },
    long_tasks_fallback: {
      count: longTasks.length,
      total_duration_ms: sum(longTasks, (item) => item.duration_ms),
      top: topBy(longTasks, (item) => item.duration_ms, 12)
    },
    dcf_self: Object.assign(aggregateApplies(entries.dcf_applies || []), {
      mutation_batches: Number(entries.mutations && entries.mutations.batches || 0),
      added_nodes: Number(entries.mutations && entries.mutations.added_nodes || 0),
      removed_nodes: Number(entries.mutations && entries.mutations.removed_nodes || 0),
      max_batch_nodes: Number(entries.mutations && entries.mutations.max_batch_nodes || 0)
    }),
    interpretation_limits: [
      'Long Animation Frames attributes main-world page scripts but may omit browser-extension isolated-world code.',
      'A reported source location is the script entry point, not necessarily the hottest internal function.',
      'Script, render, style/layout and interaction timings overlap and must not be added as mutually exclusive CPU totals.',
      'Unknown or cross-origin work may remain unattributed.'
    ],
    privacy: {
      message_text_included: false,
      dom_text_included: false,
      event_targets_included: false,
      raw_urls_or_query_strings_included: false,
      raw_stacks_included: false,
      authentication_data_included: false
    }
  };
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
  let attributionTimer = null;
  let pendingApplyReason = 'scheduled';
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
  let loafObserver = null;
  let eventObserver = null;
  let layoutShiftObserver = null;
  let longTasks = [];
  let attribution = null;
  const applyEvents = [];
  const originalStyles = new WeakMap();
  const managedNodes = new Set();
  const hiddenNodes = new Set();

  function supportedEntryTypes() {
    const ctor = windowObject.PerformanceObserver;
    return new Set(ctor && Array.isArray(ctor.supportedEntryTypes) ? ctor.supportedEntryTypes : []);
  }

  function supportSnapshot() {
    const supported = supportedEntryTypes();
    return {
      long_animation_frame: supported.has('long-animation-frame'),
      event_timing: supported.has('event'),
      layout_shift: supported.has('layout-shift'),
      long_task: supported.has('longtask'),
      content_visibility: !!(windowObject.CSS && typeof windowObject.CSS.supports === 'function' && windowObject.CSS.supports('content-visibility', 'auto'))
    };
  }

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
      revealPreviousBatch();
    };
    if (scrollElement) scrollElement.addEventListener('scroll', scrollHandler, { passive: true });
  }

  function recordApply(reason, durationMs) {
    const item = { at_epoch_ms: Date.now(), reason: String(reason || 'unknown'), duration_ms: round(durationMs), turn_count: lastTurnCount, hidden_count: lastHiddenCount };
    boundedPush(applyEvents, item, MAX_APPLY_EVENTS);
    if (attribution && attribution.status === 'running') boundedPush(attribution.entries.dcf_applies, item, MAX_APPLY_EVENTS);
  }

  function finishApply(started, reason) {
    lastApplyAt = nowIso();
    lastApplyDurationMs = Date.now() - started;
    recordApply(reason, lastApplyDurationMs);
    return diagnostics();
  }

  function applyNow(options = {}) {
    const started = Date.now();
    const reason = String(options.reason || 'direct');
    const turns = findTurns();
    lastTurnCount = turns.length;
    pruneManaged(turns);
    bindScroll(turns);
    if (policy.mode === 'off' || turns.length < policy.activation_turns) {
      restoreAllManaged();
      return finishApply(started, reason);
    }
    if (isStreaming()) {
      scheduleApply(policy.settle_ms, 'streaming-settle');
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
    return finishApply(started, reason);
  }

  function scheduleApply(delay = policy.settle_ms, reason = 'scheduled') {
    pendingApplyReason = String(reason || 'scheduled');
    if (settleTimer) windowObject.clearTimeout(settleTimer);
    settleTimer = windowObject.setTimeout(() => {
      settleTimer = null;
      const nextReason = pendingApplyReason;
      pendingApplyReason = 'scheduled';
      applyNow({ reason: nextReason });
    }, Math.max(0, Number(delay) || 0));
  }

  function revealPreviousBatch() {
    if (policy.mode !== 'window' || !lastHiddenCount) return diagnostics();
    revealedOlder += policy.reveal_batch;
    return applyNow({ preserveTop: true, reason: 'reveal' });
  }

  function recordMutation(mutations) {
    if (!attribution || attribution.status !== 'running') return;
    let added = 0;
    let removed = 0;
    for (const mutation of mutations || []) {
      added += Number(mutation.addedNodes && mutation.addedNodes.length || 0);
      removed += Number(mutation.removedNodes && mutation.removedNodes.length || 0);
    }
    const stats = attribution.entries.mutations;
    stats.batches += 1;
    stats.added_nodes += added;
    stats.removed_nodes += removed;
    stats.max_batch_nodes = Math.max(stats.max_batch_nodes, added + removed);
  }

  function attachRoot() {
    const root = findConversationRoot();
    if (root === observedRoot && observer) return true;
    if (observer) observer.disconnect();
    observer = null;
    observedRoot = root;
    if (!root) return false;
    observer = new windowObject.MutationObserver((mutations) => {
      recordMutation(mutations);
      if (mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length || mutation.removedNodes && mutation.removedNodes.length)) scheduleApply(policy.settle_ms, 'mutation');
    });
    observer.observe(root, { childList: true, subtree: true });
    return true;
  }

  function acceptsAttributionEntry(entry) {
    return !!(attribution && attribution.status === 'running' && Number(entry && entry.startTime || 0) >= Number(attribution.timeline_start_ms || 0));
  }

  function recordLongTask(entry) {
    const item = {
      start_ms: round(entry.startTime),
      duration_ms: round(entry.duration),
      name: safeText(entry.name || 'longtask', 80),
      streaming: !!isStreaming()
    };
    boundedPush(longTasks, Object.assign({ at_epoch_ms: Date.now() }, item), MAX_LONG_TASKS);
    if (acceptsAttributionEntry(entry)) boundedPush(attribution.entries.long_tasks, item, MAX_LONG_TASKS);
  }

  function recordLoaf(entry) {
    if (!acceptsAttributionEntry(entry)) return;
    const start = Number(entry.startTime || 0);
    const duration = Number(entry.duration || 0);
    const renderStart = Number(entry.renderStart || 0);
    const styleStart = Number(entry.styleAndLayoutStart || 0);
    const pageOrigin = String(windowObject.location && windowObject.location.origin || '');
    const scripts = Array.from(entry.scripts || []).map((script) => {
      const source = safeScriptSource(script.sourceURL, pageOrigin);
      return {
        category: source.category,
        source: source.source,
        function_name: safeText(script.sourceFunctionName, 120) || null,
        invoker_type: safeText(script.invokerType || script.type, 80) || null,
        invoker: safeText(script.invoker || script.name, 140) || null,
        duration_ms: round(script.duration),
        forced_style_layout_ms: round(script.forcedStyleAndLayoutDuration),
        pause_ms: round(script.pauseDuration)
      };
    });
    boundedPush(attribution.entries.loafs, {
      start_ms: round(start),
      duration_ms: round(duration),
      blocking_duration_ms: round(entry.blockingDuration),
      work_duration_ms: round(renderStart ? Math.max(0, renderStart - start) : duration),
      render_duration_ms: round(renderStart ? Math.max(0, start + duration - renderStart) : 0),
      style_layout_duration_ms: round(styleStart ? Math.max(0, start + duration - styleStart) : 0),
      has_ui_event: Number(entry.firstUIEventTimestamp || 0) > 0,
      streaming: !!isStreaming(),
      scripts
    }, MAX_LOAFS);
  }

  function recordEvent(entry) {
    if (!acceptsAttributionEntry(entry)) return;
    const start = Number(entry.startTime || 0);
    const processingStart = Number(entry.processingStart || start);
    const processingEnd = Number(entry.processingEnd || processingStart);
    const duration = Number(entry.duration || 0);
    boundedPush(attribution.entries.events, {
      name: safeText(entry.name || 'event', 60),
      start_ms: round(start),
      duration_ms: round(duration),
      input_delay_ms: round(Math.max(0, processingStart - start)),
      processing_ms: round(Math.max(0, processingEnd - processingStart)),
      presentation_delay_ms: round(Math.max(0, start + duration - processingEnd)),
      interaction_id: Number(entry.interactionId || 0) || null,
      streaming: !!isStreaming()
    }, MAX_EVENTS);
  }

  function recordLayoutShift(entry) {
    if (!acceptsAttributionEntry(entry)) return;
    boundedPush(attribution.entries.layout_shifts, {
      start_ms: round(entry.startTime),
      value: round(entry.value, 4),
      had_recent_input: !!entry.hadRecentInput,
      streaming: !!isStreaming()
    }, MAX_LAYOUT_SHIFTS);
  }

  function observeType(type, callback, options = {}) {
    const ctor = windowObject.PerformanceObserver;
    if (!ctor || !supportedEntryTypes().has(type)) return null;
    try {
      const instance = new ctor((list) => {
        for (const entry of list.getEntries()) callback(entry);
      });
      instance.observe(Object.assign({ type, buffered: true }, options));
      return instance;
    } catch (_) {
      return null;
    }
  }

  function startPerformanceObservation() {
    if (!longTaskObserver) longTaskObserver = observeType('longtask', recordLongTask);
    if (!loafObserver) loafObserver = observeType('long-animation-frame', recordLoaf);
    if (!eventObserver) eventObserver = observeType('event', recordEvent, { durationThreshold: 16 });
    if (!layoutShiftObserver) layoutShiftObserver = observeType('layout-shift', recordLayoutShift);
  }

  function finishAttribution(reason = 'manual') {
    if (!attribution) return summarizeAttributionSession(null);
    if (attribution.status === 'running') {
      attribution.status = 'complete';
      attribution.ended_at = nowIso();
      attribution.ended_epoch_ms = Date.now();
      attribution.end_reason = String(reason || 'manual');
      if (attributionTimer) windowObject.clearTimeout(attributionTimer);
      attributionTimer = null;
    }
    return attributionReport();
  }

  function startAttribution(options = {}) {
    if (attributionTimer) windowObject.clearTimeout(attributionTimer);
    attributionTimer = null;
    attribution = createAttributionSession({
      duration_ms: options.duration_ms,
      timeline_start_ms: options.timeline_start_ms != null ? Number(options.timeline_start_ms) : (windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0),
      context: Object.assign({
        route_kind: routeKind(),
        mode: policy.mode,
        turn_count: lastTurnCount,
        hidden_count: lastHiddenCount,
        selector_strategy: selectorStrategy,
        streaming_at_start: !!isStreaming()
      }, options.context || {})
    });
    attributionTimer = windowObject.setTimeout(() => finishAttribution('duration'), attribution.duration_ms);
    return attributionStatus();
  }

  function attributionStatus() {
    if (!attribution) return { available: false, status: 'not-started' };
    return {
      available: true,
      session_id: attribution.session_id,
      status: attribution.status,
      started_at: attribution.started_at,
      ended_at: attribution.ended_at,
      duration_ms: attribution.duration_ms,
      remaining_ms: attribution.status === 'running' ? Math.max(0, attribution.planned_end_epoch_ms - Date.now()) : 0,
      loaf_count: attribution.entries.loafs.length,
      event_count: attribution.entries.events.length,
      layout_shift_count: attribution.entries.layout_shifts.length,
      long_task_count: attribution.entries.long_tasks.length
    };
  }

  function attributionReport() {
    return summarizeAttributionSession(attribution, {
      route_kind: routeKind(),
      mode: policy.mode,
      turn_count: lastTurnCount,
      hidden_count: lastHiddenCount,
      selector_strategy: selectorStrategy,
      streaming_at_report: !!isStreaming(),
      support: supportSnapshot()
    });
  }

  function ensureStarted() {
    attachRoot();
    startPerformanceObservation();
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
        if (routeChanged || rootChanged) scheduleApply(0, routeChanged ? 'route' : 'root-change');
      }, 1200);
    }
  }

  function syncPolicy(value) {
    const next = normalizePerformancePolicy(value);
    if (next.mode !== policy.mode || next.keep_recent !== policy.keep_recent) revealedOlder = 0;
    policy = next;
    ensureStarted();
    if (policy.mode === 'off') {
      const started = Date.now();
      restoreAllManaged();
      lastApplyAt = nowIso();
      lastApplyDurationMs = Date.now() - started;
      recordApply('policy-off', lastApplyDurationMs);
    } else {
      scheduleApply(0, 'policy');
    }
    return diagnostics();
  }

  function diagnostics() {
    const now = Date.now();
    longTasks = longTasks.filter((item) => item.at_epoch_ms >= now - 60000);
    const root = findConversationRoot();
    const support = supportSnapshot();
    return {
      schema: 'dcf.conversation-performance.runtime.v2',
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
      content_visibility_supported: support.content_visibility,
      long_task_observer_supported: support.long_task,
      long_animation_frame_supported: support.long_animation_frame,
      event_timing_supported: support.event_timing,
      layout_shift_supported: support.layout_shift,
      long_tasks_60s: longTasks.length,
      long_task_duration_ms_60s: round(longTasks.reduce((total, item) => total + Number(item.duration_ms || 0), 0)),
      last_apply_at: lastApplyAt,
      last_apply_duration_ms: lastApplyDurationMs,
      attribution: attributionStatus(),
      mutation_strategy: 'style-only; no ChatGPT node removal or replacement'
    };
  }

  function destroy() {
    restoreAllManaged();
    if (observer) observer.disconnect();
    if (routeTimer) windowObject.clearInterval(routeTimer);
    if (settleTimer) windowObject.clearTimeout(settleTimer);
    if (attributionTimer) windowObject.clearTimeout(attributionTimer);
    if (scrollElement && scrollHandler) scrollElement.removeEventListener('scroll', scrollHandler);
    for (const item of [longTaskObserver, loafObserver, eventObserver, layoutShiftObserver]) if (item) item.disconnect();
    observer = null;
    routeTimer = null;
    settleTimer = null;
    attributionTimer = null;
    scrollElement = null;
    scrollHandler = null;
    longTaskObserver = null;
    loafObserver = null;
    eventObserver = null;
    layoutShiftObserver = null;
  }

  ensureStarted();
  return {
    syncPolicy,
    applyNow,
    revealPreviousBatch,
    diagnostics,
    destroy,
    findTurns,
    startAttribution,
    finishAttribution,
    attributionReport,
    attributionStatus
  };
}

module.exports = {
  createConversationPerformanceController,
  normalizePerformancePolicy,
  planTurnWindow,
  safeScriptSource,
  summarizeAttributionSession,
  createAttributionSession
};
