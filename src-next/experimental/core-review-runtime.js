'use strict';

const { CORE_REVIEW_VERSION } = require('./core-review-constants');
const { clone, nowIso, createCoreStorage, sanitizeState } = require('./core-review-storage');
const { createDynamicModuleRuntime } = require('./core-review-modules');
const { installPluginPack, pluginCatalog, buildSnapshot, snapshotFromManifest } = require('./core-review-pack');
const { createRecoveryRenderer } = require('./core-review-ui');

function createCoreReview(options = {}) {
  const storage = options.storage || createCoreStorage();
  const platform = options.platform || { window: globalThis.window, document: globalThis.document };
  let state = sanitizeState(storage.getState(null));
  const startedApis = new Map();
  const save = () => storage.setState(state);
  const reload = () => platform.window.location.reload();
  const setState = (next) => { state = next; };
  const recovery = createRecoveryRenderer({ platform, storage, getState: () => state, setState, save, reload });

  const currentManifest = () => (state.current_snapshot?.plugins || []).map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: plugin.enabled !== false }));
  const lastKnownGoodManifest = () => (state.last_known_good_snapshot?.plugins || []).map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: plugin.enabled !== false }));
  const publicRuntime = () => ({ get: (id) => startedApis.get(id) || null, has: (id) => startedApis.has(id), list: () => Array.from(startedApis.keys()) });
  const availablePlugins = () => pluginCatalog(state).map((plugin) => ({ id: plugin.id, version: plugin.version, title: plugin.id, description: '', pack_id: plugin.pack_id }));

  function setManifest(manifest, { restart = true } = {}) {
    state.current_snapshot = snapshotFromManifest(state, storage, manifest, state.current_snapshot);
    state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle'; save();
    if (restart) reload();
    return currentManifest();
  }
  function survivalApi() {
    return {
      version: CORE_REVIEW_VERSION,
      currentManifest,
      lastKnownGoodManifest,
      availablePlugins,
      setManifest,
      restart: reload,
      enterSafeMode(reason = 'requested_by_plugin') { state.force_recovery = true; state.recovery_reason = reason; save(); reload(); },
      stateSnapshot: () => clone(state)
    };
  }

  async function boot() {
    state = sanitizeState(storage.getState(null));
    startedApis.clear();
    if (state.force_recovery) { recovery.render(state.recovery_reason || 'forced_recovery'); return { ok: false, recovery: true }; }
    if (state.boot.status === 'starting') {
      state.force_recovery = true; state.recovery_reason = 'incomplete_previous_boot'; save();
      recovery.render('incomplete_previous_boot'); return { ok: false, recovery: true };
    }
    if (!state.current_snapshot) { recovery.render('no_snapshot'); return { ok: false, recovery: true }; }

    const snapshot = state.current_snapshot;
    const expectedHashes = Object.fromEntries((snapshot.modules || []).map((unit) => [unit.id, unit.sha256]));
    const runtime = createDynamicModuleRuntime({ readUnit: (id) => storage.readModule(id), expectedHashes });
    state.boot = { status: 'starting', attempt_id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, started_at: nowIso(), completed_at: null, plugins: [], error: null };
    save();

    for (const entry of snapshot.plugins || []) {
      if (entry.enabled === false) { state.boot.plugins.push({ id: entry.id, version: entry.version, status: 'disabled' }); save(); continue; }
      const status = { id: entry.id, version: entry.version, status: 'starting', started_at: nowIso() };
      state.boot.plugins.push(status); save();
      try {
        const exported = runtime.load(entry.entry);
        const factory = exported?.[entry.factory];
        if (typeof factory !== 'function') throw new Error(`plugin_factory_missing:${entry.factory}`);
        const definition = factory();
        if (definition?.id !== entry.id || definition?.version !== entry.version || typeof definition.start !== 'function') throw new Error('plugin_definition_mismatch');
        const api = await definition.start({
          plugin: { id: definition.id, version: definition.version, title: definition.title || definition.id },
          platform,
          storage: storage.scope(definition.id),
          rawStorage: storage,
          plugins: publicRuntime(),
          survival: survivalApi()
        });
        startedApis.set(definition.id, api || Object.freeze({}));
        status.status = 'started'; status.completed_at = nowIso(); save();
      } catch (error) {
        status.status = 'failed'; status.completed_at = nowIso(); status.error = error?.message || String(error);
        state.boot.status = 'failed'; state.boot.error = { plugin_id: entry.id, message: status.error };
        state.force_recovery = true; state.recovery_reason = 'plugin_start_failed'; save();
        recovery.render(`plugin_start_failed:${entry.id}`);
        return { ok: false, recovery: true, error: state.boot.error };
      }
    }

    state.boot.status = 'completed'; state.boot.completed_at = nowIso();
    state.last_known_good_snapshot = clone(snapshot);
    state.force_recovery = false; state.recovery_reason = null; save();
    recovery.render('running');
    return { ok: true, started: Array.from(startedApis.keys()), snapshot: snapshot.id };
  }

  return {
    boot,
    state: () => clone(state),
    storage,
    importBundle: async (bundle) => { const result = await installPluginPack(bundle, storage, state); state = sanitizeState(storage.getState(null)); return result; },
    activateRecommendation(packId, name, { restart = true } = {}) {
      state.current_snapshot = buildSnapshot(state, storage, packId, name);
      state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle'; save();
      if (restart) reload();
      return clone(state.current_snapshot);
    },
    setManifest,
    renderRecovery: recovery.render,
    runtime: publicRuntime()
  };
}

module.exports = { createCoreReview };
