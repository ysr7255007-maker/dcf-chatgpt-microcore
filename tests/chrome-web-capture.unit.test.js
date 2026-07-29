'use strict';
/**
 * Web Capture 单元测试（笼子 + 逻辑，不联网不启浏览器）
 *
 * spec §3.8 覆盖：
 * - 入口笼子：3 个坏站点配置逐一被 SiteAdapterSchema（zod）拒绝；
 *   同一组输入必须同时被 runtime-check（页面侧）拒绝（双层 contract parity）；
 *   1 个坏配置不影响其余站点加载（隔离断言，VM 中跑真实 index.js）
 * - 出口笼子：source_id 缺前缀、role 为 'system'、text 为空，逐一被
 *   CapturedEventSchema（zod + runtime-check 双层）拒绝
 * - 站点注册表完整性：6 站点文件齐全、conversationId 各站点正负例
 * - 流式完成判定：静默计时 + 停止按钮状态组合逻辑（mock DOM，VM 中跑真实 engine.js）
 * - 引擎零 require 机器断言（engine.js / runtime-check.js / index.js）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB_CAPTURE_DIR = path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'web-capture');
const SITES_DIR = path.join(WEB_CAPTURE_DIR, 'sites');
const { SiteAdapterSchema, CapturedEventSchema } = require(path.join(WEB_CAPTURE_DIR, 'contract.js'));
const runtimeCheck = require(path.join(WEB_CAPTURE_DIR, 'runtime-check.js'));

const results = { passed: 0, failed: 0, failures: [] };
function test(name, fn) {
  try {
    fn();
    results.passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed += 1;
    results.failures.push({ name, error: err.message });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function validAdapter(overrides = {}) {
  return Object.assign({
    host: 'example.com',
    matches: ['https://example.com/*'],
    conversationId: (url) => (url.pathname.startsWith('/c/') ? url.pathname.slice(3) : null),
    messageSelectors: ['.msg-a', '.msg-b'],
    roleOf: () => 'user',
    textOf: () => 'hello',
    stopButtonSelectors: [],
    verified: false
  }, overrides);
}

function validEvent(overrides = {}) {
  return Object.assign({
    source_id: 'claude.ai:abc123',
    role: 'user',
    text: 'hello world',
    ts: 1720000000000
  }, overrides);
}

// ============================================================================
console.log('\n=== 入口笼子：SiteAdapterSchema（zod）===');
// ============================================================================

const badSiteConfigs = {
  '缺 conversationId': validAdapter({ conversationId: undefined }),
  'selectors 只有一个': validAdapter({ messageSelectors: ['.only-one'] }),
  'host 为空': validAdapter({ host: '' })
};

for (const [label, bad] of Object.entries(badSiteConfigs)) {
  test(`入口笼子拒绝：${label}（zod）`, () => {
    const r = SiteAdapterSchema.safeParse(bad);
    assert.strictEqual(r.success, false, 'zod 必须拒绝');
  });
  test(`入口笼子拒绝：${label}（runtime-check parity）`, () => {
    assert.throws(() => runtimeCheck.assertSiteAdapter(bad), /./, 'runtime-check 必须同步拒绝');
  });
}

test('入口笼子放行：合法配置（双层均通过）', () => {
  const good = validAdapter();
  const r = SiteAdapterSchema.safeParse(good);
  assert.strictEqual(r.success, true, JSON.stringify(r.error && r.error.issues));
  assert.strictEqual(runtimeCheck.assertSiteAdapter(good), good);
});

// ============================================================================
console.log('\n=== 出口笼子：CapturedEventSchema（zod + runtime-check）===');
// ============================================================================

const badEvents = {
  'source_id 缺前缀': validEvent({ source_id: 'noprefix' }),
  'role 为 system': validEvent({ role: 'system' }),
  'text 为空': validEvent({ text: '' })
};

for (const [label, bad] of Object.entries(badEvents)) {
  test(`出口笼子拒绝：${label}（zod）`, () => {
    const r = CapturedEventSchema.safeParse(bad);
    assert.strictEqual(r.success, false, 'zod 必须拒绝');
  });
  test(`出口笼子拒绝：${label}（runtime-check parity）`, () => {
    assert.throws(() => runtimeCheck.assertCapturedEvent(bad), /./, 'runtime-check 必须同步拒绝');
  });
}

test('出口笼子放行：合法事件（双层均通过）', () => {
  const good = validEvent({ role: 'assistant' });
  const r = CapturedEventSchema.safeParse(good);
  assert.strictEqual(r.success, true, JSON.stringify(r.error && r.error.issues));
  assert.strictEqual(runtimeCheck.assertCapturedEvent(good), good);
});

// ============================================================================
console.log('\n=== 隔离断言：1 个坏配置不影响其余站点加载（VM 跑真实 index.js）===');
// ============================================================================

test('坏站点被隔离，好站点照常注册', () => {
  const registry = {
    'claude-ai': validAdapter({ host: 'claude.ai' }),
    gemini: validAdapter({ host: 'gemini.google.com' }),
    doubao: validAdapter({ host: '' }),              // 坏配置：host 为空
    kimi: validAdapter({ host: 'kimi.com' }),
    deepseek: validAdapter({ conversationId: undefined }), // 坏配置：缺函数
    yuanbao: validAdapter({ host: 'yuanbao.tencent.com' })
  };

  const sandbox = {
    console,
    document: { readyState: 'complete', addEventListener() {}, documentElement: {} },
    location: { href: 'https://other.invalid/', hostname: 'other.invalid', pathname: '/' },
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    URL,
    Date
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['runtime-check.js', 'engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(WEB_CAPTURE_DIR, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.__DCF_WEB_CAPTURE__ = registry;
  vm.runInContext(fs.readFileSync(path.join(WEB_CAPTURE_DIR, 'index.js'), 'utf8'), sandbox, { filename: 'index.js' });

  assert.strictEqual(sandbox.__DCF_WEB_CAPTURE_ENGINE__.adapterCount(), 4, '4 个好站点必须注册，2 个坏站点被隔离');
});

// ============================================================================
console.log('\n=== 站点注册表完整性 ===');
// ============================================================================

const EXPECTED_SITES = ['claude-ai', 'gemini', 'doubao', 'kimi', 'deepseek', 'yuanbao', 'grok', 'z-ai', 'minimax', 'xiaomimimo'];

test('全部站点文件齐全', () => {
  for (const site of EXPECTED_SITES) {
    assert.ok(fs.existsSync(path.join(SITES_DIR, `${site}.js`)), `缺站点文件 ${site}.js`);
  }
});

test('每个站点文件通过 SiteAdapterSchema（zod 全量校验）', () => {
  for (const site of EXPECTED_SITES) {
    const mod = require(path.join(SITES_DIR, `${site}.js`));
    const r = SiteAdapterSchema.safeParse(mod);
    assert.strictEqual(r.success, true, `${site}: ${r.error ? JSON.stringify(r.error.issues) : ''}`);
  }
});

test('verified 为布尔（仅 BrowserClaw 验收后可置 true）', () => {
  for (const site of EXPECTED_SITES) {
    const mod = require(path.join(SITES_DIR, `${site}.js`));
    assert.strictEqual(typeof mod.verified, 'boolean', `${site}: verified 必须是布尔`);
  }
});

test('conversationId 各站点正负例', () => {
  const cases = {
    'claude-ai': ['https://claude.ai/chat/conv-abc_123', 'https://claude.ai/'],
    gemini: ['https://gemini.google.com/app/e87168ca68adfec9', 'https://gemini.google.com/app'],
    doubao: ['https://www.doubao.com/chat/abc123XYZ', 'https://www.doubao.com/'],
    kimi: ['https://kimi.com/chat/abc-123_XYZ', 'https://kimi.com/'],
    deepseek: ['https://chat.deepseek.com/a/chat/s/318eaecf-9df2-4ad8-b23a', 'https://chat.deepseek.com/'],
    yuanbao: ['https://yuanbao.tencent.com/chat/abc123_XYZ', 'https://yuanbao.tencent.com/'],
    grok: ['https://grok.com/c/1fa8b41e-726b-4090-a257-1711d2680f40', 'https://grok.com/'],
    'z-ai': ['https://chat.z.ai/c/6feeec5c-f7f5-470a-8d3e-ff813a6052cb', 'https://chat.z.ai/'],
    minimax: ['https://agent.minimaxi.com/mavis?id=425153747059886', 'https://agent.minimaxi.com/'],
    xiaomimimo: ['https://aistudio.xiaomimimo.com/#/chat/f04abac635b0f0cc4306e3188aa3322d', 'https://aistudio.xiaomimimo.com/']
  };
  for (const [site, [positive, negative]] of Object.entries(cases)) {
    const mod = require(path.join(SITES_DIR, `${site}.js`));
    const id = mod.conversationId(new URL(positive));
    assert.ok(typeof id === 'string' && id.length > 0, `${site} 正例必须提取会话 ID，得到 ${id}`);
    assert.strictEqual(mod.conversationId(new URL(negative)), null, `${site} 负例必须返回 null`);
  }
});

// ============================================================================
console.log('\n=== 流式完成判定（mock DOM，VM 跑真实 engine.js）===');
// ============================================================================

function createEngineSandbox(initialMessages, opts = {}) {
  const sent = [];
  const intervals = [];
  const timeouts = [];
  let now = 1000000000000;
  let stopPresent = false;

  let messageEls = initialMessages;
  const listeners = [];

  const documentMock = {
    readyState: 'complete',
    documentElement: {},
    addEventListener() {},
    querySelectorAll(sel) {
      if (sel === '.msg') return messageEls;
      return [];
    },
    querySelector(sel) {
      if (sel === '.stop') return stopPresent ? {} : null;
      return null;
    }
  };

  function MockMutationObserver(cb) { listeners.push(cb); this.observe = () => {}; this.disconnect = () => {}; }

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: documentMock,
    location: { href: 'https://test.local/c/conv-1', hostname: 'test.local', pathname: '/c/conv-1' },
    MutationObserver: MockMutationObserver,
    setInterval: (cb) => { intervals.push(cb); return intervals.length; },
    clearInterval: () => {},
    setTimeout: (cb) => { timeouts.push(cb); return timeouts.length; },
    clearTimeout: () => {},
    chrome: { runtime: { sendMessage: (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); } } },
    URL,
    Date: Object.assign(Date, { now: () => now })
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['runtime-check.js', 'engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(WEB_CAPTURE_DIR, file), 'utf8'), sandbox, { filename: file });
  }

  const adapter = {
    host: 'test.local',
    matches: ['https://test.local/*'],
    conversationId: (url) => (url.pathname.startsWith('/c/') ? url.pathname.slice(3) : null),
    messageSelectors: ['.msg', '.msg-fallback'],
    roleOf: (el) => el.role || null,
    textOf: (el) => el.text || '',
    stopButtonSelectors: ['.stop'],
    verified: false
  };
  sandbox.__DCF_WEB_CAPTURE_ENGINE__.registerAdapter(adapter);

  function runTimeouts() { const cbs = timeouts.splice(0); cbs.forEach((cb) => cb()); }
  function mutate() { listeners.forEach((cb) => cb([], null)); runTimeouts(); }
  function tickIntervals() { intervals.forEach((cb) => cb()); runTimeouts(); }

  return {
    sandbox, sent,
    setMessages(els) { messageEls = els; },
    setStopPresent(v) { stopPresent = v; },
    advance(ms) { now += ms; },
    mutate, tickIntervals, runTimeouts
  };
}

test('基线：加载时已有 >1 轮历史消息只标记不上报', () => {
  const env = createEngineSandbox([
    { role: 'user', text: '历史问题一' },
    { role: 'assistant', text: '历史回答一' },
    { role: 'user', text: '历史问题二' },
    { role: 'assistant', text: '历史回答二' }
  ]);
  env.sandbox.__DCF_WEB_CAPTURE_ENGINE__.start();
  env.runTimeouts();
  assert.strictEqual(env.sent.length, 0, `基线消息不得上报，实际 ${env.sent.length}`);
});

test('新对话：<=1 轮初始消息视为实时产生，正常上报', () => {
  const env = createEngineSandbox([
    { role: 'user', text: '首轮问题' }
  ]);
  env.sandbox.__DCF_WEB_CAPTURE_ENGINE__.start();
  env.runTimeouts();
  assert.strictEqual(env.sent.length, 1, '新对话首轮 user 消息必须上报');
  assert.strictEqual(env.sent[0].payload.role, 'user');
});

test('新 user 消息实时入库；assistant 静默 >=1.5s 且无停止按钮才入库一次', () => {
  const env = createEngineSandbox([]);
  env.sandbox.__DCF_WEB_CAPTURE_ENGINE__.start();
  env.runTimeouts();

  // 新 user 消息
  const userEl = { role: 'user', text: 'DCF 采集验证问题' };
  env.setMessages([userEl]);
  env.mutate();
  assert.strictEqual(env.sent.length, 1, 'user 消息必须即时上报');
  assert.strictEqual(env.sent[0].type, 'dcf.observation');
  assert.strictEqual(env.sent[0].event_type, 'conversation.message.sent');
  assert.strictEqual(env.sent[0].payload.role, 'user');
  assert.strictEqual(env.sent[0].payload.text, 'DCF 采集验证问题');
  assert.strictEqual(env.sent[0].conversation_key, 'test.local/c/conv-1');

  // assistant 流式：文本增长中（静默不足）→ 不入库
  const aiEl = { role: 'assistant', text: '回答片段' };
  env.setMessages([userEl, aiEl]);
  env.mutate();
  env.advance(1000);
  env.tickIntervals();
  assert.strictEqual(env.sent.length, 1, '静默不足 1.5s 不得入库');

  // 停止按钮存在 → 即使静默足够也不入库
  env.setStopPresent(true);
  env.advance(2000);
  env.tickIntervals();
  assert.strictEqual(env.sent.length, 1, '停止按钮存在不得判完成');

  // 停止按钮消失 + 静默 >=1.5s → 入库一次（完成态全量文本）
  env.setStopPresent(false);
  aiEl.text = '回答片段，这是完整回答。';
  env.mutate(); // 文本变化刷新静默计时
  env.advance(1600);
  env.tickIntervals();
  assert.strictEqual(env.sent.length, 2, '判停后必须入库一次');
  assert.strictEqual(env.sent[1].event_type, 'conversation.message.received');
  assert.strictEqual(env.sent[1].payload.text, '回答片段，这是完整回答。');

  // 再次 tick：不得重复入库（半截防护）
  env.advance(5000);
  env.tickIntervals();
  assert.strictEqual(env.sent.length, 2, '同一条流式回复只入库一次');
});

test('conversationId 返回 null 时不采集不上报', () => {
  const env = createEngineSandbox([]);
  env.sandbox.location.href = 'https://test.local/';
  env.sandbox.location.pathname = '/';
  env.sandbox.__DCF_WEB_CAPTURE_ENGINE__.start();
  env.setMessages([{ role: 'user', text: '无会话 ID 页面消息' }]);
  env.mutate();
  env.tickIntervals();
  assert.strictEqual(env.sent.length, 0, '无会话 ID 不得上报');
});

// ============================================================================
console.log('\n=== 引擎零 require 机器断言 ===');
// ============================================================================

for (const file of ['engine.js', 'runtime-check.js', 'index.js']) {
  test(`${file} 不含 require(（页面运行时纯自包含）`, () => {
    const code = fs.readFileSync(path.join(WEB_CAPTURE_DIR, file), 'utf8');
    assert.ok(!/\brequire\s*\(/.test(code), `${file} 不得出现 require(`);
  });
}

// ============================================================================
console.log('\n=== G1 manifest ↔ sites registry 一致性检查 ===');
// ============================================================================

test('G1 manifest host_permissions 与 seed/adapters/chrome/web-capture/sites/*.js host 一一对应', () => {
  const g1Manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'manifest.json'), 'utf8'));
  
  // 8 站采集域名清单
  const requiredDomains = [
    'doubao.com', 'gemini.google.com', 'grok.com', 'kimi.com',
    'chat.z.ai', 'deepseek.com', 'agent.minimaxi.com', 'aistudio.xiaomimimo.com'
  ];
  
  // 验证 manifest 包含所有站点权限
  const hosts = g1Manifest.host_permissions.join(' ');
  for (const domain of requiredDomains) {
    assert.ok(hosts.includes(domain), `host_permissions 缺 ${domain}`);
  }
  
  // 验证 content_scripts 注册 bundle.js
  const cs = (g1Manifest.content_scripts || []).find((c) => (c.js || []).includes('web-capture/bundle.js'));
  assert.ok(cs, 'G1 manifest 必须注册 web-capture/bundle.js');
  
  // 验证 matches 与站点域名对应
  for (const domain of requiredDomains) {
    assert.ok(cs.matches.some((m) => m.includes(domain)), `content_scripts.matches 缺 ${domain}`);
  }
});

test('G1 manifest version 必须是 Chrome 合法版本号（1-4 段点分整数，否则扩展无法加载）', () => {
  // 回归守卫：version 'x.y.z-suffix' 会被 Chrome 拒绝加载整个扩展（Extensions.loadUnpacked
  // 报 "Required value 'version' ... 1-4 dot-separated integers"），真实浏览器零加载。
  const g1Manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'manifest.json'), 'utf8'));
  const parts = String(g1Manifest.version).split('.');
  assert.ok(parts.length >= 1 && parts.length <= 4, `version 必须是 1-4 段，实际 ${g1Manifest.version}`);
  for (const p of parts) {
    assert.ok(/^\d+$/.test(p), `version 段必须为纯整数，实际含非法段 '${p}'（version=${g1Manifest.version}）`);
    assert.ok(Number(p) >= 0 && Number(p) <= 65536, `version 段必须在 0-65536，实际 ${p}`);
  }
  // 非数字后缀（如 -g1）应放 version_name，不得污染 version
  assert.ok(!/[^0-9.]/.test(g1Manifest.version), `version 不得含非数字字符（用 version_name 承载标签），实际 ${g1Manifest.version}`);
});

test('build-g1-adapter.js 存在且生成零依赖 bundle', () => {
  const buildScriptPath = path.join(__dirname, '..', 'scripts', 'build-g1-adapter.js');
  assert.ok(fs.existsSync(buildScriptPath), 'build-g1-adapter.js 必须存在');
  
  const buildScript = fs.readFileSync(buildScriptPath, 'utf8');
  assert.ok(buildScript.includes('web-capture'), '构建脚本必须引用 web-capture');
  assert.ok(!buildScript.includes('contract.js'), '构建不得引入 zod contract.js');
});

test('seed/adapters/chrome/background.js natively 支持 dcf.observation + OutboxCore + alarms flush', () => {
  const bgPath = path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'background.js');
  const bg = fs.readFileSync(bgPath, 'utf8');
  
  assert.ok(bg.includes("importScripts('ulid.js', 'outbox-core.js')"), 'SW 必须 importScripts outbox 依赖');
  assert.ok(bg.includes('OutboxCore'), 'SW 必须实例化 OutboxCore');
  assert.ok(bg.includes('dcf.observation'), 'SW 必须处理 dcf.observation 消息');
  assert.ok(bg.includes('dcf-outbox-flush'), 'SW 必须设置 dcf-outbox-flush alarm');
});

test('G1 构建产物 seed/adapters/chrome/web-capture/bundle.js 在 VM 中可完整执行且注册全部适配器', () => {
  const bundlePath = path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'web-capture', 'bundle.js');
  assert.ok(fs.existsSync(bundlePath), 'bundle.js 必须存在（先跑 npm run build:g1）');
  const code = fs.readFileSync(bundlePath, 'utf8');
  assert.ok(!/\brequire\s*\(/.test(code), '构建产物不得含 require(');
  // 回归守卫：bundle 必须把 __SITE_* 常量接线进 __DCF_WEB_CAPTURE__ 注册表，
  // 否则 index.js 读到 undefined → 全部隔离 → loaded=0 → 真实浏览器零采集
  assert.ok(/__DCF_WEB_CAPTURE__\[/.test(code), 'bundle 必须包含注册表接线（__DCF_WEB_CAPTURE__[key]=__SITE_*）');

  const attrSet = {};
  const documentEl = {
    setAttribute(k, v) { attrSet[k] = v; },
    getAttribute(k) { return attrSet[k] || null; }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      readyState: 'complete',
      documentElement: documentEl,
      addEventListener() {},
      querySelectorAll() { return []; },
      querySelector() { return null; }
    },
    location: { href: 'https://www.doubao.com/chat/123', hostname: 'www.doubao.com', pathname: '/chat/123' },
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (cb) => { cb(); return 0; },
    clearTimeout: () => {},
    URL,
    Date
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'web-capture-bundle.js' });

  assert.ok(sandbox.__DCF_WEB_CAPTURE_ENGINE__, '构建产物必须暴露引擎');
  assert.strictEqual(sandbox.__DCF_WEB_CAPTURE_ENGINE__.adapterCount(), EXPECTED_SITES.length, '全部站点适配器必须注册');
  const beacon = attrSet['data-dcf-web-capture'];
  assert.ok(beacon && JSON.parse(beacon).started === true, '引擎必须启动并写信标');
});

// ============================================================================
console.log('\n================ 汇总 ================');
console.log(`通过 ${results.passed}，失败 ${results.failed}`);
if (results.failed > 0) {
  for (const f of results.failures) console.error(`  ✗ ${f.name}: ${f.error}`);
  process.exitCode = 1;
} else {
  console.log('✓ 全部 web-capture 单测通过');
}
