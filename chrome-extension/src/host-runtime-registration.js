'use strict';
(function initHostRuntimeRegistration(root) {
  const H = root.DCFHost;
  const C = H.C;
  const R = H.runtimeControl;
  H.withTimeout = function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label || 'operation'}_timed_out_after_${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  H.userScriptsApi = function userScriptsApi() {
    if (!chrome.userScripts || typeof chrome.userScripts.getScripts !== 'function') {
      throw new Error('USER_SCRIPTS_PERMISSION_REQUIRED');
    }
    return chrome.userScripts;
  };

  H.configureWorlds = async function configureWorlds(units) {
    const api = H.userScriptsApi();
    if (typeof api.configureWorld !== 'function') return;
    for (const worldId of [...new Set((units || []).map((unit) => unit.world_id))]) {
      await api.configureWorld({
        worldId,
        messaging: true,
        csp: "script-src 'self'; object-src 'none'"
      });
    }
  };

  H.actualDcfScripts = async function actualDcfScripts() {
    const scripts = await H.userScriptsApi().getScripts();
    return scripts.filter((item) => String(item.id || '').startsWith(C.SCRIPT_PREFIX));
  };

  H.observeRegistrations = async function observeRegistrations(userScriptsAvailable, scripts, operationId) {
    await H.mutate(async (state) => {
      state.observed.registrations = {
        observed_at: C.nowIso(),
        user_scripts_available: !!userScriptsAvailable,
        scripts: C.clone(scripts || [])
      };
      C.appendEvidence(state, {
        type: 'observation.recorded',
        operation_id: operationId || null,
        entity_id: 'registrations',
        observation_kind: 'registration',
        user_scripts_available: !!userScriptsAvailable,
        script_ids: (scripts || []).map((item) => item.id).sort()
      });
    });
  };

  H.reconcileRegistrations = async function reconcileRegistrations(state, snapshot, operationId) {
    const api = H.userScriptsApi();
    const valid = C.validateSnapshot(state, snapshot);
    const units = valid.entries
      .filter((entry) => entry.enabled !== false)
      .map((ref) => C.getUnit(state, ref.id, ref.version, ref.hash));
    await H.configureWorlds(units);
    const desired = units.map(C.registrationFor);
    const actual = await H.actualDcfScripts();
    const actualById = new Map(actual.map((item) => [item.id, item]));
    const desiredById = new Map(desired.map((item) => [item.id, item]));
    const updates = desired.filter((item) => actualById.has(item.id));
    const additions = desired.filter((item) => !actualById.has(item.id));
    const removals = actual.filter((item) => !desiredById.has(item.id)).map((item) => item.id);
    if (updates.length) await api.update(updates);
    if (additions.length) await api.register(additions);
    if (removals.length) await api.unregister({ ids: removals });
    const after = await H.actualDcfScripts();
    const expected = C.expectedScriptIds(valid);
    const found = new Set(after.map((item) => item.id));
    const missing = [...expected].filter((id) => !found.has(id));
    const extra = [...found].filter((id) => !expected.has(id));
    await H.observeRegistrations(true, after, operationId);
    if (missing.length || extra.length) {
      throw new Error(`registration mismatch missing=${missing.join(',')} extra=${extra.join(',')}`);
    }
    return {
      snapshot: valid,
      registered: [...found].sort(),
      updated: updates.length,
      added: additions.length,
      removed: removals.length
    };
  };

  H.chatGptTabs = function chatGptTabs() {
    return chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  };

  function isChatGptUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['chatgpt.com', 'chat.openai.com'].includes(url.hostname);
    } catch (_) {
      return false;
    }
  }

  function changedRefs(previous, next) {
    const before = new Map((previous && previous.entries || []).map((entry) => [entry.id, entry]));
    return (next && next.entries || []).filter((entry) => {
      const prior = before.get(entry.id);
      return !prior || prior.hash !== entry.hash || prior.enabled !== entry.enabled;
    });
  }

  function proofRefs(previous, next) {
    const before = new Map((previous && previous.entries || []).map((entry) => [entry.id, entry]));
    return (next && next.entries || []).filter((entry) => {
      if (entry.enabled === false) return false;
      const prior = before.get(entry.id);
      return !prior || prior.hash !== entry.hash || prior.enabled === false;
    });
  }

  function activationRecord(state, activationId) {
    return (state.activation_records || []).find((record) => record.activation_id === activationId) || null;
  }

  function patchActivationRecord(state, activationId, patch) {
    const record = activationRecord(state, activationId);
    if (record) Object.assign(record, C.clone(patch || {}));
    return record;
  }

  async function finishReconcile(recordId, status, actions, error) {
    await H.mutate(async (state) => {
      const record = (state.reconcile_records || []).find((item) => item.reconcile_id === recordId);
      if (record) {
        record.status = status;
        record.completed_at = C.nowIso();
        record.actions = C.clone(actions || record.actions || []);
        record.error = error ? String(error) : null;
        record.after_revision = Number(state.revision || 0) + 1;
      }
      C.appendEvidence(state, {
        type: 'reconcile.completed',
        operation_id: record && record.operation_id || null,
        entity_id: recordId,
        status,
        actions: C.clone(actions || []),
        detail: error ? String(error) : null
      });
    });
  }

  async function startReconcile(reason, writerId) {
    const reconcileId = C.eventId('reconcile');
    const operationId = C.eventId('operation');
    await H.mutate(async (state) => {
      state.reconcile_records.push({
        schema: 'dcf.reconcile.record.v1',
        reconcile_id: reconcileId,
        operation_id: operationId,
        writer_id: writerId || 'dcf.chrome.host',
        reason: String(reason || 'unspecified'),
        desired_snapshot_id: state.desired.snapshot && state.desired.snapshot.id || null,
        committed_snapshot_id: state.committed.current && state.committed.current.id || null,
        status: 'running',
        started_at: C.nowIso(),
        completed_at: null,
        actions: [],
        error: null,
        before_revision: state.revision,
        after_revision: null
      });
      state.reconcile_records = state.reconcile_records.slice(-80);
      C.appendEvidence(state, {
        type: 'reconcile.started',
        operation_id: operationId,
        entity_id: reconcileId,
        reason: String(reason || 'unspecified')
      });
    });
    return { reconcileId, operationId };
  }

  Object.assign(R, { isChatGptUrl, changedRefs, proofRefs, activationRecord, patchActivationRecord, finishReconcile, startReconcile });
})(self);
