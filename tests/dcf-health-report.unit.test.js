'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { loadOrMigrate } = require('../src/core/state');
const { ensureProductBaseline } = require('../src/index');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('../src/modules/standard-packages');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createHealthReporter } = require('../src/modules/health');

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
const root = loadOrMigrate(storage, STANDARD_PACKS);
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();
const host = {
  diagnostics() {
    return { schema: 'dcf.host.diagnostics.v1', reply_root_observer_attached: true, composer_found: true, conversation_root_found: true };
  }
};
const reporter = createHealthReporter(engine, receipts, storage, host, REQUIRED_PRODUCT_PACKAGES);
const report = reporter.report();
const serialized = JSON.stringify(report);

assert.strictEqual(report.schema, 'dcf.health.report.v2');
assert.strictEqual(report.overall, 'ok');
assert.strictEqual(report.storage.primary_backend, 'gm');
assert(report.storage.bridge, 'storage bridge missing from report');
assert(report.comparison.current_runtime_module_ids.includes('legacy.tools'), 'legacy module missing from runtime inventory');
assert.deepStrictEqual(report.comparison.missing_legacy_runtime_module_ids, []);
assert(report.packages.some((item) => item.package_id === 'legacy.tools'));
assert(report.runtime_modules.some((item) => item.module_id === 'legacy.tools' && item.command_count === 1 && item.placement === 'daily'));
assert(report.projection.installed_package_count >= 3);
assert(report.projection.runtime_module_count >= 3);
assert(report.projection.daily_function_count >= 1);
assert(report.projection.maintenance_tool_count >= 1);
assert.strictEqual(report.user_data.content_counts.ammo, 1);
assert(!serialized.includes('SECRET-AMMO-BODY'), 'ammo body leaked into health report');
assert(!serialized.includes('SECRET-COMMAND-TEXT'), 'command payload leaked into health report');
assert.strictEqual(report.privacy.conversation_text_included, false);
assert(reporter.format().startsWith('<<<DCF_HEALTH_REPORT\n'));
assert(reporter.format().endsWith('\nDCF_HEALTH_REPORT>>>'));

console.log(JSON.stringify({ ok: true, package_inventory: true, runtime_module_inventory: true, placement_inventory: true, migration_coverage: true, host_diagnostics: true, privacy_redaction: true }, null, 2));
