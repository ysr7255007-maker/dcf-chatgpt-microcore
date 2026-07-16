'use strict';
(function initHostState(root) {
  const C = root.DCFHostCore;
  const H = root.DCFHost = { C, mutationChain: Promise.resolve() };

  H.serial = function serial(task) {
    const run = H.mutationChain.then(task, task);
    H.mutationChain = run.catch(() => undefined);
    return run;
  };

  H.storageGet = async function storageGet() {
    const result = await chrome.storage.local.get(C.STATE_KEY);
    return C.normalizeState(result[C.STATE_KEY]);
  };

  H.storageSet = async function storageSet(previous, next) {
    const finalState = C.finalizeState(previous, next);
    await chrome.storage.local.set({ [C.STATE_KEY]: finalState });
    return finalState;
  };

  H.mutate = async function mutate(mutator) {
    return H.serial(async () => {
      const previous = await H.storageGet();
      const candidate = C.clone(previous);
      const result = await mutator(candidate, previous);
      const state = await H.storageSet(previous, candidate);
      return { state, result };
    });
  };

  H.loadOfficialBundle = async function loadOfficialBundle() {
    const response = await fetch(chrome.runtime.getURL('official/code-units.json'));
    if (!response.ok) throw new Error(`bundled official index failed: HTTP ${response.status}`);
    return response.json();
  };

  H.verifyBundle = async function verifyBundle(bundle, expectedSource) {
    if (!bundle || bundle.schema !== 'dcf.code_unit_bundle.v1' || !Array.isArray(bundle.units)) throw new Error('invalid code unit bundle');
    const units = [];
    for (const raw of bundle.units) {
      const unit = await C.verifyUnit(raw);
      if (expectedSource && unit.source && unit.source.kind !== expectedSource) throw new Error(`unexpected source for ${unit.id}`);
      units.push(unit);
    }
    return units;
  };

  H.ensureOfficialInstalled = async function ensureOfficialInstalled() {
    const units = await H.verifyBundle(await H.loadOfficialBundle(), 'bundled-official');
    return H.mutate(async (state) => {
      for (const unit of units) C.storeUnit(state, unit);
      if (!state.snapshots.current && !state.snapshots.candidate) {
        state.snapshots.candidate = C.snapshotFromUnits(units, 'first-install-official-candidate');
        C.appendEvidence(state, { type: 'candidate.staged', snapshot_id: state.snapshots.candidate.id, units: units.map((unit) => C.unitKey(unit.id, unit.version)) });
      } else if (state.snapshots.current && !state.snapshots.candidate) {
        const candidate = C.clone(state.snapshots.current);
        let changed = false;
        for (const unit of units) {
          const ref = candidate.entries.find((entry) => entry.id === unit.id);
          if (!ref) {
            candidate.entries.push({ id: unit.id, version: unit.version, hash: unit.hash, enabled: true, phase: unit.phase });
            changed = true;
          } else if (ref.version !== unit.version || ref.hash !== unit.hash) {
            Object.assign(ref, { version: unit.version, hash: unit.hash, enabled: true, phase: unit.phase });
            changed = true;
          }
        }
        if (changed) {
          candidate.id = `snapshot-${Date.now().toString(36)}`;
          candidate.created_at = C.nowIso();
          candidate.reason = 'extension-bundled-official-update';
          candidate.entries.sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
          state.snapshots.candidate = C.validateSnapshot(state, candidate);
          C.appendEvidence(state, { type: 'candidate.staged', snapshot_id: candidate.id, reason: candidate.reason, units: units.map((unit) => C.unitKey(unit.id, unit.version)) });
        }
      }
      return { units: units.map((unit) => C.unitKey(unit.id, unit.version)), candidate: state.snapshots.candidate };
    });
  };

  H.statusPayload = async function statusPayload() {
    const state = await H.storageGet();
    let scripts = [];
    let available = true;
    try { scripts = await H.actualDcfScripts(); } catch (_) { available = false; }
    return {
      ok: true,
      host_version: C.HOST_VERSION,
      user_scripts_available: available,
      state_revision: state.revision,
      snapshots: C.clone(state.snapshots),
      code_units: Object.fromEntries(Object.entries(state.code_units).map(([id, entry]) => [id, Object.keys(entry.versions || {}).sort()])),
      actual_scripts: scripts.map((item) => item.id),
      product: C.publicProductState(state),
      update: C.clone(state.update)
    };
  };
})(self);
