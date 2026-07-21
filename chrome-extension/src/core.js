(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DCFHostCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_SCHEMA = 'dcf.chrome.host.state.v3';
  const HOST_VERSION = '1.0.0-rc.3';
  const STATE_KEY = 'dcf.chrome.host.state.v1';
  const SCRIPT_PREFIX = 'dcf-unit-';

  function nowIso() { return new Date().toISOString(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  function canonicalJson(value) { return JSON.stringify(canonical(value)); }
  async function sha256Text(text) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  function shortHash(value) {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function contentId(hash) { return `sha256:${String(hash || '').toLowerCase()}`; }
  function unitKey(id, hash) { return `${String(id)}@${contentId(hash)}`; }
  function unitVersionKey(id, version) { return `${String(id)}@${String(version)}`; }
  function scriptId(id) { return `${SCRIPT_PREFIX}${String(id).replace(/[^a-zA-Z0-9_.-]+/g, '-')}`.slice(0, 255); }
  function worldId(id) { return `dcf-${String(id).replace(/^dcf\./, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`.slice(0, 64); }

  function emptyControl() {
    return {
      desired_snapshot: null,
      committed: { current: null, last_known_good: null, stable: null, history: [] },
      canary: { tab_id: null, snapshot_id: null, status: 'idle', last_seen_at: null, attempts: 0, error: null },
      page_runtimes: {},
      activation_records: [],
      reconcile_records: []
    };
  }
  function emptyState() {
    return {
      schema: HOST_SCHEMA,
      host_version: HOST_VERSION,
      revision: 0,
      updated_at: nowIso(),
      code_units: {},
      control: emptyControl(),
      evidence: [],
      plugin_data: {},
      migration: { next: { status: 'not_started', last_result: null }, rc1_absorbed: false },
      update: {
        plugins: { last_checked_at: null, last_result: null },
        base: { available_version: null, last_checked_at: null, last_result: null }
      },
      backups: []
    };
  }

  function cleanLegacyAmmo(value) {
    if (!isObject(value)) return {};
    const result = {};
    for (const [id, raw] of Object.entries(value)) {
      if (!isObject(raw)) continue;
      const item = clone(raw);
      delete item._meta;
      item.id = String(item.id || id);
      result[item.id] = item;
    }
    return result;
  }

  function absorbRc1Product(state, input) {
    if (state.migration.rc1_absorbed || !isObject(input && input.product)) return;
    const product = input.product;
    const ammo = cleanLegacyAmmo(product.ammo);
    if (Object.keys(ammo).length) {
      const existing = isObject(state.plugin_data['dcf.firstparty.ammo']) ? state.plugin_data['dcf.firstparty.ammo'] : {};
      state.plugin_data['dcf.firstparty.ammo'] = {
        ...existing,
        items: { ...(isObject(existing.items) ? existing.items : {}), ...ammo },
        settings: {
          ...(isObject(existing.settings) ? existing.settings : {}),
          fire_mode: product.settings && product.settings.ammo_fire_mode === 'send' ? 'send' : 'insert'
        }
      };
    }
    const appearance = product.settings && product.settings.appearance;
    if (isObject(appearance) && Object.keys(appearance).length) {
      state.plugin_data['dcf.firstparty.appearance'] = {
        ...(isObject(state.plugin_data['dcf.firstparty.appearance']) ? state.plugin_data['dcf.firstparty.appearance'] : {}),
        ...clone(appearance)
      };
    }
    if (isObject(product.migration) && product.migration.status) state.migration.next = clone(product.migration);
    state.migration.rc1_absorbed = true;
  }

  function normalizeCodeUnits(value) {
    const input = isObject(value) ? value : {};
    const result = {};
    for (const [id, raw] of Object.entries(input)) {
      const entry = { id, artifacts: {}, versions: {} };
      if (isObject(raw && raw.artifacts)) {
        for (const [hash, artifact] of Object.entries(raw.artifacts)) {
          if (!isObject(artifact)) continue;
          const normalizedHash = String(artifact.hash || hash).toLowerCase();
          entry.artifacts[normalizedHash] = { ...clone(artifact), id: String(artifact.id || id), hash: normalizedHash };
        }
      }
      if (isObject(raw && raw.versions)) {
        for (const [version, versionValue] of Object.entries(raw.versions)) {
          if (isObject(versionValue) && versionValue.code) {
            const hash = String(versionValue.hash || '').toLowerCase();
            if (hash) {
              entry.artifacts[hash] = { ...clone(versionValue), id: String(versionValue.id || id), version: String(versionValue.version || version), hash };
              entry.versions[version] = [hash];
            }
          } else {
            const hashes = Array.isArray(versionValue) ? versionValue : [versionValue];
            entry.versions[version] = [...new Set(hashes.map(String).map((hash) => hash.toLowerCase()).filter((hash) => /^[a-f0-9]{64}$/.test(hash)))];
          }
        }
      }
      for (const artifact of Object.values(entry.artifacts)) {
        const version = String(artifact.version || '').trim();
        if (!version) continue;
        const hashes = entry.versions[version] || [];
        if (!hashes.includes(artifact.hash)) hashes.push(artifact.hash);
        entry.versions[version] = hashes;
      }
      result[id] = entry;
    }
    return result;
  }

  function normalizePageRuntimes(value) {
    const entries = Object.entries(isObject(value) ? value : {})
      .filter(([, runtime]) => isObject(runtime))
      .sort((a, b) => Date.parse(b[1].last_seen_at || 0) - Date.parse(a[1].last_seen_at || 0))
      .slice(0, 24);
    return Object.fromEntries(entries.map(([key, runtime]) => [key, {
      tab_id: runtime.tab_id == null ? null : Number(runtime.tab_id),
      page_instance_id: String(runtime.page_instance_id || ''),
      conversation_id: runtime.conversation_id ? String(runtime.conversation_id) : null,
      role: String(runtime.role || 'page'),
      observed_snapshot: runtime.observed_snapshot ? String(runtime.observed_snapshot) : null,
      units: isObject(runtime.units) ? clone(runtime.units) : {},
      migration_status: String(runtime.migration_status || 'unknown'),
      last_seen_at: String(runtime.last_seen_at || nowIso())
    }]));
  }

  function normalizeControl(value, legacySnapshots) {
    const input = isObject(value) ? value : {};
    const legacy = isObject(legacySnapshots) ? legacySnapshots : {};
    const base = emptyControl();
    const committedInput = isObject(input.committed) ? input.committed : {};
    const current = clone(committedInput.current || legacy.current || null);
    const lastKnownGood = clone(committedInput.last_known_good || legacy.last_known_good || null);
    const hasCommittedStable = Object.prototype.hasOwnProperty.call(committedInput, 'stable');
    const stable = hasCommittedStable
      ? clone(committedInput.stable)
      : clone(legacy.stable || lastKnownGood || current || null);
    return {
      desired_snapshot: clone(input.desired_snapshot || legacy.candidate || current || lastKnownGood || null),
      committed: {
        current,
        last_known_good: lastKnownGood,
        stable,
        history: (Array.isArray(committedInput.history) ? committedInput.history : (Array.isArray(legacy.history) ? legacy.history : [])).slice(-12).map(clone)
      },
      canary: Object.assign(base.canary, isObject(input.canary) ? clone(input.canary) : {}),
      page_runtimes: normalizePageRuntimes(input.page_runtimes),
      activation_records: (Array.isArray(input.activation_records) ? input.activation_records : []).slice(-80).map(clone),
      reconcile_records: (Array.isArray(input.reconcile_records) ? input.reconcile_records : []).slice(-120).map(clone)
    };
  }

  function normalizeState(value) {
    const input = isObject(value) ? clone(value) : {};
    const state = Object.assign(emptyState(), input);
    state.schema = HOST_SCHEMA;
    state.host_version = HOST_VERSION;
    state.revision = Number(state.revision || 0);
    state.code_units = normalizeCodeUnits(state.code_units);
    state.control = normalizeControl(input.control, input.snapshots);
    state.evidence = Array.isArray(state.evidence) ? state.evidence.slice(-300) : [];
    state.plugin_data = isObject(state.plugin_data) ? state.plugin_data : {};
    state.migration = Object.assign({ next: { status: 'not_started', last_result: null }, rc1_absorbed: false }, isObject(state.migration) ? state.migration : {});
    state.migration.next = Object.assign({ status: 'not_started', last_result: null }, isObject(state.migration.next) ? state.migration.next : {});
    state.update = Object.assign(emptyState().update, isObject(state.update) ? state.update : {});
    state.update.plugins = Object.assign({ last_checked_at: null, last_result: null }, isObject(state.update.plugins) ? state.update.plugins : {});
    state.update.base = Object.assign({ available_version: null, last_checked_at: null, last_result: null }, isObject(state.update.base) ? state.update.base : {});
    state.backups = Array.isArray(state.backups) ? state.backups.slice(-3) : [];
    absorbRc1Product(state, input);
    delete state.product;
    delete state.snapshots;
    return state;
  }

  function finalizeState(previous, candidate) {
    const state = normalizeState(candidate);
    state.revision = Number(previous && previous.revision || 0) + 1;
    state.updated_at = nowIso();
    return state;
  }

  function normalizeUnitManifest(value) {
    if (!isObject(value)) throw new Error('code unit manifest must be an object');
    const id = String(value.id || '').trim();
    const version = String(value.version || '').trim();
    const hash = String(value.hash || '').toLowerCase();
    const manifest = {
      schema: 'dcf.code_unit.v3',
      id,
      version,
      content_id: contentId(hash),
      title: String(value.title || id).trim(),
      description: String(value.description || ''),
      code: String(value.code || ''),
      hash,
      source: isObject(value.source) ? clone(value.source) : { kind: 'unknown' },
      matches: Array.isArray(value.matches) && value.matches.length ? value.matches.map(String) : ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      run_at: ['document_start', 'document_end', 'document_idle'].includes(value.run_at) ? value.run_at : 'document_idle',
      world: 'USER_SCRIPT',
      world_id: String(value.world_id || worldId(id)),
      host_api: String(value.host_api || '3'),
      phase: Number(value.phase || 100),
      required: value.required !== false,
      default_enabled: value.default_enabled !== false,
      activation_requirement: ['loaded', 'ready'].includes(value.activation_requirement) ? value.activation_requirement : 'loaded'
    };
    if (!manifest.id) throw new Error('code unit id is required');
    if (!manifest.version) throw new Error(`code unit ${manifest.id} version is required`);
    if (!manifest.code.trim()) throw new Error(`code unit ${manifest.id}@${manifest.version} code is empty`);
    if (!/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error(`code unit ${manifest.id}@${manifest.version} has invalid SHA-256`);
    return manifest;
  }
  async function verifyUnit(value) {
    const unit = normalizeUnitManifest(value);
    if (await sha256Text(unit.code) !== unit.hash) throw new Error(`hash mismatch for ${unitKey(unit.id, unit.hash)}`);
    return unit;
  }
  function storeUnit(state, value) {
    const unit = normalizeUnitManifest(value);
    const entry = state.code_units[unit.id] || { id: unit.id, artifacts: {}, versions: {} };
    entry.artifacts = isObject(entry.artifacts) ? entry.artifacts : {};
    entry.versions = isObject(entry.versions) ? entry.versions : {};
    const existing = entry.artifacts[unit.hash];
    if (existing && existing.code !== unit.code) throw new Error(`content hash collision ${unitKey(unit.id, unit.hash)}`);
    entry.artifacts[unit.hash] = clone(unit);
    const hashes = Array.isArray(entry.versions[unit.version]) ? entry.versions[unit.version] : [];
    if (!hashes.includes(unit.hash)) hashes.push(unit.hash);
    entry.versions[unit.version] = hashes;
    state.code_units[unit.id] = entry;
    return unit;
  }
  function getUnit(state, id, identity) {
    const entry = state.code_units[id];
    if (!entry) return null;
    const key = String(identity || '').replace(/^sha256:/, '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(key)) return entry.artifacts && entry.artifacts[key] || null;
    const hashes = entry.versions && entry.versions[String(identity)] || [];
    return hashes.length === 1 ? entry.artifacts[hashes[0]] || null : null;
  }
  function getUnitByRef(state, ref) {
    if (!ref) return null;
    const unit = getUnit(state, String(ref.id || ''), String(ref.hash || ''));
    if (!unit) return null;
    if (ref.version && unit.version !== String(ref.version)) return null;
    return unit;
  }

  function snapshotSignature(entries) {
    return entries.map((entry) => ({
      id: entry.id,
      hash: entry.hash,
      enabled: entry.enabled !== false,
      phase: Number(entry.phase || 100),
      required: entry.required !== false,
      activation_requirement: entry.activation_requirement === 'ready' ? 'ready' : 'loaded'
    }));
  }
  function normalizeSnapshot(value) {
    if (!isObject(value)) throw new Error('snapshot must be an object');
    const entries = (Array.isArray(value.entries) ? value.entries : []).map((entry) => ({
      id: String(entry.id || ''),
      version: String(entry.version || ''),
      hash: String(entry.hash || '').replace(/^sha256:/, '').toLowerCase(),
      content_id: contentId(String(entry.hash || '').replace(/^sha256:/, '').toLowerCase()),
      enabled: entry.enabled !== false,
      phase: Number(entry.phase || 100),
      required: entry.required !== false,
      activation_requirement: entry.activation_requirement === 'ready' ? 'ready' : 'loaded'
    })).sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
    const generatedId = `snapshot-${shortHash(canonicalJson(snapshotSignature(entries)))}`;
    return {
      schema: 'dcf.startup.snapshot.v3',
      id: String(value.id || generatedId),
      created_at: String(value.created_at || nowIso()),
      reason: String(value.reason || 'unspecified'),
      entries
    };
  }
  function validateSnapshot(state, value) {
    const snapshot = normalizeSnapshot(value);
    const ids = new Set();
    for (const ref of snapshot.entries) {
      if (!ref.id || !ref.hash) throw new Error('snapshot entry requires id and content hash');
      if (ids.has(ref.id)) throw new Error(`duplicate snapshot unit ${ref.id}`);
      ids.add(ref.id);
      const unit = getUnitByRef(state, ref);
      if (!unit) throw new Error(`snapshot references missing ${unitKey(ref.id, ref.hash)}`);
      if (unit.hash !== ref.hash) throw new Error(`snapshot hash mismatch ${unitKey(ref.id, ref.hash)}`);
    }
    return snapshot;
  }
  function snapshotFromUnits(units, reason) {
    return normalizeSnapshot({
      reason: reason || 'official-default',
      entries: units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        hash: unit.hash,
        enabled: unit.default_enabled !== false,
        phase: unit.phase,
        required: unit.required !== false,
        activation_requirement: unit.activation_requirement === 'ready' ? 'ready' : 'loaded'
      }))
    });
  }
  function sameSnapshot(a, b) {
    if (!a || !b) return false;
    return canonicalJson(snapshotSignature(normalizeSnapshot(a).entries)) === canonicalJson(snapshotSignature(normalizeSnapshot(b).entries));
  }
  function projectSnapshots(state) {
    const control = state.control || emptyControl();
    return {
      current: clone(control.committed.current),
      candidate: control.desired_snapshot && !sameSnapshot(control.desired_snapshot, control.committed.current) ? clone(control.desired_snapshot) : null,
      last_known_good: clone(control.committed.last_known_good),
      stable: clone(control.committed.stable),
      history: clone(control.committed.history || [])
    };
  }

  function observationPrelude(unit, snapshotId, role) {
    const payload = {
      type: 'runtime.observed',
      runtime_state: 'loaded',
      unit_id: unit.id,
      version: unit.version,
      content_hash: unit.hash,
      snapshot_id: snapshotId,
      role: role || 'page'
    };
    return `(function(){try{const k='__DCF_PAGE_INSTANCE_ID__';const p=globalThis[k]||(globalThis[k]=(globalThis.crypto&&crypto.randomUUID?crypto.randomUUID():('page-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))));chrome.runtime.sendMessage(Object.assign(${JSON.stringify(payload)},{page_instance_id:p})).catch(function(){});}catch(_){}})();`;
  }
  function registrationFor(unit, snapshotId, role) {
    return {
      id: scriptId(unit.id),
      matches: unit.matches.slice(),
      js: [{ code: unit.code }, { code: observationPrelude(unit, snapshotId, role || 'page') }],
      runAt: unit.run_at,
      world: 'USER_SCRIPT',
      worldId: unit.world_id
    };
  }
  function expectedScriptIds(snapshot) {
    return new Set((snapshot && snapshot.entries || []).filter((entry) => entry.enabled !== false).map((entry) => scriptId(entry.id)));
  }

  function appendEvidence(state, event) {
    const payload = Object.assign({
      event_id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: nowIso()
    }, clone(event || {}));
    state.evidence = [...(state.evidence || []), payload].slice(-300);
    return payload;
  }
  function upsertActivationRecord(state, snapshotId, patch) {
    const records = state.control.activation_records || [];
    let record = [...records].reverse().find((item) => item.snapshot_id === snapshotId && !['committed', 'failed', 'rolled_back'].includes(item.status));
    if (!record) {
      record = {
        schema: 'dcf.activation.record.v1',
        activation_id: `activation-${snapshotId}-${Date.now().toString(36)}`,
        snapshot_id: snapshotId,
        status: 'declared',
        declared_at: nowIso(),
        loaded_units: [],
        ready_units: [],
        degraded_units: [],
        failed_units: []
      };
      records.push(record);
    }
    Object.assign(record, clone(patch || {}));
    state.control.activation_records = records.slice(-80);
    return record;
  }
  function appendReconcileRecord(state, record) {
    const payload = Object.assign({
      schema: 'dcf.reconcile.record.v1',
      operation_id: `reconcile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: nowIso()
    }, clone(record || {}));
    state.control.reconcile_records = [...(state.control.reconcile_records || []), payload].slice(-120);
    return payload;
  }

  function diagnostics(state, actualScripts, userScriptsAvailable) {
    const snapshots = projectSnapshots(state);
    const target = state.control.desired_snapshot || snapshots.current || snapshots.last_known_good;
    const expected = expectedScriptIds(snapshots.current || snapshots.last_known_good);
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
      desired_snapshot: clone(state.control.desired_snapshot),
      committed: clone(state.control.committed),
      target_snapshot: clone(target),
      snapshots,
      candidate_snapshot: clone(snapshots.candidate),
      current_snapshot: clone(snapshots.current),
      last_known_good_snapshot: clone(snapshots.last_known_good),
      stable_snapshot: clone(snapshots.stable),
      canary: clone(state.control.canary),
      page_runtimes: clone(state.control.page_runtimes),
      actual_registered_scripts: clone(actualScripts || []),
      installed_units: Object.fromEntries(Object.entries(state.code_units).map(([id, entry]) => [id, {
        content_hashes: Object.keys(entry.artifacts || {}).sort(),
        versions: clone(entry.versions || {})
      }])),
      update: clone(state.update),
      migration: clone(state.migration),
      deviations,
      recent_activation_records: clone((state.control.activation_records || []).slice(-12)),
      recent_reconcile_records: clone((state.control.reconcile_records || []).slice(-20)),
      recent_evidence: clone((state.evidence || []).slice(-50))
    };
  }

  return {
    HOST_SCHEMA, HOST_VERSION, STATE_KEY, SCRIPT_PREFIX,
    nowIso, clone, isObject, canonical, canonicalJson, sha256Text, shortHash, contentId, unitKey, unitVersionKey, scriptId, worldId,
    emptyControl, emptyState, normalizeState, finalizeState,
    normalizeUnitManifest, verifyUnit, storeUnit, getUnit, getUnitByRef,
    normalizeSnapshot, validateSnapshot, snapshotFromUnits, sameSnapshot, projectSnapshots,
    observationPrelude, registrationFor, expectedScriptIds,
    appendEvidence, upsertActivationRecord, appendReconcileRecord, diagnostics
  };
});
