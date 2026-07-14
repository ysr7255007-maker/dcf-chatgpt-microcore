from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')
def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1: raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)

app = read('src/ui/app.js')
app = replace_once(app, "views.packages = { entry_ids: collectIds('[data-runtime-section=\"packages\"] [data-package-id]', 'data-package-id') };", "views.packages = { entry_ids: collectIds('[data-package-id]', 'data-package-id') };", 'package runtime capture')
write('src/ui/app.js', app)

health = read('src/modules/health.js')
old = "    const enabledPackageIds = new Set(Object.entries(root.packages && root.packages.packages || {}).filter(([, entry]) => entry && entry.enabled !== false).map(([id]) => id));\n    const legacyModulesMissingFromPresentPackages = legacy.module_providers.filter((item) => enabledPackageIds.has(item.package_id) && !currentRuntimeModuleIds.includes(item.module_id));\n    if (legacyModulesMissingFromPresentPackages.length) add('runtime_legacy_module_projection_gap', 'error', 'legacy-runtime-modules', 'modules from migrated active packages enter the current runtime registry', legacyModulesMissingFromPresentPackages, null, 'The package exists in the current browser state, but one or more of its legacy modules did not reach the running registry.');"
new = "    const enabledPackageIds = new Set(Object.entries(root.packages && root.packages.packages || {}).filter(([, entry]) => entry && entry.enabled !== false).map(([id]) => id));\n    const supersededModuleIds = new Set(Object.keys(registry && registry.moduleSupersession && registry.moduleSupersession.entries || {}));\n    const legacyModulesMissingFromPresentPackages = legacy.module_providers.filter((item) => enabledPackageIds.has(item.package_id) && !currentRuntimeModuleIds.includes(item.module_id) && !supersededModuleIds.has(item.module_id));\n    if (legacyModulesMissingFromPresentPackages.length) add('runtime_legacy_module_projection_gap', 'error', 'legacy-runtime-modules', 'modules from migrated active packages enter the current runtime registry or have an explicit active supersession', legacyModulesMissingFromPresentPackages, null, 'The package exists in the current browser state, but one or more of its legacy modules neither reached the running registry nor have an explicit active replacement.');"
health = replace_once(health, old, new, 'health supersession awareness')
write('src/modules/health.js', health)

package = json.loads(read('package.json'))
needle = 'node tests/dcf-module-supersession.unit.test.js && '
if needle not in package['scripts']['test']: raise RuntimeError('test insertion point missing')
package['scripts']['test'] = package['scripts']['test'].replace(needle, needle + 'node tests/dcf-supersession-health.unit.test.js && ', 1)
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')

test = r''' 'use strict';

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
'''.lstrip()
write('tests/dcf-supersession-health.unit.test.js', test)

module_test = read('tests/dcf-module-supersession.unit.test.js')
module_test = module_test.replace("for (const marker of ['ammo-new', 'ammo-edit', 'ammo-search', 'saveAmmoDraft', 'package-history', 'supersededPackages'])", "for (const marker of ['ammo-new', 'ammo-edit', 'ammo-search', 'saveAmmoDraft', 'package-history', 'supersededPackages', \"collectIds('[data-package-id]'\"])")
write('tests/dcf-module-supersession.unit.test.js', module_test)

architecture = read('docs/architecture-current.md')
architecture += '\nRuntime 体检把显式替代视为可解释的退出，不再将其误报为迁移投影缺口；包视图观察同时统计主列表与折叠历史区。\n'
write('docs/architecture-current.md', architecture)

current = read('docs/current-state.md')
current += '\n- 0.15.0 体检观察已同步理解模块替代关系，且折叠历史包仍计入真实包视图覆盖。\n'
write('docs/current-state.md', current)

print(json.dumps({'ok': True}, ensure_ascii=False))
