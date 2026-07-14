'use strict';

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
const healthSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'health.js'), 'utf8');
assert(healthSource.includes('performanceExpected && !performanceState'), 'health requires the controller even when its package is absent');

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
