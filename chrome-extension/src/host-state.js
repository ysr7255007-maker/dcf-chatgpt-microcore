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
  H.mutate = function mutate(mutator, options = {}) {
    const run = async () => {
      const previous = await H.storageGet();
      if (options.expected_revision != null && Number(options.expected_revision) !== previous.revision) {
        throw new Error(`revision_conflict expected=${options.expected_revision} actual=${previous.revision}`);
      }
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
  H.semanticCommand = function semanticCommand(name, input, handler) {
    const operationId = String(input && input.operation_id || `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    return H.mutate(async (state, previous) => {
      const duplicate = (state.evidence || []).find((event) => event.operation_id === operationId && event.type === `${name}.completed`);
      if (duplicate) return C.clone(duplicate.result || { status: 'already_completed' });
      const result = await handler(state, previous, operationId);
      C.appendEvidence(state, { type: `${name}.completed`, operation_id: operationId, result: C.clone(result || {}) });
      return result;
    }, { expected_revision: input && input.expected_revision });
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
      schema: 'dcf.chrome.backup.v2',
      exported_at: C.nowIso(),
      host_version: C.HOST_VERSION,
      plugin_data: C.clone(state.plugin_data),
      committed: C.clone(state.control.committed)
    };
  };
  H.importBackup = async function importBackup(payload) {
    if (!payload || !['dcf.chrome.backup.v1', 'dcf.chrome.backup.v2'].includes(payload.schema) || !C.isObject(payload.plugin_data)) throw new Error('invalid_backup');
    return H.mutate(async (state) => {
      state.backups.push({ at: C.nowIso(), plugin_data: C.clone(state.plugin_data) });
      state.backups = state.backups.slice(-3);
      state.plugin_data = C.clone(payload.plugin_data);
      C.appendEvidence(state, { type: 'backup.imported', plugins: Object.keys(state.plugin_data).sort() });
      return { plugins: Object.keys(state.plugin_data).length };
    });
  };
})(self);
