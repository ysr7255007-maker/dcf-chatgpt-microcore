'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAttributionSession, safeScriptSource, summarizeAttributionSession } = require('../src/host/conversation-performance');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

const firstParty = safeScriptSource('https://cdn.oaistatic.com/assets/app-123.js?token=SECRET#fragment', 'https://chatgpt.com');
assert.strictEqual(firstParty.category, 'chatgpt-page');
assert(!firstParty.source.includes('SECRET'));
assert(!firstParty.source.includes('?'));
assert(!firstParty.source.includes('#'));
const thirdParty = safeScriptSource('https://example.net/vendor/tool.js?user=private', 'https://chatgpt.com');
assert.strictEqual(thirdParty.category, 'third-party');
assert(!thirdParty.source.includes('private'));

const session = createAttributionSession({ session_id: 'test-session', started_at: '2026-07-14T00:00:00.000Z', started_epoch_ms: 1000, duration_ms: 60000, timeline_start_ms: 500, context: { route_kind: '/c/:conversation', mode: 'safe', turn_count: 116 } });
assert.strictEqual(session.timeline_start_ms, 500);
session.status = 'complete';
session.ended_at = '2026-07-14T00:01:00.000Z';
session.ended_epoch_ms = 61000;
session.end_reason = 'duration';
session.entries.loafs.push({
  start_ms: 1000, duration_ms: 180, blocking_duration_ms: 90, work_duration_ms: 120, render_duration_ms: 60, style_layout_duration_ms: 35,
  streaming: false, has_ui_event: true,
  scripts: [
    { category: 'chatgpt-page', source: 'cdn.oaistatic.com/assets/app-123.js', function_name: 'renderConversation', invoker_type: 'event-listener', invoker: 'DOMWindow.onclick', duration_ms: 92, forced_style_layout_ms: 24, pause_ms: 0 },
    { category: 'third-party', source: 'example.net/vendor/tool.js', function_name: 'observerCallback', invoker_type: 'user-callback', invoker: 'MutationObserver', duration_ms: 18, forced_style_layout_ms: 2, pause_ms: 0 }
  ]
});
session.entries.loafs.push({ start_ms: 2000, duration_ms: 70, blocking_duration_ms: 10, work_duration_ms: 70, render_duration_ms: 0, style_layout_duration_ms: 0, streaming: true, has_ui_event: false, scripts: [] });
session.entries.events.push({ name: 'click', start_ms: 990, duration_ms: 160, input_delay_ms: 70, processing_ms: 55, presentation_delay_ms: 35, interaction_id: 7, streaming: false });
session.entries.layout_shifts.push({ start_ms: 1200, value: 0.08, had_recent_input: false, streaming: false });
session.entries.long_tasks.push({ start_ms: 1000, duration_ms: 170, name: 'self', streaming: false });
session.entries.dcf_applies.push({ at_epoch_ms: 2000, reason: 'mutation', duration_ms: 2, turn_count: 116, hidden_count: 0 });
session.entries.mutations = { batches: 4, added_nodes: 8, removed_nodes: 1, max_batch_nodes: 5 };

const report = summarizeAttributionSession(session, { selector_strategy: 'testid', support: { long_animation_frame: true, event_timing: true, layout_shift: true, long_task: true } });
assert.strictEqual(report.schema, 'dcf.conversation-performance.attribution.v1');
assert.strictEqual(report.long_animation_frames.count, 2);
assert.strictEqual(report.long_animation_frames.total_blocking_duration_ms, 100);
assert.strictEqual(report.long_animation_frames.total_forced_style_layout_ms, 26);
assert.strictEqual(report.top_scripts[0].source, 'cdn.oaistatic.com/assets/app-123.js');
assert.strictEqual(report.top_scripts[0].total_duration_ms, 92);
assert.strictEqual(report.interactions.by_type[0].max_input_delay_ms, 70);
assert.strictEqual(report.layout_shifts.unexpected_score, 0.08);
assert.strictEqual(report.dcf_self.total_duration_ms, 2);
assert.strictEqual(report.dcf_self.mutation_batches, 4);
assert.strictEqual(report.privacy.message_text_included, false);
assert.strictEqual(report.privacy.event_targets_included, false);
assert(!JSON.stringify(report).includes('SECRET'));
assert(!JSON.stringify(report).includes('private'));

const pack = STANDARD_PACKS.find((item) => item.pack_id === 'dcf.standard.conversation-performance');
assert.strictEqual(pack.revision, '1.2.0');
const commandIds = pack.modules[0].blocks.flatMap((block) => block.commands).map((command) => command.id);
assert(commandIds.includes('turn_attribution_arm'));
assert(commandIds.includes('turn_attribution_copy'));
assert(commandIds.includes('turn_attribution_finish'));

const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'host', 'conversation-performance.js'), 'utf8');
for (const marker of ['long-animation-frame', 'forcedStyleAndLayoutDuration', 'durationThreshold: 16', 'layout-shift', 'timeline_start_ms', 'acceptsAttributionEntry']) assert(controllerSource.includes(marker), `missing attribution marker ${marker}`);
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'effects.js'), 'utf8');
assert(effectSource.includes('DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION'));
assert(effectSource.includes("finishAttribution('manual')"));
const commandSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'commands.js'), 'utf8');
assert(commandSource.includes('conversation.performance.attribution.start'));
assert(commandSource.includes('conversation.performance.attribution.report'));

console.log(JSON.stringify({ ok: true, loaf_script_attribution: true, interaction_breakdown: true, layout_shift_summary: true, dcf_self_timing: true, source_url_sanitization: true, start_action_excluded_by_timeline: true, turn_scoped_package: true }, null, 2));
