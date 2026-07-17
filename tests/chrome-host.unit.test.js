'use strict';
const assert = require('assert');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const C = require('../chrome-extension/src/core');

(async () => {
  const rc1 = {
    schema: 'dcf.chrome.host.state.v1', revision: 4,
    product: {
      ammo: { alpha: { id: 'alpha', title: 'Alpha', body: 'body', _meta: { version: 2 } } },
      settings: { ammo_fire_mode: 'send', appearance: { side: 'left', width: 420 } },
      migration: { status: 'success', last_result: { source: 'rc1' } }
    }
  };
  const migrated = C.normalizeState(rc1);
  assert.strictEqual(migrated.schema, 'dcf.chrome.host.state.v2');
  assert.strictEqual(migrated.product, undefined);
  assert.strictEqual(migrated.plugin_data['dcf.firstparty.ammo'].items.alpha.body, 'body');
  assert.strictEqual(migrated.plugin_data['dcf.firstparty.ammo'].items.alpha._meta, undefined);
  assert.strictEqual(migrated.plugin_data['dcf.firstparty.ammo'].settings.fire_mode, 'send');
  assert.strictEqual(migrated.plugin_data['dcf.firstparty.appearance'].side, 'left');
  assert.strictEqual(migrated.migration.rc1_absorbed, true);

  const state = C.emptyState();
  const codeA = '(function(){globalThis.a=1;})();';
  const codeB = '(function(){globalThis.b=1;})();';
  const unitA = await C.verifyUnit({ id: 'dcf.firstparty.a', version: '1.0.0', code: codeA, hash: await C.sha256Text(codeA), source: { kind: 'test' }, phase: 10 });
  const unitB = await C.verifyUnit({ id: 'dcf.firstparty.b', version: '1.0.0', code: codeB, hash: await C.sha256Text(codeB), source: { kind: 'test' }, phase: 20 });
  assert.notStrictEqual(unitA.world_id, unitB.world_id);
  C.storeUnit(state, unitA); C.storeUnit(state, unitB);
  assert.throws(() => C.storeUnit(state, { ...unitA, hash: '0'.repeat(64) }), /immutable code unit conflict/);
  const snapshot = C.snapshotFromUnits([unitB, unitA], 'test');
  assert.deepStrictEqual(C.validateSnapshot(state, snapshot).entries.map((entry) => entry.id), ['dcf.firstparty.a', 'dcf.firstparty.b']);
  assert.strictEqual(C.registrationFor(unitA).world, 'USER_SCRIPT');
  assert.strictEqual(C.registrationFor(unitA).worldId, unitA.world_id);
  state.snapshots.current = snapshot; state.snapshots.last_known_good = snapshot;
  assert.deepStrictEqual(C.diagnostics(state, snapshot.entries.map((entry) => ({ id: C.scriptId(entry.id) })), true).deviations, []);
  assert.strictEqual(C.diagnostics(state, [], true).deviations[0].code, 'missing_registration');
  console.log(JSON.stringify({ ok: true, rc1_absorption: true, pure_plugin_data: true, unique_worlds: true, immutable_units: true, exact_snapshots: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
