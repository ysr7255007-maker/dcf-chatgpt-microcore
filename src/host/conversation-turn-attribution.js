'use strict';

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
