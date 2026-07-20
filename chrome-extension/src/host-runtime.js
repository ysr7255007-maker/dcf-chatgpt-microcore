'use strict';
(function initHostRuntime(root) {
  const H = root.DCFHost;
  const C = H.C;
  const CANDIDATE_TIMEOUT_MINUTES = 1;
  const EXECUTE_TIMEOUT_MS = 6000;
  const ENABLE_HARD_TIMEOUT_MS = 8000;

  H.withTimeout = function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label || 'operation'}_timed_out_after_${ms}ms`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

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
    let timedOut = 0;
    for (const tab of tabs) {
      if (!tab.id) continue;
      for (const ref of snapshot.entries.filter((entry) => entry.enabled !== false)) {
        const unit = C.getUnit(state, ref.id, ref.version);
        try {
          await H.withTimeout(
            chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: unit.code }], world: 'USER_SCRIPT', worldId: unit.world_id }),
            EXECUTE_TIMEOUT_MS,
            `execute_${ref.id}_tab${tab.id}`
          );
          executed += 1;
        } catch (error) {
          const message = String(error && error.message || error);
          if (message.includes('timed_out')) timedOut += 1;
          await H.mutate(async (next) => C.appendEvidence(next, { type: 'candidate.execute.failed', unit_id: ref.id, tab_id: tab.id, detail: message }));
        }
      }
    }
    return { executed, tabs: tabs.length, timedOut };
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
  H.setUnitEnabled = async function setUnitEnabled(id, enabled, senderTabId) {
    const state = await H.storageGet();
    const base = state.snapshots.current || state.snapshots.last_known_good;
    if (!base) throw new Error('no_snapshot_to_edit');
    const ref = base.entries.find((entry) => entry.id === id);
    if (!ref) throw new Error(`unit_not_installed:${id}`);
    const wantEnabled = enabled !== false;
    if (ref.enabled === wantEnabled) return { ok: true, status: 'unchanged', id, enabled: wantEnabled };

    // Step 1: commit the config fact directly to current + LKG (no candidate)
    await H.mutate(async (next) => {
      const target = next.snapshots.current || next.snapshots.last_known_good;
      const entry = target.entries.find((e) => e.id === id);
      if (entry) entry.enabled = wantEnabled;
      if (next.snapshots.current && next.snapshots.last_known_good) {
        const lkgEntry = next.snapshots.last_known_good.entries.find((e) => e.id === id);
        if (lkgEntry) lkgEntry.enabled = wantEnabled;
      }
      next.snapshots.candidate = null;
      C.appendEvidence(next, { type: 'unit.config_changed', unit_id: id, enabled: wantEnabled });
    });

    // Step 2: reconcile only the target unit's registration
    const api = H.userScriptsApi();
    const unit = C.getUnit(state, ref.id, ref.version);
    if (!unit) throw new Error(`unit_code_missing:${id}@${ref.version}`);
    try {
      if (wantEnabled) {
        await H.configureWorlds([unit]);
        const existing = await api.getScripts({ ids: [C.scriptId(id)] });
        const registration = C.registrationFor(unit);
        if (existing.length) await api.update([registration]);
        else await api.register([registration]);
      } else {
        await api.unregister({ ids: [C.scriptId(id)] }).catch(() => {});
      }
    } catch (regError) {
      return { ok: false, status: 'registration_failed', id, enabled: wantEnabled, error: String(regError && regError.message || regError) };
    }

    // Step 3: if enabling, try bounded hot-execute on the source tab only
    if (wantEnabled && chrome.userScripts && typeof chrome.userScripts.execute === 'function') {
      const tabId = senderTabId || null;
      if (tabId) {
        try {
          await H.withTimeout(
            chrome.userScripts.execute({ target: { tabId }, js: [{ code: unit.code }], world: 'USER_SCRIPT', worldId: unit.world_id }),
            EXECUTE_TIMEOUT_MS,
            `hot_enable_${id}`
          );
          return { ok: true, status: 'completed', id, enabled: true, hot_executed: true };
        } catch (_) {
          return { ok: true, status: 'reload_required', id, enabled: true, hot_executed: false, reason: 'hot_execute_timed_out_or_failed' };
        }
      }
      return { ok: true, status: 'reload_required', id, enabled: true, hot_executed: false, reason: 'no_source_tab' };
    }

    return { ok: true, status: 'completed', id, enabled: wantEnabled };
  };
})(self);
