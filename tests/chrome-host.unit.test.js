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

  const codeA1 = '(function(){globalThis.a=1;})();';
  const codeA2 = '(function(){globalThis.a=2;})();';
  const hashA1 = await C.sha256Text(codeA1);
  const hashA2 = await C.sha256Text(codeA2);
  const legacySnapshot = {
    schema: 'dcf.startup.snapshot.v2',
    id: 'legacy-current',
    entries: [{ id: 'dcf.firstparty.a', version: '1.0.0', hash: hashA1, enabled: true, phase: 10 }]
  };
  const legacyV2 = {
    schema: 'dcf.chrome.host.state.v2',
    code_units: {
      'dcf.firstparty.a': {
        id: 'dcf.firstparty.a',
        versions: {
          '1.0.0': {
            id: 'dcf.firstparty.a',
            version: '1.0.0',
            code: codeA1,
            hash: hashA1,
            source: { kind: 'legacy-test' },
            phase: 10
          }
        }
      }
    },
    snapshots: {
      current: legacySnapshot,
      last_known_good: legacySnapshot,
      candidate: { ...legacySnapshot, id: 'legacy-candidate' }
    }
  };
  const state = C.normalizeState(legacyV2);
  assert.strictEqual(state.committed.current.id, 'legacy-current');
  assert.strictEqual(state.committed.last_known_good.id, 'legacy-current');
  assert.strictEqual(state.committed.stable.id, 'legacy-current');
  assert.strictEqual(state.desired.snapshot, null);
  assert.strictEqual(state.migration.control_plane_v3.discarded_legacy_candidate_id, 'legacy-candidate');
  assert(state.code_units[hashA1]);

  const unitA2 = await C.verifyUnit({
    id: 'dcf.firstparty.a',
    version: '1.0.0',
    code: codeA2,
    hash: hashA2,
    source: { kind: 'test' },
    phase: 10
  });
  const stored = C.storeUnit(state, unitA2);
  assert.strictEqual(stored.semantic_version_reused, true);
  assert.strictEqual(stored.prior_hash, hashA1);
  assert(state.code_units[hashA1], 'old content-addressed artifact must remain');
  assert(state.code_units[hashA2], 'new content-addressed artifact must be stored');
  assert.deepStrictEqual(new Set(state.unit_versions['dcf.firstparty.a'].history['1.0.0']), new Set([hashA1, hashA2]));
  assert.strictEqual(C.getUnit(state, 'dcf.firstparty.a', '1.0.0', hashA1).code, codeA1);
  assert.strictEqual(C.getUnit(state, 'dcf.firstparty.a', '1.0.0', hashA2).code, codeA2);

  const normalizedHistorical = C.normalizeState(state);
  assert.strictEqual(
    normalizedHistorical.unit_versions['dcf.firstparty.a'].versions['1.0.0'],
    hashA2,
    'normalization must preserve the explicitly active hash instead of selecting by object iteration order'
  );

  const codeB = '(function(){globalThis.b=1;})();';
  const unitB = await C.verifyUnit({
    id: 'dcf.firstparty.b',
    version: '1.0.0',
    code: codeB,
    hash: await C.sha256Text(codeB),
    source: { kind: 'test' },
    phase: 20
  });
  C.storeUnit(state, unitB);
  const snapshot = await C.snapshotFromUnits([unitA2, unitB], 'test');
  assert(snapshot.id.startsWith('sha256:'));
  assert.deepStrictEqual(C.validateSnapshot(state, snapshot).entries.map((entry) => entry.id), [
    'dcf.firstparty.a',
    'dcf.firstparty.b'
  ]);
  assert.strictEqual(C.registrationFor(unitA2).world, 'USER_SCRIPT');
  assert.strictEqual(C.registrationFor(unitA2).worldId, unitA2.world_id);

  state.committed.current = snapshot;
  state.committed.last_known_good = snapshot;
  const scripts = snapshot.entries.map((entry) => ({ id: C.scriptId(entry.id) }));
  assert.deepStrictEqual(C.diagnostics(state, scripts, true).deviations, []);
  assert.strictEqual(C.diagnostics(state, [], true).deviations[0].code, 'missing_registration');

  console.log(JSON.stringify({
    ok: true,
    rc1_absorption: true,
    v2_to_v3_migration: true,
    legacy_candidate_discarded: true,
    content_addressed_identity: true,
    historical_same_version_artifacts_preserved: true,
    active_hash_survives_normalization: true,
    exact_snapshot_identity: true
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
