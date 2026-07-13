'use strict';

const assert = require('assert');
const { VERSION } = require('../src/core/constants');
const { createStorage } = require('../src/runtime/storage');
const { loadOrMigrate } = require('../src/core/state');
const { ensureProductBaseline } = require('../src/index');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('../src/modules/standard-packages');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createHealthReporter } = require('../src/modules/health');
const { modulesByRole } = require('../src/modules/module-roles');

function localStore() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] || null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

const gm = new Map();
const localStorage = localStore();
const api = {
  localStorage,
  GM_getValue(key, fallback) { return gm.has(key) ? gm.get(key) : fallback; },
  GM_setValue(key, value) { gm.set(key, value); },
  GM_deleteValue(key) { gm.delete(key); },
  GM_listValues() { return Array.from(gm.keys()); }
};
const storage = createStorage(api);
const oldPack = {
  schema: 'dcf.module_pack.v1',
  pack_id: 'legacy.tools',
  revision: '1',
  modules: [{ id: 'legacy.tools', title: '旧工具', version: '1', commands: [{ id: 'run', label: '运行', steps: [{ call: 'notice', with: { text: 'SECRET-COMMAND-TEXT' } }] }] }]
};
localStorage.setItem('dcf.package.sources.v1', JSON.stringify({ schema: 'dcf.package.sources.v1', revision: 1, packages: { 'legacy.tools': { package_id: 'legacy.tools', enabled: true, active_revision: '1', source: { kind: 'legacy' }, revisions: { '1': { revision: '1', hash: 'legacy', installed_at: '2026-07-12T00:00:00Z', pack: oldPack } } } } }));
localStorage.setItem('dcf.user.state.v1', JSON.stringify({ schema: 'dcf.user.state.v1', revision: 1, appearance: { side: null, vars: {}, css: '', safe_mode: false }, settings: {}, content: { ammo: { secret: { id: 'secret', title: '秘密', body: 'SECRET-AMMO-BODY' } } }, moduleDisplay: {} }));
localStorage.setItem('dcf.kernel.ops.v2', JSON.stringify({ schema: 'dcf.kernel.ops.v2', seenBlocks: {}, badBlocks: {} }));

const clean = ensureProductBaseline(loadOrMigrate(createStorage({}), STANDARD_PACKS));
gm.set('dcf.state.root.v1', clean);
const loaded = loadOrMigrate(storage, STANDARD_PACKS);
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: loaded });
engine.initialize();

let hostState = {
  schema: 'dcf.host.diagnostics.v1',
  route_kind: '/c/:conversation',
  conversation_root_found: true,
  reply_root_observer_attached: true,
  observed_root_connected: true,
  observed_root_is_current: true,
  composer_found: true
};
const host = { diagnostics: () => hostState };
const roles = modulesByRole(engine.getRoot(), engine.getRegistry());
const packageIds = Object.keys(engine.getRoot().packages.packages).sort();
let uiState = {
  schema: 'dcf.ui.runtime.snapshot.v1',
  host_count: 1,
  host_connected: true,
  shadow_root_attached: true,
  shell_connected: true,
  shell_visible: true,
  shell_intersects_viewport: true,
  shell_rect: { left: 10, top: 10, right: 350, bottom: 700, width: 340, height: 690 },
  current_tab: 'maintenance',
  tab_ids: ['ammo', 'functions', 'packages', 'maintenance'],
  version_text: `DCF ${VERSION}`,
  views: {
    packages: { entry_ids: packageIds.slice() },
    functions: { module_ids: roles.daily.map((module) => module.id), collapsed_module_ids: [] },
    maintenance: { module_ids: roles.maintenance.map((module) => module.id), collapsed_module_ids: roles.maintenance.map((module) => module.id) }
  }
};
const runtimeObject = { version: VERSION };
const app = { captureRuntimeViews: () => JSON.parse(JSON.stringify(uiState)) };
const reporter = createHealthReporter(engine, receipts, storage, host, REQUIRED_PRODUCT_PACKAGES, {
  getApp: () => app,
  getRuntime: () => runtimeObject
});

let report = reporter.report();
let serialized = JSON.stringify(report);
assert.strictEqual(report.schema, 'dcf.runtime.health.diff.v1');
assert.strictEqual(report.status, 'healthy');
assert.deepStrictEqual(report.deviations, []);
assert(!serialized.includes('SECRET-AMMO-BODY'), 'ammo body leaked into Runtime health report');
assert(!serialized.includes('SECRET-COMMAND-TEXT'), 'command payload leaked into Runtime health report');
assert.strictEqual(report.privacy.conversation_text_included, false);
assert(reporter.format().startsWith('<<<DCF_RUNTIME_HEALTH\n'));
assert(reporter.format().endsWith('\nDCF_RUNTIME_HEALTH>>>'));

uiState.host_count = 2;
uiState.views.functions.module_ids = uiState.views.functions.module_ids.filter((id) => id !== 'legacy.tools');
hostState = Object.assign({}, hostState, { observed_root_is_current: false });
report = reporter.report();
const codes = report.deviations.map((item) => item.code);
assert.strictEqual(report.status, 'error');
assert(codes.includes('runtime_host_count_mismatch'));
assert(codes.includes('runtime_function_entries_diverged'));
assert(codes.includes('runtime_reply_observer_stale'));
const entryDeviation = report.deviations.find((item) => item.code === 'runtime_function_entries_diverged');
assert(entryDeviation.evidence.missing_daily.includes('legacy.tools'));

console.log(JSON.stringify({ ok: true, healthy_report_is_diff_only: true, browser_dom_divergence_detected: true, duplicate_runtime_detected: true, stale_host_detected: true, privacy_redaction: true }, null, 2));
