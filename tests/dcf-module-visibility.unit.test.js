'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { classifyModule, modulesByRole } = require('../src/modules/module-roles');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { clone } = require('../src/core/utils');

let root = normalizeRoot({});
const candidate = clone(root);
addPackRevision(candidate, {
  schema: 'dcf.module_pack.v1',
  pack_id: 'legacy.roles-pack',
  revision: '1.0.0',
  modules: [
    { id: 'dcf.ammo_workbench', title: '弹药工作台', version: '1.0.0', commands: [] },
    { id: 'dcf.runtime_inspector', title: '运行检查', version: '1.0.0', commands: [] },
    { id: 'custom.legacy-hidden', title: '旧隐藏字段模块', version: '1.0.0', commands: [] }
  ],
  contributes: {
    module_display: {
      'dcf.ammo_workbench': { area: 'work', hidden: true },
      'dcf.runtime_inspector': { area: 'work', hidden: true },
      'custom.legacy-hidden': { area: 'work', hidden: true }
    }
  }
}, { kind: 'test' });
root = finalizeCandidate(root, candidate);

const storage = createStorage({});
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();
const registry = engine.getRegistry();
const modules = Object.fromEntries(registry.modules.map((module) => [module.id, module]));

assert.deepStrictEqual(classifyModule(engine.getRoot(), registry, modules['dcf.ammo_workbench']), { role: 'daily', source: 'legacy-product-map' });
assert.deepStrictEqual(classifyModule(engine.getRoot(), registry, modules['dcf.runtime_inspector']), { role: 'maintenance', source: 'legacy-product-map' });
assert.deepStrictEqual(classifyModule(engine.getRoot(), registry, modules['custom.legacy-hidden']), { role: 'daily', source: 'declaration' });

let groups = modulesByRole(engine.getRoot(), registry);
assert(groups.daily.some((module) => module.id === 'dcf.ammo_workbench'));
assert(groups.maintenance.some((module) => module.id === 'dcf.runtime_inspector'));
assert(groups.daily.some((module) => module.id === 'custom.legacy-hidden'), 'legacy hidden metadata removed discoverability');

let receipt = engine.setUserPath(['moduleDisplay', 'custom.legacy-hidden'], { hidden: true });
assert.strictEqual(receipt.status, 'committed');
groups = modulesByRole(engine.getRoot(), engine.getRegistry());
assert(groups.daily.some((module) => module.id === 'custom.legacy-hidden'), 'user hidden residue still acts as a product role');

receipt = engine.setUserPath(['moduleDisplay', 'custom.legacy-hidden'], { role: 'maintenance', area: 'maintenance', hidden: true });
assert.strictEqual(receipt.status, 'committed');
groups = modulesByRole(engine.getRoot(), engine.getRegistry());
assert(groups.maintenance.some((module) => module.id === 'custom.legacy-hidden'));
assert(engine.getRoot().packages.packages['legacy.roles-pack'], 'changing role removed its package');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
assert(appSource.includes('details class="card module-card"'), 'module cards are not foldable');
assert(appSource.includes('collapsed_modules'), 'fold state is not kept in UI session');
assert(appSource.includes('data-module-role="daily"'), 'daily/maintenance role controls missing');
assert(!appSource.includes('data-placement="hidden"'), 'hidden remains a product placement');
assert(!appSource.includes('module-show-all-hidden'), 'obsolete hidden restoration remains');
assert(!appSource.includes("engine.setUserPath(['moduleDisplay', moduleId], Object.assign({}, current, { hidden"), 'folding still writes authoritative moduleDisplay state');

console.log(JSON.stringify({ ok: true, hidden_semantics_removed: true, daily_maintenance_roles_preserved: true, fold_state_is_ui_session: true, package_preserved: true }, null, 2));
