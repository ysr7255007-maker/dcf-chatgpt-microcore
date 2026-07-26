(function (root) {
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
  function artifactId(hash) { return `sha256:${String(hash || '').toLowerCase()}`; }
  function unitKey(id, version) { return `${String(id)}@${String(version)}`; }
  function unitRefKey(ref) { return `${String(ref && ref.id || '')}@${artifactId(ref && ref.hash || '')}`; }
  function scriptId(id) { return `${SCRIPT_PREFIX}${String(id).replace(/[^a-zA-Z0-9_.-]+/g, '-')}`.slice(0, 255); }
  function worldId(id) { return `dcf-${String(id).replace(/^dcf\./, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`.slice(0, 64); }
  function eventId(prefix) {
    const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${String(prefix || 'event')}-${random}`;
  }

  function emptyDesired() {
    return {
      schema: 'dcf.desired.snapshot.v1',
      snapshot: null,
      operation_id: null,
      writer_id: null,
      activation_id: null,
      declared_at: null,
      status: 'idle',
      proof_refs: [],
      observations: {},
      canary: null,
      last_error: null
    };
  }

  function emptyState() {
    return {
      schema: HOST_SCHEMA,
      host_version: HOST_VERSION,
      revision: 0,
      updated_at: nowIso(),
      code_units: {},
      unit_versions: {},
      desired: emptyDesired(),
      committed: { current: null, last_known_good: null, stable: null, history: [] },
      observed: { registrations: { observed_at: null, user_scripts_available: null, scripts: [] }, pages: {} },
      activation_records: [],
      reconcile_records: [],
      evidence: [],
      plugin_data: {},
      migration: {
        next: { status: 'not_started', last_result: null },
        rc1_absorbed: false,
        control_plane_v3: { status: 'not_started', discarded_legacy_candidate_id: null }
      },
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

  function normalizeUnitManifest(value) {
    if (!isObject(value)) throw new Error('code unit manifest must be an object');
    const id = String(value.id || '').trim();
    const version = String(value.version || '').trim();
    const hash = String(value.hash || '').toLowerCase();
    const manifest = {
      schema: 'dcf.code_unit.v3',
      artifact_id: artifactId(hash),
      id,
      version,
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

  const api = {
    HOST_SCHEMA, HOST_VERSION, STATE_KEY, SCRIPT_PREFIX,
    nowIso, clone, isObject, canonical, canonicalJson, sha256Text, artifactId, unitKey, unitRefKey, scriptId, worldId, eventId,
    emptyDesired, emptyState, normalizeUnitManifest, verifyUnit, absorbRc1Product
  };
  root.DCFHostCore = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    require('./core-store');
    require('./core-snapshot');
    require('./core-state');
    require('./core-diagnostics');
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
