'use strict';

const assert = require('assert');
const { normalizeRoot, finalizeCandidate, validateRoot, addPackRevision } = require('../src/core/state');
const { buildProjection } = require('../src/core/projection');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { clone } = require('../src/core/utils');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createPackageManager } = require('../src/modules/package-manager');

let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
root = finalizeCandidate(root, candidate);
assert(validateRoot(root).ok, 'standard root rejected');
const first = buildProjection(root);
assert(first.ok, first.errors.join('; '));
assert(first.registry.contentTypes.ammo, 'ammo is not supplied through first-party package resources');
assert(first.registry.modules.some((module) => module.kind === 'shell-adjuster'), 'standard shell adjuster module missing');

const second = buildProjection(root);
assert.strictEqual(first.registry.build.build_id, second.registry.build.build_id, 'same state produced different projection identity');

candidate = clone(root);
candidate.user.content.ammo.alpha = { id: 'alpha', title: 'Alpha', body: 'x' };
candidate.user.revision += 1;
const withUser = finalizeCandidate(root, candidate);
const userProjection = buildProjection(withUser);
assert(userProjection.registry.content.ammo.alpha, 'user content missing from projection');

candidate = clone(withUser);
candidate.packages.packages['dcf.standard.ammo'].enabled = false;
candidate.packages.revision += 1;
const disabled = finalizeCandidate(withUser, candidate);
const disabledProjection = buildProjection(disabled);
assert(disabledProjection.ok, disabledProjection.errors.join('; '));
assert(disabledProjection.registry.content.ammo.alpha, 'disabling package destroyed user-owned content');
assert(!disabledProjection.registry.contentTypes.ammo, 'disabled package still contributes content type');

const replacementRoot = normalizeRoot({});
let replacementCandidate = clone(replacementRoot);
for (const pack of STANDARD_PACKS) addPackRevision(replacementCandidate, pack, { kind: 'test' });
addPackRevision(replacementCandidate, {
  schema: 'dcf.module_pack.v1',
  pack_id: 'aaa.custom-ammo-type',
  revision: '1.0.0',
  replaces: ['content-type:ammo'],
  contributes: { content_types: [{ id: 'ammo', title: '自定义弹药', marker: 'DCF_AMMO', body_field: 'body' }] },
  modules: []
}, { kind: 'test' });
const replacementProjection = buildProjection(finalizeCandidate(replacementRoot, replacementCandidate));
assert(replacementProjection.ok, replacementProjection.errors.join('; '));
assert.strictEqual(replacementProjection.registry.contentTypes.ammo.title, '自定义弹药', 'explicit replacement depended on package sort order');

const requiredStorage = createStorage({});
const requiredReceipts = createReceiptStore(requiredStorage);
const requiredEngine = createTransactionEngine(requiredStorage, requiredReceipts, { initialRoot: root });
requiredEngine.initialize();
const requiredManager = createPackageManager(requiredEngine, { check: async () => ({ ok: true }) });
assert.throws(() => requiredManager.uninstall('dcf.standard.ammo'), /required by the DCF product value loop/, 'package manager allowed removal of the value-critical ammo module');

const disabledRequired = clone(root);
disabledRequired.packages.packages['dcf.standard.ammo'].enabled = false;
disabledRequired.packages.revision += 1;
const restoredBaseline = require('../src/index').ensureProductBaseline(finalizeCandidate(root, disabledRequired));
assert.strictEqual(restoredBaseline.packages.packages['dcf.standard.ammo'].enabled, true, 'value-critical ammo package was not restored by product baseline');

console.log(JSON.stringify({ ok: true, single_root: true, deterministic_projection: true, user_state_separated: true, first_party_package: true, order_independent_replacement: true }, null, 2));
