'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createConversationPerformanceController, normalizePerformancePolicy, planTurnWindow } = require('../src/host/conversation-performance');
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

function fakeStyle(initial = {}) {
  const values = new Map(Object.entries(initial).map(([name, value]) => [name, { value, priority: '' }]));
  return {
    getPropertyValue(name) { return values.has(name) ? values.get(name).value : ''; },
    getPropertyPriority(name) { return values.has(name) ? values.get(name).priority : ''; },
    setProperty(name, value, priority = '') { values.set(name, { value: String(value), priority: String(priority) }); },
    removeProperty(name) { values.delete(name); }
  };
}

function fakeTurn(index, scroll) {
  return {
    nodeType: 1,
    isConnected: true,
    parentElement: scroll,
    dataset: {},
    style: fakeStyle(index === 0 ? { display: 'grid' } : {}),
    contains(other) { return other === this; },
    querySelector() { return null; }
  };
}

const scroll = {
  parentElement: null,
  scrollHeight: 6000,
  clientHeight: 800,
  scrollTop: 5200,
  addEventListener() {},
  removeEventListener() {}
};
const turns = Array.from({ length: 60 }, (_, index) => fakeTurn(index, scroll));
const root = {
  isConnected: true,
  querySelectorAll(selector) {
    if (selector.includes('conversation-turn')) return turns;
    return [];
  }
};
const body = {};
scroll.parentElement = body;
let streaming = false;
const queued = [];
class FakeMutationObserver { observe() {} disconnect() {} }
const fakeDocument = { body, documentElement: {}, scrollingElement: scroll };
const fakeWindow = {
  document: fakeDocument,
  location: { href: 'https://chatgpt.com/c/example', pathname: '/c/example' },
  MutationObserver: FakeMutationObserver,
  CSS: { supports: () => true },
  getComputedStyle(node) { return { overflowY: node === scroll ? 'auto' : 'visible' }; },
  setTimeout(callback) { queued.push(callback); return queued.length; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  requestAnimationFrame(callback) { callback(); return 1; }
};
const controller = createConversationPerformanceController(fakeWindow, {
  findConversationRoot: () => root,
  isStreaming: () => streaming
});
controller.syncPolicy({ mode: 'safe', activation_turns: 24, keep_recent: 40, reveal_batch: 20 });
let runtime = controller.applyNow();
assert.strictEqual(runtime.optimized_count, 60);
assert.strictEqual(runtime.hidden_count, 0);
assert(turns.every((turn) => turn.style.getPropertyValue('content-visibility') === 'auto'));
assert.strictEqual(turns[0].style.getPropertyValue('display'), 'grid');

controller.syncPolicy({ mode: 'window', activation_turns: 24, keep_recent: 40, reveal_batch: 20 });
runtime = controller.applyNow();
assert.strictEqual(runtime.hidden_count, 20);
assert(turns.slice(0, 20).every((turn) => turn.style.getPropertyValue('display') === 'none'));
assert(turns.slice(20).every((turn) => turn.style.getPropertyValue('display') !== 'none'));
assert(turns.every((turn) => turn.isConnected), 'window mode detached a ChatGPT turn');

streaming = true;
runtime = controller.revealPreviousBatch();
assert.strictEqual(runtime.hidden_count, 20, 'manual reveal changed the window during streaming');
streaming = false;
runtime = controller.applyNow();
assert.strictEqual(runtime.hidden_count, 0, 'queued reveal intent was not applied after streaming');

controller.syncPolicy({ mode: 'off' });
runtime = controller.applyNow();
assert.strictEqual(runtime.hidden_count, 0);
assert(turns.every((turn) => turn.style.getPropertyValue('content-visibility') === ''));
assert.strictEqual(turns[0].style.getPropertyValue('display'), 'grid', 'original inline display was not restored');
assert(turns.slice(1).every((turn) => turn.style.getPropertyValue('display') === ''));
controller.destroy();

const pack = STANDARD_PACKS.find((item) => item.pack_id === 'dcf.standard.conversation-performance');
assert(pack, 'conversation performance package missing');
assert(REQUIRED_PRODUCT_PACKAGES.includes(pack.pack_id), 'conversation performance package is not in product baseline');
assert.strictEqual(pack.revision, '1.3.0');
assert.strictEqual(pack.contributes.policies.conversation_performance.mode, 'safe');
const commands = pack.modules[0].blocks.flatMap((block) => block.commands).map((command) => command.id);
for (const id of ['safe', 'window40', 'window20', 'off', 'reveal', 'report', 'turn_attribution_arm', 'turn_attribution_copy']) assert(commands.includes(id), `missing performance command ${id}`);

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'host', 'conversation-performance.js'), 'utf8');
assert(source.includes("content-visibility', 'auto"), 'safe content-visibility mode missing');
assert(source.includes("display', 'none', 'important"), 'windowed rendering control missing');
assert(source.includes('PerformanceObserver'), 'long-task observation missing');
assert(source.includes('isStreaming()'), 'streaming guard missing');
assert(source.includes('revealPreviousBatch'), 'batch reveal missing');
assert(source.includes('if (routeChanged || rootChanged) scheduleApply(0);'), 'route safety poll still performs periodic full reconciliation');
assert(!source.includes('force: options.automatic !== true'), 'manual reveal bypasses the streaming guard');
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
  reconciled_policy: true,
  no_idle_full_rescan: true,
  streaming_safe_manual_reveal: true,
  style_restoration_exercised: true,
  long_animation_frame_attribution: true
}, null, 2));
