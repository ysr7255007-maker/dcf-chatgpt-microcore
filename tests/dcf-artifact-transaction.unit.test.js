'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { decodeArtifacts } = require('../src/core/artifacts');
const { clone } = require('../src/core/utils');

const api = {};
const storage = createStorage(api);
const receipts = createReceiptStore(storage);
let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();

const ammoBlock = `<<<DCF_AMMO\n${JSON.stringify({ id: 'architecture', title: '架构', body: '底座不能重构目的' })}\nDCF_AMMO>>>`;
const decodedAmmo = decodeArtifacts(ammoBlock);
assert.strictEqual(decodedAmmo.artifacts.length, 1);
const receipt = engine.applyArtifact(decodedAmmo.artifacts[0], { kind: 'test-reply' });
assert.strictEqual(receipt.status, 'committed');
assert(engine.getRoot().user.content.ammo.architecture, 'ammo artifact not committed');
const duplicate = engine.applyArtifact(decodedAmmo.artifacts[0], { kind: 'test-reply' });
assert.strictEqual(duplicate.status, 'ignored', 'same artifact was not idempotent');

const updateBlock = `<<<DCF_AMMO\n${JSON.stringify({ id: 'architecture', title: '架构', body: '更新后的内容' })}\nDCF_AMMO>>>`;
const updateArtifact = decodeArtifacts(updateBlock).artifacts[0];
assert.strictEqual(engine.applyArtifact(updateArtifact, { kind: 'test-reply' }).status, 'committed');
assert.strictEqual(engine.getRoot().user.content.ammo.architecture.body, '更新后的内容');

const pack = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.test', revision: '1.0.0', contributes: { settings: { test_default: true } }, modules: [] };
const packBlock = `<<<DCF_MODULE_PACK\n${JSON.stringify(pack)}\nDCF_MODULE_PACK>>>`;
const packArtifact = decodeArtifacts(packBlock).artifacts[0];
const packReceipt = engine.applyArtifact(packArtifact, { kind: 'test-reply' });
assert.strictEqual(packReceipt.status, 'committed');
assert(engine.getRoot().packages.packages['dcf.test'], 'package artifact not installed');
assert(engine.getRoot().system.artifact_index[packArtifact.identity], 'package artifact identity not committed atomically');

const before = engine.getRoot().state_hash;
const badPack = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.conflict', revision: '1', contributes: { content_types: [{ id: 'ammo', title: 'Conflict' }] } };
const badReceipt = engine.installPackage(badPack, { kind: 'test' });
assert.strictEqual(badReceipt.status, 'rejected');
assert.strictEqual(engine.getRoot().state_hash, before, 'rejected candidate changed authoritative state');

const placeholders = [
  `<<<DCF_MODULE_PACK\n...\nDCF_MODULE_PACK>>>`,
  `<<<DCF_MODULE_PACK\nexample\nDCF_MODULE_PACK>>>`,
  `<<<DCF_MODULE_PACK\n{"not_a_package":true}\nDCF_MODULE_PACK>>>`
];
for (const text of placeholders) {
  const ignored = decodeArtifacts(text);
  assert.strictEqual(ignored.artifacts.length, 0, 'explanatory placeholder became an artifact');
  assert.strictEqual(ignored.errors.length, 0, 'explanatory placeholder emitted an error');
}

const brokenSensitive = decodeArtifacts(`<<<DCF_AMMO\n{"id":"broken","body":"PRIVATE-BODY",}\nDCF_AMMO>>>`);
assert.strictEqual(brokenSensitive.errors.length, 1, 'broken artifact did not emit a decode error');
assert(!JSON.stringify(brokenSensitive.errors).includes('PRIVATE-BODY'), 'broken artifact body leaked into decode evidence');

console.log(JSON.stringify({ ok: true, automatic_artifacts: true, idempotent_identity: true, atomic_package_artifact: true, failed_candidate_preserves_state: true, decode_error_redacted: true }, null, 2));
