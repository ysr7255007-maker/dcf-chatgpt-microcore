(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DCFHostCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_SCHEMA = 'dcf.chrome.host.state.v1';
  const HOST_VERSION = '1.0.0-rc.1';
  const STATE_KEY = 'dcf.chrome.host.state.v1';
  const WORLD_ID = 'dcf-runtime';
  const SCRIPT_PREFIX = 'dcf-unit-';

  function nowIso() { return new Date().toISOString(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!isObject(value)) return value;
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
    return result;
  }

  function canonicalJson(value) { return JSON.stringify(canonical(value)); }

  async function sha256Text(text) {
    const bytes = new TextEncoder().encode(String(text));
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable');
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function unitKey(id, version) { return `${String(id)}@${String(version)}`; }
  function scriptId(id) { return `${SCRIPT_PREFIX}${String(id).replace(/[^a-zA-Z0-9_.-]+/g, '-')}`.slice(0, 255); }

  function emptyState() {
    return {
      schema: HOST_SCHEMA,
      host_version: HOST_VERSION,
      revision: 0,
      updated_at: nowIso(),
      code_units: {},
      snapshots: { current: null, candidate: null, last_known_good: null, history: [] },
      evidence: [],
      product: {
        ammo: {},
        settings: { ammo_fire_mode: 'insert', appearance: {} },
        migration: { status: 'not_started', last_result: null }
      },
      update: { last_checked_at: null, last_result: null }
    };
  }

  function normalizeState(value) {
    const state = Object.assign(emptyState(), isObject(value) ? clone(value) : {});
    state.schema = HOST_SCHEMA;
    state.host_version = HOST_VERSION;
    state.revision = Number(state.revision || 0);
    state.code_units = isObject(state.code_units) ? state.code_units : {};
    state.snapshots = Object.assign({ current: null, candidate: null, last_known_good: null, history: [] }, isObject(state.snapshots) ? state.snapshots : {});
    state.snapshots.history = Array.isArray(state.snapshots.history) ? state.snapshots.history.slice(-12) : [];
    state.evidence = Array.isArray(state.evidence) ? state.evidence.slice(-200) : [];
    state.product = Object.assign({ ammo: {}, settings: {}, migration: {} }, isObject(state.product) ? state.product : {});
    state.product.ammo = isObject(state.product.ammo) ? state.product.ammo : {};
    state.product.settings = Object.assign({ ammo_fire_mode: 'insert', appearance: {} }, isObject(state.product.settings) ? state.product.settings : {});
    state.product.migration = Object.assign({ status: 'not_started', last_result: null }, isObject(state.product.migration) ? state.product.migration : {});
    state.update = Object.assign({ last_checked_at: null, last_result: null }, isObject(state.update) ? state.update : {});
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
    const manifest = {
      schema: 'dcf.code_unit.v1',
      id: String(value.id || '').trim(),
      version: String(value.version || '').trim(),
      title: String(value.title || value.id || '').trim(),
      description: String(value.description || ''),
      code: String(value.code || ''),
      hash: String(value.hash || '').toLowerCase(),
      source: isObject(value.source) ? clone(value.source) : { kind: 'unknown' },
      matches: Array.isArray(value.matches) && value.matches.length ? value.matches.map(String) : ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      run_at: ['document_start', 'document_end', 'document_idle'].includes(value.run_at) ? value.run_at : 'document_idle',
      world: 'USER_SCRIPT',
      world_id: String(value.world_id || WORLD_ID),
      host_api: String(value.host_api || '1'),
      phase: Number(value.phase || 100),
      required: value.required === true
    };
    if (!manifest.id) throw new Error('code unit id is required');
    if (!manifest.version) throw new Error(`code unit ${manifest.id} version is required`);
    if (!manifest.code.trim()) throw new Error(`code unit ${manifest.id}@${manifest.version} code is empty`);
    if (!/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error(`code unit ${manifest.id}@${manifest.version} has invalid SHA-256`);
    return manifest;
  }

  async function verifyUnit(value) {
    const unit = normalizeUnitManifest(value);
    const actual = await sha256Text(unit.code);
    if (actual !== unit.hash) throw new Error(`hash mismatch for ${unit.id}@${unit.version}`);
    return unit;
  }

  function storeUnit(state, unit) {
    const id = unit.id;
    const entry = state.code_units[id] || { id, versions: {} };
    entry.versions = isObject(entry.versions) ? entry.versions : {};
    const existing = entry.versions[unit.version];
    if (existing && existing.hash !== unit.hash) throw new Error(`immutable code unit conflict ${unitKey(id, unit.version)}`);
    entry.versions[unit.version] = clone(unit);
    state.code_units[id] = entry;
  }

  function getUnit(state, id, version) {
    const entry = state.code_units[id];
    return entry && entry.versions && entry.versions[version] || null;
  }

  function normalizeSnapshot(value) {
    if (!isObject(value)) throw new Error('snapshot must be an object');
    const entries = Array.isArray(value.entries) ? value.entries.map((entry) => ({
      id: String(entry.id || ''),
      version: String(entry.version || ''),
      hash: String(entry.hash || '').toLowerCase(),
      enabled: entry.enabled !== false,
      phase: Number(entry.phase || 100)
    })) : [];
    entries.sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
    return {
      schema: 'dcf.startup.snapshot.v1',
      id: String(value.id || `snapshot-${Date.now().toString(36)}`),
      created_at: String(value.created_at || nowIso()),
      reason: String(value.reason || 'unspecified'),
      entries
    };
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
    return normalizeSnapshot({
      id: `snapshot-${Date.now().toString(36)}`,
      reason: reason || 'official-default',
      entries: units.map((unit) => ({ id: unit.id, version: unit.version, hash: unit.hash, enabled: true, phase: unit.phase }))
    });
  }

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

  function trimEvidence(items) { return (Array.isArray(items) ? items : []).slice(-200); }

  function appendEvidence(state, event) {
    state.evidence = trimEvidence([...(state.evidence || []), Object.assign({ at: nowIso() }, clone(event || {}))]);
  }

  function extractBlocks(text, marker) {
    const source = String(text || '');
    const startToken = `<<<${marker}`;
    const endToken = `${marker}>>>`;
    const result = [];
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf(startToken, cursor);
      if (start < 0) break;
      const end = source.indexOf(endToken, start + startToken.length);
      if (end < 0) break;
      const bodyStart = source.indexOf('{', start + startToken.length);
      if (bodyStart >= 0 && bodyStart < end) result.push(source.slice(bodyStart, end).trim());
      cursor = end + endToken.length;
    }
    return result;
  }

  function normalizeAmmo(value) {
    if (!isObject(value) || !value.id) throw new Error('DCF_AMMO requires id');
    const item = clone(value);
    delete item._meta;
    item.id = String(item.id);
    item.title = String(item.title || item.id);
    item.purpose = String(item.purpose || '');
    item.body = String(item.body || '');
    if (!item.body.trim()) throw new Error(`DCF_AMMO ${item.id} body is empty`);
    if (Array.isArray(item.tags)) item.tags = item.tags.map(String).filter(Boolean);
    return item;
  }

  function decodeAmmoArtifacts(text) {
    const items = [];
    const errors = [];
    for (const raw of extractBlocks(text, 'DCF_AMMO')) {
      try { items.push(normalizeAmmo(JSON.parse(raw))); }
      catch (error) { errors.push(String(error && error.message || error)); }
    }
    return { items, errors };
  }

  async function ammoRecord(item, previous) {
    const normalized = normalizeAmmo(item);
    return Object.assign({}, normalized, {
      _meta: {
        version: Number(previous && previous._meta && previous._meta.version || 0) + 1,
        updated_at: nowIso(),
        content_hash: await sha256Text(canonicalJson(normalized))
      }
    });
  }

  function publicProductState(state) {
    return {
      ammo: clone(state.product.ammo),
      settings: clone(state.product.settings),
      migration: clone(state.product.migration)
    };
  }

  function diagnostics(state, actualScripts, userScriptsAvailable) {
    const target = state.snapshots.candidate || state.snapshots.current;
    const expected = expectedScriptIds(target);
    const actual = new Set((actualScripts || []).filter((item) => String(item.id || '').startsWith(SCRIPT_PREFIX)).map((item) => item.id));
    const missing = [...expected].filter((id) => !actual.has(id));
    const unexpected = [...actual].filter((id) => !expected.has(id));
    return {
      schema: 'dcf.chrome.diagnostics.v1',
      generated_at: nowIso(),
      host_version: HOST_VERSION,
      state_revision: state.revision,
      user_scripts_available: !!userScriptsAvailable,
      code_unit_count: Object.keys(state.code_units).length,
      current_snapshot: clone(state.snapshots.current),
      candidate_snapshot: clone(state.snapshots.candidate),
      last_known_good_snapshot: clone(state.snapshots.last_known_good),
      actual_registered_scripts: (actualScripts || []).map((item) => ({ id: item.id, matches: item.matches, runAt: item.runAt, world: item.world, worldId: item.worldId })),
      deviations: [
        ...missing.map((id) => ({ code: 'registered_script_missing', id })),
        ...unexpected.map((id) => ({ code: 'registered_script_unexpected', id }))
      ],
      recent_evidence: (state.evidence || []).slice(-30).map((item) => {
        const copy = clone(item);
        if (copy.detail && typeof copy.detail === 'string' && copy.detail.length > 300) copy.detail = `${copy.detail.slice(0, 300)}…`;
        return copy;
      }),
      migration: clone(state.product.migration),
      update: clone(state.update)
    };
  }

  return {
    HOST_SCHEMA, HOST_VERSION, STATE_KEY, WORLD_ID, SCRIPT_PREFIX,
    nowIso, clone, isObject, canonical, canonicalJson, sha256Text, unitKey, scriptId,
    emptyState, normalizeState, finalizeState, normalizeUnitManifest, verifyUnit,
    storeUnit, getUnit, normalizeSnapshot, validateSnapshot, snapshotFromUnits,
    registrationFor, expectedScriptIds, appendEvidence, extractBlocks,
    normalizeAmmo, decodeAmmoArtifacts, ammoRecord, publicProductState, diagnostics
  };
});
