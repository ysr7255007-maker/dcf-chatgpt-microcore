'use strict';
const assert = require('assert');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const C = require('../chrome-extension/src/core');

(async () => {
  const state = C.emptyState();
  const code = '(function(){return 1;})();';
  const unit = await C.verifyUnit({ id: 'dcf.test', version: '1.0.0', code, hash: await C.sha256Text(code), source: { kind: 'test' }, phase: 10 });
  C.storeUnit(state, unit);
  assert.throws(() => C.storeUnit(state, Object.assign({}, unit, { hash: '0'.repeat(64) })), /immutable code unit conflict/);
  const snapshot = C.snapshotFromUnits([unit], 'test');
  assert.strictEqual(C.validateSnapshot(state, snapshot).entries[0].id, 'dcf.test');
  assert.strictEqual(C.registrationFor(unit).world, 'USER_SCRIPT');
  assert.strictEqual(C.registrationFor(unit).worldId, 'dcf-runtime');
  assert(C.expectedScriptIds(snapshot).has('dcf-unit-dcf.test'));

  const decoded = C.decodeAmmoArtifacts('prefix\n<<<DCF_AMMO\n{"id":"x","title":"X","body":"body"}\nDCF_AMMO>>>');
  assert.strictEqual(decoded.items.length, 1);
  const first = await C.ammoRecord(decoded.items[0], null);
  const second = await C.ammoRecord(Object.assign({}, decoded.items[0], { body: 'changed' }), first);
  assert.strictEqual(first._meta.version, 1);
  assert.strictEqual(second._meta.version, 2);
  assert.notStrictEqual(first._meta.content_hash, second._meta.content_hash);

  const diag = C.diagnostics(Object.assign(state, { snapshots: { current: snapshot, candidate: null, last_known_good: snapshot, history: [] } }), [C.registrationFor(unit)], true);
  assert.deepStrictEqual(diag.deviations, []);
  const missing = C.diagnostics(state, [], true);
  assert.strictEqual(missing.deviations[0].code, 'registered_script_missing');
  console.log(JSON.stringify({ ok: true, state_and_snapshot: true, sha256: true, ammo_same_id_update: true, diagnostics_diff: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
