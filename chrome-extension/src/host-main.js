'use strict';
(function initHostMain(root) {
  const H = root.DCFHost;
  const C = H.C;

  H.handleMessage = async function handleMessage(message, sender) {
    const type = String(message && message.type || '');
    if (type === 'host.status') return H.statusPayload();
    if (type === 'host.open_recovery') { await chrome.tabs.create({ url: chrome.runtime.getURL('pages/recovery.html') }); return { ok: true }; }
    if (type === 'host.activate') {
      const state = await H.storageGet();
      if (!state.snapshots.current && !state.snapshots.candidate && !state.snapshots.last_known_good) return H.checkRemoteUpdates('first-activation');
      return H.reconcileTarget('user-activation');
    }
    if (type === 'host.restore_lkg') return H.rollbackToLastKnownGood('user-recovery');
    if (type === 'host.check_updates') return H.checkRemoteUpdates('user');
    if (type === 'host.check_base_update') return H.checkBaseUpdate();
    if (type === 'host.check_all_updates') return { ok: true, plugins: await H.checkRemoteUpdates('user'), base: await H.checkBaseUpdate() };
    if (type === 'host.diagnostics') {
      const state = await H.storageGet();
      let scripts = []; let available = true;
      try { scripts = await H.actualDcfScripts(); } catch (_) { available = false; }
      const report = C.diagnostics(state, scripts, available);
      // Page probe: check if DCF Shell exists on the sender's tab
      const senderTabId = sender && sender.tab && sender.tab.id;
      if (senderTabId && chrome.scripting) {
        try {
          const probeResults = await H.withTimeout(
            chrome.scripting.executeScript({ target: { tabId: senderTabId }, func: () => {
              const shellHost = document.getElementById('dcf-chrome-shell-host');
              const shellShadow = shellHost ? shellHost.shadowRoot : null;
              const panels = shellShadow ? shellShadow.querySelectorAll('[data-dcf-panel-root="true"]') : [];
              return {
                shell_host_exists: !!shellHost,
                shell_shadow_exists: !!shellShadow,
                mounted_panel_count: panels.length,
                mounted_panel_ids: Array.from(panels).map((p) => p.dataset.dcfPanelId || '').filter(Boolean),
                document_ready_state: document.readyState,
                url_origin: location.origin,
                probe_at: new Date().toISOString()
              };
            }, world: 'MAIN' }),
            4000,
            'page_probe'
          );
          report.page_probe = probeResults && probeResults[0] && probeResults[0].result || null;
        } catch (probeError) {
          report.page_probe = { error: String(probeError && probeError.message || probeError), probe_at: new Date().toISOString() };
        }
      } else {
        report.page_probe = { error: 'probe_unavailable_no_tab_or_scripting', probe_at: new Date().toISOString() };
      }
      // Determine overall health considering page truth
      const registrationHealthy = report.deviations.length === 0 && report.user_scripts_available;
      const probe = report.page_probe;
      if (registrationHealthy && probe && !probe.error && !probe.shell_host_exists) {
        report.page_health = 'page_shell_missing';
        report.deviations.push({ code: 'page_shell_missing', detail: 'Scripts registered but DCF Shell not found on current page' });
      } else if (registrationHealthy && probe && !probe.error && probe.shell_host_exists) {
        report.page_health = 'healthy';
      } else if (probe && probe.error) {
        report.page_health = 'unknown';
      } else {
        report.page_health = registrationHealthy ? 'healthy' : 'degraded';
      }
      return { ok: true, report };
    }
    if (type === 'host.set_unit_enabled') return H.setUnitEnabled(String(message.id || ''), message.enabled !== false, sender && sender.tab && sender.tab.id || null);
    if (type === 'plugin.data.get') return { ok: true, data: await H.pluginDataGet(message.plugin_id) };
    if (type === 'plugin.data.set') return { ok: true, data: (await H.pluginDataSet(message.plugin_id, message.data)).result };
    if (type === 'backup.export') return { ok: true, backup: await H.exportBackup() };
    if (type === 'backup.import') return { ok: true, result: (await H.importBackup(message.backup)).result };
    if (type === 'migration.import_next') return { ok: true, result: (await H.importNextMigration(message.payload)).result };
    if (type === 'migration.status') return { ok: true, migration: C.clone((await H.storageGet()).migration) };
    if (type === 'migration.error') {
      await H.mutate(async (state) => { state.migration.next = { status: 'failed', last_result: { at: C.nowIso(), error: String(message.error || 'unknown') } }; C.appendEvidence(state, { type: 'next.migration.failed', detail: String(message.error || 'unknown') }); });
      return { ok: true };
    }
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
      const state = await H.storageGet();
      let activation;
      if (!state.snapshots.current && !state.snapshots.candidate && !state.snapshots.last_known_good) activation = await H.checkRemoteUpdates('extension-install');
      else activation = await H.reconcileTarget(`extension-${details.reason}`);
      if (details.reason === 'install' || !activation.ok || activation.status === 'permission_required') await chrome.tabs.create({ url: chrome.runtime.getURL('pages/onboarding.html') });
    } catch (error) {
      await H.mutate(async (state) => C.appendEvidence(state, { type: 'extension.install.failed', detail: String(error && error.message || error) }));
      await chrome.tabs.create({ url: chrome.runtime.getURL('pages/recovery.html') });
    }
  });
  chrome.runtime.onStartup.addListener(async () => {
    try {
      const state = await H.storageGet();
      if (state.snapshots.current || state.snapshots.last_known_good) await H.reconcileTarget('browser-startup');
      await H.maybeCheckRemoteUpdates('browser-startup');
    } catch (error) { await H.mutate(async (state) => C.appendEvidence(state, { type: 'startup.failed', detail: String(error && error.message || error) })); }
  });
  chrome.runtime.onUpdateAvailable.addListener(async (details) => {
    await H.mutate(async (state) => { state.update.base.available_version = details && details.version || null; C.appendEvidence(state, { type: 'base.update.available', version: details && details.version || null }); });
  });
  chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('pages/recovery.html') }));
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'dcf-plugin-update-check') { await H.maybeCheckRemoteUpdates('scheduled'); return; }
    if (alarm.name !== 'dcf-candidate-timeout') return;
    const state = await H.storageGet();
    if (!state.snapshots.candidate) return;
    const tabs = await H.chatGptTabs();
    if (!tabs.length) { await H.mutate(async (next) => C.appendEvidence(next, { type: 'candidate.awaiting_page', snapshot_id: next.snapshots.candidate && next.snapshots.candidate.id })); return; }
    const required = state.snapshots.candidate.entries.filter((entry) => entry.enabled !== false).map((entry) => entry.id);
    const started = H.candidateStartedSet(state);
    const missing = required.filter((id) => !started.has(id));
    if (missing.length) await H.rollbackToLastKnownGood(`candidate-timeout:${missing.join(',')}`);
  });
  chrome.alarms.create('dcf-plugin-update-check', { periodInMinutes: 360 });
})(self);
