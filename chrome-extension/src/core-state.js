(function (root) {
  'use strict';
  const C = root.DCFHostCore;
  const { HOST_SCHEMA, HOST_VERSION, emptyState, emptyDesired, clone, isObject, nowIso, importLegacyCodeStore, normalizeSnapshot, normalizeDesired, absorbRc1Product, normalizeUnitManifest, artifactId, unitRefKey, unitKey } = C;
  function normalizeState(value) {
    const input = isObject(value) ? clone(value) : {};
    const state = emptyState();
    state.revision = Number(input.revision || 0);
    state.updated_at = String(input.updated_at || nowIso());
    state.plugin_data = isObject(input.plugin_data) ? input.plugin_data : {};
    state.migration = Object.assign(state.migration, isObject(input.migration) ? input.migration : {});
    state.migration.next = Object.assign({ status: 'not_started', last_result: null }, isObject(state.migration.next) ? state.migration.next : {});
    state.migration.control_plane_v3 = Object.assign({ status: 'not_started', discarded_legacy_candidate_id: null }, isObject(state.migration.control_plane_v3) ? state.migration.control_plane_v3 : {});
    state.update = Object.assign(state.update, isObject(input.update) ? input.update : {});
    state.update.plugins = Object.assign({ last_checked_at: null, last_result: null }, isObject(state.update.plugins) ? state.update.plugins : {});
    state.update.base = Object.assign({ available_version: null, last_checked_at: null, last_result: null }, isObject(state.update.base) ? state.update.base : {});
    state.backups = Array.isArray(input.backups) ? input.backups.slice(-3) : [];
    state.evidence = Array.isArray(input.evidence) ? input.evidence.slice(-400) : [];
    state.activation_records = Array.isArray(input.activation_records) ? input.activation_records.slice(-40) : [];
    state.reconcile_records = Array.isArray(input.reconcile_records) ? input.reconcile_records.slice(-80) : [];
    importLegacyCodeStore(state, input);

    const legacySnapshots = isObject(input.snapshots) ? input.snapshots : {};
    const committed = isObject(input.committed) ? input.committed : {};
    state.committed = {
      current: committed.current ? normalizeSnapshot(committed.current) : legacySnapshots.current ? normalizeSnapshot(legacySnapshots.current) : null,
      last_known_good: committed.last_known_good ? normalizeSnapshot(committed.last_known_good) : legacySnapshots.last_known_good ? normalizeSnapshot(legacySnapshots.last_known_good) : null,
      stable: committed.stable ? normalizeSnapshot(committed.stable) : legacySnapshots.last_known_good ? normalizeSnapshot(legacySnapshots.last_known_good) : null,
      history: (Array.isArray(committed.history) ? committed.history : Array.isArray(legacySnapshots.history) ? legacySnapshots.history : []).map(normalizeSnapshot).slice(-12)
    };
    state.desired = normalizeDesired(input.desired);
    if (!state.desired.snapshot && legacySnapshots.candidate) {
      state.migration.control_plane_v3 = {
        status: 'completed',
        discarded_legacy_candidate_id: String(legacySnapshots.candidate.id || '')
      };
    } else if (state.migration.control_plane_v3.status === 'not_started') {
      state.migration.control_plane_v3.status = 'completed';
    }

    const observed = isObject(input.observed) ? input.observed : {};
    state.observed.registrations = Object.assign(state.observed.registrations, isObject(observed.registrations) ? observed.registrations : {});
    const pages = isObject(observed.pages) ? Object.entries(observed.pages) : [];
    state.observed.pages = Object.fromEntries(pages
      .sort((a, b) => Date.parse(b[1] && b[1].last_seen_at || 0) - Date.parse(a[1] && a[1].last_seen_at || 0))
      .slice(0, 48));

    absorbRc1Product(state, input);
    state.schema = HOST_SCHEMA;
    state.host_version = HOST_VERSION;
    delete state.snapshots;
    delete state.product;
    return state;
  }

  function finalizeState(previous, candidate) {
    const state = normalizeState(candidate);
    state.revision = Number(previous && previous.revision || 0) + 1;
    state.updated_at = nowIso();
    return state;
  }

  function storeUnit(state, value) {
    const unit = normalizeUnitManifest(value);
    const index = state.unit_versions[unit.id] || { id: unit.id, versions: {}, history: {} };
    index.versions = isObject(index.versions) ? index.versions : {};
    index.history = isObject(index.history) ? index.history : {};
    const existingArtifact = state.code_units[unit.hash];
    if (existingArtifact && (existingArtifact.id !== unit.id || existingArtifact.version !== unit.version || existingArtifact.code !== unit.code)) {
      throw new Error(`content-address collision ${artifactId(unit.hash)}`);
    }
    const priorHash = index.versions[unit.version];
    const hashes = new Set(Array.isArray(index.history[unit.version]) ? index.history[unit.version] : []);
    if (priorHash) hashes.add(priorHash);
    hashes.add(unit.hash);
    index.history[unit.version] = [...hashes];
    index.versions[unit.version] = unit.hash;
    state.code_units[unit.hash] = clone(unit);
    state.unit_versions[unit.id] = index;
    return { ...clone(unit), semantic_version_reused: Boolean(priorHash && priorHash !== unit.hash), prior_hash: priorHash || null };
  }

  function getUnit(state, id, version, hash) {
    const resolvedHash = String(hash || state.unit_versions[id] && state.unit_versions[id].versions && state.unit_versions[id].versions[version] || '').toLowerCase();
    const unit = state.code_units[resolvedHash] || null;
    if (!unit) return null;
    if (id && unit.id !== id) return null;
    if (version && unit.version !== version) return null;
    return unit;
  }

  function validateSnapshot(state, value) {
    const snapshot = normalizeSnapshot(value);
    const ids = new Set();
    for (const ref of snapshot.entries) {
      if (!ref.id || !ref.version || !/^[a-f0-9]{64}$/.test(ref.hash)) throw new Error('snapshot entry requires id, version and hash');
      if (ids.has(ref.id)) throw new Error(`duplicate snapshot unit ${ref.id}`);
      ids.add(ref.id);
      const unit = getUnit(state, ref.id, ref.version, ref.hash);
      if (!unit) throw new Error(`snapshot references missing ${unitRefKey(ref)}`);
      if (unit.hash !== ref.hash) throw new Error(`snapshot hash mismatch ${unitKey(ref.id, ref.version)}`);
    }
    if (!snapshot.id) throw new Error('snapshot id is required');
    return snapshot;
  }

  Object.assign(C, { normalizeState, finalizeState, storeUnit, getUnit, validateSnapshot });
})(typeof globalThis !== 'undefined' ? globalThis : this);
