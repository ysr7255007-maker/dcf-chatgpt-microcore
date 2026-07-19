#!/usr/bin/env node
'use strict';

// A deliberately small, dependency-free loopback collector. It accepts only
// schema-validated, browser-produced evidence and never executes commands.
const http = require('http');
const crypto = require('crypto');

const host = process.env.DCF_RUNTIME_BRIDGE_HOST || '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('DCF_RUNTIME_BRIDGE_HOST must be loopback');
const port = Number(process.env.DCF_RUNTIME_BRIDGE_PORT || 4178);
const maxBody = 128 * 1024;
const maxEvents = 256;
const retentionMs = 30 * 60 * 1000;
const staleMs = Number(process.env.DCF_RUNTIME_BRIDGE_STALE_MS || 15000);
const allowedOrigins = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
const runtimes = new Map();
const audit = [];

function now() { return new Date().toISOString(); }
function bounded(value, limit = 240) { return String(value || '').slice(0, limit); }
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function cors(request, response) {
  const origin = String(request.headers.origin || '');
  if (allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
function recordAudit(type, runtimeId, detail = '') {
  audit.push({ at: now(), type, runtime_id: runtimeId || null, detail: bounded(detail) });
  if (audit.length > 128) audit.shift();
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBody) { reject(new Error('body_too_large')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
}
function safeRuntimeId(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id)) throw new Error('invalid_runtime_id');
  return id;
}
function cleanRuntimes() {
  const cutoff = Date.now() - retentionMs;
  for (const [id, runtime] of runtimes) if (runtime.last_seen_ms < cutoff) runtimes.delete(id);
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function only(value, keys) { const source = object(value); if (!source || Object.keys(source).some((key) => !keys.includes(key))) throw new Error('unknown_snapshot_field'); return source; }
function nullableString(value, limit = 240) { return value == null ? null : String(value).slice(0, limit); }
function cleanPlugin(value) { const item = only(value, ['id', 'version', 'hash', 'enabled', 'registered', 'running', 'startup_generation', 'recent_failure']); return { id: nullableString(item.id, 160), version: nullableString(item.version, 160), hash: nullableString(item.hash, 128), enabled: Boolean(item.enabled), registered: Boolean(item.registered), running: Boolean(item.running), startup_generation: nullableString(item.startup_generation, 160), recent_failure: nullableString(item.recent_failure) }; }
function cleanSnapshotRef(value) { if (value == null) return null; const item = only(value, ['id', 'created_at', 'reason', 'entries']); const entries = Array.isArray(item.entries) ? item.entries : (() => { throw new Error('invalid_snapshot_entries'); })(); if (entries.length > 32) throw new Error('snapshot_entries_too_large'); return { id: nullableString(item.id, 160), created_at: nullableString(item.created_at, 64), reason: nullableString(item.reason, 160), entries: entries.map((entry) => { const clean = only(entry, ['id', 'version', 'hash', 'enabled']); return { id: nullableString(clean.id, 160), version: nullableString(clean.version, 160), hash: nullableString(clean.hash, 128), enabled: Boolean(clean.enabled) }; }) }; }
function cleanOutboxItem(value) { const item = only(value, ['schema', 'request_id', 'session_id', 'seq', 'state', 'attempts', 'last_error']); return { schema: nullableString(item.schema, 160), request_id: nullableString(item.request_id, 160), session_id: nullableString(item.session_id, 160), seq: item.seq == null ? null : Number(item.seq), state: nullableString(item.state, 80), attempts: Number(item.attempts || 0), last_error: nullableString(item.last_error) }; }
function sanitizeSnapshot(raw) {
  const value = only(raw, ['schema', 'generated_at', 'runtime_id', 'generation', 'bridge', 'extension', 'shell', 'dialogue', 'local_agent', 'outbox', 'page_lifecycle', 'recovery', 'privacy']);
  if (value.schema !== 'dcf.runtime.snapshot.v1') throw new Error('invalid_snapshot_schema');
  const bridge = only(value.bridge, ['enabled', 'endpoint', 'client_connected', 'last_ack_at', 'last_failure_at', 'consecutive_failures']);
  const extension = only(value.extension, ['version', 'user_scripts_available', 'candidate', 'current', 'last_known_good', 'plugins']);
  const shell = only(value.shell, ['mounted', 'mount_generation', 'active_panel', 'pinned_panels', 'panel_count']);
  const dialogue = only(value.dialogue, ['observer_generation', 'last_mutation_at', 'last_consume_at', 'last_watchdog_at', 'recoveries', 'last_recovery_reason', 'queue_length', 'active_request_id', 'active_session_id', 'stage', 'status', 'waiting_permission', 'active_last_activity_at', 'last_recovery_at', 'outbox_pending_count', 'outbox_states']);
  const local = only(value.local_agent, ['connected', 'endpoint', 'selected_session_id', 'session_status', 'last_poll_at', 'endpoint_errors', 'poll_failures']);
  const outbox = only(value.outbox, ['pending_count', 'states']);
  const lifecycle = only(value.page_lifecycle, ['visibility', 'focused', 'running', 'ring_size', 'analysis', 'summary', 'page_diagnostics_running']);
  const recovery = only(value.recovery, ['last_reason', 'last_recovery_at', 'count']);
  const privacy = only(value.privacy, ['conversation_text_included', 'assistant_text_included', 'credentials_included', 'cookies_included', 'raw_dom_included', 'raw_logs_included', 'reasoning_included']);
  if (Object.values(privacy).some(Boolean)) throw new Error('privacy_boundary_violation');
  const plugins = Array.isArray(extension.plugins) ? extension.plugins : (() => { throw new Error('invalid_plugins'); })();
  if (plugins.length > 32) throw new Error('plugins_too_large');
  const states = Array.isArray(outbox.states) ? outbox.states : (() => { throw new Error('invalid_outbox'); })();
  if (states.length > 16) throw new Error('outbox_too_large');
  return { schema: value.schema, generated_at: nullableString(value.generated_at, 64), runtime_id: nullableString(value.runtime_id, 160), generation: nullableString(value.generation, 160), bridge: { enabled: Boolean(bridge.enabled), endpoint: nullableString(bridge.endpoint, 240), client_connected: Boolean(bridge.client_connected), last_ack_at: nullableString(bridge.last_ack_at, 64), last_failure_at: nullableString(bridge.last_failure_at, 64), consecutive_failures: Number(bridge.consecutive_failures || 0) }, extension: { version: nullableString(extension.version, 160), user_scripts_available: Boolean(extension.user_scripts_available), candidate: cleanSnapshotRef(extension.candidate), current: cleanSnapshotRef(extension.current), last_known_good: cleanSnapshotRef(extension.last_known_good), plugins: plugins.map(cleanPlugin) }, shell: { mounted: Boolean(shell.mounted), mount_generation: nullableString(shell.mount_generation, 160), active_panel: nullableString(shell.active_panel, 160), pinned_panels: (Array.isArray(shell.pinned_panels) ? shell.pinned_panels : []).slice(0, 16).map((item) => nullableString(item, 160)), panel_count: Number(shell.panel_count || 0) }, dialogue: { ...dialogue, outbox_states: Array.isArray(dialogue.outbox_states) ? dialogue.outbox_states.slice(0, 16).map(cleanOutboxItem) : [] }, local_agent: { ...local, endpoint_errors: object(local.endpoint_errors) || {} }, outbox: { pending_count: Number(outbox.pending_count || 0), states: states.map(cleanOutboxItem) }, page_lifecycle: lifecycle, recovery, privacy: Object.fromEntries(Object.keys(privacy).map((key) => [key, false])) };
}
function cleanEvents(runtime) {
  const cutoff = Date.now() - retentionMs;
  runtime.events = runtime.events.filter((event) => event.at_ms >= cutoff).slice(-maxEvents);
}
function health(runtime) {
  if (!runtime) return { status: 'blocked', conclusion: 'Browser bridge is offline.', failed_stage: 'bridge', evidence: [], suggested_action: 'Start the bridge and enable it in DCF.', user_intervention_required: false };
  if (Date.now() - runtime.last_seen_ms > staleMs) return { status: 'blocked', conclusion: 'Browser evidence is stale.', failed_stage: 'bridge', evidence: [`Last publish: ${runtime.last_seen_at}`], suggested_action: 'Restore browser publishing before accepting runtime state.', user_intervention_required: false };
  const snapshot = runtime.snapshot || {};
  const failures = [];
  const add = (condition, stage, evidence, action) => { if (!condition) failures.push({ stage, evidence, action }); };
  add(snapshot.bridge?.enabled, 'bridge', 'Browser evidence publishing is disabled.', 'Enable the evidence bridge in DCF.');
  const plugins = Array.isArray(snapshot.extension?.plugins) ? snapshot.extension.plugins : [];
  add(plugins.length, 'plugins', 'No plugin runtime records were reported.', 'Run DCF update/recovery.');
  for (const unit of plugins.filter((item) => item.enabled)) add(unit.registered && unit.running && !unit.recent_failure, 'plugins', `${unit.id} is not registered/running cleanly.`, 'Recover the plugin combination and inspect recent failure evidence.');
  add(snapshot.shell?.mounted, 'shell', 'The DCF shell is not mounted.', 'Reload or recover the current ChatGPT page.');
  add(snapshot.dialogue?.observer_generation, 'dialogue', 'Dialogue observer has no generation.', 'Inspect Dialogue lifecycle evidence.');
  add(snapshot.local_agent?.connected, 'local-agent', 'OpenCode is not connected.', 'Start or reconnect OpenCode.');
  if (snapshot.outbox?.pending_count > 0) failures.push({ stage: 'outbox', evidence: `${snapshot.outbox.pending_count} artifact(s) remain unconfirmed.`, action: 'Wait for confirmation or retry after the page is idle.' });
  const recoveryAge = Date.now() - Date.parse(snapshot.recovery?.last_recovery_at || 0);
  if (snapshot.recovery?.last_reason && recoveryAge < 60000 && !snapshot.shell?.mounted) failures.push({ stage: 'recovery', evidence: 'A recent recovery has not restored the Shell.', action: 'Review the bounded event timeline.' });
  const first = failures[0];
  return failures.length
    ? { status: 'failed', conclusion: `DCF runtime health check found ${failures.length} issue(s).`, failed_stage: first.stage, evidence: failures.map((item) => item.evidence), suggested_action: first.action, user_intervention_required: false }
    : { status: 'passed', conclusion: 'DCF browser runtime is online and its core surfaces are healthy.', failed_stage: null, evidence: ['Bridge, plugin snapshot, shell, Dialogue, and Local Agent are active.'], suggested_action: 'No action required.', user_intervention_required: false };
}
function publicRuntime(runtime) {
  if (!runtime) return null;
  cleanEvents(runtime);
  return { runtime_id: runtime.id, generation: runtime.generation, connected: Date.now() - runtime.last_seen_ms < 15000, last_seen_at: runtime.last_seen_at, snapshot: runtime.snapshot, next_seq: runtime.next_seq, event_count: runtime.events.length };
}

const server = http.createServer(async (request, response) => {
  cors(request, response);
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  const url = new URL(request.url, `http://${host}:${port}`);
  try {
    cleanRuntimes();
    if (request.method === 'GET' && url.pathname === '/dcf/runtime/connection') {
      const runtime = [...runtimes.values()].sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] || null;
      recordAudit('connection.read', runtime?.id);
      return json(response, 200, { schema: 'dcf.runtime.connection.v1', bridge: 'online', runtime: publicRuntime(runtime), audit_entries: audit.slice(-20) });
    }
    const runtimeId = url.searchParams.get('runtime_id');
    const runtime = runtimeId ? runtimes.get(safeRuntimeId(runtimeId)) : [...runtimes.values()].sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
    if (request.method === 'GET' && url.pathname === '/dcf/runtime/snapshot') {
      recordAudit('snapshot.read', runtime?.id);
      return json(response, runtime ? 200 : 404, runtime ? { schema: 'dcf.runtime.snapshot.v1', ...publicRuntime(runtime) } : { error: 'runtime_not_found' });
    }
    if (request.method === 'GET' && url.pathname === '/dcf/runtime/events') {
      if (!runtime) return json(response, 404, { error: 'runtime_not_found' });
      const since = Math.max(0, Number(url.searchParams.get('since') || 0));
      cleanEvents(runtime); recordAudit('events.read', runtime.id, `since=${since}`);
      return json(response, 200, { schema: 'dcf.runtime.event.v1', runtime_id: runtime.id, generation: runtime.generation, events: runtime.events.filter((event) => event.seq > since) });
    }
    if (request.method === 'POST' && url.pathname === '/dcf/runtime/checks/run') {
      recordAudit('health-check.run', runtime?.id);
      return json(response, 200, { schema: 'dcf.runtime.health-report.v1', generated_at: now(), runtime: publicRuntime(runtime), report: health(runtime) });
    }
    if (request.method === 'POST' && /^\/dcf\/runtime\/diagnostic\/(start|stop)$/.test(url.pathname)) {
      if (!runtime) return json(response, 404, { error: 'runtime_not_found' });
      const kind = url.pathname.endsWith('/start') ? 'diagnostic.start' : 'diagnostic.stop';
      runtime.commands.push({ command_id: crypto.randomUUID(), type: kind, state: 'queued', created_at: now(), delivered_at: null, applied_at: null, error: null, report: null });
      runtime.commands = runtime.commands.slice(-16); recordAudit(kind, runtime.id);
      return json(response, 202, { schema: 'dcf.runtime.diagnostic-command.v1', accepted: true, runtime_id: runtime.id, command: kind });
    }
    if (request.method === 'GET' && url.pathname === '/dcf/runtime/commands') {
      if (!runtime) return json(response, 404, { error: 'runtime_not_found' });
      const commands = runtime.commands.filter((command) => command.state === 'queued' || command.state === 'delivered');
      for (const command of commands) { command.state = 'delivered'; command.delivered_at = command.delivered_at || now(); }
      recordAudit('commands.deliver', runtime.id, String(commands.length));
      return json(response, 200, { schema: 'dcf.runtime.command-poll.v1', commands });
    }
    const commandAck = url.pathname.match(/^\/dcf\/runtime\/commands\/([a-f0-9-]+)\/ack$/);
    if (request.method === 'POST' && commandAck) {
      if (!runtime) return json(response, 404, { error: 'runtime_not_found' });
      const body = await readBody(request); const command = runtime.commands.find((item) => item.command_id === commandAck[1]);
      if (!command || body.schema !== 'dcf.runtime.command-ack.v1' || body.command_id !== command.command_id || !['applied', 'failed'].includes(body.status)) throw new Error('invalid_command_ack');
      command.state = body.status; command.applied_at = now(); command.report = body.report || null; command.error = body.error ? bounded(body.error) : null;
      recordAudit('command.ack', runtime.id, `${command.type}:${command.state}`); return json(response, 200, { ok: true, schema: 'dcf.runtime.command-ack.v1', command_id: command.command_id, state: command.state });
    }
    if (request.method === 'POST' && url.pathname === '/dcf/runtime/publish') {
      const payload = await readBody(request);
      const id = safeRuntimeId(payload.runtime_id);
      if (payload.schema !== 'dcf.runtime.publish.v1') throw new Error('invalid_publish_schema');
      const eventList = Array.isArray(payload.events) ? payload.events : [];
      if (eventList.length > 64 || eventList.some((event) => event.schema !== 'dcf.runtime.event.v1' || typeof event.summary !== 'string' || event.summary.length > 240)) throw new Error('invalid_event_batch');
      let entry = runtimes.get(id);
      if (!entry || entry.generation !== String(payload.generation || '')) entry = { id, generation: String(payload.generation || ''), events: [], commands: [], next_seq: 1 };
      entry.snapshot = sanitizeSnapshot(payload.snapshot); entry.last_seen_at = now(); entry.last_seen_ms = Date.now();
      for (const event of eventList) entry.events.push({ ...event, seq: entry.next_seq++, at_ms: Date.now() });
      cleanEvents(entry); runtimes.set(id, entry); recordAudit('publish', id, `events=${eventList.length}`);
      return json(response, 200, { ok: true, schema: 'dcf.runtime.publish-ack.v1', runtime_id: id, generation: entry.generation, last_seq: entry.next_seq - 1 });
    }
    return json(response, 404, { error: 'not_found' });
  } catch (error) { return json(response, 400, { error: bounded(error.message || error) }); }
});
server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ schema: 'dcf.runtime.bridge.v1', status: 'listening', host, port, loopback_only: true })}\n`));
