'use strict';
(function initHostRuntimeCanary(root) {
  const H = root.DCFHost;
  const C = H.C;
  const R = H.runtimeControl;
  const { CANARY_TIMEOUT_MINUTES, EXECUTE_TIMEOUT_MS, TAB_READY_TIMEOUT_MS, ACTIVE_RUNTIME_STATUSES, isChatGptUrl, changedRefs, proofRefs, patchActivationRecord } = R;
  H.declareDesiredSnapshot = async function declareDesiredSnapshot(snapshotValue, reason, options = {}) {
    const writerId = String(options.writer_id || 'dcf.chrome.host');
    const operationId = String(options.operation_id || C.eventId('operation'));
    return H.mutate(async (state) => {
      const snapshot = C.validateSnapshot(state, snapshotValue);
      const current = state.committed.current;
      const existing = state.desired.snapshot;
      if (existing && existing.id === snapshot.id && ['declared', 'proving', 'committed', 'converged'].includes(state.desired.status)) {
        C.appendEvidence(state, {
          type: 'desired.declared',
          operation_id: operationId,
          writer_id: writerId,
          snapshot_id: snapshot.id,
          status: 'idempotent'
        });
        return {
          status: current && current.id === snapshot.id ? 'converged' : state.desired.status,
          snapshot: C.clone(snapshot),
          activation_id: state.desired.activation_id,
          operation_id: state.desired.operation_id,
          idempotent: true
        };
      }

      const activationId = C.eventId('activation');
      const requiredProof = options.trusted === true ? [] : proofRefs(current, snapshot);
      const delta = changedRefs(current, snapshot);
      state.desired = {
        schema: 'dcf.desired.snapshot.v1',
        snapshot: C.clone(snapshot),
        operation_id: operationId,
        writer_id: writerId,
        activation_id: activationId,
        declared_at: C.nowIso(),
        status: current && current.id === snapshot.id ? 'converged' : 'declared',
        proof_refs: C.clone(requiredProof),
        observations: {},
        canary: null,
        last_error: null
      };
      state.activation_records.push({
        schema: 'dcf.activation.record.v1',
        activation_id: activationId,
        operation_id: operationId,
        writer_id: writerId,
        desired_snapshot_id: snapshot.id,
        previous_current_snapshot_id: current && current.id || null,
        status: state.desired.status,
        declared_at: state.desired.declared_at,
        proving_at: null,
        committed_at: current && current.id === snapshot.id ? C.nowIso() : null,
        failed_at: null,
        canary: null,
        proof_refs: C.clone(requiredProof),
        changed_refs: C.clone(delta),
        observations: {},
        error: null
      });
      state.activation_records = state.activation_records.slice(-40);
      C.appendEvidence(state, {
        type: 'desired.declared',
        operation_id: operationId,
        writer_id: writerId,
        snapshot_id: snapshot.id,
        activation_id: activationId,
        proof_refs: requiredProof.map(C.unitRefKey),
        changed_refs: delta.map(C.unitRefKey)
      });
      return {
        status: state.desired.status,
        snapshot: C.clone(snapshot),
        activation_id: activationId,
        operation_id: operationId,
        proof_refs: C.clone(requiredProof),
        changed_refs: C.clone(delta),
        idempotent: false
      };
    }, options);
  };

  async function waitForTabReady(tabId) {
    if (!chrome.tabs || typeof chrome.tabs.get !== 'function') return { id: tabId, status: 'complete' };
    const started = Date.now();
    while (Date.now() - started < TAB_READY_TIMEOUT_MS) {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === 'complete' && isChatGptUrl(tab.url)) return tab;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`canary_tab_${tabId}_not_ready`);
  }

  async function existingCanaryTab(canary) {
    if (!canary || !canary.tab_id || !chrome.tabs || typeof chrome.tabs.get !== 'function') return null;
    try {
      const tab = await chrome.tabs.get(canary.tab_id);
      return tab && isChatGptUrl(tab.url) ? tab : null;
    } catch (_) {
      return null;
    }
  }

  H.ensureCanaryPage = async function ensureCanaryPage(preferredTabId) {
    const state = await H.storageGet();
    const desired = state.desired;
    if (!desired.snapshot || !desired.activation_id) throw new Error('no_desired_activation');
    const existing = await existingCanaryTab(desired.canary);
    if (existing) return desired.canary;

    let tab = null;
    if (chrome.tabs && typeof chrome.tabs.create === 'function') {
      try { tab = await chrome.tabs.create({ url: 'https://chatgpt.com/?dcf_canary=1', active: false }); }
      catch (_) {}
    }
    if (!tab || !tab.id) throw new Error('dedicated_canary_page_unavailable');
    const createdByHost = true;
    tab = await waitForTabReady(tab.id);
    const canary = {
      tab_id: tab.id,
      page_instance_id: `canary:${desired.activation_id}:tab:${tab.id}`,
      created_by_host: createdByHost,
      status: 'ready',
      opened_at: C.nowIso(),
      last_seen_at: C.nowIso()
    };
    await H.mutate(async (next) => {
      if (next.desired.activation_id !== desired.activation_id) return;
      next.desired.canary = C.clone(canary);
      next.desired.status = 'proving';
      patchActivationRecord(next, desired.activation_id, {
        status: 'proving',
        proving_at: C.nowIso(),
        canary: C.clone(canary)
      });
      C.appendEvidence(next, {
        type: 'reconcile.action',
        operation_id: next.desired.operation_id,
        snapshot_id: next.desired.snapshot && next.desired.snapshot.id,
        page_instance_id: canary.page_instance_id,
        action: 'canary.ready',
        tab_id: canary.tab_id,
        created_by_host: canary.created_by_host
      });
    });
    return canary;
  };

  async function closeCanary(canary) {
    if (!canary || !canary.created_by_host || !canary.tab_id || !chrome.tabs || typeof chrome.tabs.remove !== 'function') return;
    try { await chrome.tabs.remove(canary.tab_id); } catch (_) {}
  }

  H.executeCanaryProof = async function executeCanaryProof(canary) {
    const state = await H.storageGet();
    const desired = state.desired;
    if (!desired.snapshot || !desired.activation_id || !canary || canary.tab_id !== desired.canary?.tab_id) {
      throw new Error('stale_canary_execution');
    }
    const pending = desired.proof_refs.filter((ref) => !ACTIVE_RUNTIME_STATUSES.has(desired.observations[ref.hash] && desired.observations[ref.hash].status));
    const units = pending.map((ref) => C.getUnit(state, ref.id, ref.version, ref.hash));
    await H.configureWorlds(units);
    let attempted = 0;
    const failures = [];
    for (let index = 0; index < pending.length; index += 1) {
      const ref = pending[index];
      const unit = units[index];
      try {
        await H.withTimeout(
          chrome.userScripts.execute({
            target: { tabId: canary.tab_id },
            js: [{ code: unit.code }],
            world: 'USER_SCRIPT',
            worldId: unit.world_id
          }),
          EXECUTE_TIMEOUT_MS,
          `canary_execute_${ref.id}`
        );
        attempted += 1;
        await H.recordRuntimeObservation({
          unit_id: ref.id,
          version: ref.version,
          hash: ref.hash,
          status: 'loaded',
          reason: 'chrome.userScripts.execute resolved for exact content-addressed artifact',
          activation_id: desired.activation_id
        }, {
          tab: { id: canary.tab_id },
          documentId: canary.page_instance_id,
          frameId: 0,
          url: 'https://chatgpt.com/?dcf_canary=1'
        });
      } catch (error) {
        const detail = String(error && error.message || error);
        failures.push({ ref: C.unitRefKey(ref), error: detail });
        await H.recordRuntimeObservation({
          unit_id: ref.id,
          version: ref.version,
          hash: ref.hash,
          status: 'failed',
          reason: detail,
          activation_id: desired.activation_id
        }, {
          tab: { id: canary.tab_id },
          documentId: canary.page_instance_id,
          frameId: 0,
          url: 'https://chatgpt.com/?dcf_canary=1'
        });
      }
    }
    return { attempted, pending: pending.length, failures };
  };

  Object.assign(R, { waitForTabReady, existingCanaryTab, closeCanary });
})(self);
