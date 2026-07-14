from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


controller = read('src/host/conversation-performance.js')
controller = replace_once(
    controller,
    "  function revealPreviousBatch(options = {}) {\n    if (policy.mode !== 'window' || !lastHiddenCount) return diagnostics();\n    revealedOlder += policy.reveal_batch;\n    return applyNow({ preserveTop: true, force: options.automatic !== true });\n  }",
    "  function revealPreviousBatch() {\n    if (policy.mode !== 'window' || !lastHiddenCount) return diagnostics();\n    revealedOlder += policy.reveal_batch;\n    return applyNow({ preserveTop: true });\n  }",
    'streaming-safe reveal'
)
controller = replace_once(
    controller,
    "      routeTimer = windowObject.setInterval(() => {\n        const href = String(windowObject.location && windowObject.location.href || '');\n        if (href !== lastHref) {\n          lastHref = href;\n          restoreAllManaged();\n          revealedOlder = 0;\n          if (observer) observer.disconnect();\n          observer = null;\n          observedRoot = null;\n        }\n        attachRoot();\n        scheduleApply();\n      }, 1200);",
    "      routeTimer = windowObject.setInterval(() => {\n        const href = String(windowObject.location && windowObject.location.href || '');\n        const routeChanged = href !== lastHref;\n        if (routeChanged) {\n          lastHref = href;\n          restoreAllManaged();\n          revealedOlder = 0;\n          if (observer) observer.disconnect();\n          observer = null;\n          observedRoot = null;\n        }\n        const previousRoot = observedRoot;\n        attachRoot();\n        const rootChanged = observedRoot !== previousRoot;\n        if (routeChanged || rootChanged) scheduleApply(0);\n      }, 1200);",
    'idle route polling'
)
write('src/host/conversation-performance.js', controller)

unit = read('tests/dcf-conversation-performance.unit.test.js')
unit = replace_once(
    unit,
    "const { normalizePerformancePolicy, planTurnWindow } = require('../src/host/conversation-performance');",
    "const { createConversationPerformanceController, normalizePerformancePolicy, planTurnWindow } = require('../src/host/conversation-performance');",
    'controller test import'
)
behavior = r'''

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
'''
unit = replace_once(unit, "\nconst pack = STANDARD_PACKS.find", behavior + "\nconst pack = STANDARD_PACKS.find", 'behavior test insertion')
unit = replace_once(
    unit,
    "assert(source.includes('revealPreviousBatch'), 'batch reveal missing');",
    "assert(source.includes('revealPreviousBatch'), 'batch reveal missing');\nassert(source.includes('if (routeChanged || rootChanged) scheduleApply(0);'), 'route safety poll still performs periodic full reconciliation');\nassert(!source.includes('force: options.automatic !== true'), 'manual reveal bypasses the streaming guard');",
    'audit source assertions'
)
unit = replace_once(
    unit,
    "  reconciled_policy: true",
    "  reconciled_policy: true,\n  no_idle_full_rescan: true,\n  streaming_safe_manual_reveal: true,\n  style_restoration_exercised: true",
    'audit test output'
)
write('tests/dcf-conversation-performance.unit.test.js', unit)

architecture = read('docs/architecture-current.md')
architecture += '\n性能控制器不按固定频率重扫对话。MutationObserver 负责内容变化，低频 URL/root 轮询只在导航或根节点替换时触发一次重新协调；手动与自动历史展开都服从流式输出保护。\n'
write('docs/architecture-current.md', architecture)

current = read('docs/current-state.md')
current += '\n- 0.16.0 合并前审计已取消空闲状态下的固定频率全量重扫；手动展开历史也不再绕过流式保护。\n'
write('docs/current-state.md', current)

print('ok')
