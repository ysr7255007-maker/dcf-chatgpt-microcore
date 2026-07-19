(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.runtime-evidence';
  const UNIT_VERSION = '1.0.0-rc.2-runtime-evidence.1';
  const PANEL_ID = 'runtime-evidence';
  const HOST_ID = 'dcf-panel-runtime-evidence';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_RUNTIME_EVIDENCE__';
  const DEFAULTS = Object.freeze({ enabled: false, endpoint: 'http://127.0.0.1:4178', interval_ms: 2000 });
  const previous = globalThis[GLOBAL_KEY];
  previous?.destroy?.();

  const send = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
    return result;
  });
  let config = { ...DEFAULTS };
  let panel = null;
  let timer = null;
  let destroyed = false;
  let lastFingerprint = '';
  let pendingEvents = [];
  let lastError = '';
  let publishBusy = false;
  let consecutiveFailures = 0;
  let lastAckAt = null;
  let lastFailureAt = null;
  const runtimeId = `dcf_${crypto.randomUUID().replace(/-/g, '')}`;
  const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function bounded(value, limit = 240) { return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').slice(0, limit); }
  function endpoint() {
    const url = new URL(String(config.endpoint || DEFAULTS.endpoint));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error('Evidence bridge endpoint must be loopback origin only');
    return url.origin;
  }
  function push(source, type, summary, refs) {
    const event = { schema: 'dcf.runtime.event.v1', event_id: crypto.randomUUID(), timestamp: new Date().toISOString(), generation, source, type, summary: bounded(summary), refs: refs || {} };
    if (pendingEvents.some((item) => item.type === event.type && item.summary === event.summary && JSON.stringify(item.refs) === JSON.stringify(event.refs))) return;
    pendingEvents.push(event);
    pendingEvents = pendingEvents.slice(-32);
  }
  function plugin(name) { return globalThis[name] || null; }
  function shallow(value, keys) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(keys.map((key) => [key, source[key] == null ? null : source[key]]));
  }
  function snapshotIdentity(value) {
    if (!value || typeof value !== 'object') return null;
    return { id: bounded(value.id, 160), created_at: value.created_at || null, reason: bounded(value.reason, 160), entries: Array.isArray(value.entries) ? value.entries.slice(0, 32).map((entry) => ({ id: bounded(entry.id, 160), version: bounded(entry.version, 160), hash: bounded(entry.hash, 128), enabled: entry.enabled !== false })) : [] };
  }
  function scriptId(id) { return `dcf-unit-${String(id).replace(/^dcf\./, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`; }
  function unitGlobal(id) { return ({ 'dcf.firstparty.shell': '__DCF_FIRSTPARTY_SHELL__', 'dcf.firstparty.local-agent': '__DCF_FIRSTPARTY_LOCAL_AGENT__', 'dcf.firstparty.local-agent-dialogue': '__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__', 'dcf.firstparty.page-diagnostics': '__DCF_FIRSTPARTY_PAGE_DIAGNOSTICS__', 'dcf.firstparty.runtime-evidence': GLOBAL_KEY })[id] || null; }
  function pluginRecords(host, current) {
    const expected = Array.isArray(current?.entries) ? current.entries : [];
    const actual = new Set(Array.isArray(host.actual_scripts) ? host.actual_scripts : []);
    const evidence = Array.isArray(host.recent_evidence) ? host.recent_evidence : [];
    return expected.map((entry) => {
      const id = String(entry.id || ''); const key = unitGlobal(id); const unit = key ? plugin(key) : null;
      const failures = evidence.filter((item) => item?.unit_id === id && String(item.type || '').endsWith('failed')).slice(-1);
      return { id, version: entry.version || null, hash: entry.hash || null, enabled: entry.enabled !== false, registered: actual.has(scriptId(id)), running: Boolean(unit), startup_generation: unit?.version || 'unavailable', recent_failure: failures[0] ? bounded(failures[0].detail || failures[0].type) : null };
    });
  }
  function stableSnapshot(value) {
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.generated_at; delete copy.runtime_id; delete copy.generation;
    delete copy.bridge?.last_ack_at; delete copy.bridge?.last_failure_at; delete copy.bridge?.client_connected;
    return JSON.stringify(copy);
  }
  async function snapshot() {
    const host = await send({ type: 'host.status' });
    const dialogue = plugin('__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__');
    const local = plugin('__DCF_FIRSTPARTY_LOCAL_AGENT__');
    const shell = plugin('__DCF_FIRSTPARTY_SHELL__');
    const pageDiagnostics = plugin('__DCF_FIRSTPARTY_PAGE_DIAGNOSTICS__');
    const dialogueEvidence = dialogue?.readRuntimeEvidence?.() || {};
    const localEvidence = local?.readRuntimeEvidence?.() || {};
    const d = dialogue?.diagnostics || {};
    const current = host.snapshots?.current || host.snapshots?.last_known_good || null;
    const candidates = host.snapshots?.candidate || null;
    const shellEvidence = shell?.readRuntimeEvidence?.() || { mounted: false, mount_generation: 'unavailable', active_panel: 'unavailable', pinned_panels: [], panel_count: 0 };
    const plugins = pluginRecords(host, current);
    return {
      schema: 'dcf.runtime.snapshot.v1', generated_at: new Date().toISOString(), runtime_id: runtimeId, generation,
      bridge: { enabled: Boolean(config.enabled), endpoint: endpoint(), client_connected: Boolean(lastAckAt && !lastFailureAt), last_ack_at: lastAckAt, last_failure_at: lastFailureAt, consecutive_failures: consecutiveFailures },
      extension: { version: host.host_version || null, user_scripts_available: Boolean(host.user_scripts_available), candidate: snapshotIdentity(candidates), current: snapshotIdentity(current), last_known_good: snapshotIdentity(host.snapshots?.last_known_good), plugins },
      shell: shellEvidence,
      dialogue: { observer_generation: d.observer_generation || null, last_mutation_at: d.last_mutation_at || null, last_consume_at: d.last_consume_at || null, last_watchdog_at: d.last_watchdog_at || null, recoveries: Number(d.recoveries || 0), last_recovery_reason: d.last_recovery_reason || null, ...dialogueEvidence },
      local_agent: { ...localEvidence },
      outbox: { pending_count: Number(dialogueEvidence.outbox_pending_count || 0), states: Array.isArray(dialogueEvidence.outbox_states) ? dialogueEvidence.outbox_states : [] },
      page_lifecycle: { visibility: document.visibilityState, focused: document.hasFocus(), ...(pageDiagnostics?.readRuntimeEvidence?.() || { page_diagnostics_running: false }) },
      recovery: { last_reason: d.last_recovery_reason || null, last_recovery_at: dialogueEvidence.last_recovery_at || null, count: Number(d.recoveries || 0) },
      privacy: { conversation_text_included: false, assistant_text_included: false, credentials_included: false, cookies_included: false, raw_dom_included: false, raw_logs_included: false, reasoning_included: false }
    };
  }
  async function commandAck(command, status, report, error) {
    const response = await fetch(`${endpoint()}/dcf/runtime/commands/${encodeURIComponent(command.command_id)}/ack?runtime_id=${encodeURIComponent(runtimeId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify({ schema: 'dcf.runtime.command-ack.v1', command_id: command.command_id, status, report: report || null, error: error ? bounded(error) : null }) });
    if (!response.ok) throw new Error(`command ACK HTTP ${response.status}`);
  }
  async function pollCommands() {
    const response = await fetch(`${endpoint()}/dcf/runtime/commands?runtime_id=${encodeURIComponent(runtimeId)}`, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return;
    const body = await response.json();
    for (const command of Array.isArray(body.commands) ? body.commands : []) {
      const diagnostics = plugin('__DCF_FIRSTPARTY_PAGE_DIAGNOSTICS__');
      try {
        if (!diagnostics) throw new Error('page_diagnostics_unavailable');
        if (command.type === 'diagnostic.start') diagnostics.start();
        else if (command.type === 'diagnostic.stop') diagnostics.stop();
        else throw new Error('unsupported_command');
        const report = command.type === 'diagnostic.stop' ? diagnostics.readRuntimeEvidence?.() || null : null;
        await commandAck(command, 'applied', report);
        push('runtime-evidence', command.type, `Controlled diagnostic command ${command.type} applied.`, { command_id: command.command_id });
      } catch (error) { await commandAck(command, 'failed', null, error?.message || error); }
    }
  }
  async function publish() {
    if (!config.enabled || destroyed || publishBusy) return;
    publishBusy = true;
    try {
    const current = await snapshot();
    const fingerprint = stableSnapshot(current);
    if (fingerprint !== lastFingerprint) { push('runtime', 'snapshot.changed', 'Whitelisted runtime snapshot changed.'); lastFingerprint = fingerprint; }
    const events = pendingEvents.slice();
    const response = await fetch(`${endpoint()}/dcf/runtime/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store', body: JSON.stringify({ schema: 'dcf.runtime.publish.v1', runtime_id: runtimeId, generation, snapshot: current, events }) });
    if (!response.ok) throw new Error(`bridge HTTP ${response.status}`);
    const ack = await response.json();
    if (ack.schema !== 'dcf.runtime.publish-ack.v1') throw new Error('invalid publish ACK');
    pendingEvents.splice(0, events.length); lastAckAt = new Date().toISOString(); lastFailureAt = null; consecutiveFailures = 0;
    await pollCommands(); lastError = '';
    } catch (error) { consecutiveFailures += 1; lastFailureAt = new Date().toISOString(); throw error; } finally { publishBusy = false; }
  }
  async function persist() { await send({ type: 'plugin.data.set', plugin_id: UNIT_ID, data: config }); }
  function schedule() { clearInterval(timer); timer = config.enabled ? setInterval(() => publish().catch((error) => { lastError = bounded(error?.message || error); render(); }), Math.max(1000, Math.min(10000, Number(config.interval_ms) || 2000))) : null; }
  function style() { return ':host{display:block;font:13px/1.5 system-ui}.card{display:grid;gap:8px;border:1px solid #ddd;border-radius:8px;padding:10px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:#666;font-size:12px}.error{color:#b42318;font-size:12px}input{font:inherit;min-width:0;box-sizing:border-box;padding:6px}button{font:inherit;padding:6px 9px}'; }
  function render() {
    if (!panel) return;
    panel.shadowRoot.querySelector('.content').innerHTML = `<style>${style()}</style><section class="card"><div class="row"><b>Runtime evidence</b><span>${config.enabled ? 'enabled' : 'disabled'}</span></div><div class="muted">Whitelisted, read-only runtime state only. No conversation content, credentials, DOM, or logs are published.</div><label class="row"><input data-field="enabled" type="checkbox" ${config.enabled ? 'checked' : ''}> Enable local evidence bridge</label><label class="muted">Loopback endpoint <input data-field="endpoint" value="${String(config.endpoint).replace(/"/g, '&quot;')}"></label><div class="row"><button data-action="publish">Publish now</button><span class="muted">Generation ${generation}</span></div>${lastError ? `<div class="error">${lastError}</div>` : ''}</section>`;
    panel.shadowRoot.querySelector('[data-field="enabled"]').onchange = async (event) => { config.enabled = event.target.checked; await persist(); schedule(); if (config.enabled) await publish(); render(); };
    panel.shadowRoot.querySelector('[data-field="endpoint"]').onchange = async (event) => { config.endpoint = event.target.value.trim(); endpoint(); await persist(); schedule(); render(); };
    panel.shadowRoot.querySelector('[data-action="publish"]').onclick = () => publish().catch((error) => { lastError = bounded(error?.message || error); render(); });
  }
  async function start() {
    const saved = await send({ type: 'plugin.data.get', plugin_id: UNIT_ID });
    config = { ...DEFAULTS, ...(saved.data || {}) }; endpoint(); render(); schedule(); if (config.enabled) await publish();
  }
  function create() { panel = document.createElement('section'); panel.id = HOST_ID; panel.dataset.dcfPanelRoot = 'true'; panel.dataset.dcfPanelId = PANEL_ID; panel.dataset.dcfPanelTitle = 'Evidence'; panel.style.display = 'none'; const root = panel.attachShadow({ mode: 'open' }); root.innerHTML = '<div class="content"></div>'; document.documentElement.append(panel); document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID })); }
  function destroy() { destroyed = true; clearInterval(timer); panel?.remove(); panel = null; }
  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy, publish, snapshot, runtime_id: runtimeId, generation };
  try { document.getElementById(HOST_ID)?.remove(); create(); start().then(() => send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION })).catch((error) => send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: bounded(error?.message || error) })); } catch (error) { destroy(); send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: bounded(error?.message || error) }).catch(() => {}); }
})();
