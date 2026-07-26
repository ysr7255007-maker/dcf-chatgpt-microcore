'use strict';
(function initHostRuntimeReconcile(root) {
  const H = root.DCFHost;
  const C = H.C;
  const R = H.runtimeControl;
  const { CANARY_TIMEOUT_MINUTES, ACTIVE_RUNTIME_STATUSES, patchActivationRecord, startReconcile, finishReconcile, closeCanary } = R;
  let reconcileQueue = R.reconcileQueue;
  H.reconcile = function reconcile(reason, options = {}) {
    const run = async () => {
      const { reconcileId, operationId } = await startReconcile(reason, options.writer_id);
      const actions = [];
      try {
        let state = await H.storageGet();
        if (state.committed.current) {
          try {
            await H.reconcileRegistrations(state, state.committed.current, operationId);
            actions.push('committed.registrations_reconciled');
          } catch (error) {
            actions.push('committed.registrations_degraded');
            if (String(error && error.message || error) === 'USER_SCRIPTS_PERMISSION_REQUIRED') throw error;
          }
        }

        state = await H.storageGet();
        const desired = state.desired;
        const current = state.committed.current;
        if (!desired.snapshot || current && desired.snapshot.id === current.id) {
          await finishReconcile(reconcileId, 'converged', actions);
          return { ok: true, status: current ? 'converged' : 'no_desired_snapshot', actions };
        }
        if (desired.status === 'failed' && options.retry_failed !== true) {
          await finishReconcile(reconcileId, 'blocked', actions, desired.last_error || 'desired_activation_failed');
          return { ok: false, status: 'activation_failed', error: desired.last_error, actions };
        }
        if (desired.status === 'failed' && options.retry_failed === true) {
          await H.mutate(async (next) => {
            next.desired.status = 'declared';
            next.desired.last_error = null;
            next.desired.observations = {};
            patchActivationRecord(next, next.desired.activation_id, {
              status: 'declared',
              failed_at: null,
              error: null,
              observations: {}
            });
          });
          actions.push('failed_activation_reset');
        }

        const immediate = await H.commitDesiredIfProven();
        if (immediate.result.committed) {
          actions.push('desired.committed_without_canary');
          const convergence = await H.postCommitConverge(immediate.result);
          await finishReconcile(reconcileId, 'committed', [...actions, ...(convergence.actions || [])]);
          return { ok: true, status: 'committed', activation: immediate.result, convergence };
        }

        const canary = await H.ensureCanaryPage(options.preferred_tab_id);
        actions.push('canary.ready');
        await chrome.alarms.create('dcf-reconcile-watch', { delayInMinutes: CANARY_TIMEOUT_MINUTES });
        const proof = await H.executeCanaryProof(canary);
        actions.push(`canary.execute:${proof.attempted}`);
        const after = await H.commitDesiredIfProven();
        if (after.result.committed) {
          const convergence = await H.postCommitConverge(after.result);
          await finishReconcile(reconcileId, 'committed', [...actions, ...(convergence.actions || [])]);
          return { ok: true, status: 'committed', activation: after.result, convergence };
        }
        const refreshed = await H.storageGet();
        if (refreshed.committed.current && refreshed.desired.snapshot && refreshed.committed.current.id === refreshed.desired.snapshot.id) {
          actions.push('desired.committed_by_observation');
          await finishReconcile(reconcileId, 'committed', actions);
          return { ok: true, status: 'committed', activation: { snapshot: C.clone(refreshed.committed.current) }, actions };
        }
        await finishReconcile(reconcileId, after.result.reason === 'proof_failed' ? 'failed' : 'awaiting_observation', actions, after.result.reason === 'proof_failed' ? 'canary proof failed' : null);
        return {
          ok: after.result.reason !== 'proof_failed',
          status: after.result.reason === 'proof_failed' ? 'activation_failed' : 'canary_pending_observation',
          canary,
          proof,
          missing: after.result.missing || [],
          actions
        };
      } catch (error) {
        const message = String(error && error.message || error);
        await finishReconcile(reconcileId, 'failed', actions, message);
        return {
          ok: false,
          status: message === 'USER_SCRIPTS_PERMISSION_REQUIRED' ? 'permission_required' : 'failed',
          error: message,
          actions
        };
      }
    };
    const task = reconcileQueue.then(run, run);
    reconcileQueue = task.then(() => undefined, () => undefined);
    return task;
  };

  H.reconcileTarget = function reconcileTarget(reason, options) {
    return H.reconcile(reason, options);
  };

  H.rollbackToLastKnownGood = async function rollbackToLastKnownGood(reason) {
    const state = await H.storageGet();
    const snapshot = state.committed.last_known_good;
    if (!snapshot) {
      await H.mutate(async (next) => C.appendEvidence(next, {
        type: 'rollback.unavailable',
        reason: String(reason || 'unspecified')
      }));
      return { ok: false, status: 'no_last_known_good' };
    }
    const declared = await H.declareDesiredSnapshot(snapshot, reason || 'restore-last-known-good', {
      trusted: true,
      writer_id: 'dcf.chrome.recovery'
    });
    const committed = await H.commitDesiredIfProven();
    const convergence = committed.result.committed ? await H.postCommitConverge(committed.result) : null;
    await H.mutate(async (next) => C.appendEvidence(next, {
      type: 'rollback.completed',
      operation_id: declared.result && declared.result.operation_id || null,
      snapshot_id: snapshot.id,
      reason: String(reason || 'unspecified')
    }));
    return { ok: true, status: 'restored', snapshot_id: snapshot.id, convergence };
  };

  H.stageSnapshotFromVersions = async function stageSnapshotFromVersions(versions, reason, options = {}) {
    const state = await H.storageGet();
    const base = options.replace === true
      ? { schema: 'dcf.startup.snapshot.v3', id: 'pending', entries: [] }
      : state.desired.snapshot || state.committed.current || state.committed.last_known_good || { schema: 'dcf.startup.snapshot.v3', id: 'pending', entries: [] };
    const entries = C.clone(base.entries || []);
    for (const [id, selector] of Object.entries(versions || {})) {
      const version = typeof selector === 'string' ? selector : String(selector && selector.version || '');
      const hash = typeof selector === 'object' && selector ? String(selector.hash || '').toLowerCase() : '';
      const unit = C.getUnit(state, id, version, hash || undefined);
      if (!unit) throw new Error(`missing ${C.unitKey(id, version)}${hash ? `@${hash}` : ''}`);
      const ref = entries.find((entry) => entry.id === id);
      const nextRef = {
        id,
        version,
        hash: unit.hash,
        artifact_id: C.artifactId(unit.hash),
        enabled: unit.default_enabled !== false,
        phase: unit.phase
      };
      if (ref) Object.assign(ref, nextRef);
      else entries.push(nextRef);
    }
    const snapshot = await C.snapshotFromEntries(entries, reason);
    const declared = await H.declareDesiredSnapshot(snapshot, reason, options);
    return { state: declared.state, result: C.clone(snapshot), declaration: declared.result };
  };

  H.setUnitEnabled = async function setUnitEnabled(id, enabled, senderTabId) {
    const state = await H.storageGet();
    const base = state.desired.snapshot || state.committed.current || state.committed.last_known_good;
    if (!base) throw new Error('no_snapshot_to_edit');
    const entries = C.clone(base.entries);
    const ref = entries.find((entry) => entry.id === id);
    if (!ref) throw new Error(`unit_not_installed:${id}`);
    const wantEnabled = enabled !== false;
    if (ref.enabled === wantEnabled && state.committed.current && state.committed.current.id === base.id) {
      return { ok: true, status: 'unchanged', id, enabled: wantEnabled };
    }
    ref.enabled = wantEnabled;
    const snapshot = await C.snapshotFromEntries(entries, `unit-enabled:${id}:${wantEnabled}`);
    await H.declareDesiredSnapshot(snapshot, `unit-enabled:${id}:${wantEnabled}`, {
      writer_id: 'dcf.firstparty.plugin-manager'
    });
    const activation = await H.reconcile(`unit-enabled:${id}:${wantEnabled}`, {
      preferred_tab_id: senderTabId,
      retry_failed: true,
      writer_id: 'dcf.firstparty.plugin-manager'
    });
    return {
      ok: activation.ok,
      status: activation.status === 'committed' || activation.status === 'converged' ? 'completed' : activation.status,
      id,
      enabled: wantEnabled,
      activation
    };
  };

  H.handleReconcileWatch = async function handleReconcileWatch() {
    const state = await H.storageGet();
    const desired = state.desired;
    if (!desired.snapshot || !['declared', 'proving'].includes(desired.status)) return { ok: true, status: 'no_pending_activation' };
    const declaredAt = Date.parse(desired.declared_at || 0) || 0;
    if (Date.now() - declaredAt < CANARY_TIMEOUT_MINUTES * 60 * 1000) {
      return H.reconcile('reconcile-watch-resume');
    }
    await H.mutate(async (next) => {
      if (!['declared', 'proving'].includes(next.desired.status)) return;
      const missing = next.desired.proof_refs.filter((ref) => !ACTIVE_RUNTIME_STATUSES.has(next.desired.observations[ref.hash] && next.desired.observations[ref.hash].status));
      next.desired.status = 'failed';
      next.desired.last_error = `canary_observation_timeout:${missing.map(C.unitRefKey).join(',')}`;
      patchActivationRecord(next, next.desired.activation_id, {
        status: 'failed',
        failed_at: C.nowIso(),
        error: next.desired.last_error,
        observations: C.clone(next.desired.observations)
      });
      C.appendEvidence(next, {
        type: 'activation.failed',
        operation_id: next.desired.operation_id,
        snapshot_id: next.desired.snapshot.id,
        activation_id: next.desired.activation_id,
        detail: next.desired.last_error
      });
    });
    const final = await H.storageGet();
    await closeCanary(final.desired.canary);
    return { ok: false, status: 'activation_failed', error: final.desired.last_error };
  };
  R.reconcileQueue = reconcileQueue;
})(self);
