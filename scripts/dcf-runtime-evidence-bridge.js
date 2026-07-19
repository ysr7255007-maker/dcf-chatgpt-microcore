#!/usr/bin/env node
'use strict';

// A deliberately small, dependency-free loopback collector. It accepts only
// schema-validated, browser-produced evidence and never executes commands.
const http = require('http');
const crypto = require('crypto');

const host = process.env.DCF_RUNTIME_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.env.DCF_RUNTIME_BRIDGE_PORT || 4178);
const maxBody = 128 * 1024;
const maxEvents = 256;
const retentionMs = 30 * 60 * 1000;
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
function cleanEvents(runtime) {
  const cutoff = Date.now() - retentionMs;
  runtime.events = runtime.events.filter((event) => event.at_ms >= cutoff).slice(-maxEvents);
}
function health(runtime) {
  if (!runtime) return { status: 'blocked', conclusion: 'Browser bridge is offline.', failed_stage: 'bridge', evidence: [], suggested_action: 'Start the bridge and enable it in DCF.', user_intervention_required: false };
  const snapshot = runtime.snapshot || {};
  const failures = [];
  const add = (condition, stage, evidence, action) => { if (!condition) failures.push({ stage, evidence, action }); };
  add(snapshot.bridge?.enabled, 'bridge', 'Browser evidence publishing is disabled.', 'Enable the evidence bridge in DCF.');
  add(snapshot.extension?.current?.entries?.length, 'plugins', 'No current plugin snapshot was reported.', 'Run DCF update/recovery.');
  add(snapshot.shell?.mounted, 'shell', 'The DCF shell is not mounted.', 'Reload or recover the current ChatGPT page.');
  add(snapshot.dialogue?.observer_generation, 'dialogue', 'Dialogue observer has no generation.', 'Inspect Dialogue lifecycle evidence.');
  add(snapshot.local_agent?.connected, 'local-agent', 'OpenCode is not connected.', 'Start or reconnect OpenCode.');
  if (snapshot.outbox?.pending_count > 0) failures.push({ stage: 'outbox', evidence: `${snapshot.outbox.pending_count} artifact(s) remain unconfirmed.`, action: 'Wait for confirmation or retry after the page is idle.' });
  const recentRecovery = Number(snapshot.dialogue?.recoveries || 0) > 0 || Boolean(snapshot.recovery?.last_reason);
  if (recentRecovery) failures.push({ stage: 'recovery', evidence: 'A recent runtime recovery was reported.', action: 'Review the bounded event timeline.' });
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
      runtime.commands.push({ id: crypto.randomUUID(), type: kind, created_at: now() });
      runtime.commands = runtime.commands.slice(-16); recordAudit(kind, runtime.id);
      return json(response, 202, { schema: 'dcf.runtime.diagnostic-command.v1', accepted: true, runtime_id: runtime.id, command: kind });
    }
    if (request.method === 'GET' && url.pathname === '/dcf/runtime/commands') {
      if (!runtime) return json(response, 404, { error: 'runtime_not_found' });
      const commands = runtime.commands.splice(0, runtime.commands.length); recordAudit('commands.read', runtime.id, String(commands.length));
      return json(response, 200, { schema: 'dcf.runtime.command-poll.v1', commands });
    }
    if (request.method === 'POST' && url.pathname === '/dcf/runtime/publish') {
      const payload = await readBody(request);
      const id = safeRuntimeId(payload.runtime_id);
      if (payload.schema !== 'dcf.runtime.publish.v1' || !payload.snapshot || payload.snapshot.schema !== 'dcf.runtime.snapshot.v1') throw new Error('invalid_publish_schema');
      const eventList = Array.isArray(payload.events) ? payload.events : [];
      if (eventList.length > 64 || eventList.some((event) => event.schema !== 'dcf.runtime.event.v1' || typeof event.summary !== 'string' || event.summary.length > 240)) throw new Error('invalid_event_batch');
      let entry = runtimes.get(id);
      if (!entry || entry.generation !== String(payload.generation || '')) entry = { id, generation: String(payload.generation || ''), events: [], commands: [], next_seq: 1 };
      entry.snapshot = payload.snapshot; entry.last_seen_at = now(); entry.last_seen_ms = Date.now();
      for (const event of eventList) entry.events.push({ ...event, seq: entry.next_seq++, at_ms: Date.now() });
      cleanEvents(entry); runtimes.set(id, entry); recordAudit('publish', id, `events=${eventList.length}`);
      return json(response, 200, { ok: true, schema: 'dcf.runtime.publish-ack.v1', runtime_id: id, generation: entry.generation, last_seq: entry.next_seq - 1 });
    }
    return json(response, 404, { error: 'not_found' });
  } catch (error) { return json(response, 400, { error: bounded(error.message || error) }); }
});
server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ schema: 'dcf.runtime.bridge.v1', status: 'listening', host, port, loopback_only: true })}\n`));
