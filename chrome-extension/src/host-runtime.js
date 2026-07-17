'use strict';
(function initHostRuntime(root) {
  const H = root.DCFHost;
  const C = H.C;
  const CANDIDATE_TIMEOUT_MINUTES = 1;

  H.userScriptsApi = function userScriptsApi() {
    if (!chrome.userScripts || typeof chrome.userScripts.getScripts !== 'function') throw new Error('USER_SCRIPTS_PERMISSION_REQUIRED');
    return chrome.userScripts;
  };
  H.configureWorlds = async function configureWorlds(units) {
    const api = H.userScriptsApi();
    if (typeof api.configureWorld !== 'function') return;
    for (const worldId of [...new Set((units || []).map((unit) => unit.world_id))]) {
      await api.configureWorld({ worldId, messaging: true, csp: "script-src 'self'; object-src 'none'" });
    }
  };
  H.actualDcfScripts = async function actualDcfScripts() {
    const scripts = await H.userScriptsApi().getScripts();
    return scripts.filter((item) => String(item.id || '').startsWith(C.SCRIPT_PREFIX));
  };
  H.reconcileRegistrations = async function reconcileRegistrations(state, snapshot) {
    const api = H.userScriptsApi();
    const valid = C.validateSnapshot(state, snapshot);
    const units = valid.entries.filter((entry) => entry.enabled !== false).map((ref) => C.getUnit(state, ref.id, ref.version));
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
    if (missing.length || extra.length) throw new Error(`registration mismatch missing=${missing.join(',')} extra=${extra.join(',')}`);
    return { snapshot: valid, registered: [...found].sort(), updated: updates.length, added: additions.length, removed: removals.length };
  };

  H.chatGptTabs = function chatGptTabs() { return chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] }); };
  H.executeCandidateInOpenTabs = async function executeCandidateInOpenTabs() {
    const state = await H.storageGet();
    const snapshot = state.snapshots.candidate;
    if (!snapshot || !chrome.userScripts || typeof chrome.userScripts.execute !== 'function') return { executed: 0 };
    const tabs = await H.chatGptTabs();
    let executed = 0;
    for (const tab of tabs) {
      if (!tab.id) continue;
      for (const ref of snapshot.entries.filter((entry) => entry.enabled !== false)) {
        const unit = C.getUnit(state, ref.id, ref.version);
        try {
          await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: unit.code }], world: 'USER_SCRIPT', worldId: unit.world_id });
          executed += 1;
        } catch (error) {
          await H.mutate(async (next) => C.appendEvidence(next, { type: 'candidate.execute.failed', unit_id: ref.id, tab_id: tab.id, detail: String(error && error.message || error) }));
        }
      }
    }
    return { executed, tabs: tabs.length };
  };
  H.armCandidateEvidence = async function armCandidateEvidence() {
    if (!(await H.storageGet()).snapshots.candidate) return;
    await chrome.alarms.create('dcf-candidate-timeout', { delayInMinutes: CANDIDATE_TIMEOUT_MINUTES });
    await H.executeCandidateInOpenTabs();
  };
  H.candidateStartedSet = function candidateStartedSet(state) {
    const candidateId = state.snapshots.candidate && state.snapshots.candidate.id;
    return new Set((state.evidence || []).filter((event) => event.type === 'unit.started' && event.snapshot_id === candidateId).map((event) => event.unit_id));
  };
  H.maybeCommitCandidate = async function maybeCommitCandidate() {
    return H.mutate(async (state) => {
      const candidate = state.snapshots.candidate;
      if (!candidate) return { committed: false, reason: 'no_candidate' };
      const required = candidate.entries.filter((entry) => entry.enabled !== false).map((entry) => entry.id);
      const started = H.candidateStartedSet(state);
      const missing = required.filter((id) => !started.has(id));
      if (missing.length) return { committed: false, missing };
      if (state.snapshots.current) state.snapshots.history.push(C.clone(state.snapshots.current));
      state.snapshots.current = C.clone(candidate);
      state.snapshots.last_known_good = C.clone(candidate);
      state.snapshots.candidate = null;
      state.snapshots.history = state.snapshots.history.slice(-12);
      C.appendEvidence(state, { type: 'candidate.committed', snapshot_id: candidate.id, units: required });
      return { committed: true, snapshot_id: candidate.id };
    });
  };
  H.recordUnitStarted = async function recordUnitStarted(message, sender) {
    await H.mutate(async (state) => {
      const current = state.snapshots.candidate || state.snapshots.current;
      const ref = current && current.entries.find((entry) => entry.id === message.unit_id && entry.version === message.version);
      if (!ref) throw new Error(`unrecognized startup evidence ${message.unit_id}@${message.version}`);
      C.appendEvidence(state, { type: 'unit.started', snapshot_id: current.id, unit_id: message.unit_id, version: message.version, tab_id: sender && sender.tab && sender.tab.id || null, url: sender && sender.url ? new URL(sender.url).origin : null });
    });
    return H.maybeCommitCandidate();
  };
  H.rollbackToLastKnownGood = async function rollbackToLastKnownGood(reason) {
    const state = await H.storageGet();
    const snapshot = state.snapshots.last_known_good;
    if (!snapshot) {
      const actual = await H.actualDcfScripts().catch(() => []);
      if (actual.length && chrome.userScripts) await chrome.userScripts.unregister({ ids: actual.map((item) => item.id) });
      await H.mutate(async (next) => { next.snapshots.candidate = null; C.appendEvidence(next, { type: 'rollback.unavailable', reason }); });
      return { ok: false, status: 'no_last_known_good' };
    }
    const result = await H.reconcileRegistrations(state, snapshot);
    await H.mutate(async (next) => { next.snapshots.current = C.clone(snapshot); next.snapshots.candidate = null; C.appendEvidence(next, { type: 'rollback.completed', reason, snapshot_id: snapshot.id }); });
    return { ok: true, result };
  };
  H.reconcileTarget = async function reconcileTarget(reason) {
    const state = await H.storageGet();
    const target = state.snapshots.candidate || state.snapshots.current || state.snapshots.last_known_good;
    if (!target) return { ok: false, status: 'no_snapshot' };
    try {
      const result = await H.reconcileRegistrations(state, target);
      await H.mutate(async (next) => C.appendEvidence(next, { type: 'registration.reconciled', reason, snapshot_id: target.id, result }));
      if (state.snapshots.candidate) await H.armCandidateEvidence();
      return { ok: true, status: state.snapshots.candidate ? 'candidate_pending_evidence' : 'current_restored', result };
    } catch (error) {
      const message = String(error && error.message || error);
      await H.mutate(async (next) => C.appendEvidence(next, { type: 'registration.failed', reason, detail: message }));
      if (state.snapshots.last_known_good) {
        try {
          await H.reconcileRegistrations(state, state.snapshots.last_known_good);
          await H.mutate(async (next) => { next.snapshots.candidate = null; next.snapshots.current = C.clone(next.snapshots.last_known_good); C.appendEvidence(next, { type: 'rollback.completed', reason: 'candidate-registration-failure', detail: message }); });
        } catch (rollbackError) {
          await H.mutate(async (next) => C.appendEvidence(next, { type: 'rollback.failed', detail: String(rollbackError && rollbackError.message || rollbackError) }));
        }
      }
      return { ok: false, status: message === 'USER_SCRIPTS_PERMISSION_REQUIRED' ? 'permission_required' : 'failed', error: message };
    }
  };
  H.stageSnapshotFromVersions = async function stageSnapshotFromVersions(versions, reason, options = {}) {
    return H.mutate(async (state) => {
      const base = options.replace === true ? { schema: 'dcf.startup.snapshot.v2', entries: [] } : (state.snapshots.current || state.snapshots.last_known_good || { schema: 'dcf.startup.snapshot.v2', entries: [] });
      const candidate = C.clone(base);
      for (const [id, version] of Object.entries(versions || {})) {
        const unit = C.getUnit(state, id, version);
        if (!unit) throw new Error(`missing ${C.unitKey(id, version)}`);
        const ref = candidate.entries.find((entry) => entry.id === id);
        const nextRef = { id, version, hash: unit.hash, enabled: unit.default_enabled !== false, phase: unit.phase };
        if (ref) Object.assign(ref, nextRef); else candidate.entries.push(nextRef);
      }
      candidate.id = `snapshot-${Date.now().toString(36)}`;
      candidate.created_at = C.nowIso();
      candidate.reason = reason;
      state.snapshots.candidate = C.validateSnapshot(state, candidate);
      C.appendEvidence(state, { type: 'candidate.staged', snapshot_id: candidate.id, reason, units: Object.entries(versions).map(([id, version]) => C.unitKey(id, version)) });
      return C.clone(candidate);
    });
  };
  H.setUnitEnabled = async function setUnitEnabled(id, enabled) {
    const state = await H.storageGet();
    const base = state.snapshots.current || state.snapshots.last_known_good;
    if (!base) throw new Error('no_snapshot_to_edit');
    const candidate = C.clone(base);
    const ref = candidate.entries.find((entry) => entry.id === id);
    if (!ref) throw new Error(`unit_not_installed:${id}`);
    ref.enabled = enabled !== false;
    candidate.id = `snapshot-${Date.now().toString(36)}`;
    candidate.created_at = C.nowIso();
    candidate.reason = `${ref.enabled ? 'enable' : 'disable'}-unit:${id}`;
    await H.mutate(async (next) => { next.snapshots.candidate = C.validateSnapshot(next, candidate); C.appendEvidence(next, { type: 'candidate.staged', reason: candidate.reason, snapshot_id: candidate.id }); });
    return H.reconcileTarget(candidate.reason);
  };
})(self);
