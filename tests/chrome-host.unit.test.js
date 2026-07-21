'use strict';
const assert = require('assert');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const C = require('../chrome-extension/src/core');

(async () => {
  const rc1 = {
    schema: 'dcf.chrome.host.state.v1',
    revision: 4,
    product: {
      ammo: { alpha: { id: 'alpha', title: 'Alpha', body: 'body', _meta: { version: 2 } } },
      settings: { ammo_fire_mode: 'send', appearance: { side: 'left', width: 420 } },
      migration: { status: 'success', last_result: { source: 'rc1' } }
    }
  };
  const migratedRc1 = C.normalizeState(rc1);
  assert.strictEqual(migratedRc1.schema, 'dcf.chrome.host.state.v3');
  assert.strictEqual(migratedRc1.product, undefined);
  assert.strictEqual(migratedRc1.plugin_data['dcf.firstparty.ammo'].items.alpha.body, 'body');
  assert.strictEqual(migratedRc1.plugin_data['dcf.firstparty.ammo'].items.alpha._meta, undefined);
  assert.strictEqual(migratedRc1.plugin_data['dcf.firstparty.ammo'].settings.fire_mode, 'send');
  assert.strictEqual(migratedRc1.plugin_data['dcf.firstparty.appearance'].side, 'left');
  assert.strictEqual(migratedRc1.migration.rc1_absorbed, true);

  const codeA = '(function(){globalThis.a=1;})();';
  const codeB = '(function(){globalThis.a=2;})();';
  const hashA = await C.sha256Text(codeA);
  const hashB = await C.sha256Text(codeB);
  const legacyV2 = {
    schema: 'dcf.chrome.host.state.v2',
    code_units: {
      'dcf.firstparty.a': {
        id: 'dcf.firstparty.a',
        versions: {
          '1.0.0': {
            id: 'dcf.firstparty.a',
            version: '1.0.0',
            code: codeA,
            hash: hashA,
            world_id: 'dcf-firstparty-a',
            matches: ['https://chatgpt.com/*']
          }
        }
      }
    },
    snapshots: {
      current: {
        schema: 'dcf.startup.snapshot.v2',
        id: 'legacy-current',
        entries: [{ id: 'dcf.firstparty.a', version: '1.0.0', hash: hashA, enabled: true, phase: 10 }]
      },
      candidate: null,
      last_known_good: {
        schema: 'dcf.startup.snapshot.v2',
        id: 'legacy-current',
        entries: [{ id: 'dcf.firstparty.a', version: '1.0.0', hash: hashA, enabled: true, phase: 10 }]
      },
      history: []
    }
  };
  const migratedV2 = C.normalizeState(legacyV2);
  assert.strictEqual(migratedV2.snapshots, undefined);
  assert(migratedV2.code_units['dcf.firstparty.a'].artifacts[hashA]);
  assert.deepStrictEqual(migratedV2.code_units['dcf.firstparty.a'].versions['1.0.0'], [hashA]);
  assert.strictEqual(migratedV2.control.committed.current.id, 'legacy-current');
  assert.strictEqual(migratedV2.control.committed.stable.id, 'legacy-current');

  const state = C.emptyState();
  const unitA = await C.verifyUnit({ id: 'dcf.firstparty.a', version: '1.0.0', code: codeA, hash: hashA, source: { kind: 'test' }, phase: 10 });
  const unitB = await C.verifyUnit({ id: 'dcf.firstparty.a', version: '1.0.0', code: codeB, hash: hashB, source: { kind: 'test' }, phase: 10 });
  C.storeUnit(state, unitA);
  C.storeUnit(state, unitB);
  assert.strictEqual(Object.keys(state.code_units['dcf.firstparty.a'].artifacts).length, 2);
  assert.deepStrictEqual(state.code_units['dcf.firstparty.a'].versions['1.0.0'].sort(), [hashA, hashB].sort());
  assert.strictEqual(C.getUnit(state, unitA.id, unitA.hash).code, codeA);
  assert.strictEqual(C.getUnit(state, unitA.id, '1.0.0'), null);

  const snapshotA = C.snapshotFromUnits([unitA], 'test');
  const snapshotA2 = C.snapshotFromUnits([unitA], 'test-again');
  assert.strictEqual(snapshotA.id, snapshotA2.id);
  assert.strictEqual(C.validateSnapshot(state, snapshotA).entries[0].content_id, `sha256:${hashA}`);
  assert.strictEqual(C.getUnitByRef(state, snapshotA.entries[0]).code, codeA);
  assert(C.registrationFor(unitA, snapshotA.id).js[1].code.includes('runtime.observed'));
  assert(C.registrationFor(unitA, snapshotA.id).js[1].code.includes(hashA));
  assert.strictEqual(C.registrationFor(unitA, snapshotA.id).world, 'USER_SCRIPT');

  const explicitUnstable = C.emptyState();
  explicitUnstable.control.desired_snapshot = snapshotA;
  explicitUnstable.control.committed.current = snapshotA;
  explicitUnstable.control.committed.last_known_good = snapshotA;
  explicitUnstable.control.committed.stable = null;
  assert.strictEqual(C.normalizeState(explicitUnstable).control.committed.stable, null);
  assert.strictEqual(snapshotA.entries[0].activation_requirement, 'loaded');

  state.control.desired_snapshot = snapshotA;
  state.control.committed.current = snapshotA;
  state.control.committed.last_known_good = snapshotA;
  state.control.committed.stable = snapshotA;
  assert.strictEqual(C.projectSnapshots(state).candidate, null);
  assert.deepStrictEqual(C.diagnostics(state, [{ id: C.scriptId(unitA.id) }], true).deviations, []);
  assert.strictEqual(C.diagnostics(state, [], true).deviations[0].code, 'missing_registration');

  console.log(JSON.stringify({
    ok: true,
    state_v3_migration: true,
    content_addressed_units: true,
    legacy_version_collision_survives_without_overwrite: true,
    deterministic_snapshot_identity: true,
    runtime_observation_prelude: true,
    desired_committed_projection: true,
    stable_is_explicit_not_inferred: true
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
