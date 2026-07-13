'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createHealthReporter } = require('../src/modules/health');
const { classifyModule, modulesByPlacement } = require('../src/modules/module-roles');
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
    { id: 'custom.hidden', title: '自定义隐藏模块', version: '1.0.0', commands: [] }
  ],
  contributes: {
    module_display: {
      'dcf.ammo_workbench': { area: 'work', hidden: true },
      'dcf.runtime_inspector': { area: 'work', hidden: true },
      'custom.hidden': { area: 'work', hidden: true }
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

assert.deepStrictEqual(classifyModule(engine.getRoot(), registry, modules['dcf.ammo_workbench']), { placement: 'daily', source: 'legacy-product-map' });
assert.deepStrictEqual(classifyModule(engine.getRoot(), registry, modules['dcf.runtime_inspector']), { placement: 'maintenance', source: 'legacy-product-map' });
assert.deepStrictEqual(classifyModule(engine.getRoot(), registry, modules['custom.hidden']), { placement: 'hidden', source: 'declaration' });

let groups = modulesByPlacement(engine.getRoot(), registry);
assert(groups.daily.some((module) => module.id === 'dcf.ammo_workbench'));
assert(groups.maintenance.some((module) => module.id === 'dcf.runtime_inspector'));
assert(groups.hidden.some((module) => module.id === 'custom.hidden'));

let receipt = engine.setUserPath(['moduleDisplay', 'custom.hidden'], { hidden: false, role: 'daily', area: 'work' });
assert.strictEqual(receipt.status, 'committed');
groups = modulesByPlacement(engine.getRoot(), engine.getRegistry());
assert(groups.daily.some((module) => module.id === 'custom.hidden'));

receipt = engine.setUserPath(['moduleDisplay', 'dcf.runtime_inspector'], { hidden: false, role: 'daily', area: 'work' });
assert.strictEqual(receipt.status, 'committed');
groups = modulesByPlacement(engine.getRoot(), engine.getRegistry());
assert(groups.daily.some((module) => module.id === 'dcf.runtime_inspector'));
assert(engine.getRoot().packages.packages['legacy.roles-pack'], 'changing placement removed its package');

receipt = engine.setUserPath(['moduleDisplay', 'custom.hidden'], { hidden: true, role: 'daily', area: 'work' });
assert.strictEqual(receipt.status, 'committed');

const reporter = createHealthReporter(engine, receipts, storage, { diagnostics: () => ({ reply_root_observer_attached: true, composer_found: true }) }, []);
const report = reporter.report();
assert.strictEqual(report.schema, 'dcf.health.report.v2');
assert.strictEqual(report.projection.installed_package_count, 1);
assert.strictEqual(report.projection.runtime_module_count, 3);
assert.strictEqual(report.projection.daily_function_count, 2);
assert.strictEqual(report.projection.maintenance_tool_count, 0);
assert.strictEqual(report.projection.hidden_runtime_module_count, 1);
assert(report.runtime_modules.some((item) => item.module_id === 'dcf.runtime_inspector' && item.placement === 'daily' && item.placement_source === 'user'));

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
assert(appSource.includes('包管理'), 'package management is still labelled as modules');
assert(appSource.includes('日常功能'), 'daily function section missing');
assert(appSource.includes('维护工具'), 'maintenance tool section missing');
assert(appSource.includes('module-placement'), 'placement controls missing');
assert(!appSource.includes('module-show-all-hidden'), 'obsolete show-all hidden path remains');

console.log(JSON.stringify({ ok: true, package_runtime_ui_separated: true, daily_maintenance_separated: true, legacy_role_map: true, user_placement_override: true, package_preserved: true }, null, 2));
