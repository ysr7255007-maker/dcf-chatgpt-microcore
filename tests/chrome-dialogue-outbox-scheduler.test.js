'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.InputEvent = class InputEvent { constructor() {} };
global.Event = class Event { constructor() {} };

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');
const start = code.indexOf('const composer = () =>');
const end = code.indexOf('async function returnPermissionRequest', start);
assert(start >= 0 && end > start, 'outbox state machine is extractable');
assert(!code.includes('async function confirmDelivery'), 'confirmation is tick-driven, not a sleep loop');

let now = 1000;
function button({ visible = true, disabled = false, testid = 'stop-button', click } = {}) {
  return { hidden: !visible, disabled, getAttribute: (name) => name === 'aria-hidden' && !visible ? 'true' : null, getBoundingClientRect: () => visible ? { width: 12, height: 12 } : { width: 0, height: 0 }, click: click || (() => {}), dataset: { testid } };
}
function runtime({ stops = [], send = button({ testid: 'send-button' }), value = '' } = {}) {
  const area = { querySelectorAll: (sel) => sel.includes('stop-button') ? stops : [], querySelector: (sel) => sel.includes('send-button') ? send : null };
  const target = { value, parentElement: area, closest: () => area, focus() {}, dispatchEvent() {} };
  const users = [];
  const document = { querySelector: (sel) => sel.includes('prompt') || sel.includes('composer') ? target : null };
  const state = { settings: { auto_send_results: true }, delivery_state: 'healthy', delivery_status: 'ready', execution_status: '本机执行中', status: '本机执行中' };
  const outbox = { items: [], status: '', sending: false };
  const factory = new Function('document', 'state', 'outbox', 'Date', 'setTimeout', 'destroyed', 'conversationRoot', 'pageConversationRoot', 'persist', 'render', 'hash', 'pendingArtifact', 'pendingForceSend', 'OUTBOX_TICK_MS', 'DELIVERY_CONFIRM_MS', 'DELIVERY_DEGRADED_AFTER_MS', `${code.slice(start, end)}\nreturn { isStreaming, outboxPump, checkConfirmation, sendArtifact, artifactPriority };`);
  const api = factory(document, state, outbox, { now: () => now }, () => 0, false, { querySelectorAll: () => users }, () => ({ querySelectorAll: () => users }), async () => {}, () => {}, (v) => `h${String(v).length}`, '', false, 250, 15000, 60000);
  return { api, state, outbox, target, users, area };
}

(async () => {
  let rt = runtime({ stops: [button({ visible: false })] });
  assert.strictEqual(rt.api.isStreaming(rt.target), false, 'hidden stop is not streaming');
  rt = runtime({ stops: [button({ disabled: true })] });
  assert.strictEqual(rt.api.isStreaming(rt.target), false, 'disabled stop is not streaming');
  rt = runtime({ stops: [button()] });
  assert.strictEqual(rt.api.isStreaming(rt.target), true, 'visible active composer stop is streaming');

  rt = runtime({ stops: [button()] });
  rt.outbox.items.push({ id: 'progress.v1:req:s:1', text: 'p', state: 'queued', created_at: now, attempts: 0 });
  await rt.api.outboxPump();
  assert.strictEqual(rt.outbox.items[0].state, 'waiting_page_idle', 'page generation is normal transport waiting');
  assert.strictEqual(rt.state.delivery_status, 'waiting_page_idle');
  assert.strictEqual(rt.state.execution_status, '本机执行中', 'delivery waiting never overwrites execution status');
  assert.notStrictEqual(rt.state.delivery_status, 'degraded');

  let clicked = [];
  rt = runtime({ send: button({ testid: 'send-button', click: () => clicked.push('send') }) });
  rt.outbox.items.push({ id: 'progress.v1:req:s:1', text: 'old', state: 'awaiting_confirmation', created_at: now - 1, attempts: 1, baseline_users: 0, confirmation_deadline: now + 1000 });
  rt.outbox.items.push({ id: 'progress.v1:req:s:ack:status:x', text: 'status', state: 'queued', created_at: now, attempts: 0 });
  await rt.api.outboxPump();
  assert.strictEqual(rt.outbox.items[1].state, 'awaiting_confirmation', 'status ACK is scheduled while old progress awaits confirmation');
  assert.strictEqual(clicked.length, 1);

  now += 16000;
  rt.api.checkConfirmation(rt.outbox.items[1], now);
  assert.strictEqual(rt.outbox.items[1].state, 'retry_wait', 'confirmation deadline schedules retry instead of stopping');
  assert(rt.outbox.items[1].next_retry_at > now);

  rt = runtime();
  for (let i = 0; i < 8; i += 1) rt.outbox.items.push({ id: `progress.v1:req:s:${i}`, text: 'old', state: 'queued', created_at: now, attempts: 0 });
  rt.api.sendArtifact('<<<DCF_LOCAL_AGENT_PROGRESS>>>\n{"schema":"dcf.local-agent.progress.v1","request_id":"req","session_id":"s","seq":99,"ack":{"command":"cancel"}}\n<<<END_DCF_LOCAL_AGENT_PROGRESS>>>', true);
  assert(rt.outbox.items.some((entry) => entry.id.includes('ack:cancel')), 'heartbeat compaction preserves cancel ACK');
  assert.strictEqual(rt.api.artifactPriority(rt.outbox.items.find((entry) => entry.id.includes('ack:cancel'))), 1);

  const source = code.slice(start, end);
  assert(!/await\s+sleep\(500\)/.test(source), 'outbox contains no long confirmation polling loop');
  console.log(JSON.stringify({ ok: true, hidden_stop_ignored: true, transport_wait_isolated: true, priority_preempts_old_confirmation: true, timeout_retries: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
