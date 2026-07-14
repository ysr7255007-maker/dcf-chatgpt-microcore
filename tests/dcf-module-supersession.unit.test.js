'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { clone } = require('../src/core/utils');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { buildProjection, resolveModuleSupersession } = require('../src/core/projection');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { createPackageManager } = require('../src/modules/package-manager');

const legacyIds = ['dcf.ammo_workbench', 'dcf.ammo_workspace.unified', 'dcf.language_ammo'];
const ammoPack = STANDARD_PACKS.find((pack) => pack.pack_id === 'dcf.standard.ammo');
assert(ammoPack, 'canonical ammo package missing');
assert.strictEqual(ammoPack.revision, '1.3.0');
assert.strictEqual(ammoPack.modules[0].title, '语言弹药工作台');
assert.deepStrictEqual(ammoPack.modules[0].supersedes, legacyIds);

let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
for (const id of legacyIds) {
  addPackRevision(candidate, { schema: 'dcf.module_pack.v1', pack_id: id, revision: 'legacy-1', modules: [{ id, title: id, version: 'legacy-1', commands: [{ id: 'old', label: '旧命令', steps: [] }] }] }, { kind: 'legacy-registry' });
}
addPackRevision(candidate, { schema: 'dcf.module_pack.v1', pack_id: 'example.similar-name', revision: '1', modules: [{ id: 'example.similar-name', title: '另一个弹药工作台', version: '1', commands: [] }] }, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const built = buildProjection(root);
assert.strictEqual(built.ok, true, built.errors && built.errors.join('; '));
const ids = built.registry.modules.map((module) => module.id);
for (const id of legacyIds) assert(!ids.includes(id), `${id} remained in Runtime`);
assert(ids.includes('dcf.ammo.module'), 'canonical ammo workbench missing');
assert(ids.includes('example.similar-name'), 'title-similar unrelated module was incorrectly suppressed');
for (const id of legacyIds) assert.strictEqual(built.registry.moduleSupersession.entries[id].by, 'dcf.ammo.module');

const manager = createPackageManager({ getRoot: () => root, getRegistry: () => built.registry, getEnvironment: () => ({}) }, { check: () => null }, null);
const activePackageIds = manager.packages().map((entry) => entry.package_id);
const retiredPackageIds = manager.supersededPackages().map((entry) => entry.package_id);
for (const id of legacyIds) {
  assert(!activePackageIds.includes(id), `${id} remained in primary package list`);
  assert(retiredPackageIds.includes(id), `${id} missing from historical package list`);
}
assert(activePackageIds.includes('example.similar-name'));

const fallback = resolveModuleSupersession(legacyIds.map((id) => ({ id, supersedes: [] })));
assert.strictEqual(fallback.ok, true);
assert.deepStrictEqual(fallback.entries, {}, 'legacy modules must remain reachable when no replacement is active');
const conflict = resolveModuleSupersession([{ id: 'new-a', supersedes: ['old'] }, { id: 'new-b', supersedes: ['old'] }, { id: 'old' }]);
assert.strictEqual(conflict.ok, false, 'conflicting replacements were accepted');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
for (const marker of ['ammo-new', 'ammo-edit', 'ammo-search', 'saveAmmoDraft', 'package-history', 'supersededPackages', "collectIds('[data-package-id]'"]) assert(appSource.includes(marker), `workbench consolidation missing ${marker}`);

console.log(JSON.stringify({
  ok: true,
  exact_id_supersession: true,
  fallback_preserved: true,
  conflicts_rejected: true,
  canonical_ammo_workbench: true,
  direct_create_edit_search: true,
  historical_packages_folded: true
}, null, 2));
