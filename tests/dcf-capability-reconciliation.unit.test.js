'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createCapabilityReconciler } = require('../src/runtime/reconciler');
const { normalizeRoot } = require('../src/core/state');
const { decodeArtifacts, normalizePackage } = require('../src/core/artifacts');

const storage = createStorage({});
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: normalizeRoot({}) });
engine.initialize();

const remotePack = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.remote-test', revision: '2.0.0', title: '远程测试包', modules: [] };
const catalog = {
  resolve(reference) {
    assert.strictEqual(reference.package_id, 'dcf.remote-test');
    assert.strictEqual(reference.target, 'latest');
    return Promise.resolve({ schema: 'dcf.resolved.artifact.v1', input_mode: 'reference', artifact: normalizePackage(remotePack), source: { kind: 'test-catalog' } });
  }
};
let activations = 0;
const reconciler = createCapabilityReconciler(engine, catalog, receipts, { onCommitted: () => { activations += 1; } });

(async () => {
  const referenceText = `<<<DCF_PACKAGE_UPDATE\n${JSON.stringify({ package_id: 'dcf.remote-test', target: 'latest' })}\nDCF_PACKAGE_UPDATE>>>`;
  const decodedReference = decodeArtifacts(referenceText);
  assert.strictEqual(decodedReference.artifacts.length, 1);
  assert.strictEqual(decodedReference.artifacts[0].type, 'package-reference');
  const referenceResult = await reconciler.accept(decodedReference.artifacts[0], { kind: 'test-reply' });
  assert.strictEqual(referenceResult.schema, 'dcf.reconcile.result.v1');
  assert.strictEqual(referenceResult.input_mode, 'reference');
  assert.strictEqual(referenceResult.status, 'committed');
  assert.strictEqual(referenceResult.activation, 'runtime-reprojected');
  assert.strictEqual(engine.getRoot().packages.packages['dcf.remote-test'].active_revision, '2.0.0');

  const directPack = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.direct-test', revision: '1.0.0', title: '直接测试包', modules: [] };
  const directText = `<<<DCF_MODULE_PACK\n${JSON.stringify(directPack)}\nDCF_MODULE_PACK>>>`;
  const directResult = reconciler.accept(decodeArtifacts(directText).artifacts[0], { kind: 'test-reply' });
  assert.strictEqual(directResult.input_mode, 'value');
  assert.strictEqual(directResult.status, 'committed');
  assert(reconciler.desiredState().packages.some((entry) => entry.package_id === 'dcf.direct-test'));
  assert.strictEqual(activations, 2);
  console.log(JSON.stringify({ ok: true, value_and_reference_inputs_unified: true, desired_state_derived_from_root: true, runtime_activation_callback: true }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
