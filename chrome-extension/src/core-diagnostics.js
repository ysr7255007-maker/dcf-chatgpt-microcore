(function (root) {
  'use strict';
  const C = root.DCFHostCore;
  const { SCRIPT_PREFIX, HOST_VERSION, clone, nowIso, scriptId, eventId } = C;
  function registrationFor(unit) {
    return {
      id: scriptId(unit.id),
      matches: unit.matches.slice(),
      js: [{ code: unit.code }],
      runAt: unit.run_at,
      world: 'USER_SCRIPT',
      worldId: unit.world_id
    };
  }

  function expectedScriptIds(snapshot) {
    return new Set((snapshot && snapshot.entries || []).filter((entry) => entry.enabled !== false).map((entry) => scriptId(entry.id)));
  }

  function appendEvidence(state, event) {
    const raw = clone(event || {});
    const at = String(raw.at || nowIso());
    delete raw.at;
    const record = Object.assign({
      schema: 'dcf.control.event.v1',
      event_id: String(raw.event_id || eventId(raw.type || 'event')),
      timestamp: at,
      writer_id: String(raw.writer_id || 'dcf.chrome.host'),
      operation_id: raw.operation_id || null,
      entity_id: raw.entity_id || raw.snapshot_id || raw.artifact_id || raw.page_instance_id || null,
      before_revision: Number(state.revision || 0),
      after_revision: Number(state.revision || 0) + 1
    }, raw);
    state.evidence = [...(state.evidence || []), record].slice(-400);
    return record;
  }

  function compatibilitySnapshots(state) {
    const desiredSnapshot = state.desired && state.desired.snapshot;
    const current = state.committed && state.committed.current;
    return {
      current: clone(current),
      candidate: desiredSnapshot && (!current || desiredSnapshot.id !== current.id) ? clone(desiredSnapshot) : null,
      last_known_good: clone(state.committed && state.committed.last_known_good),
      stable: clone(state.committed && state.committed.stable)
    };
  }

  function installedUnitVersions(state) {
    return Object.fromEntries(Object.entries(state.unit_versions || {}).map(([id, entry]) => [id, Object.keys(entry.versions || {}).sort()]));
  }

  function diagnostics(state, actualScripts, userScriptsAvailable) {
    const target = state.committed.current || state.committed.last_known_good;
    const expected = expectedScriptIds(target);
    const actual = new Set((actualScripts || []).map((item) => item.id));
    const deviations = [];
    for (const id of expected) if (!actual.has(id)) deviations.push({ code: 'missing_registration', id });
    for (const id of actual) if (!expected.has(id)) deviations.push({ code: 'unexpected_registration', id });
    if (!userScriptsAvailable) deviations.push({ code: 'user_scripts_unavailable' });
    return {
      schema: 'dcf.chrome.diagnostic.v3',
      generated_at: nowIso(),
      host_version: HOST_VERSION,
      state_revision: state.revision,
      user_scripts_available: !!userScriptsAvailable,
      desired: clone(state.desired),
      committed: clone(state.committed),
      observed: clone(state.observed),
      candidate_snapshot: compatibilitySnapshots(state).candidate,
      current_snapshot: clone(state.committed.current),
      last_known_good_snapshot: clone(state.committed.last_known_good),
      stable_snapshot: clone(state.committed.stable),
      actual_registered_scripts: clone(actualScripts || []),
      installed_units: installedUnitVersions(state),
      activation_records: clone((state.activation_records || []).slice(-12)),
      reconcile_records: clone((state.reconcile_records || []).slice(-20)),
      update: clone(state.update),
      migration: clone(state.migration),
      deviations,
      recent_evidence: clone((state.evidence || []).slice(-60))
    };
  }
  Object.assign(C, { registrationFor, expectedScriptIds, appendEvidence, compatibilitySnapshots, installedUnitVersions, diagnostics });
})(typeof globalThis !== 'undefined' ? globalThis : this);
