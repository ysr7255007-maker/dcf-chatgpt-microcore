(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DCFHostCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_SCHEMA = 'dcf.chrome.host.state.v2';
  const HOST_VERSION = '1.0.0-rc.2';
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
  function unitKey(id, version) { return `${String(id)}@${String(version)}`; }
  function scriptId(id) { return `${SCRIPT_PREFIX}${String(id).replace(/[^a-zA-Z0-9_.-]+/g, '-')}`.slice(0, 255); }
  function worldId(id) { return `dcf-${String(id).replace(/^dcf\./, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`.slice(0, 64); }

  function emptyState() {
    return {
      schema: HOST_SCHEMA,
      host_version: HOST_VERSION,
      revision: 0,
      updated_at: nowIso(),
      code_units: {},
      snapshots: { current: null, candidate: null, last_known_good: null, history: [] },
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
    if (isObject(product.migration) && product.migration.status) {
      state.migration.next = clone(product.migration);
    }
    state.migration.rc1_absorbed = true;
  }

  function normalizeState(value) {
    const input = isObject(value) ? clone(value) : {};
    const state = Object.assign(emptyState(), input);
    state.schema = HOST_SCHEMA;
    state.host_version = HOST_VERSION;
    state.revision = Number(state.revision || 0);
    state.code_units = isObject(state.code_units) ? state.code_units : {};
    state.snapshots = Object.assign({ current: null, candidate: null, last_known_good: null, history: [] }, isObject(state.snapshots) ? state.snapshots : {});
    state.snapshots.history = Array.isArray(state.snapshots.history) ? state.snapshots.history.slice(-12) : [];
    state.evidence = Array.isArray(state.evidence) ? state.evidence.slice(-240) : [];
    state.plugin_data = isObject(state.plugin_data) ? state.plugin_data : {};
    state.migration = Object.assign({ next: { status: 'not_started', last_result: null }, rc1_absorbed: false }, isObject(state.migration) ? state.migration : {});
    state.migration.next = Object.assign({ status: 'not_started', last_result: null }, isObject(state.migration.next) ? state.migration.next : {});
    state.update = Object.assign(emptyState().update, isObject(state.update) ? state.update : {});
    state.update.plugins = Object.assign({ last_checked_at: null, last_result: null }, isObject(state.update.plugins) ? state.update.plugins : {});
    state.update.base = Object.assign({ available_version: null, last_checked_at: null, last_result: null }, isObject(state.update.base) ? state.update.base : {});
    state.backups = Array.isArray(state.backups) ? state.backups.slice(-3) : [];
    absorbRc1Product(state, input);
    delete state.product;
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
    const manifest = {
      schema: 'dcf.code_unit.v2',
      id,
      version,
      title: String(value.title || id).trim(),
      description: String(value.description || ''),
      code: String(value.code || ''),
      hash: String(value.hash || '').toLowerCase(),
      source: isObject(value.source) ? clone(value.source) : { kind: 'unknown' },
      matches: Array.isArray(value.matches) && value.matches.length ? value.matches.map(String) : ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      run_at: ['document_start', 'document_end', 'document_idle'].includes(value.run_at) ? value.run_at : 'document_idle',
      world: 'USER_SCRIPT',
      world_id: String(value.world_id || worldId(id)),
      host_api: String(value.host_api || '2'),
      phase: Number(value.phase || 100),
      required: value.required !== false,
      default_enabled: value.default_enabled !== false
    };
    if (!manifest.id) throw new Error('code unit id is required');
    if (!manifest.version) throw new Error(`code unit ${manifest.id} version is required`);
    if (!manifest.code.trim()) throw new Error(`code unit ${manifest.id}@${manifest.version} code is empty`);
    if (!/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error(`code unit ${manifest.id}@${manifest.version} has invalid SHA-256`);
    return manifest;
  }
  async function verifyUnit(value) {
    const unit = normalizeUnitManifest(value);
    if (await sha256Text(unit.code) !== unit.hash) throw new Error(`hash mismatch for ${unitKey(unit.id, unit.version)}`);
    return unit;
  }
  function storeUnit(state, unit) {
    const entry = state.code_units[unit.id] || { id: unit.id, versions: {} };
    entry.versions = isObject(entry.versions) ? entry.versions : {};
    const existing = entry.versions[unit.version];
    if (existing && existing.hash !== unit.hash) throw new Error(`immutable code unit conflict ${unitKey(unit.id, unit.version)}`);
    entry.versions[unit.version] = clone(unit);
    state.code_units[unit.id] = entry;
  }
  function getUnit(state, id, version) { return state.code_units[id] && state.code_units[id].versions && state.code_units[id].versions[version] || null; }

  function normalizeSnapshot(value) {
    if (!isObject(value)) throw new Error('snapshot must be an object');
    const entries = (Array.isArray(value.entries) ? value.entries : []).map((entry) => ({
      id: String(entry.id || ''), version: String(entry.version || ''), hash: String(entry.hash || '').toLowerCase(),
      enabled: entry.enabled !== false, phase: Number(entry.phase || 100)
    })).sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
    return { schema: 'dcf.startup.snapshot.v2', id: String(value.id || `snapshot-${Date.now().toString(36)}`), created_at: String(value.created_at || nowIso()), reason: String(value.reason || 'unspecified'), entries };
  }
  function validateSnapshot(state, value) {
    const snapshot = normalizeSnapshot(value);
    const ids = new Set();
    for (const ref of snapshot.entries) {
      if (!ref.id || !ref.version) throw new Error('snapshot entry requires id and version');
      if (ids.has(ref.id)) throw new Error(`duplicate snapshot unit ${ref.id}`);
      ids.add(ref.id);
      const unit = getUnit(state, ref.id, ref.version);
      if (!unit) throw new Error(`snapshot references missing ${unitKey(ref.id, ref.version)}`);
      if (unit.hash !== ref.hash) throw new Error(`snapshot hash mismatch ${unitKey(ref.id, ref.version)}`);
    }
    return snapshot;
  }
  function snapshotFromUnits(units, reason) {
    return normalizeSnapshot({ reason: reason || 'official-default', entries: units.map((unit) => ({ id: unit.id, version: unit.version, hash: unit.hash, enabled: unit.default_enabled !== false, phase: unit.phase })) });
  }
  function registrationFor(unit) {
    return { id: scriptId(unit.id), matches: unit.matches.slice(), js: [{ code: unit.code }], runAt: unit.run_at, world: 'USER_SCRIPT', worldId: unit.world_id };
  }
  function expectedScriptIds(snapshot) { return new Set((snapshot && snapshot.entries || []).filter((entry) => entry.enabled !== false).map((entry) => scriptId(entry.id))); }
  function appendEvidence(state, event) { state.evidence = [...(state.evidence || []), Object.assign({ at: nowIso() }, clone(event || {}))].slice(-240); }

  function diagnostics(state, actualScripts, userScriptsAvailable) {
    const target = state.snapshots.candidate || state.snapshots.current || state.snapshots.last_known_good;
    const expected = expectedScriptIds(target);
    const actual = new Set((actualScripts || []).map((item) => item.id));
    const deviations = [];
    for (const id of expected) if (!actual.has(id)) deviations.push({ code: 'missing_registration', id });
    for (const id of actual) if (!expected.has(id)) deviations.push({ code: 'unexpected_registration', id });
    if (!userScriptsAvailable) deviations.push({ code: 'user_scripts_unavailable' });
    return {
      schema: 'dcf.chrome.diagnostic.v2', generated_at: nowIso(), host_version: HOST_VERSION,
      state_revision: state.revision, user_scripts_available: !!userScriptsAvailable,
      candidate_snapshot: clone(state.snapshots.candidate), current_snapshot: clone(state.snapshots.current),
      last_known_good_snapshot: clone(state.snapshots.last_known_good), actual_registered_scripts: clone(actualScripts || []),
      installed_units: Object.fromEntries(Object.entries(state.code_units).map(([id, entry]) => [id, Object.keys(entry.versions || {}).sort()])),
      update: clone(state.update), migration: clone(state.migration), deviations,
      recent_evidence: clone((state.evidence || []).slice(-40))
    };
  }

  return {
    HOST_SCHEMA, HOST_VERSION, STATE_KEY, SCRIPT_PREFIX,
    nowIso, clone, isObject, canonical, canonicalJson, sha256Text, unitKey, scriptId, worldId,
    emptyState, normalizeState, finalizeState, normalizeUnitManifest, verifyUnit, storeUnit, getUnit,
    normalizeSnapshot, validateSnapshot, snapshotFromUnits, registrationFor, expectedScriptIds, appendEvidence, diagnostics
  };
});
