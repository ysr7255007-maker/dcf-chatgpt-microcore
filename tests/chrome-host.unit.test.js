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
  const scripts = snapshot.entries.map((entry) => ({ id: C.scriptId(entry.id) }));
  const healthy = C.diagnostics(state, scripts, true, [{
    reachable: true,
    tab_id: 1,
    url: 'https://chatgpt.com/c/test',
    static_bridge_present: true,
    shell_present: true,
    shell_shadow_root_present: true,
    mounted_panel_count: 2
  }]);
  assert.deepStrictEqual(healthy.deviations, []);
  assert.strictEqual(healthy.health, 'healthy');
  assert.strictEqual(C.diagnostics(state, [], true, []).deviations[0].code, 'missing_registration');
  assert.strictEqual(C.diagnostics(state, scripts, true, [{ reachable: true, tab_id: 1, shell_present: false, static_bridge_present: true }]).deviations[0].code, 'page_shell_missing');
  assert.strictEqual(C.diagnostics(state, scripts, true, [{ reachable: false, tab_id: 1, error: 'page_probe_timeout' }]).deviations[0].code, 'page_probe_unreachable');
  assert.strictEqual(C.diagnostics(state, scripts, true, []).health, 'unknown');
  console.log(JSON.stringify({ ok: true, rc1_absorption: true, pure_plugin_data: true, unique_worlds: true, immutable_units: true, exact_snapshots: true, page_truth_diagnostics: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
