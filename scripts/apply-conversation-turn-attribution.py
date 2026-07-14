from pathlib import Path

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


# Version and build entry.
constants = read('src/core/constants.js')
constants = replace_once(constants, "const VERSION = '0.17.0';", "const VERSION = '0.18.0';", 'runtime version')
write('src/core/constants.js', constants)

package = read('package.json')
package = replace_once(package, '"version": "0.17.0"', '"version": "0.18.0"', 'package version')
package = replace_once(
    package,
    'node tests/dcf-performance-attribution.unit.test.js && node tests/dcf-conversation-environment.unit.test.js',
    'node tests/dcf-performance-attribution.unit.test.js && node tests/dcf-conversation-turn-attribution.unit.test.js && node tests/dcf-conversation-environment.unit.test.js',
    'turn attribution test command'
)
write('package.json', package)

build = read('scripts/build-userscript.js')
build = replace_once(
    build,
    "  'src/host/conversation-performance.js',\n  'src/modules/standard-packages.js',",
    "  'src/host/conversation-performance.js',\n  'src/host/conversation-turn-attribution.js',\n  'src/modules/standard-packages.js',",
    'turn attribution bundle entry'
)
write('scripts/build-userscript.js', build)

# Let the low-level collector accept a send-event timeline boundary and a long safety cap.
performance = read('src/host/conversation-performance.js')
performance = replace_once(
    performance,
    'const durationMs = clamp(context.duration_ms, 10000, 180000, 60000);',
    'const durationMs = clamp(context.duration_ms, 10000, 900000, 60000);',
    'attribution safety cap'
)
performance = replace_once(
    performance,
    "      duration_ms: options.duration_ms,\n      timeline_start_ms: windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0,\n      context: {\n        route_kind: routeKind(),\n        mode: policy.mode,\n        turn_count: lastTurnCount,\n        hidden_count: lastHiddenCount,\n        selector_strategy: selectorStrategy,\n        streaming_at_start: !!isStreaming()\n      }",
    "      duration_ms: options.duration_ms,\n      timeline_start_ms: options.timeline_start_ms != null ? Number(options.timeline_start_ms) : (windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0),\n      context: Object.assign({\n        route_kind: routeKind(),\n        mode: policy.mode,\n        turn_count: lastTurnCount,\n        hidden_count: lastHiddenCount,\n        selector_strategy: selectorStrategy,\n        streaming_at_start: !!isStreaming()\n      }, options.context || {})",
    'external attribution boundary'
)
write('src/host/conversation-performance.js', performance)

turn_module = r'''\'use strict\';

const { nowIso } = require('../core/utils');

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createConversationTurnAttribution(performanceController, options = {}) {
  if (!performanceController) throw new Error('performance controller required');
  const windowObject = options.windowObject || globalThis;
  const maxDurationMs = Math.min(900000, Math.max(30000, Number(options.max_duration_ms || 600000)));
  let timeoutTimer = null;
  let turn = idleTurn();

  function idleTurn() {
    return {
      schema: 'dcf.conversation-performance.turn-session.v1',
      status: 'idle',
      armed_at: null,
      armed_epoch_ms: null,
      sent_at: null,
      sent_epoch_ms: null,
      send_timeline_ms: null,
      send_signal: null,
      reply_started_at: null,
      reply_started_epoch_ms: null,
      reply_source: null,
      reply_completed_at: null,
      reply_completed_epoch_ms: null,
      completion_quiet_ms: null,
      finished_at: null,
      finished_epoch_ms: null,
      finish_reason: null
    };
  }

  function clearTimer() {
    if (timeoutTimer && windowObject.clearTimeout) windowObject.clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }

  function snapshot() {
    return {
      schema: 'dcf.conversation-performance.turn-status.v1',
      status: turn.status,
      armed_at: turn.armed_at,
      sent_at: turn.sent_at,
      reply_started_at: turn.reply_started_at,
      reply_completed_at: turn.reply_completed_at,
      finish_reason: turn.finish_reason,
      send_signal: turn.send_signal,
      remaining_ms: turn.status === 'running' && turn.sent_epoch_ms ? Math.max(0, maxDurationMs - (Date.now() - turn.sent_epoch_ms)) : 0
    };
  }

  function arm() {
    if (turn.status === 'running') return Object.assign({ accepted: false, reason: 'turn-already-running' }, snapshot());
    clearTimer();
    const epoch = Date.now();
    turn = idleTurn();
    turn.status = 'armed';
    turn.armed_at = nowIso();
    turn.armed_epoch_ms = epoch;
    return Object.assign({ accepted: true }, snapshot());
  }

  function onSend(signal = {}) {
    if (turn.status !== 'armed') return Object.assign({ accepted: false, reason: 'not-armed' }, snapshot());
    const epoch = finite(signal.at_epoch_ms, Date.now());
    const timeline = finite(signal.timeline_ms, windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0);
    turn.status = 'running';
    turn.sent_at = signal.at || nowIso();
    turn.sent_epoch_ms = epoch;
    turn.send_timeline_ms = timeline;
    turn.send_signal = String(signal.kind || 'unknown').slice(0, 40);
    performanceController.startAttribution({
      duration_ms: maxDurationMs,
      timeline_start_ms: timeline,
      context: {
        attribution_scope: 'conversation-turn',
        boundary: 'send-to-reply-complete',
        send_signal: turn.send_signal
      }
    });
    clearTimer();
    if (windowObject.setTimeout) timeoutTimer = windowObject.setTimeout(() => finish('timeout'), maxDurationMs);
    return Object.assign({ accepted: true }, snapshot());
  }

  function onReplyStart(meta = {}) {
    if (turn.status !== 'running' || turn.reply_started_epoch_ms) return Object.assign({ accepted: false }, snapshot());
    turn.reply_started_at = meta.started_at || nowIso();
    turn.reply_started_epoch_ms = finite(meta.at_epoch_ms, Date.now());
    turn.reply_source = String(meta.source || 'live').slice(0, 40);
    return Object.assign({ accepted: true }, snapshot());
  }

  function finish(reason = 'manual') {
    if (turn.status === 'idle' || turn.status === 'complete' || turn.status === 'cancelled') return snapshot();
    clearTimer();
    const epoch = Date.now();
    if (turn.status === 'armed') {
      turn.status = 'cancelled';
      turn.finish_reason = reason === 'manual' ? 'cancelled-before-send' : String(reason || 'cancelled');
    } else {
      performanceController.finishAttribution(reason);
      turn.status = 'complete';
      turn.finish_reason = String(reason || 'manual');
    }
    turn.finished_at = nowIso();
    turn.finished_epoch_ms = epoch;
    return snapshot();
  }

  function onReplyComplete(meta = {}) {
    if (turn.status !== 'running') return Object.assign({ accepted: false, completed: false }, snapshot());
    turn.reply_completed_at = meta.completed_at || nowIso();
    turn.reply_completed_epoch_ms = finite(meta.at_epoch_ms, Date.now());
    turn.completion_quiet_ms = finite(meta.quiet_ms, null);
    finish('reply-complete');
    return Object.assign({ accepted: true, completed: true }, snapshot());
  }

  function report() {
    const hasSend = !!turn.sent_epoch_ms;
    const base = hasSend ? performanceController.attributionReport() : { available: false, status: turn.status };
    const endEpoch = turn.reply_completed_epoch_ms || turn.finished_epoch_ms || (turn.status === 'running' ? Date.now() : null);
    const totalMs = hasSend && endEpoch ? Math.max(0, endEpoch - turn.sent_epoch_ms) : null;
    const waitMs = hasSend && turn.reply_started_epoch_ms ? Math.max(0, turn.reply_started_epoch_ms - turn.sent_epoch_ms) : null;
    const activeMs = turn.reply_started_epoch_ms && endEpoch ? Math.max(0, endEpoch - turn.reply_started_epoch_ms) : null;
    return Object.assign({}, base, {
      schema: 'dcf.conversation-performance.turn-attribution.v1',
      performance_schema: base.schema || null,
      scope: 'send-to-reply-complete',
      turn_boundary: {
        status: turn.status,
        armed_at: turn.armed_at,
        sent_at: turn.sent_at,
        send_signal: turn.send_signal,
        reply_started_at: turn.reply_started_at,
        reply_source: turn.reply_source,
        reply_completed_at: turn.reply_completed_at,
        finished_at: turn.finished_at,
        finish_reason: turn.finish_reason,
        total_ms: totalMs,
        send_to_first_reply_activity_ms: waitMs,
        first_reply_activity_to_complete_ms: activeMs,
        completion_detection_quiet_ms: turn.completion_quiet_ms
      },
      interpretation_limits: (base.interpretation_limits || []).concat([
        'The turn begins at the captured send interaction and ends when DCF detects the assistant reply as quiet and no longer streaming.',
        'Reply completion detection may lag the final visible token by the reported quiet window.',
        'Waiting for first reply activity includes backend, network, scheduling and any page work before the first assistant DOM activity; the browser Runtime cannot separate those server-side causes.'
      ]),
      privacy: Object.assign({}, base.privacy || {}, {
        user_message_text_included: false,
        assistant_message_text_included: false
      })
    });
  }

  function finishAndReport(reason = 'manual') {
    finish(reason);
    return report();
  }

  function destroy() {
    clearTimer();
  }

  return { arm, onSend, onReplyStart, onReplyComplete, finish, report, finishAndReport, status: snapshot, destroy };
}

module.exports = { createConversationTurnAttribution };
'''.replace("\\'use strict\\';", "'use strict';", 1)
write('src/host/conversation-turn-attribution.js', turn_module)

# Add bounded send-event observation and reply-start signaling to the Host Adapter.
host = read('src/host/chatgpt.js')
host = replace_once(
    host,
    "  let onReplyComplete = null;\n  let lastUrl",
    "  let onReplyComplete = null;\n  let onReplyStart = null;\n  let onSend = null;\n  let sendClickHandler = null;\n  let sendKeyHandler = null;\n  let lastSendSignalAt = 0;\n  let lastUrl",
    'host lifecycle fields'
)
host = replace_once(
    host,
    "    disconnectActive();\n    activeNode = normalized;\n    activeObserver = new windowObject.MutationObserver(() => scheduleCompletion(normalized, source));",
    "    disconnectActive();\n    activeNode = normalized;\n    if (typeof onReplyStart === 'function') onReplyStart({ source, started_at: nowIso(), at_epoch_ms: Date.now(), timeline_ms: windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0 });\n    activeObserver = new windowObject.MutationObserver(() => scheduleCompletion(normalized, source));",
    'reply start callback'
)
host = replace_once(
    host,
    "       if (typeof onReplyComplete === 'function') onReplyComplete({ node, text, source, completed_at: nowIso() });",
    "       if (typeof onReplyComplete === 'function') onReplyComplete({ node, text, source, completed_at: nowIso(), at_epoch_ms: Date.now(), quiet_ms: quietMs });",
    'reply completion timing'
)
host = replace_once(
    host,
    "  function startReplyObserver(callback) {\n    onReplyComplete = callback;",
    "  function startReplyObserver(callback, observerOptions = {}) {\n    onReplyComplete = callback;\n    onReplyStart = typeof observerOptions.onReplyStart === 'function' ? observerOptions.onReplyStart : null;",
    'reply observer options'
)
host = replace_once(
    host,
    "       startReplyObserver(callback);",
    "       startReplyObserver(callback, observerOptions);",
    'reply observer navigation restart'
)
send_observer = r'''

  function eventTimelineMs(event) {
    const raw = Number(event && event.timeStamp);
    const perf = windowObject.performance;
    if (Number.isFinite(raw) && raw >= 0) {
      if (raw > 1e12 && perf && Number.isFinite(Number(perf.timeOrigin))) return Math.max(0, raw - Number(perf.timeOrigin));
      return raw;
    }
    return perf && typeof perf.now === 'function' ? perf.now() : 0;
  }

  function emitSend(kind, event) {
    if (typeof onSend !== 'function') return;
    const epoch = Date.now();
    if (epoch - lastSendSignalAt < 250) return;
    lastSendSignalAt = epoch;
    onSend({ kind, at: nowIso(), at_epoch_ms: epoch, timeline_ms: eventTimelineMs(event) });
  }

  function startSendObserver(callback) {
    stopSendObserver();
    onSend = callback;
    sendClickHandler = (event) => {
      const target = event && event.target instanceof windowObject.Element ? event.target : null;
      const button = target && target.closest('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
      if (button && !button.disabled) emitSend('click', event);
    };
    sendKeyHandler = (event) => {
      if (!event || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const input = composer();
      const target = event.target instanceof windowObject.Element ? event.target : null;
      if (!input || !target || !(target === input || input.contains(target))) return;
      const button = doc.querySelector('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
      if (button && !button.disabled) emitSend('enter', event);
    };
    doc.addEventListener('click', sendClickHandler, true);
    doc.addEventListener('keydown', sendKeyHandler, true);
    return () => stopSendObserver();
  }

  function stopSendObserver() {
    if (sendClickHandler) doc.removeEventListener('click', sendClickHandler, true);
    if (sendKeyHandler) doc.removeEventListener('keydown', sendKeyHandler, true);
    sendClickHandler = null;
    sendKeyHandler = null;
    onSend = null;
  }
'''
host = replace_once(host, "\n  async function copy(text) {", send_observer + "\n  async function copy(text) {", 'send observer insertion')
host = replace_once(
    host,
    "       url_watch_active: !!urlTimer",
    "       url_watch_active: !!urlTimer,\n       send_observer_attached: !!(sendClickHandler && sendKeyHandler)",
    'host send diagnostics'
)
host = replace_once(
    host,
    "    startReplyObserver,\n    stopReplyObserver,",
    "    startReplyObserver,\n    stopReplyObserver,\n    startSendObserver,\n    stopSendObserver,",
    'host send exports'
)
write('src/host/chatgpt.js', host)

# Wire lifecycle coordinator into boot, effects and Runtime health.
index = read('src/index.js')
index = replace_once(
    index,
    "const { createConversationPerformanceController } = require('./host/conversation-performance');",
    "const { createConversationPerformanceController } = require('./host/conversation-performance');\nconst { createConversationTurnAttribution } = require('./host/conversation-turn-attribution');",
    'turn coordinator import'
)
index = replace_once(
    index,
    "  conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});\n  const effects = createEffectRunner(host, receiptStore, conversationPerformance);",
    "  conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});\n  const conversationTurnAttribution = createConversationTurnAttribution(conversationPerformance, { windowObject });\n  const effects = createEffectRunner(host, receiptStore, conversationPerformance, conversationTurnAttribution);",
    'turn coordinator boot'
)
index = replace_once(
    index,
    "    getPerformance: () => conversationPerformance.diagnostics()",
    "    getPerformance: () => Object.assign({}, conversationPerformance.diagnostics(), { turn_attribution: conversationTurnAttribution.status() })",
    'turn health snapshot'
)
index = replace_once(
    index,
    "  host.startReplyObserver((reply) => {\n    processReply(reply).catch((error) => receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'reply.reconcile' }, status: 'rejected', stage: 'runtime', error: String(error && error.message || error) }));\n  });",
    "  host.startSendObserver((signal) => conversationTurnAttribution.onSend(signal));\n  host.startReplyObserver((reply) => {\n    const completed = conversationTurnAttribution.onReplyComplete({ source: reply.source, completed_at: reply.completed_at, at_epoch_ms: reply.at_epoch_ms, quiet_ms: reply.quiet_ms });\n    if (completed.completed && app) { app.setNotice('本轮问答归因已完成，可复制报告'); app.render(); }\n    processReply(reply).catch((error) => receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'reply.reconcile' }, status: 'rejected', stage: 'runtime', error: String(error && error.message || error) }));\n  }, {\n    onReplyStart: (meta) => conversationTurnAttribution.onReplyStart(meta)\n  });",
    'turn lifecycle observers'
)
index = replace_once(
    index,
    "  const runtime = { version: VERSION, engine, getEnvironment: () => engine.getEnvironment(), host, conversationPerformance, app, catalog, reconciler, receiptStore, health, maintenance };",
    "  const runtime = { version: VERSION, engine, getEnvironment: () => engine.getEnvironment(), host, conversationPerformance, conversationTurnAttribution, app, catalog, reconciler, receiptStore, health, maintenance };",
    'turn runtime export'
)
write('src/index.js', index)

effects = read('src/runtime/effects.js')
effects = replace_once(
    effects,
    'function createEffectRunner(host, receiptStore, performanceController) {',
    'function createEffectRunner(host, receiptStore, performanceController, turnAttribution) {',
    'effect runner turn dependency'
)
effects = replace_once(
    effects,
    "      } else if (effect.type === 'conversation.performance.attribution.report') {\n        if (!performanceController) throw new Error('conversation performance controller unavailable');\n        const attribution = effect.finish === false ? performanceController.attributionReport() : performanceController.finishAttribution('manual');\n        const report = `<<<DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION\n${JSON.stringify(attribution, null, 2)}\nDCF_CONVERSATION_PERFORMANCE_ATTRIBUTION>>>`;\n        result = await host.copy(report);",
    "      } else if (effect.type === 'conversation.performance.attribution.report') {\n        if (!performanceController) throw new Error('conversation performance controller unavailable');\n        const attribution = effect.finish === false ? performanceController.attributionReport() : performanceController.finishAttribution('manual');\n        const report = `<<<DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION\n${JSON.stringify(attribution, null, 2)}\nDCF_CONVERSATION_PERFORMANCE_ATTRIBUTION>>>`;\n        result = await host.copy(report);\n      } else if (effect.type === 'conversation.performance.turn.arm') {\n        if (!turnAttribution) throw new Error('conversation turn attribution unavailable');\n        result = turnAttribution.arm();\n      } else if (effect.type === 'conversation.performance.turn.report') {\n        if (!turnAttribution) throw new Error('conversation turn attribution unavailable');\n        const attribution = effect.finish === false ? turnAttribution.report() : turnAttribution.finishAndReport('manual');\n        const report = `<<<DCF_CONVERSATION_TURN_ATTRIBUTION\n${JSON.stringify(attribution, null, 2)}\nDCF_CONVERSATION_TURN_ATTRIBUTION>>>`;\n        result = await host.copy(report);",
    'turn attribution effects'
)
write('src/runtime/effects.js', effects)

commands = read('src/runtime/commands.js')
commands = replace_once(
    commands,
    "    } else if (call === 'conversation.performance.attribution.report') {\n      result = await effectRunner.run({ type: 'conversation.performance.attribution.report', finish: args.finish !== false }, context);",
    "    } else if (call === 'conversation.performance.attribution.report') {\n      result = await effectRunner.run({ type: 'conversation.performance.attribution.report', finish: args.finish !== false }, context);\n    } else if (call === 'conversation.performance.turn.arm') {\n      result = await effectRunner.run({ type: 'conversation.performance.turn.arm' }, context);\n    } else if (call === 'conversation.performance.turn.report') {\n      result = await effectRunner.run({ type: 'conversation.performance.turn.report', finish: args.finish !== false }, context);",
    'turn attribution commands'
)
write('src/runtime/commands.js', commands)

health = read('src/modules/health.js')
health = replace_once(
    health,
    "          layout_shift_supported: performanceState.layout_shift_supported, attribution_status: performanceState.attribution && performanceState.attribution.status || 'not-started'",
    "          layout_shift_supported: performanceState.layout_shift_supported, attribution_status: performanceState.attribution && performanceState.attribution.status || 'not-started',\n          turn_attribution_status: performanceState.turn_attribution && performanceState.turn_attribution.status || 'idle'",
    'turn health status'
)
write('src/modules/health.js', health)

# Publish package revision 1.2.0 with turn-scoped naming.
packs = read('src/modules/standard-packages.js')
packs = replace_once(packs, "    revision: '1.1.0',", "    revision: '1.2.0',", 'performance package revision')
packs = replace_once(
    packs,
    "    description: '降低 ChatGPT 长对话的浏览器渲染负担，并通过 Runtime 诊断归因主线程阻塞。',",
    "    description: '降低 ChatGPT 长对话的浏览器渲染负担，并按一次完整问答归因主线程阻塞。',",
    'performance package description'
)
packs = replace_once(packs, "id: 'dcf.standard.conversation-performance', title: '长对话减负', version: '1.1.0'", "id: 'dcf.standard.conversation-performance', title: '长对话减负', version: '1.2.0'", 'performance module revision')
packs = replace_once(
    packs,
    "        { id: 'attribution', title: '主线程归因诊断', commands: [\n          { id: 'attribution60', label: '开始 60 秒归因诊断', steps: [{ call: 'conversation.performance.attribution.start', with: { duration_ms: 60000 } }] },\n          { id: 'attribution_copy', label: '结束并复制归因报告', steps: [{ call: 'conversation.performance.attribution.report', with: { finish: true } }] }\n        ] }",
    "        { id: 'attribution', title: '问答轮次归因', commands: [\n          { id: 'turn_attribution_arm', label: '记录下一轮问答', steps: [{ call: 'conversation.performance.turn.arm' }] },\n          { id: 'turn_attribution_copy', label: '结束并复制本轮报告', steps: [{ call: 'conversation.performance.turn.report', with: { finish: true } }] }\n        ] }",
    'turn attribution package UI'
)
write('src/modules/standard-packages.js', packs)

# Tests.
performance_test = read('tests/dcf-conversation-performance.unit.test.js')
performance_test = performance_test.replace("assert.strictEqual(pack.revision, '1.1.0');", "assert.strictEqual(pack.revision, '1.2.0');")
performance_test = performance_test.replace("for (const id of ['safe', 'window40', 'window20', 'off', 'reveal', 'report', 'attribution60', 'attribution_copy'])", "for (const id of ['safe', 'window40', 'window20', 'off', 'reveal', 'report', 'turn_attribution_arm', 'turn_attribution_copy'])")
write('tests/dcf-conversation-performance.unit.test.js', performance_test)

host_test = read('tests/dcf-host-bounded-intake.unit.test.js')
host_test = replace_once(
    host_test,
    "assert(!source.includes('cursor.querySelector'), 'root discovery scans growing conversation subtrees');",
    "assert(!source.includes('cursor.querySelector'), 'root discovery scans growing conversation subtrees');\nassert(source.includes(\"doc.addEventListener('click', sendClickHandler, true)\"), 'send click is not captured at the interaction boundary');\nassert(source.includes(\"doc.addEventListener('keydown', sendKeyHandler, true)\"), 'Enter-to-send is not captured');\nassert(source.includes('onReplyStart'), 'first assistant activity is not exposed');\nassert(!source.includes('message_text'), 'send observer retains message text');",
    'host turn lifecycle tests'
)
write('tests/dcf-host-bounded-intake.unit.test.js', host_test)

turn_test = r'''\'use strict\';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createConversationTurnAttribution } = require('../src/host/conversation-turn-attribution');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

let now = 100000;
let timer = null;
const starts = [];
const finishes = [];
const performanceController = {
  startAttribution(options) { starts.push(options); return { status: 'running' }; },
  finishAttribution(reason) { finishes.push(reason); return { status: 'complete' }; },
  attributionReport() {
    return {
      schema: 'dcf.conversation-performance.attribution.v1',
      available: true,
      long_animation_frames: { count: 3, total_blocking_duration_ms: 420 },
      interpretation_limits: [],
      privacy: { message_text_included: false }
    };
  }
};
const fakeWindow = {
  performance: { now: () => 2000 },
  setTimeout(callback) { timer = callback; return 1; },
  clearTimeout() { timer = null; }
};
const originalNow = Date.now;
Date.now = () => now;
try {
  const coordinator = createConversationTurnAttribution(performanceController, { windowObject: fakeWindow, max_duration_ms: 600000 });
  let state = coordinator.arm();
  assert.strictEqual(state.status, 'armed');
  assert.strictEqual(starts.length, 0, 'arming the next turn started collection before send');

  now = 101000;
  state = coordinator.onSend({ kind: 'click', at_epoch_ms: now, timeline_ms: 1234, at: '2026-07-14T12:00:01.000Z' });
  assert.strictEqual(state.status, 'running');
  assert.strictEqual(starts.length, 1);
  assert.strictEqual(starts[0].timeline_start_ms, 1234, 'send interaction was not used as the performance boundary');
  assert.strictEqual(starts[0].context.boundary, 'send-to-reply-complete');

  now = 104500;
  coordinator.onReplyStart({ source: 'live', at_epoch_ms: now, started_at: '2026-07-14T12:00:04.500Z' });
  now = 112000;
  state = coordinator.onReplyComplete({ source: 'live', at_epoch_ms: now, completed_at: '2026-07-14T12:00:12.000Z', quiet_ms: 900 });
  assert.strictEqual(state.completed, true);
  assert.deepStrictEqual(finishes, ['reply-complete']);
  assert.strictEqual(timer, null);

  const report = coordinator.report();
  assert.strictEqual(report.schema, 'dcf.conversation-performance.turn-attribution.v1');
  assert.strictEqual(report.scope, 'send-to-reply-complete');
  assert.strictEqual(report.turn_boundary.total_ms, 11000);
  assert.strictEqual(report.turn_boundary.send_to_first_reply_activity_ms, 3500);
  assert.strictEqual(report.turn_boundary.first_reply_activity_to_complete_ms, 7500);
  assert.strictEqual(report.turn_boundary.completion_detection_quiet_ms, 900);
  assert.strictEqual(report.privacy.user_message_text_included, false);
  assert.strictEqual(report.privacy.assistant_message_text_included, false);

  coordinator.arm();
  const cancelled = coordinator.finishAndReport('manual');
  assert.strictEqual(cancelled.turn_boundary.status, 'cancelled');
  assert.strictEqual(cancelled.turn_boundary.finish_reason, 'cancelled-before-send');
} finally {
  Date.now = originalNow;
}

const pack = STANDARD_PACKS.find((item) => item.pack_id === 'dcf.standard.conversation-performance');
assert.strictEqual(pack.revision, '1.2.0');
const commands = pack.modules[0].blocks.flatMap((block) => block.commands);
assert(commands.some((command) => command.id === 'turn_attribution_arm' && command.label === '记录下一轮问答'));
assert(commands.some((command) => command.id === 'turn_attribution_copy' && command.label === '结束并复制本轮报告'));

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert(indexSource.includes('host.startSendObserver'));
assert(indexSource.includes('conversationTurnAttribution.onReplyComplete'));
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'effects.js'), 'utf8');
assert(effectSource.includes('DCF_CONVERSATION_TURN_ATTRIBUTION'));

console.log(JSON.stringify({ ok: true, armed_before_send: true, send_boundary: true, first_reply_phase: true, automatic_reply_completion: true, manual_recovery: true, no_message_text: true }, null, 2));
'''.replace("\\'use strict\\';", "'use strict';", 1)
write('tests/dcf-conversation-turn-attribution.unit.test.js', turn_test)

# Documentation and governance.
readme = read('README.md')
readme = readme.replace('DCF `0.17.0` keeps a generic modular kernel', 'DCF `0.18.0` keeps a generic modular kernel', 1)
if '## Conversation-turn attribution' not in readme:
    readme += '''\n\n## Conversation-turn attribution\n\nDCF `0.18.0` replaces the fixed 60-second diagnostic as the primary workflow with a question-answer turn boundary. **记录下一轮问答** only arms the collector. The actual Runtime sample begins on the next captured send interaction, records the first assistant DOM activity, and closes automatically after the reply is no longer streaming and remains quiet. The report separates send-to-first-reply activity from reply-activity-to-completion, while keeping a long timeout and manual finish as recovery paths. No user or assistant message text is retained.\n'''
write('README.md', readme)

architecture = read('docs/architecture-current.md')
architecture = architecture.replace('Current release: `0.17.0`', 'Current release: `0.18.0`', 1)
if '## 15. 问答轮次归因' not in architecture:
    architecture += '''\n\n## 15. 问答轮次归因（0.18.0）\n\n主线程归因的默认统计边界不是任意 60 秒，而是用户可感知的一次完整问答：下一次发送动作发生时开始，首个助手输出活动形成阶段分界，助手回复停止流式并通过安静窗口确认后自动结束。固定时长只保留为最长运行围栏，手动结束只用于失败、取消或回复无法正常收口。\n\n“记录下一轮问答”只进入 armed 状态，不启动 Performance 样本，因此诊断按钮本身不进入数据。Host Adapter 在捕获阶段观察发送按钮点击和输入框 Enter，不读取输入正文；send event 的 timeline timestamp 成为 LoAF、Event Timing、layout-shift 和 longtask 的共同下界。回复侧复用已有的 bounded current-reply observer，额外发出 first activity 与 completion 生命周期信号。\n\n报告把浏览器可观察的轮次拆为 send-to-first-reply-activity 与 first-reply-activity-to-completion。前一段包含服务端、网络、调度和页面工作，Runtime 只能证明等待长度及同时发生的浏览器阻塞，不能把整段等待自动归罪于浏览器。完成时间包含明确报告的 quiet-window 检测余量。\n'''
write('docs/architecture-current.md', architecture)

maintenance = read('docs/dcf-maintenance-skill.md')
if '## 十四、问答轮次性能边界' not in maintenance:
    maintenance += '''\n\n## 十四、问答轮次性能边界\n\n排查“发送后到回复完成最卡”的问题，默认使用问答轮次归因，不使用任意固定时间窗。先点击“记录下一轮问答”进入待命；下一次真实发送动作才启动样本，首个助手活动划分等待与输出阶段，回复完成自动封口。最长时限与手动结束只是异常恢复，不是正常统计边界。\n\n分析时分别看 send-to-first-reply-activity 和 first-reply-activity-to-completion。前者不能仅凭耗时判断为前端问题，因为它混合服务端、网络与页面调度；只有同期 LoAF、Event Timing、longtask 或 DCF self timing 才能证明浏览器主线程在这段时间实际阻塞。完成检测存在 quiet-window 延后，报告必须显式保留该值。\n\nHost 只记录发送方式、时间和回复生命周期，不读取用户输入或助手正文。发送监听必须是事件级、捕获期、可停用的有限适配，不得扩展成全页输入记录器。\n'''
write('docs/dcf-maintenance-skill.md', maintenance)

consensus = read('docs/dcf-basic-consensus-prompt.md')
if '性能样本应服从用户实际经历的事件边界' not in consensus:
    consensus += '''\n\n性能样本应服从用户实际经历的事件边界。针对发送后卡顿，以发送动作到本轮回复完成作为默认统计轮次；固定时长只做安全围栏，不能让空闲期稀释或混入主要问题。等待时间与浏览器阻塞分别呈现，不把后端或网络等待机械归因给前端。\n'''
write('docs/dcf-basic-consensus-prompt.md', consensus)

status_index = read('docs/adr/status-index.md')
if '2026-07-14-dcf-conversation-turn-attribution.md' not in status_index:
    status_index = status_index.replace('## Current\n', '## Current\n\n- `2026-07-14-dcf-conversation-turn-attribution.md` — **accepted**\n', 1)
write('docs/adr/status-index.md', status_index)

adr = '''# ADR: Conversation-turn performance attribution\n\nDate: 2026-07-14  \nStatus: accepted\n\n## Context\n\nThe user's dominant slowdown occurs after sending a message and during the wait and streaming reply. A fixed 60-second sample can mix unrelated idle, scrolling and typing work and can miss long replies or dilute the problematic interval.\n\n## Decision\n\n- Make one question-answer turn the primary attribution boundary.\n- Arm first; start collection only on the next send click or Enter action.\n- Use the send event timeline timestamp so the send interaction itself is included while the arm-button interaction is excluded.\n- Mark first assistant DOM activity and automatically finish when the bounded reply observer declares the response complete.\n- Report total send-to-complete, send-to-first-reply activity and first-reply-activity-to-complete durations.\n- Keep a ten-minute default safety timeout and manual finish only as recovery.\n- Capture no composer text, user message body or assistant reply body.\n\n## Limits\n\nSend-to-first-reply time includes backend, network, scheduling and browser work. Runtime APIs can identify simultaneous main-thread blocking but cannot decompose server-side waiting. Reply completion is detected after a quiet window, so the report retains that detection margin.\n'''
write('docs/adr/2026-07-14-dcf-conversation-turn-attribution.md', adr)

current = read('docs/current-state.md')
current = current.replace('当前正式版本：`0.17.0`', '当前正式版本：`0.18.0`', 1)
current = current.replace('`0.17.0` 增加有界 Runtime 主线程归因会话。', '`0.17.0` 增加有界 Runtime 主线程归因会话。`0.18.0` 将主要归因边界改为发送到本轮回复完成。', 1)
if '## 0.18.0 问答轮次归因' not in current:
    current += '''\n\n## 0.18.0 问答轮次归因\n\n- `dcf.standard.conversation-performance@1.2.0` 用“问答轮次归因”替代固定 60 秒作为主入口。\n- “记录下一轮问答”只待命；下一次发送按钮点击或输入框 Enter 才正式启动采样。\n- 首个助手 DOM 活动划分等待阶段，已有 bounded reply observer 在流式结束并安静后自动封口。\n- 报告给出发送到首个回复活动、首个回复活动到完成和整轮时长，并保留 completion quiet-window。\n- 十分钟最长运行和手动结束仅作异常恢复；不采集用户输入或助手回复正文。\n- 用户浏览器尚未完成 0.18.0 的真实问答轮次归因验收。\n'''
write('docs/current-state.md', current)

print('ok')
