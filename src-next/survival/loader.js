'use strict';

const { VERSION, STATE_SCHEMA } = require('./constants');
const { cloneManifest, sameManifest, normalizeManifest } = require('./manifest');
const { clone, nowIso } = require('../core/utils');

function defaultState(defaultManifest) {
  return {
    schema: STATE_SCHEMA,
    survival_version: VERSION,
    current_manifest: cloneManifest(defaultManifest),
    last_known_good_manifest: null,
    force_safe_mode: false,
    safe_mode_reason: null,
    boot: { status: 'idle', attempt_id: null, started_at: null, completed_at: null, plugins: [], error: null }
  };
}

function sanitizeState(raw, registry, defaultManifest) {
  const base = defaultState(defaultManifest);
  if (!raw || raw.schema !== STATE_SCHEMA) return base;
  const current = normalizeManifest(raw.current_manifest, registry, defaultManifest);
  const knownGood = Array.isArray(raw.last_known_good_manifest)
    ? normalizeManifest(raw.last_known_good_manifest, registry, defaultManifest)
    : null;
  return {
    ...base,
    ...raw,
    schema: STATE_SCHEMA,
    survival_version: VERSION,
    current_manifest: current,
    last_known_good_manifest: knownGood,
    force_safe_mode: raw.force_safe_mode === true,
    safe_mode_reason: raw.safe_mode_reason || null,
    boot: {
      ...base.boot,
      ...(raw.boot || {}),
      plugins: Array.isArray(raw.boot?.plugins) ? raw.boot.plugins : []
    }
  };
}

function createSurvivalLoader(options) {
  const {
    registry,
    storage,
    defaultManifest,
    renderRecovery,
    reload = () => globalThis.location.reload(),
    now = () => Date.now(),
    platform = { window: globalThis.window, document: globalThis.document }
  } = options;
  const startedApis = new Map();
  let state = sanitizeState(storage.getState(null), registry, defaultManifest);

  function save() { storage.setState(state); }
  function manifest() { return cloneManifest(state.current_manifest); }
  function setManifest(next, { restart = true } = {}) {
    const normalized = normalizeManifest(next, registry, defaultManifest);
    if (!normalized.length && next?.length) throw new Error('manifest_has_no_available_plugins');
    state.current_manifest = normalized;
    state.force_safe_mode = false;
    state.safe_mode_reason = null;
    state.boot.status = 'idle';
    save();
    if (restart) reload();
    return manifest();
  }


  function publicRuntime() {
    return {
      get: (id) => startedApis.get(id) || null,
      has: (id) => startedApis.has(id),
      list: () => Array.from(startedApis.keys())
    };
  }

  function survivalApi() {
    return {
      version: VERSION,
      currentManifest: manifest,
      lastKnownGoodManifest: () => cloneManifest(state.last_known_good_manifest || []),
      availablePlugins: () => registry.list().map((plugin) => ({ id: plugin.id, version: plugin.version, title: plugin.title || plugin.id, description: plugin.description || '' })),
      setManifest,
      restart: reload,
      enterSafeMode(reason = 'requested_by_plugin') {
        state.force_safe_mode = true;
        state.safe_mode_reason = reason;
        save();
        reload();
      },
      stateSnapshot: () => clone(state)
    };
  }

  function recoveryModel(reason) {
    return {
      version: VERSION,
      reason,
      state: clone(state),
      retry() {
        state.force_safe_mode = false;
        state.safe_mode_reason = null;
        state.boot.status = 'idle';
        state.boot.error = null;
        save(); reload();
      },
      skipFailed() {
        const failed = state.boot.plugins.find((item) => item.status === 'failed');
        if (failed) state.current_manifest = state.current_manifest.map((entry) => entry.id === failed.id ? { ...entry, enabled: false } : entry);
        state.force_safe_mode = false;
        state.safe_mode_reason = null;
        state.boot.status = 'idle';
        save(); reload();
      },
      loadKnownGood() {
        if (state.last_known_good_manifest) state.current_manifest = cloneManifest(state.last_known_good_manifest);
        state.force_safe_mode = false;
        state.safe_mode_reason = null;
        state.boot.status = 'idle';
        save(); reload();
      },
      loadMinimal() {
        state.current_manifest = state.current_manifest.map((entry) => ({ ...entry, enabled: false }));
        state.force_safe_mode = true;
        state.safe_mode_reason = 'minimal_combination';
        state.boot.status = 'idle';
        save(); reload();
      },
      diagnostics() {
        return JSON.stringify({
          schema: 'dcf.next.survival.diagnostics.v1',
          generated_at: nowIso(now),
          survival_version: VERSION,
          reason,
          current_manifest: state.current_manifest,
          last_known_good_manifest: state.last_known_good_manifest,
          boot: state.boot
        }, null, 2);
      }
    };
  }

  function enterRecovery(reason) {
    state.force_safe_mode = true;
    state.safe_mode_reason = reason;
    save();
    renderRecovery(recoveryModel(reason));
    return { ok: false, safe_mode: true, reason };
  }

  async function boot() {
    state = sanitizeState(storage.getState(null), registry, defaultManifest);
    if (state.force_safe_mode) return enterRecovery(state.safe_mode_reason || 'forced_safe_mode');
    if (state.boot.status === 'starting') return enterRecovery('incomplete_previous_boot');

    state.boot = {
      status: 'starting',
      attempt_id: `${now()}-${Math.random().toString(36).slice(2, 9)}`,
      started_at: nowIso(now),
      completed_at: null,
      plugins: [],
      error: null
    };
    save();

    for (const entry of state.current_manifest) {
      if (!entry.enabled) {
        state.boot.plugins.push({ ...entry, status: 'disabled' }); save(); continue;
      }
      const plugin = registry.get(entry.id, entry.version);
      if (!plugin) {
        state.boot.plugins.push({ ...entry, status: 'failed', error: 'plugin_not_found' });
        state.boot.status = 'failed';
        state.boot.error = { plugin_id: entry.id, message: 'plugin_not_found' };
        save();
        return enterRecovery('plugin_not_found');
      }
      const status = { ...entry, status: 'starting', started_at: nowIso(now) };
      state.boot.plugins.push(status); save();
      try {
        const api = await plugin.start({
          plugin: { id: plugin.id, version: plugin.version, title: plugin.title || plugin.id },
          platform,
          storage: storage.scope(plugin.id),
          rawStorage: storage,
          plugins: publicRuntime(),
          survival: survivalApi()
        });
        startedApis.set(plugin.id, api || Object.freeze({}));
        status.status = 'started';
        status.completed_at = nowIso(now);
        save();
      } catch (error) {
        const message = error?.message || String(error);
        status.status = 'failed';
        status.completed_at = nowIso(now);
        status.error = message;
        state.boot.status = 'failed';
        state.boot.error = { plugin_id: plugin.id, message };
        save();
        return enterRecovery('plugin_start_failed');
      }
    }

    state.boot.status = 'completed';
    state.boot.completed_at = nowIso(now);
    state.force_safe_mode = false;
    state.safe_mode_reason = null;
    if (!sameManifest(state.last_known_good_manifest, state.current_manifest)) state.last_known_good_manifest = cloneManifest(state.current_manifest);
    save();
    return { ok: true, safe_mode: false, started: Array.from(startedApis.keys()), manifest: manifest() };
  }

  return { boot, getState: () => clone(state), setManifest };
}

module.exports = { createSurvivalLoader, defaultState, sanitizeState };
