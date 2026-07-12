'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { loadOrMigrate } = require('../src/core/state');
const { buildProjection } = require('../src/core/projection');
const { ensureProductBaseline } = require('../src/index');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

const storage = createStorage({});
const legacyPack = {
  schema: 'dcf.module_pack.v1', pack_id: 'dcf.shell_adjuster', revision: '2.1',
  modules: [{ id: 'dcf.shell_adjuster', title: '旧壳体调节', version: '2.1', blocks: [{ id: 'main', commands: [{ id: 'grow', label: '宽', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] }] }] }],
  contributes: { module_display: { 'dcf.shell_adjuster': { area: 'maintenance', order: 10 } } }
};
storage.set('dcf.package.sources.v1', { schema: 'dcf.package.sources.v1', revision: 1, packages: { 'dcf.shell_adjuster': { package_id: 'dcf.shell_adjuster', enabled: true, active_revision: '2.1', source: { kind: 'legacy' }, revisions: { '2.1': { revision: '2.1', hash: 'legacy-hash', installed_at: '2026-07-12T00:00:00Z', pack: legacyPack } } } } });
storage.set('dcf.user.state.v1', { schema: 'dcf.user.state.v1', revision: 3, appearance: { side: 'left', vars: { w: '420px', h: '700px', anchor: 'top', top: '20px', bottom: '80px' }, css: '', safe_mode: false }, settings: { x: 1 }, content: { ammo: { kept: { id: 'kept', title: '保留', body: 'user-data' } } }, moduleDisplay: {} });
storage.set('dcf.kernel.ops.v2', { schema: 'dcf.kernel.ops.v2', seenBlocks: { old: true }, badBlocks: {} });

let root = loadOrMigrate(storage, STANDARD_PACKS);
root = ensureProductBaseline(root);
const built = buildProjection(root);
assert(built.ok, built.errors.join('; '));
assert.strictEqual(root.schema, 'dcf.state.root.v1');
assert.strictEqual(root.user.appearance.side, 'left');
assert.strictEqual(root.user.appearance.vars.w, '420px');
assert(root.user.content.ammo.kept, 'user ammo lost during v10 migration');
assert(root.packages.packages['dcf.shell_adjuster'], 'legacy package lost');
assert(built.registry.modules.some((module) => module.id === 'dcf.shell_adjuster'), 'legacy module no longer projected');
assert(built.registry.contentTypes.ammo, 'product baseline ammo type missing after migration');
assert(root.system.migration && root.system.migration.legacy_ops_summary.seen_blocks === 1, 'legacy operational state was not summarized for migration evidence');
assert(!root.system.migration.legacy_ops, 'legacy seen-block ledger leaked into the new authoritative root');

console.log(JSON.stringify({ ok: true, v10_root_migration: true, user_data_preserved: true, legacy_modules_preserved: true, product_baseline_completed: true }, null, 2));
