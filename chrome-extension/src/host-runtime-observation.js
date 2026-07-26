'use strict';
(function initHostRuntimeObservation(root) {
  const H = root.DCFHost;
  const C = H.C;
  const R = H.runtimeControl;
  const { EXECUTE_TIMEOUT_MS, ACTIVE_RUNTIME_STATUSES, changedRefs, patchActivationRecord, closeCanary } = R;
  function pageInstanceId(sender) {
    if (sender && sender.documentId) return String(sender.documentId);
    const tabId = sender && sender.tab && sender.tab.id;
    const frameId = sender && sender.frameId != null ? sender.frameId : 0;
    return tabId ? `tab:${tabId}:frame:${frameId}` : `unknown:${C.eventId('page')}`;
  }

  function recordPageObservation(state, message, sender, ref, status) {
    const id = pageInstanceId(sender);
    const current = state.committed.current;
    const page = state.observed.pages[id] || {
      schema: 'dcf.page.runtime.v1',
      page_instance_id: id,
      tab_id: sender && sender.tab && sender.tab.id || null,
      conversation_id: null,
      url_origin: sender && sender.url ? (() => { try { return new URL(sender.url).origin; } catch (_) { return null; } })() : null,
      observed_snapshot: null,
      units: {},
      migration_status: 'observed',
      first_seen_at: C.nowIso(),
      last_seen_at: C.nowIso()
    };
    page.last_seen_at = C.nowIso();
    page.units[ref.id] = {
      id: ref.id,
      version: ref.version,
      hash: ref.hash,
      artifact_id: C.artifactId(ref.hash),
      status,
      reason: message.reason ? String(message.reason).slice(0, 500) : null,
      observed_at: C.nowIso()
    };
    if (current) {
      const ready = current.entries.filter((entry) => entry.enabled !== false).every((entry) => {
        const observed = page.units[entry.id];
        return observed && observed.hash === entry.hash && ACTIVE_RUNTIME_STATUSES.has(observed.status);
      });
      if (ready) {
        page.observed_snapshot = current.id;
        page.migration_status = 'current';
      } else if (page.observed_snapshot && page.observed_snapshot !== current.id) {
        page.migration_status = 'stale';
      }
    }
    state.observed.pages[id] = page;
    return page;
  }

  H.commitDesiredIfProven = async function commitDesiredIfProven() {
    return H.mutate(async (state) => {
      const desired = state.desired;
      const snapshot = desired.snapshot;
      if (!snapshot) return { committed: false, reason: 'no_desired_snapshot' };
      if (state.committed.current && state.committed.current.id === snapshot.id) {
        desired.status = 'converged';
        return { committed: false, reason: 'already_committed' };
      }
      const failed = desired.proof_refs.filter((ref) => desired.observations[ref.hash] && desired.observations[ref.hash].status === 'failed');
      if (failed.length) {
        desired.status = 'failed';
        desired.last_error = `canary_failed:${failed.map(C.unitRefKey).join(',')}`;
        patchActivationRecord(state, desired.activation_id, {
          status: 'failed',
          failed_at: C.nowIso(),
          error: desired.last_error,
          observations: C.clone(desired.observations)
        });
        C.appendEvidence(state, {
          type: 'activation.failed',
          operation_id: desired.operation_id,
          snapshot_id: snapshot.id,
          activation_id: desired.activation_id,
          failed_refs: failed.map(C.unitRefKey)
        });
        return { committed: false, reason: 'proof_failed', failed: failed.map(C.unitRefKey) };
      }
      const missing = desired.proof_refs.filter((ref) => !ACTIVE_RUNTIME_STATUSES.has(desired.observations[ref.hash] && desired.observations[ref.hash].status));
      if (missing.length) return { committed: false, reason: 'proof_pending', missing: missing.map(C.unitRefKey) };

      const previous = C.clone(state.committed.current);
      if (previous) state.committed.history.push(previous);
      state.committed.history = state.committed.history.slice(-12);
      state.committed.current = C.clone(snapshot);
      state.committed.last_known_good = C.clone(snapshot);
      desired.status = 'committed';
      desired.last_error = null;
      const record = patchActivationRecord(state, desired.activation_id, {
        status: 'committed',
        committed_at: C.nowIso(),
        observations: C.clone(desired.observations),
        error: null
      });
      C.appendEvidence(state, {
        type: 'commit.completed',
        operation_id: desired.operation_id,
        snapshot_id: snapshot.id,
        activation_id: desired.activation_id,
        previous_snapshot_id: previous && previous.id || null,
        stable_snapshot_id: state.committed.stable && state.committed.stable.id || null
      });
      return {
        committed: true,
        snapshot: C.clone(snapshot),
        previous,
        changed_refs: C.clone(record && record.changed_refs || changedRefs(previous, snapshot)),
        canary: C.clone(desired.canary),
        activation_id: desired.activation_id,
        operation_id: desired.operation_id
      };
    });
  };

  async function markMigrationAttempt(tab, snapshot, ref, status, detail) {
    await H.mutate(async (state) => {
      const pageId = `tab:${tab.id}:frame:0`;
      const page = state.observed.pages[pageId] || {
        schema: 'dcf.page.runtime.v1',
        page_instance_id: pageId,
        tab_id: tab.id,
        conversation_id: null,
        url_origin: tab.url ? (() => { try { return new URL(tab.url).origin; } catch (_) { return null; } })() : null,
        observed_snapshot: null,
        units: {},
        migration_status: 'observed',
        first_seen_at: C.nowIso(),
        last_seen_at: C.nowIso()
      };
      page.last_seen_at = C.nowIso();
      page.migration_status = status;
      if (ref) {
        page.units[ref.id] = Object.assign(page.units[ref.id] || {}, {
          id: ref.id,
          version: ref.version,
          hash: ref.hash,
          artifact_id: C.artifactId(ref.hash),
          status: status === 'migration_failed' ? 'failed' : 'loaded',
          reason: detail || null,
          observed_at: C.nowIso()
        });
      }
      state.observed.pages[pageId] = page;
      C.appendEvidence(state, {
        type: 'observation.recorded',
        snapshot_id: snapshot && snapshot.id,
        page_instance_id: pageId,
        observation_kind: 'page_migration',
        status,
        unit_id: ref && ref.id || null,
        detail: detail || null
      });
    });
  }

  H.migrateExistingPages = async function migrateExistingPages(previous, snapshot, refs, canary) {
    const tabs = await H.chatGptTabs();
    const enabledRefs = (refs || []).filter((ref) => ref.enabled !== false);
    const disabledRefs = (refs || []).filter((ref) => ref.enabled === false);
    const state = await H.storageGet();
    let attempted = 0;
    let failed = 0;
    let reloadRequired = 0;
    for (const tab of tabs) {
      if (!tab.id || tab.id === canary?.tab_id) continue;
      let tabFailed = false;
      for (const ref of enabledRefs) {
        const unit = C.getUnit(state, ref.id, ref.version, ref.hash);
        try {
          await H.withTimeout(
            chrome.userScripts.execute({
              target: { tabId: tab.id },
              js: [{ code: unit.code }],
              world: 'USER_SCRIPT',
              worldId: unit.world_id
            }),
            EXECUTE_TIMEOUT_MS,
            `page_migrate_${ref.id}_tab${tab.id}`
          );
          attempted += 1;
          await markMigrationAttempt(tab, snapshot, ref, 'migration_attempted', null);
        } catch (error) {
          failed += 1;
          tabFailed = true;
          await markMigrationAttempt(tab, snapshot, ref, 'migration_failed', String(error && error.message || error));
        }
      }
      if (disabledRefs.length && !tabFailed) {
        reloadRequired += 1;
        await markMigrationAttempt(
          tab,
          snapshot,
          null,
          'reload_required',
          `disabled_units_may_still_exist:${disabledRefs.map((ref) => ref.id).join(',')}`
        );
      }
    }
    return { tabs: tabs.length, attempted, failed, reload_required: reloadRequired, current_unchanged_on_failure: true };
  };

  H.postCommitConverge = async function postCommitConverge(commitResult) {
    if (!commitResult || !commitResult.committed) return { ok: true, status: 'nothing_committed' };
    const actions = [];
    let registration = null;
    let migration = null;
    try {
      const state = await H.storageGet();
      registration = await H.reconcileRegistrations(state, state.committed.current, commitResult.operation_id);
      actions.push('registrations.reconciled');
    } catch (error) {
      actions.push('registrations.degraded');
      await H.mutate(async (state) => C.appendEvidence(state, {
        type: 'reconcile.action',
        operation_id: commitResult.operation_id,
        snapshot_id: commitResult.snapshot.id,
        action: 'registrations.failed',
        detail: String(error && error.message || error)
      }));
    }
    try {
      migration = await H.migrateExistingPages(
        commitResult.previous,
        commitResult.snapshot,
        commitResult.changed_refs,
        commitResult.canary
      );
      actions.push('pages.migration_attempted');
    } catch (error) {
      actions.push('pages.migration_degraded');
      await H.mutate(async (state) => C.appendEvidence(state, {
        type: 'reconcile.action',
        operation_id: commitResult.operation_id,
        snapshot_id: commitResult.snapshot.id,
        action: 'pages.migration_failed',
        detail: String(error && error.message || error)
      }));
    }
    await closeCanary(commitResult.canary);
    await H.mutate(async (state) => {
      if (state.desired.activation_id === commitResult.activation_id && state.desired.canary) {
        state.desired.canary.status = 'closed';
        state.desired.canary.closed_at = C.nowIso();
      }
    });
    return { ok: true, status: 'committed', registration, migration, actions };
  };

  H.recordRuntimeObservation = async function recordRuntimeObservation(message, sender) {
    const allowed = new Set(['loaded', 'ready', 'degraded', 'failed']);
    const status = allowed.has(message && message.status) ? message.status : 'ready';
    const result = await H.mutate(async (state) => {
      const unitId = String(message && message.unit_id || '');
      const version = String(message && message.version || '');
      const senderTabId = sender && sender.tab && sender.tab.id || null;
      const isCanary = !!(state.desired.canary && senderTabId === state.desired.canary.tab_id);
      const desiredRef = state.desired.snapshot && state.desired.snapshot.entries.find((entry) =>
        entry.id === unitId && entry.version === version && (!message.hash || entry.hash === String(message.hash).toLowerCase())
      );
      const currentRef = state.committed.current && state.committed.current.entries.find((entry) =>
        entry.id === unitId && entry.version === version && (!message.hash || entry.hash === String(message.hash).toLowerCase())
      );
      const ref = isCanary && desiredRef ? desiredRef : currentRef || desiredRef;
      if (!ref) throw new Error(`unrecognized runtime observation ${unitId}@${version}`);
      const page = recordPageObservation(state, message || {}, sender || {}, ref, status);
      if (isCanary && desiredRef && state.desired.activation_id) {
        const prior = state.desired.observations[ref.hash];
        const rank = { loaded: 1, ready: 2, degraded: 3, failed: 4 };
        if (!prior || rank[status] >= rank[prior.status]) {
          state.desired.observations[ref.hash] = {
            status,
            observed_at: C.nowIso(),
            page_instance_id: page.page_instance_id,
            tab_id: senderTabId,
            reason: message.reason ? String(message.reason).slice(0, 500) : null
          };
        }
        patchActivationRecord(state, state.desired.activation_id, {
          observations: C.clone(state.desired.observations)
        });
      }
      C.appendEvidence(state, {
        type: `runtime.${status}`,
        operation_id: isCanary ? state.desired.operation_id : null,
        snapshot_id: isCanary && state.desired.snapshot ? state.desired.snapshot.id : state.committed.current && state.committed.current.id || null,
        page_instance_id: page.page_instance_id,
        unit_id: ref.id,
        artifact_id: C.artifactId(ref.hash),
        version: ref.version,
        canary: isCanary,
        detail: message.reason ? String(message.reason).slice(0, 500) : null
      });
      return { isCanary, status, ref: C.clone(ref), page: C.clone(page) };
    });

    if (result.result.isCanary) {
      const committed = await H.commitDesiredIfProven();
      if (committed.result.committed) {
        committed.result.convergence = await H.postCommitConverge(committed.result);
      }
      return committed.result;
    }
    return { committed: false, observation: result.result };
  };

  H.recordUnitStarted = function recordUnitStarted(message, sender) {
    return H.recordRuntimeObservation({ ...message, status: 'ready', protocol: 'legacy-unit.started' }, sender);
  };

  H.recordUnitFailed = function recordUnitFailed(message, sender) {
    return H.recordRuntimeObservation({
      ...message,
      status: 'failed',
      reason: String(message && message.error || 'unknown'),
      protocol: 'legacy-unit.failed'
    }, sender);
  };

  Object.assign(R, { pageInstanceId, recordPageObservation, markMigrationAttempt });
})(self);
