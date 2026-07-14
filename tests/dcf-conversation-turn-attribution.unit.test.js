'use strict';

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
