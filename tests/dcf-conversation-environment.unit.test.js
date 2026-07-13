'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { clone } = require('../src/core/utils');

const storage = createStorage({});
const receipts = createReceiptStore(storage);
let root = normalizeRoot({});
const candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();

const environment = engine.getEnvironment();
assert.strictEqual(environment.schema, 'dcf.environment.snapshot.v1');
assert(environment.capabilities.packages.some((entry) => entry.package_id === 'dcf.ui.runtime-workspace'));
assert(environment.presentation.views.ammo && environment.presentation.views.functions && environment.presentation.views.packages && environment.presentation.views.maintenance, 'four views are not package-owned environment projections');
assert.strictEqual(engine.getRegistry().resources.schema, 'dcf.environment.resource-graph.v1');
assert(engine.getRegistry().resources.resources.some((resource) => resource.family === 'action'));
assert(engine.getRegistry().resources.resources.some((resource) => resource.family === 'view'));

const ammoReceipt = engine.applyEnvironmentIntent({ type: 'environment.resource.upsert', resource_type: 'ammo', resource_id: 'environment-test' }, { value: { id: 'environment-test', title: '环境测试', body: 'test' } });
assert.strictEqual(ammoReceipt.status, 'committed');
assert(engine.getRoot().user.content.ammo['environment-test']);

const preferenceReceipt = engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: 'send' });
assert.strictEqual(preferenceReceipt.status, 'committed');
assert.strictEqual(engine.getRoot().user.preferences.ammo_fire_mode, 'send');

const save = engine.saveEnvironmentProfile('测试环境', 'test-environment');
assert.strictEqual(save.status, 'committed');
assert(engine.getRoot().user.environmentProfiles['test-environment']);
assert(!JSON.stringify(engine.getRoot().user.environmentProfiles['test-environment']).includes('environment-test'), 'profile copied user ammo content');

engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: 'insert' });
assert.strictEqual(engine.getRoot().user.active_environment_profile, null, 'profile drift was not exposed');
const activate = engine.activateEnvironmentProfile('test-environment');
assert.strictEqual(activate.status, 'committed');
assert.strictEqual(engine.getRoot().user.preferences.ammo_fire_mode, 'send');
assert.strictEqual(engine.getRoot().user.active_environment_profile, 'test-environment');

const snapshotRevision = engine.snapshots()[0].revision;
const rollback = engine.rollbackTo(snapshotRevision);
assert.strictEqual(rollback.status, 'committed');
assert.strictEqual(rollback.intent.type, 'environment.restore');

console.log(JSON.stringify({
  ok: true,
  environment_facade: true,
  unified_environment_intents: true,
  environment_reconciler_path: true,
  finite_resource_graph: true,
  package_owned_four_views: true,
  profiles_and_restore_are_environment_transitions: true
}, null, 2));
