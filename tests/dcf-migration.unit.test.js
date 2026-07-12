'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { loadOrMigrate } = require('../src/core/state');
const { buildProjection } = require('../src/core/projection');
const { ensureProductBaseline } = require('../src/index');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

function legacyPack() {
  return {
    schema: 'dcf.module_pack.v1', pack_id: 'dcf.shell_adjuster', revision: '2.1',
    modules: [{ id: 'dcf.shell_adjuster', title: '旧壳体调节', version: '2.1', blocks: [{ id: 'main', commands: [{ id: 'grow', label: '宽', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] }] }] }],
    contributes: { module_display: { 'dcf.shell_adjuster': { area: 'maintenance', order: 10 } } }
  };
}

function legacyStores(storage) {
  const pack = legacyPack();
  storage.set('dcf.package.sources.v1', { schema: 'dcf.package.sources.v1', revision: 1, packages: { 'dcf.shell_adjuster': { package_id: 'dcf.shell_adjuster', enabled: true, active_revision: '2.1', source: { kind: 'legacy' }, revisions: { '2.1': { revision: '2.1', hash: 'legacy-hash', installed_at: '2026-07-12T00:00:00Z', pack } } } } });
  storage.set('dcf.user.state.v1', { schema: 'dcf.user.state.v1', revision: 3, appearance: { side: 'left', vars: { w: '420px', h: '700px', anchor: 'top', top: '20px', bottom: '80px' }, css: '', safe_mode: false }, settings: { x: 1 }, content: { ammo: { kept: { id: 'kept', title: '保留', body: 'user-data' } } }, moduleDisplay: {} });
  storage.set('dcf.kernel.ops.v2', { schema: 'dcf.kernel.ops.v2', seenBlocks: { old: true }, badBlocks: {} });
}

function assertMigrated(root) {
  const built = buildProjection(root);
  assert(built.ok, built.errors.join('; '));
  assert.strictEqual(root.schema, 'dcf.state.root.v1');
  assert.strictEqual(root.user.appearance.side, 'left');
  assert.strictEqual(root.user.appearance.vars.w, '420px');
  assert(root.user.content.ammo.kept, 'user ammo lost during v10 migration');
  assert(root.packages.packages['dcf.shell_adjuster'], 'legacy package lost');
  assert(built.registry.modules.some((module) => module.id === 'dcf.shell_adjuster'), 'legacy module no longer projected');
  assert(built.registry.contentTypes.ammo, 'product baseline ammo type missing after migration');
}

const directStorage = createStorage({});
legacyStores(directStorage);
let directRoot = ensureProductBaseline(loadOrMigrate(directStorage, STANDARD_PACKS));
assertMigrated(directRoot);
assert(directRoot.system.migration && directRoot.system.migration.legacy_ops_summary.seen_blocks === 1, 'legacy operational state was not summarized for migration evidence');
assert(!directRoot.system.migration.legacy_ops, 'legacy seen-block ledger leaked into the new authoritative root');

function createLocalStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] || null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

const gmValues = new Map();
const localStorage = createLocalStorage();
const api = {
  localStorage,
  GM_getValue(key, fallback) { return gmValues.has(key) ? gmValues.get(key) : fallback; },
  GM_setValue(key, value) { gmValues.set(key, value); },
  GM_deleteValue(key) { gmValues.delete(key); },
  GM_listValues() { return Array.from(gmValues.keys()); }
};
const dualStorage = createStorage(api);
assert.strictEqual(dualStorage.primaryBackend, 'gm');
const oldPageStorage = {
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};
legacyStores(oldPageStorage);

const cleanRoot = ensureProductBaseline(loadOrMigrate(createStorage({}), STANDARD_PACKS));
gmValues.set('dcf.state.root.v1', cleanRoot);
let bridgedRoot = loadOrMigrate(dualStorage, STANDARD_PACKS);
assertMigrated(bridgedRoot);
assert(bridgedRoot.system.storage_bridge, 'storage backend bridge was not recorded');
assert.strictEqual(bridgedRoot.system.storage_bridge.from_backend, 'localStorage');
assert.strictEqual(bridgedRoot.system.storage_bridge.to_backend, 'gm');
assert(bridgedRoot.system.storage_bridge.recovered.packages.includes('dcf.shell_adjuster'), 'legacy package was not recorded as recovered');

const bridgedRevision = bridgedRoot.revision;
dualStorage.set('dcf.state.root.v1', bridgedRoot);
bridgedRoot = loadOrMigrate(dualStorage, STANDARD_PACKS);
assert.strictEqual(bridgedRoot.revision, bridgedRevision, 'storage bridge replayed after completion');

console.log(JSON.stringify({ ok: true, v10_root_migration: true, gm_localstorage_bridge: true, user_data_preserved: true, legacy_modules_preserved: true, bridge_is_idempotent: true }, null, 2));