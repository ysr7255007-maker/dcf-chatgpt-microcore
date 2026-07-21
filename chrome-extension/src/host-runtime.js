'use strict';
(function initHostRuntime(root) {
  const H = root.DCFHost;
  const C = H.C;
  const EXECUTE_TIMEOUT_MS = 7000;
  const CANARY_READY_TIMEOUT_MS = 12000;
  const CANARY_RETRY_MINUTES = 1;
  let reconcileQueue = Promise.resolve();

  H.withTimeout = function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label || 'operation'}_timed_out_after_${ms}ms`)), ms);
    });
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
    const units = valid.entries.filter((entry) => entry.enabled !== false).map((ref) => {
      const unit = C.getUnitByRef(state, ref);
      if (!unit) throw new Error(`unit_missing:${C.unitKey(ref.id, ref.hash)}`);
      return unit;
    });
    await H.configureWorlds(units);
    const desired = units.map((unit) => C.registrationFor(unit, valid.id, 'page'));
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
    if (missing.length || extra.length) throw new Error(`registration_mismatch missing=${missing.join(',')} extra=${extra.join(',')}`);
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
  function conversationId(url) {
    try {
      const match = new URL(String(url || '')).pathname.match(/^\/c\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }
  async function tabExists(tabId) {
    if (!tabId) return null;
    if (chrome.tabs && typeof chrome.tabs.get === 'function') {
      try { return await chrome.tabs.get(tabId); } catch (_) { return null; }
    }
    const tabs = await H.chatGptTabs();
    return tabs.find((tab) => tab.id === tabId) || null;
  }
  async function waitForTabReady(tabId) {
    const started = Date.now();
    while (Date.now() - started < CANARY_READY_TIMEOUT_MS) {
      const tab = await tabExists(tabId);
      if (!tab) throw new Error('canary_tab_disappeared');
      if (!tab.status || tab.status === 'complete') return tab;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('canary_page_ready_timeout');
  }
  function canaryUrl(snapshotId) {
    return `https://chatgpt.com/?dcf_canary=${encodeURIComponent(snapshotId)}`;
  }
  H.ensureCanary = async function ensureCanary(snapshot) {
    const state = await H.storageGet();
    const existing = state.control.canary;
    if (existing.tab_id && existing.snapshot_id === snapshot.id) {
      const tab = await tabExists(existing.tab_id);
      if (tab) {
        await waitForTabReady(existing.tab_id);
        return { tab_id: existing.tab_id, reused: true };
      }
    }
    if (existing.tab_id && chrome.tabs && typeof chrome.tabs.remove === 'function') {
      await chrome.tabs.remove(existing.tab_id).catch(() => undefined);
    }
    const tab = await chrome.tabs.create({ url: canaryUrl(snapshot.id), active: false });
    if (!tab || !tab.id) throw new Error('canary_tab_creation_failed');
    await H.mutate(async (next) => {
      next.control.canary = {
        tab_id: tab.id,
        snapshot_id: snapshot.id,
        status: 'loading',
        last_seen_at: C.nowIso(),
        attempts: Number(existing.attempts || 0) + 1,
        error: null
      };
      C.upsertActivationRecord(next, snapshot.id, {
        status: 'proving',
        canary_tab_id: tab.id,
        proving_at: C.nowIso()
      });
      C.appendEvidence(next, { type: 'canary.created', snapshot_id: snapshot.id, tab_id: tab.id });
    });
    await waitForTabReady(tab.id);
    await H.mutate(async (next) => {
      if (next.control.canary.tab_id === tab.id) {
        next.control.canary.status = 'ready';
        next.control.canary.last_seen_at = C.nowIso();
      }
      C.appendEvidence(next, { type: 'canary.ready', snapshot_id: snapshot.id, tab_id: tab.id });
    });
    return { tab_id: tab.id, reused: false };
  };

  function runtimeKey(tabId) { return `tab:${String(tabId == null ? 'unknown' : tabId)}`; }
  function runtimeStateRank(value) {
    return { loaded: 1, ready: 2, degraded: 3, failed: 4 }[value] || 0;
  }
  H.recordRuntimeObservation = async function recordRuntimeObservation(message, sender, options = {}) {
    const runtimeState = String(message && message.runtime_state || '').toLowerCase();
    if (!['loaded', 'ready', 'degraded', 'failed'].includes(runtimeState)) throw new Error(`invalid_runtime_state:${runtimeState}`);
    const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : (message.tab_id == null ? null : Number(message.tab_id));
    const senderUrl = sender && sender.url || message.url || '';
    const result = await H.mutate(async (state) => {
      const candidates = [
        state.control.desired_snapshot,
        state.control.committed.current,
        state.control.committed.last_known_good,
        state.control.committed.stable
      ].filter(Boolean);
      const requestedSnapshot = String(message.snapshot_id || '');
      const snapshot = candidates.find((item) => item.id === requestedSnapshot)
        || candidates.find((item) => item.entries.some((entry) => entry.id === message.unit_id && (!message.version || entry.version === message.version)))
        || null;
      if (!snapshot) {
        C.appendEvidence(state, {
          type: 'runtime.observation.rejected',
          detail: 'snapshot_unrecognized',
          unit_id: String(message.unit_id || ''),
          snapshot_id: requestedSnapshot,
          tab_id: tabId
        });
        return { accepted: false, reason: 'snapshot_unrecognized' };
      }
      const ref = snapshot.entries.find((entry) => entry.id === message.unit_id
        && (!message.content_hash || entry.hash === String(message.content_hash).replace(/^sha256:/, '').toLowerCase())
        && (!message.version || entry.version === String(message.version)));
      if (!ref) {
        C.appendEvidence(state, {
          type: 'runtime.observation.rejected',
          detail: 'unit_identity_mismatch',
          unit_id: String(message.unit_id || ''),
          snapshot_id: snapshot.id,
          tab_id: tabId
        });
        return { accepted: false, reason: 'unit_identity_mismatch' };
      }
      const key = runtimeKey(tabId);
      const previous = state.control.page_runtimes[key] || {};
      const role = state.control.canary.tab_id === tabId && state.control.canary.snapshot_id === snapshot.id
        ? 'canary'
        : String(message.role || previous.role || 'page');
      const pageInstanceId = String(message.page_instance_id || previous.page_instance_id || key);
      const units = C.isObject(previous.units) ? previous.units : {};
      const priorUnit = units[ref.id];
      const old = priorUnit
        && priorUnit.content_hash === ref.hash
        && previous.observed_snapshot === snapshot.id
        ? priorUnit
        : null;
      const nextUnit = {
        content_hash: ref.hash,
        content_id: C.contentId(ref.hash),
        version: ref.version,
        state: runtimeStateRank(runtimeState) >= runtimeStateRank(old && old.state) ? runtimeState : old.state,
        detail: String(message.detail || message.error || ''),
        observed_at: C.nowIso()
      };
      const duplicate = old
        && old.content_hash === nextUnit.content_hash
        && old.state === nextUnit.state
        && old.detail === nextUnit.detail
        && previous.observed_snapshot === snapshot.id
        && previous.page_instance_id === pageInstanceId;
      units[ref.id] = nextUnit;
      state.control.page_runtimes[key] = {
        tab_id: tabId,
        page_instance_id: String(pageInstanceId).startsWith('host:')
          && previous.page_instance_id
          && !String(previous.page_instance_id).startsWith('host:')
          ? previous.page_instance_id
          : pageInstanceId,
        conversation_id: conversationId(senderUrl) || previous.conversation_id || null,
        role,
        observed_snapshot: snapshot.id,
        units,
        migration_status: role === 'canary' ? 'proving' : String(previous.migration_status || 'observed'),
        last_seen_at: C.nowIso()
      };
      if (role === 'canary') {
        const record = C.upsertActivationRecord(state, snapshot.id, {});
        const field = `${runtimeState}_units`;
        const list = Array.isArray(record[field]) ? record[field] : [];
        if (!list.includes(ref.id)) list.push(ref.id);
        record[field] = list.sort();
        state.control.canary.status = runtimeState === 'failed' ? 'failed' : 'proving';
        state.control.canary.last_seen_at = C.nowIso();
        state.control.canary.error = runtimeState === 'failed' ? nextUnit.detail || `${ref.id}_failed` : null;
      }
      if (!duplicate) {
        C.appendEvidence(state, {
          type: `runtime.${runtimeState}`,
          snapshot_id: snapshot.id,
          unit_id: ref.id,
          content_hash: ref.hash,
          version: ref.version,
          tab_id: tabId,
          page_instance_id: pageInstanceId,
          role,
          observed_via: String(message.observed_via || 'page_message'),
          detail: nextUnit.detail || undefined
        });
      }
      return { accepted: true, role, snapshot_id: snapshot.id, unit_id: ref.id, runtime_state: runtimeState };
    });
    if (!options.suppress_reconcile && result.result && result.result.accepted && result.result.role === 'canary') {
      Promise.resolve().then(() => H.reconcileControlPlane('runtime-observation')).catch(() => undefined);
    }
    return result;
  };

  function resolveLegacyUnitSignal(state, message, sender) {
    const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;
    const runtime = tabId == null ? null : state.control.page_runtimes[runtimeKey(tabId)];
    const snapshots = [
      state.control.desired_snapshot,
      state.control.committed.current,
      state.control.committed.last_known_good,
      state.control.committed.stable
    ].filter(Boolean);
    if (runtime && runtime.observed_snapshot) {
      const snapshot = snapshots.find((item) => item.id === runtime.observed_snapshot);
      const observed = runtime.units && runtime.units[String(message.unit_id || '')];
      const ref = snapshot && observed && snapshot.entries.find((entry) => entry.id === message.unit_id
        && entry.hash === observed.content_hash
        && (!message.version || entry.version === String(message.version)));
      if (snapshot && ref) return { snapshot, ref, source: 'page_runtime' };
    }
    const requestedSnapshotId = String(message.snapshot_id || '');
    const requestedHash = String(message.content_hash || '').replace(/^sha256:/, '').toLowerCase();
    if (requestedSnapshotId || requestedHash) {
      const snapshot = requestedSnapshotId ? snapshots.find((item) => item.id === requestedSnapshotId) : null;
      const candidates = snapshot ? [snapshot] : snapshots;
      for (const item of candidates) {
        const ref = item.entries.find((entry) => entry.id === message.unit_id
          && (!message.version || entry.version === String(message.version))
          && (!requestedHash || entry.hash === requestedHash));
        if (ref) return { snapshot: item, ref, source: 'explicit_identity' };
      }
    }
    const unique = new Map();
    for (const snapshot of snapshots) {
      const ref = snapshot.entries.find((entry) => entry.id === message.unit_id
        && (!message.version || entry.version === String(message.version)));
      if (ref) unique.set(`${ref.id}@${ref.hash}`, { snapshot, ref, source: 'unique_legacy_identity' });
    }
    return unique.size === 1 ? [...unique.values()][0] : null;
  }

  H.recordUnitStarted = async function recordUnitStarted(message, sender) {
    const state = await H.storageGet();
    const resolved = resolveLegacyUnitSignal(state, message, sender);
    if (!resolved) throw new Error(`ambiguous_or_unrecognized_startup_evidence:${message.unit_id}@${message.version || ''}`);
    return H.recordRuntimeObservation({
      type: 'runtime.observed',
      runtime_state: 'ready',
      unit_id: resolved.ref.id,
      version: resolved.ref.version,
      content_hash: resolved.ref.hash,
      snapshot_id: resolved.snapshot.id,
      page_instance_id: message.page_instance_id || '',
      observed_via: `unit.started:${resolved.source}`
    }, sender);
  };
  H.recordUnitFailed = async function recordUnitFailed(message, sender) {
    const state = await H.storageGet();
    const resolved = resolveLegacyUnitSignal(state, message, sender);
    if (!resolved) {
      await H.mutate(async (next) => C.appendEvidence(next, {
        type: 'runtime.failed.unroutable',
        unit_id: String(message.unit_id || ''),
        version: String(message.version || ''),
        detail: String(message.error || 'unknown'),
        tab_id: sender && sender.tab && sender.tab.id || null
      }));
      return { accepted: false, reason: 'ambiguous_or_unroutable' };
    }
    return H.recordRuntimeObservation({
      type: 'runtime.observed',
      runtime_state: 'failed',
      unit_id: resolved.ref.id,
      version: resolved.ref.version,
      content_hash: resolved.ref.hash,
      snapshot_id: resolved.snapshot.id,
      page_instance_id: message.page_instance_id || '',
      observed_via: `unit.failed:${resolved.source}`,
      detail: String(message.error || 'unknown')
    }, sender);
  };

  function canaryRuntime(state, snapshot) {
    const tabId = state.control.canary.tab_id;
    return state.control.page_runtimes[runtimeKey(tabId)] || null;
  }
  function canaryProof(state, snapshot) {
    const runtime = canaryRuntime(state, snapshot);
    const enabled = snapshot.entries.filter((entry) => entry.enabled !== false);
    const loaded = [];
    const ready = [];
    const degraded = [];
    const failed = [];
    const blockingFailed = [];
    const missing = [];
    for (const ref of enabled) {
      const observed = runtime && runtime.observed_snapshot === snapshot.id && runtime.units && runtime.units[ref.id];
      const identityMatches = observed && observed.content_hash === ref.hash;
      if (identityMatches && runtimeStateRank(observed.state) >= runtimeStateRank('loaded')) loaded.push(ref.id);
      if (identityMatches && observed.state === 'ready') ready.push(ref.id);
      if (identityMatches && observed.state === 'degraded') degraded.push(ref.id);
      if (identityMatches && observed.state === 'failed') failed.push(ref.id);
      if (ref.required !== false) {
        if (identityMatches && observed.state === 'failed') blockingFailed.push(ref.id);
        const requirementMet = identityMatches && (ref.activation_requirement === 'ready'
          ? ['ready', 'degraded'].includes(observed.state)
          : runtimeStateRank(observed.state) >= runtimeStateRank('loaded') && observed.state !== 'failed');
        if (!requirementMet) missing.push(ref.id);
      }
    }
    return {
      required: enabled.filter((entry) => entry.required !== false).map((entry) => entry.id),
      loaded,
      ready,
      degraded,
      failed,
      blocking_failed: blockingFailed,
      optional_failed: failed.filter((id) => !blockingFailed.includes(id)),
      missing
    };
  }

  H.executeSnapshotInTab = async function executeSnapshotInTab(snapshot, tabId, role) {
    const state = await H.storageGet();
    const valid = C.validateSnapshot(state, snapshot);
    const units = valid.entries.filter((entry) => entry.enabled !== false).map((entry) => C.getUnitByRef(state, entry));
    await H.configureWorlds(units);
    const results = [];
    for (const unit of units) {
      const current = await H.storageGet();
      const existing = current.control.page_runtimes[runtimeKey(tabId)];
      const observed = existing && existing.observed_snapshot === valid.id && existing.units && existing.units[unit.id];
      if (observed && observed.content_hash === unit.hash && runtimeStateRank(observed.state) >= runtimeStateRank('loaded')) {
        results.push({ unit_id: unit.id, status: 'already_observed' });
        continue;
      }
      try {
        await H.withTimeout(
          chrome.userScripts.execute({
            target: { tabId },
            js: [{ code: unit.code }, { code: C.observationPrelude(unit, valid.id, role) }],
            world: 'USER_SCRIPT',
            worldId: unit.world_id
          }),
          EXECUTE_TIMEOUT_MS,
          `execute_${role}_${unit.id}_tab${tabId}`
        );
        await H.recordRuntimeObservation({
          type: 'runtime.observed',
          runtime_state: 'loaded',
          unit_id: unit.id,
          version: unit.version,
          content_hash: unit.hash,
          snapshot_id: valid.id,
          role,
          page_instance_id: `host:${tabId}`,
          observed_via: 'chrome.userScripts.execute'
        }, { tab: { id: tabId }, url: role === 'canary' ? canaryUrl(valid.id) : '' }, { suppress_reconcile: true });
        results.push({ unit_id: unit.id, status: 'loaded' });
      } catch (error) {
        const detail = String(error && error.message || error);
        const timedOut = detail.includes('_timed_out_after_');
        await H.mutate(async (next) => C.appendEvidence(next, {
          type: timedOut ? 'runtime.execute_timed_out' : 'runtime.execute_failed',
          snapshot_id: valid.id,
          unit_id: unit.id,
          content_hash: unit.hash,
          tab_id: tabId,
          role,
          detail
        }));
        if (!timedOut) {
          await H.recordRuntimeObservation({
            type: 'runtime.observed',
            runtime_state: 'failed',
            unit_id: unit.id,
            version: unit.version,
            content_hash: unit.hash,
            snapshot_id: valid.id,
            role,
            page_instance_id: `host:${tabId}`,
            observed_via: 'chrome.userScripts.execute',
            detail
          }, { tab: { id: tabId }, url: role === 'canary' ? canaryUrl(valid.id) : '' }, { suppress_reconcile: true });
        }
        results.push({ unit_id: unit.id, status: timedOut ? 'timed_out' : 'failed', detail });
      }
    }
    return results;
  };

  H.declareDesiredSnapshot = async function declareDesiredSnapshot(snapshot, reason, operationId) {
    return H.mutate(async (state) => {
      const desired = C.validateSnapshot(state, { ...snapshot, reason: reason || snapshot.reason });
      const unchanged = state.control.desired_snapshot && C.sameSnapshot(state.control.desired_snapshot, desired);
      state.control.desired_snapshot = desired;
      const record = C.upsertActivationRecord(state, desired.id, {
        status: 'declared',
        reason: String(reason || desired.reason || 'unspecified'),
        operation_id: operationId || null,
        previous_current_snapshot_id: state.control.committed.current && state.control.committed.current.id || null
      });
      C.appendEvidence(state, {
        type: 'desired.declared',
        operation_id: operationId || undefined,
        snapshot_id: desired.id,
        unchanged
      });
      return { desired: C.clone(desired), unchanged, activation_id: record.activation_id };
    });
  };

  H.stageSnapshotFromUnits = async function stageSnapshotFromUnits(units, reason, options = {}) {
    const state = await H.storageGet();
    const base = options.replace === true
      ? { schema: 'dcf.startup.snapshot.v3', entries: [] }
      : (state.control.desired_snapshot || state.control.committed.current || state.control.committed.last_known_good || { schema: 'dcf.startup.snapshot.v3', entries: [] });
    const candidate = C.clone(base);
    for (const unit of units || []) {
      const stored = C.getUnit(state, unit.id, unit.hash);
      if (!stored) throw new Error(`missing:${C.unitKey(unit.id, unit.hash)}`);
      const ref = candidate.entries.find((entry) => entry.id === unit.id);
      const nextRef = {
        id: unit.id,
        version: unit.version,
        hash: unit.hash,
        enabled: unit.default_enabled !== false,
        phase: unit.phase,
        required: unit.required !== false,
        activation_requirement: unit.activation_requirement === 'ready' ? 'ready' : 'loaded'
      };
      if (ref) Object.assign(ref, nextRef); else candidate.entries.push(nextRef);
    }
    delete candidate.id;
    candidate.created_at = C.nowIso();
    candidate.reason = reason;
    const desired = C.normalizeSnapshot(candidate);
    return H.declareDesiredSnapshot(desired, reason, options.operation_id);
  };
  H.stageSnapshotFromVersions = async function stageSnapshotFromVersions(versions, reason, options = {}) {
    const state = await H.storageGet();
    const units = Object.entries(versions || {}).map(([id, version]) => {
      const unit = C.getUnit(state, id, version);
      if (!unit) throw new Error(`ambiguous_or_missing_version:${C.unitVersionKey(id, version)}`);
      return unit;
    });
    return H.stageSnapshotFromUnits(units, reason, options);
  };

  async function restoreCommittedRegistrations(reason) {
    const state = await H.storageGet();
    const target = state.control.committed.current || state.control.committed.last_known_good;
    if (!target) {
      const actual = await H.actualDcfScripts().catch(() => []);
      if (actual.length) await H.userScriptsApi().unregister({ ids: actual.map((item) => item.id) }).catch(() => undefined);
      return { status: 'no_committed_snapshot' };
    }
    const result = await H.reconcileRegistrations(state, target);
    await H.mutate(async (next) => C.appendEvidence(next, {
      type: 'registration.reconciled',
      reason,
      snapshot_id: target.id,
      committed: true,
      result
    }));
    return result;
  }

  async function closeCanary(snapshotId, tabId, status) {
    if (tabId && chrome.tabs && typeof chrome.tabs.remove === 'function') await chrome.tabs.remove(tabId).catch(() => undefined);
    await H.mutate(async (state) => {
      if (state.control.canary.snapshot_id === snapshotId) {
        state.control.canary = {
          tab_id: null,
          snapshot_id: null,
          status: status || 'idle',
          last_seen_at: C.nowIso(),
          attempts: state.control.canary.attempts || 0,
          error: state.control.canary.error || null
        };
      }
      C.appendEvidence(state, { type: 'canary.closed', snapshot_id: snapshotId, tab_id: tabId, status: status || 'idle' });
    });
  }

  H.migrateOpenPages = async function migrateOpenPages(snapshot, excludeTabId) {
    const tabs = await H.chatGptTabs();
    const results = [];
    for (const tab of tabs) {
      if (!tab.id || tab.id === excludeTabId) continue;
      const executed = await H.executeSnapshotInTab(snapshot, tab.id, 'migration');
      const failed = executed.filter((item) => ['failed', 'timed_out'].includes(item.status));
      const migrationStatus = failed.length ? 'reload_required' : 'migrated';
      await H.mutate(async (state) => {
        const key = runtimeKey(tab.id);
        const runtime = state.control.page_runtimes[key] || {
          tab_id: tab.id,
          page_instance_id: key,
          conversation_id: conversationId(tab.url),
          role: 'page',
          observed_snapshot: null,
          units: {}
        };
        runtime.migration_status = migrationStatus;
        runtime.last_seen_at = C.nowIso();
        state.control.page_runtimes[key] = runtime;
        C.appendEvidence(state, {
          type: migrationStatus === 'migrated' ? 'page.migration.completed' : 'page.migration.reload_required',
          snapshot_id: snapshot.id,
          tab_id: tab.id,
          failed_units: failed.map((item) => item.unit_id)
        });
      });
      results.push({ tab_id: tab.id, status: migrationStatus, failed_units: failed.map((item) => item.unit_id) });
    }
    return results;
  };

  H.markOpenPagesReloadRequired = async function markOpenPagesReloadRequired(snapshot, reason) {
    const tabs = await H.chatGptTabs();
    const results = [];
    for (const tab of tabs) {
      if (!tab.id) continue;
      await H.mutate(async (state) => {
        const key = runtimeKey(tab.id);
        const runtime = state.control.page_runtimes[key] || {
          tab_id: tab.id,
          page_instance_id: key,
          conversation_id: conversationId(tab.url),
          role: 'page',
          observed_snapshot: null,
          units: {}
        };
        runtime.migration_status = 'reload_required';
        runtime.last_seen_at = C.nowIso();
        state.control.page_runtimes[key] = runtime;
        C.appendEvidence(state, {
          type: 'page.migration.reload_required',
          snapshot_id: snapshot.id,
          tab_id: tab.id,
          reason: String(reason || 'runtime_cannot_be_destroyed_generically')
        });
      });
      results.push({ tab_id: tab.id, status: 'reload_required' });
    }
    return results;
  };

  async function commitDesired(snapshot, reason, registration, proof, canaryTabId) {
    const result = await H.mutate(async (state) => {
      const desired = state.control.desired_snapshot;
      if (!desired || !C.sameSnapshot(desired, snapshot)) return { committed: false, reason: 'desired_changed' };
      if (state.control.committed.current && C.sameSnapshot(state.control.committed.current, desired)) {
        return { committed: false, reason: 'already_committed', snapshot_id: state.control.committed.current.id };
      }
      if (state.control.committed.current) state.control.committed.history.push(C.clone(state.control.committed.current));
      state.control.committed.history = state.control.committed.history.slice(-12);
      state.control.committed.current = C.clone(desired);
      state.control.committed.last_known_good = C.clone(desired);
      const record = C.upsertActivationRecord(state, desired.id, {
        status: 'committed',
        committed_at: C.nowIso(),
        reason,
        canary_tab_id: canaryTabId,
        loaded_units: proof.loaded.slice().sort(),
        ready_units: proof.ready.slice().sort(),
        degraded_units: proof.degraded.slice().sort(),
        failed_units: proof.optional_failed.slice().sort(),
        registration: C.clone(registration)
      });
      C.appendEvidence(state, {
        type: 'commit.completed',
        snapshot_id: desired.id,
        activation_id: record.activation_id,
        units: proof.loaded.slice().sort()
      });
      return { committed: true, snapshot_id: desired.id, activation_id: record.activation_id };
    });
    return result.result;
  }

  async function reconcileOnce(reason) {
    const before = await H.storageGet();
    const desired = before.control.desired_snapshot;
    const current = before.control.committed.current;
    const lkg = before.control.committed.last_known_good;

    if (!desired) {
      const target = current || lkg;
      if (!target) {
        await H.mutate(async (state) => C.appendReconcileRecord(state, { reason, status: 'no_snapshot', action: 'none' }));
        return { ok: false, status: 'no_snapshot' };
      }
      try {
        const registration = await H.reconcileRegistrations(before, target);
        await H.mutate(async (state) => C.appendReconcileRecord(state, {
          reason,
          status: 'current_restored',
          action: 'reconcile_registration',
          committed_snapshot_id: target.id
        }));
        return { ok: true, status: 'current_restored', registration };
      } catch (error) {
        const detail = String(error && error.message || error);
        await H.mutate(async (state) => C.appendReconcileRecord(state, { reason, status: 'failed', action: 'reconcile_registration', detail }));
        return { ok: false, status: detail === 'USER_SCRIPTS_PERMISSION_REQUIRED' ? 'permission_required' : 'failed', error: detail };
      }
    }

    if (current && C.sameSnapshot(desired, current)) {
      try {
        const registration = await H.reconcileRegistrations(before, current);
        await H.mutate(async (state) => C.appendReconcileRecord(state, {
          reason,
          status: 'converged',
          action: 'verify_committed_registration',
          desired_snapshot_id: desired.id,
          committed_snapshot_id: current.id
        }));
        return { ok: true, status: 'converged', snapshot_id: current.id, registration };
      } catch (error) {
        const detail = String(error && error.message || error);
        await H.mutate(async (state) => C.appendReconcileRecord(state, {
          reason,
          status: 'failed',
          action: 'verify_committed_registration',
          desired_snapshot_id: desired.id,
          committed_snapshot_id: current.id,
          detail
        }));
        return { ok: false, status: 'failed', error: detail };
      }
    }

    let canary;
    try {
      canary = await H.ensureCanary(desired);
      await H.executeSnapshotInTab(desired, canary.tab_id, 'canary');
    } catch (error) {
      const detail = String(error && error.message || error);
      await H.mutate(async (state) => {
        const record = C.upsertActivationRecord(state, desired.id, { status: 'failed', failed_at: C.nowIso(), failure: detail });
        state.control.canary.status = 'failed';
        state.control.canary.error = detail;
        C.appendReconcileRecord(state, {
          reason,
          status: 'failed',
          action: 'prove_canary',
          desired_snapshot_id: desired.id,
          committed_snapshot_id: current && current.id || null,
          activation_id: record.activation_id,
          detail
        });
      });
      await restoreCommittedRegistrations('canary-setup-failed').catch(() => undefined);
      const failedCanary = await H.storageGet();
      if (failedCanary.control.canary.snapshot_id === desired.id) {
        await closeCanary(desired.id, failedCanary.control.canary.tab_id, 'failed').catch(() => undefined);
      }
      return { ok: false, status: 'canary_failed', error: detail };
    }

    const observed = await H.storageGet();
    const proof = canaryProof(observed, desired);
    if (proof.blocking_failed.length) {
      const detail = `required_units_failed:${proof.blocking_failed.join(',')}`;
      await H.mutate(async (state) => {
        const record = C.upsertActivationRecord(state, desired.id, {
          status: 'failed',
          failed_at: C.nowIso(),
          failed_units: proof.blocking_failed.slice().sort(),
          failure: detail
        });
        C.appendReconcileRecord(state, {
          reason,
          status: 'failed',
          action: 'prove_canary',
          desired_snapshot_id: desired.id,
          committed_snapshot_id: current && current.id || null,
          activation_id: record.activation_id,
          detail
        });
      });
      await restoreCommittedRegistrations('canary-unit-failed').catch(() => undefined);
      await closeCanary(desired.id, canary.tab_id, 'failed');
      return { ok: false, status: 'candidate_failed', failed: proof.blocking_failed };
    }
    if (proof.missing.length) {
      await chrome.alarms.create('dcf-candidate-reconcile', { delayInMinutes: CANARY_RETRY_MINUTES });
      await H.mutate(async (state) => {
        C.upsertActivationRecord(state, desired.id, {
          status: 'proving',
          loaded_units: proof.loaded.slice().sort(),
          missing_units: proof.missing.slice().sort()
        });
        C.appendReconcileRecord(state, {
          reason,
          status: 'pending_observation',
          action: 'prove_canary',
          desired_snapshot_id: desired.id,
          committed_snapshot_id: current && current.id || null,
          missing_units: proof.missing.slice().sort()
        });
      });
      return { ok: true, status: 'candidate_pending_observation', missing: proof.missing };
    }

    let registration;
    try {
      registration = await H.reconcileRegistrations(observed, desired);
    } catch (error) {
      const detail = String(error && error.message || error);
      await restoreCommittedRegistrations('candidate-registration-failed').catch(() => undefined);
      await H.mutate(async (state) => {
        const record = C.upsertActivationRecord(state, desired.id, {
          status: 'failed',
          failed_at: C.nowIso(),
          failure: detail
        });
        C.appendReconcileRecord(state, {
          reason,
          status: 'failed',
          action: 'verify_registration',
          desired_snapshot_id: desired.id,
          committed_snapshot_id: current && current.id || null,
          activation_id: record.activation_id,
          detail
        });
      });
      await closeCanary(desired.id, canary.tab_id, 'failed');
      return { ok: false, status: 'registration_failed', error: detail };
    }

    const committed = await commitDesired(desired, reason, registration, proof, canary.tab_id);
    if (!committed.committed && committed.reason !== 'already_committed') {
      await restoreCommittedRegistrations('desired-changed-before-commit').catch(() => undefined);
      return { ok: false, status: committed.reason };
    }
    await closeCanary(desired.id, canary.tab_id, 'committed');
    const migration = await H.migrateOpenPages(desired, canary.tab_id);
    await H.mutate(async (state) => C.appendReconcileRecord(state, {
      reason,
      status: 'committed',
      action: 'commit_then_migrate',
      desired_snapshot_id: desired.id,
      committed_snapshot_id: desired.id,
      activation_id: committed.activation_id || null,
      migration
    }));
    return {
      ok: true,
      status: committed.reason === 'already_committed' ? 'converged' : 'committed',
      snapshot_id: desired.id,
      activation_id: committed.activation_id || null,
      migration
    };
  }

  H.reconcileControlPlane = function reconcileControlPlane(reason) {
    const run = () => reconcileOnce(String(reason || 'unspecified'));
    const task = reconcileQueue.then(run, run);
    reconcileQueue = task.then(() => undefined, () => undefined);
    return task;
  };
  H.reconcileTarget = H.reconcileControlPlane;

  H.rollbackToLastKnownGood = async function rollbackToLastKnownGood(reason) {
    const state = await H.storageGet();
    const snapshot = state.control.committed.last_known_good || state.control.committed.stable;
    if (!snapshot) {
      const actual = await H.actualDcfScripts().catch(() => []);
      if (actual.length) await H.userScriptsApi().unregister({ ids: actual.map((item) => item.id) }).catch(() => undefined);
      await H.mutate(async (next) => C.appendEvidence(next, { type: 'rollback.unavailable', reason }));
      return { ok: false, status: 'no_last_known_good' };
    }
    const registration = await H.reconcileRegistrations(state, snapshot);
    await H.mutate(async (next) => {
      next.control.desired_snapshot = C.clone(snapshot);
      next.control.committed.current = C.clone(snapshot);
      C.appendEvidence(next, { type: 'rollback.completed', reason, snapshot_id: snapshot.id });
      C.appendReconcileRecord(next, {
        reason,
        status: 'rolled_back',
        action: 'restore_last_known_good',
        desired_snapshot_id: snapshot.id,
        committed_snapshot_id: snapshot.id
      });
    });
    return { ok: true, status: 'rolled_back', snapshot_id: snapshot.id, registration };
  };

  H.setUnitEnabled = async function setUnitEnabled(id, enabled, senderTabId) {
    const state = await H.storageGet();
    const base = state.control.committed.current || state.control.committed.last_known_good;
    if (!base) throw new Error('no_snapshot_to_edit');
    const existingRef = base.entries.find((entry) => entry.id === id);
    if (!existingRef) throw new Error(`unit_not_installed:${id}`);
    const wantEnabled = enabled !== false;
    if (existingRef.enabled === wantEnabled) return { ok: true, status: 'unchanged', id, enabled: wantEnabled };

    const desired = C.clone(base);
    desired.entries.find((entry) => entry.id === id).enabled = wantEnabled;
    delete desired.id;
    desired.created_at = C.nowIso();
    desired.reason = `unit-config:${id}:${wantEnabled ? 'enabled' : 'disabled'}`;
    const normalized = C.normalizeSnapshot(desired);
    await H.declareDesiredSnapshot(normalized, normalized.reason);

    let registration;
    try {
      registration = await H.reconcileRegistrations(await H.storageGet(), normalized);
    } catch (error) {
      await H.mutate(async (next) => C.appendReconcileRecord(next, {
        reason: normalized.reason,
        status: 'failed',
        action: 'unit_config_registration',
        desired_snapshot_id: normalized.id,
        committed_snapshot_id: base.id,
        detail: String(error && error.message || error)
      }));
      return { ok: false, status: 'registration_failed', id, enabled: wantEnabled, error: String(error && error.message || error) };
    }

    await H.mutate(async (next) => {
      if (next.control.committed.current) next.control.committed.history.push(C.clone(next.control.committed.current));
      next.control.committed.history = next.control.committed.history.slice(-12);
      next.control.committed.current = C.clone(normalized);
      next.control.committed.last_known_good = C.clone(normalized);
      C.upsertActivationRecord(next, normalized.id, {
        status: 'committed',
        committed_at: C.nowIso(),
        reason: normalized.reason,
        registration
      });
      C.appendEvidence(next, { type: 'unit.config_committed', unit_id: id, enabled: wantEnabled, snapshot_id: normalized.id });
    });

    if (!wantEnabled) {
      const migration = await H.markOpenPagesReloadRequired(normalized, `unit_disabled:${id}`);
      await H.mutate(async (next) => C.appendReconcileRecord(next, {
        reason: normalized.reason,
        status: 'committed',
        action: 'commit_config_then_mark_reload',
        desired_snapshot_id: normalized.id,
        committed_snapshot_id: normalized.id,
        migration
      }));
      return { ok: true, status: 'completed', id, enabled: false, migration };
    }

    const migration = await H.migrateOpenPages(normalized, null);
    await H.mutate(async (next) => C.appendReconcileRecord(next, {
      reason: normalized.reason,
      status: 'committed',
      action: 'commit_config_then_migrate',
      desired_snapshot_id: normalized.id,
      committed_snapshot_id: normalized.id,
      migration
    }));
    const senderMigration = senderTabId ? migration.find((item) => item.tab_id === senderTabId) : null;
    if (!senderTabId || !senderMigration || senderMigration.status !== 'migrated') {
      return { ok: true, status: 'reload_required', id, enabled: true, hot_executed: false, reason: !senderTabId ? 'no_source_tab' : 'hot_execute_timed_out_or_failed', migration };
    }
    return { ok: true, status: 'completed', id, enabled: true, hot_executed: true, migration };
  };

  H.markCurrentStable = async function markCurrentStable(snapshotId, evidenceRef) {
    return H.mutate(async (state) => {
      const current = state.control.committed.current;
      if (!current || current.id !== snapshotId) throw new Error('stable_snapshot_mismatch');
      state.control.committed.stable = C.clone(current);
      C.appendEvidence(state, { type: 'stable.committed', snapshot_id: current.id, evidence_ref: String(evidenceRef || '') });
      return { snapshot_id: current.id };
    });
  };
})(self);
