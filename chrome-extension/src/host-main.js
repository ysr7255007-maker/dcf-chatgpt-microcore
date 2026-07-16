'use strict';
(function initHostMain(root) {
  const H = root.DCFHost;
  const C = H.C;

  H.handleMessage = async function handleMessage(message, sender) {
    const type = String(message && message.type || '');
    if (type === 'host.status') return H.statusPayload();
    if (type === 'host.open_recovery') { await chrome.tabs.create({ url: chrome.runtime.getURL('pages/recovery.html') }); return { ok: true }; }
    if (type === 'host.activate') return H.reconcileTarget('user-activation');
    if (type === 'host.restore_lkg') return H.rollbackToLastKnownGood('user-recovery');
    if (type === 'host.check_updates') return H.checkRemoteUpdates();
    if (type === 'host.diagnostics') {
      const state = await H.storageGet();
      let scripts = []; let available = true;
      try { scripts = await H.actualDcfScripts(); } catch (_) { available = false; }
      return { ok: true, report: C.diagnostics(state, scripts, available) };
    }
    if (type === 'host.disable_unit') {
      const id = String(message.id || '');
      const state = await H.storageGet();
      const base = state.snapshots.current || state.snapshots.last_known_good;
      if (!base) throw new Error('no snapshot to edit');
      const candidate = C.clone(base);
      candidate.id = `snapshot-${Date.now().toString(36)}`;
      candidate.created_at = C.nowIso();
      candidate.reason = `disable-unit:${id}`;
      const ref = candidate.entries.find((entry) => entry.id === id);
      if (!ref) throw new Error(`unit ${id} is not in snapshot`);
      ref.enabled = false;
      await H.mutate(async (next) => { next.snapshots.candidate = C.validateSnapshot(next, candidate); C.appendEvidence(next, { type: 'candidate.staged', reason: candidate.reason, snapshot_id: candidate.id }); });
      return H.reconcileTarget(candidate.reason);
    }
    if (type === 'product.state') return { ok: true, product: C.publicProductState(await H.storageGet()) };
    if (type === 'product.export') {
      const state = await H.storageGet();
      return { ok: true, export: { schema: 'dcf.language-ammo.library.v1', exported_at: C.nowIso(), count: Object.keys(state.product.ammo).length, items: Object.values(state.product.ammo).map((item) => { const copy = C.clone(item); delete copy._meta; return copy; }), settings: C.clone(state.product.settings) } };
    }
    if (type === 'ammo.upsert') return { ok: true, item: (await H.upsertAmmo(message.item, message.source || 'user-script')).result };
    if (type === 'ammo.delete') return H.mutate(async (state) => { const id = String(message.id || ''); const existed = !!state.product.ammo[id]; delete state.product.ammo[id]; if (existed) C.appendEvidence(state, { type: 'ammo.deleted', item_id: id }); return { deleted: existed }; }).then(({ result }) => ({ ok: true, ...result }));
    if (type === 'ammo.ingest') return { ok: true, ...(await H.ingestAmmoText(message.text, message.source || 'assistant-reply')) };
    if (type === 'settings.set') return H.mutate(async (state) => { const patch = C.isObject(message.patch) ? message.patch : {}; if (patch.ammo_fire_mode === 'send' || patch.ammo_fire_mode === 'insert') state.product.settings.ammo_fire_mode = patch.ammo_fire_mode; if (C.isObject(patch.appearance)) state.product.settings.appearance = Object.assign({}, state.product.settings.appearance || {}, C.clone(patch.appearance)); return C.clone(state.product.settings); }).then(({ result }) => ({ ok: true, settings: result }));
    if (type === 'legacy.import') return { ok: true, result: (await H.importLegacy(message.payload)).result };
    if (type === 'legacy.status') return { ok: true, migration: C.clone((await H.storageGet()).product.migration) };
    if (type === 'legacy.error') { await H.mutate(async (state) => { state.product.migration.status = 'failed'; state.product.migration.last_result = { status: 'failed', at: C.nowIso(), error: String(message.error || 'unknown') }; C.appendEvidence(state, { type: 'legacy.migration.failed', detail: String(message.error || 'unknown') }); }); return { ok: true }; }
    if (type === 'unit.started') return { ok: true, result: (await H.recordUnitStarted(message, sender)).result };
    if (type === 'unit.failed') {
      await H.mutate(async (state) => C.appendEvidence(state, { type: 'unit.failed', unit_id: String(message.unit_id || ''), version: String(message.version || ''), detail: String(message.error || 'unknown') }));
      return H.rollbackToLastKnownGood(`unit-failed:${message.unit_id}`);
    }
    throw new Error(`unsupported message type ${type}`);
  };

  function installMessageListener(event) {
    if (!event || typeof event.addListener !== 'function') return;
    event.addListener((message, sender, sendResponse) => {
      Promise.resolve(H.handleMessage(message, sender)).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error && error.message || error) }));
      return true;
    });
  }

  installMessageListener(chrome.runtime.onMessage);
  installMessageListener(chrome.runtime.onUserScriptMessage);

  chrome.runtime.onInstalled.addListener(async (details) => {
    try {
      await H.ensureOfficialInstalled();
      const activation = await H.reconcileTarget(`extension-${details.reason}`);
      if (details.reason === 'install' || activation.status === 'permission_required') await chrome.tabs.create({ url: chrome.runtime.getURL('pages/onboarding.html') });
    } catch (error) {
      await H.mutate(async (state) => C.appendEvidence(state, { type: 'extension.install.failed', detail: String(error && error.message || error) }));
      await chrome.tabs.create({ url: chrome.runtime.getURL('pages/recovery.html') });
    }
  });

  chrome.runtime.onStartup.addListener(async () => {
    try { await H.ensureOfficialInstalled(); await H.reconcileTarget('browser-startup'); }
    catch (error) { await H.mutate(async (state) => C.appendEvidence(state, { type: 'startup.failed', detail: String(error && error.message || error) })); }
  });

  chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('pages/recovery.html') }));

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'dcf-candidate-timeout') return;
    const state = await H.storageGet();
    if (!state.snapshots.candidate) return;
    const tabs = await H.chatGptTabs();
    if (!tabs.length) {
      await H.mutate(async (next) => C.appendEvidence(next, { type: 'candidate.awaiting_page', snapshot_id: next.snapshots.candidate && next.snapshots.candidate.id }));
      return;
    }
    const required = state.snapshots.candidate.entries.filter((entry) => entry.enabled !== false).map((entry) => entry.id);
    const started = H.candidateStartedSet(state);
    const missing = required.filter((id) => !started.has(id));
    if (missing.length) await H.rollbackToLastKnownGood(`candidate-timeout:${missing.join(',')}`);
  });
})(self);
