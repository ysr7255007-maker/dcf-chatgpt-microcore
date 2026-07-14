'use strict';

const assert = require('assert');
const { clone } = require('../src/core/utils');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createHealthReporter } = require('../src/modules/health');
const { modulesByRole } = require('../src/modules/module-roles');
const { VERSION } = require('../src/core/constants');

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

const oldPack = { schema: 'dcf.module_pack.v1', pack_id: 'legacy.retired', revision: '1', modules: [{ id: 'legacy.retired', title: '旧入口', version: '1', commands: [] }] };
const replacementPack = { schema: 'dcf.module_pack.v1', pack_id: 'canonical.tools', revision: '1', modules: [{ id: 'canonical.tools', title: '完整入口', version: '1', supersedes: ['legacy.retired'], commands: [] }] };
let root = normalizeRoot({});
let candidate = clone(root);
addPackRevision(candidate, oldPack, { kind: 'legacy-registry' });
addPackRevision(candidate, replacementPack, { kind: 'test' });
root = finalizeCandidate(root, candidate);

const gm = new Map();
const localStorage = localStore();
localStorage.setItem('dcf.package.sources.v1', JSON.stringify({ schema: 'dcf.package.sources.v1', revision: 1, packages: { 'legacy.retired': root.packages.packages['legacy.retired'] } }));
const storage = createStorage({
  localStorage,
  GM_getValue(key, fallback) { return gm.has(key) ? gm.get(key) : fallback; },
  GM_setValue(key, value) { gm.set(key, value); },
  GM_deleteValue(key) { gm.delete(key); },
  GM_listValues() { return Array.from(gm.keys()); }
});
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();
const registry = engine.getRegistry();
assert(!registry.modules.some((module) => module.id === 'legacy.retired'));
assert.strictEqual(registry.moduleSupersession.entries['legacy.retired'].by, 'canonical.tools');
const roles = modulesByRole(engine.getRoot(), registry);
const packageIds = Object.keys(engine.getRoot().packages.packages).sort();
const app = { captureRuntimeViews: () => ({
  schema: 'dcf.ui.runtime.snapshot.v1', host_count: 1, host_connected: true, shadow_root_attached: true,
  shell_connected: true, shell_visible: true, shell_intersects_viewport: true,
  shell_rect: { left: 0, top: 0, right: 340, bottom: 600, width: 340, height: 600 },
  current_tab: 'maintenance', tab_ids: ['ammo', 'functions', 'packages', 'maintenance'], version_text: `DCF ${VERSION}`,
  views: {
    packages: { entry_ids: packageIds },
    functions: { module_ids: roles.daily.map((module) => module.id), collapsed_module_ids: [] },
    maintenance: { module_ids: roles.maintenance.map((module) => module.id), collapsed_module_ids: roles.maintenance.map((module) => module.id) }
  }
}) };
const host = { diagnostics: () => ({ route_kind: '/c/:conversation', conversation_root_found: true, reply_root_observer_attached: true, observed_root_connected: true, observed_root_is_current: true, composer_found: true }) };
const reporter = createHealthReporter(engine, receipts, storage, host, [], { getApp: () => app, getRuntime: () => ({ version: VERSION }) });
const report = reporter.report();
assert.strictEqual(report.status, 'healthy', JSON.stringify(report.deviations, null, 2));
assert(!report.deviations.some((item) => item.code === 'runtime_legacy_module_projection_gap'));

console.log(JSON.stringify({ ok: true, superseded_legacy_module_is_not_a_health_gap: true, folded_packages_remain_observable: true }, null, 2));
