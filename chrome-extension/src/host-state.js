'use strict';
(function initHostState(root) {
  const C = root.DCFHostCore;
  const H = root.DCFHost = root.DCFHost || {};
  H.C = C;
  let mutationQueue = Promise.resolve();

  H.storageGet = async function storageGet() {
    const stored = await chrome.storage.local.get(C.STATE_KEY);
    return C.normalizeState(stored[C.STATE_KEY]);
  };
  H.storageSet = async function storageSet(state) {
    await chrome.storage.local.set({ [C.STATE_KEY]: C.normalizeState(state) });
  };
  H.mutate = function mutate(mutator) {
    const run = async () => {
      const previous = await H.storageGet();
      const next = C.clone(previous);
      const result = await mutator(next, previous);
      const committed = C.finalizeState(previous, next);
      await H.storageSet(committed);
      return { state: committed, result };
    };
    const task = mutationQueue.then(run, run);
    mutationQueue = task.then(() => undefined, () => undefined);
    return task;
  };
  H.pluginDataGet = async function pluginDataGet(pluginId) {
    const state = await H.storageGet();
    return C.clone(state.plugin_data[String(pluginId)] || {});
  };
  H.pluginDataSet = async function pluginDataSet(pluginId, data) {
    const id = String(pluginId || '').trim();
    if (!id) throw new Error('plugin_id_required');
    if (!C.isObject(data)) throw new Error('plugin_data_must_be_object');
    return H.mutate(async (state) => {
      state.plugin_data[id] = C.clone(data);
      C.appendEvidence(state, { type: 'plugin.data.saved', plugin_id: id });
      return C.clone(state.plugin_data[id]);
    });
  };
  H.exportBackup = async function exportBackup() {
    const state = await H.storageGet();
    return {
      schema: 'dcf.chrome.backup.v1', exported_at: C.nowIso(), host_version: C.HOST_VERSION,
      plugin_data: C.clone(state.plugin_data), snapshots: { current: C.clone(state.snapshots.current), last_known_good: C.clone(state.snapshots.last_known_good) }
    };
  };
  H.importBackup = async function importBackup(payload) {
    if (!payload || payload.schema !== 'dcf.chrome.backup.v1' || !C.isObject(payload.plugin_data)) throw new Error('invalid_backup');
    return H.mutate(async (state) => {
      state.backups.push({ at: C.nowIso(), plugin_data: C.clone(state.plugin_data) });
      state.backups = state.backups.slice(-3);
      state.plugin_data = C.clone(payload.plugin_data);
      C.appendEvidence(state, { type: 'backup.imported', plugins: Object.keys(state.plugin_data).sort() });
      return { plugins: Object.keys(state.plugin_data).length };
    });
  };
})(self);
