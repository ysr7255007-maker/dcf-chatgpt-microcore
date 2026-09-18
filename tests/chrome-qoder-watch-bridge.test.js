'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pluginPath = path.join(root, 'chrome-extension/code-units/qoder-watch/main.js');
const code = fs.readFileSync(pluginPath, 'utf8');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((unit) => unit.id === 'dcf.firstparty.qoder-watch');
assert(ref, 'qoder watch plugin missing from release index');
assert.strictEqual(ref.version, '1.0.0-rc.2-qoder-watch.12');
assert.strictEqual(ref.phase, 58);
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);

for (const token of [
  "const UNIT_ID = 'dcf.firstparty.qoder-watch'",
  '127.0.0.1:4937',
  '/events/claim',
  '/ack',
  '/observe',
  '/clients/heartbeat',
  'already_visible',
  'verify_visible',
  'eligible=${health.eligible ? 1 : 0}',
  'composer contains an existing draft',
  "type: 'unit.started'"
]) assert(code.includes(token), `missing ${token}`);

function response(payload, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}

function newHarness() {
  const state = {
    sendClicks: 0,
    claimCalls: 0,
    ackCalls: 0,
    observeCalls: [],
    heartbeatCalls: [],
    claimQueries: [],
    transcript: [],
    ackObservedTranscript: null,
    submitted: null,
    pendingSubmission: false,
    buttonReadyCountdown: null,
    claimedEvent: null,
    claimReason: '',
    streaming: false,
    activeRequestWithoutStop: false
  };
  const inputEvents = [];
  const composer = {
    textContent: '',
    focus() {},
    dispatchEvent(event) {
      inputEvents.push(event.type);
      if (event.type === 'beforeinput') state.buttonReadyCountdown = 2;
    }
  };
  const sendButton = {
    disabled: true,
    getAttribute(name) { return name === 'aria-disabled' && this.disabled ? 'true' : null; },
    click() {
      state.sendClicks += 1;
      state.submitted = composer.textContent;
      state.pendingSubmission = true;
      composer.textContent = '';
    }
  };
  const document = {
    visibilityState: 'hidden',
    documentElement: { dataset: {} },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (selector.includes('prompt-textarea') || selector.includes('composer-text-input') || selector.includes('textarea') || selector.includes('contenteditable')) return composer;
      if (selector.includes('stop-button') || selector.includes('Stop') || selector.includes('停止')) return state.streaming ? { disabled: false } : null;
      if (selector.includes('send-button') || selector.includes('Send') || selector.includes('发送') || selector.includes('type="submit"')) {
        if (composer.textContent && !state.streaming) sendButton.disabled = false;
        return sendButton;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="user"]') {
        return state.transcript.map((text) => ({ innerText: text }));
      }
      if (selector.includes('section[data-turn="assistant"]')) {
        return state.activeRequestWithoutStop ? [{
          querySelector() { return null; }
        }] : [];
      }
      return [];
    }
  };
  const context = {
    console,
    document,
    location: { pathname: '/c/test', origin: 'https://chatgpt.com' },
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } },
    crypto: { randomUUID: () => 'client-1' },
    setTimeout: (fn, ms) => {
      if (state.buttonReadyCountdown !== null && state.buttonReadyCountdown > 0) {
        state.buttonReadyCountdown -= 1;
        if (state.buttonReadyCountdown === 0) sendButton.disabled = false;
      }
      if (state.pendingSubmission) {
        state.transcript.push(state.submitted);
        state.pendingSubmission = false;
      }
      if (ms <= 500) fn();
      return 1;
    },
    clearTimeout() {},
    InputEvent: class InputEvent { constructor(type) { this.type = type; } },
    Event: class Event { constructor(type) { this.type = type; } },
    fetch: async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/events/claim')) {
        state.claimCalls += 1;
        state.claimQueries.push(target);
        return response({ ok: true, event: state.claimedEvent, reason: state.claimReason });
      }
      if (target.includes('/observe')) {
        const body = JSON.parse(options.body);
        state.observeCalls.push(body);
        return response({ ok: true, event: {} });
      }
      if (target.includes('/clients/heartbeat')) {
        state.heartbeatCalls.push(JSON.parse(options.body));
        return response({ ok: true, client: {} });
      }
      if (target.includes('/ack')) {
        state.ackCalls += 1;
        state.ackObservedTranscript = state.transcript.slice();
        assert.strictEqual(options.method, 'POST');
        return response({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  return { state, api: context.__DCF_FIRSTPARTY_QODER_WATCH__, document, composer, inputEvents };
}

async function runBehavior() {
  // --- 1. a hidden but executable page still participates -----------------
  const hidden = newHarness();
  assert(hidden.api && typeof hidden.api.pollNow === 'function');
  await hidden.api.pollNow();
  assert.strictEqual(hidden.state.claimCalls, 1,
    'background tab must keep polling when its page execution context is alive');
  assert(hidden.state.claimQueries[0].includes('visible=0'),
    'visibility remains an observed fact; the page must not lie that it is visible');
  assert(hidden.state.claimQueries[0].includes('eligible=1'),
    'execution eligibility must be independent from tab visibility');
  hidden.api.destroy();

  // --- 2. a fresh event is typed, sent, confirmed and then ACKed ---------
  const h = newHarness();
  h.document.visibilityState = 'visible';
  h.state.claimedEvent = { id: 'evt-1', type: 'complete', message: 'Qoder 完成', deliver: true };
  await h.api.pollNow();
  assert.strictEqual(h.state.claimCalls, 1);
  assert(h.inputEvents.includes('beforeinput'), 'contenteditable delivery must emit beforeinput so ChatGPT internal composer state updates');
  assert.strictEqual(h.state.sendClicks, 1);
  assert.strictEqual(h.state.ackCalls, 1);
  assert.deepStrictEqual(h.state.ackObservedTranscript, ['Qoder 完成'],
    'event must be ACKed only after the user message is visibly delivered');
  assert.strictEqual(h.composer.textContent, '', 'successful delivery should leave the composer cleared by submission');
  const phases = h.state.observeCalls.map((call) => call.phase);
  assert(phases.includes('claim_received'), 'claim must be observed');
  assert(phases.includes('send_clicked'), 'send must be observed');
  assert(phases.includes('delivery_observed'), 'visible delivery must be observed before ACK');
  assert(phases.indexOf('delivery_observed') < phases.length, 'delivery observation must precede ACK');
  const claimQuery = h.state.claimQueries[0];
  for (const field of ['client_id', 'visible=1', 'eligible=1', 'conversation_path=', 'streaming=0', 'composer=1', 'last_error=']) {
    assert(claimQuery.includes(field), `claim must carry client health field ${field}`);
  }

  // --- 3. an occupied composer is never overwritten and never ACKed ------
  h.composer.textContent = 'existing draft';
  h.state.claimedEvent = { id: 'evt-2', type: 'complete', message: 'second', deliver: true };
  await h.api.pollNow();
  assert.strictEqual(h.state.claimCalls, 2);
  assert.strictEqual(h.state.sendClicks, 1, 'occupied composer must not send');
  assert.strictEqual(h.state.ackCalls, 1, 'failed send must not ack');
  const failurePhases = h.state.observeCalls.map((call) => call.phase);
  assert(failurePhases.includes('delivery_failed'), 'page-side failure must be reported to the adapter');
  assert.strictEqual(h.state.heartbeatCalls.length >= 1, true, 'a page-side failure must also heartbeat its real state');

  // --- 4. an event the transport already knows is visible is ACKed without sending
  const h2 = newHarness();
  h2.document.visibilityState = 'visible';
  h2.state.claimedEvent = {
    id: 'evt-3', type: 'complete', message: 'Qoder 完成', deliver: false,
    already_visible: true, state: 'visible_pending_ack', visible_at: '2026-09-13T08:00:00+0800'
  };
  await h2.api.pollNow();
  assert.strictEqual(h2.state.sendClicks, 0, 'an already-visible delivery must never be re-sent');
  assert.strictEqual(h2.state.ackCalls, 1, 'an already-visible delivery must still be ACKed');
  const already = h2.state.observeCalls.find((call) => call.phase === 'delivery_already_visible');
  assert(already, 'the ACK-without-send decision must be recorded');
  assert.strictEqual(already.details.acked_without_send, true);

  // --- 5. an unconfirmed earlier send is resolved from the transcript -----
  const h3 = newHarness();
  h3.document.visibilityState = 'visible';
  h3.state.transcript = ['older message', 'Qoder 完成'];
  h3.state.claimedEvent = {
    id: 'evt-4', type: 'complete', message: 'Qoder 完成', deliver: false, verify_visible: true,
    state: 'blocked', blocker: 'send_unconfirmed'
  };
  await h3.api.pollNow();
  assert.strictEqual(h3.state.sendClicks, 0, 'a possibly-sent message must not be sent again');
  assert.strictEqual(h3.state.ackCalls, 1);
  const recovered = h3.state.observeCalls.find((call) => call.phase === 'delivery_already_visible');
  assert(recovered, 'the transcript must be able to prove the earlier send landed');
  assert.strictEqual(recovered.details.proof, 'transcript_text');
  assert.strictEqual(recovered.details.acked_without_send, true);

  // --- 6. an unconfirmed send that is really absent is released ----------
  const h4 = newHarness();
  h4.document.visibilityState = 'visible';
  h4.state.claimedEvent = {
    id: 'evt-5', type: 'complete', message: 'Qoder 完成', deliver: false, verify_visible: true,
    state: 'blocked', blocker: 'send_unconfirmed'
  };
  await h4.api.pollNow();
  const absentIndex = h4.state.observeCalls.findIndex((call) => call.phase === 'delivery_absent');
  assert(absentIndex >= 0, 'a proven absence must be reported to the adapter');
  assert.strictEqual(h4.state.sendClicks, 1, 'a proven absence may then be delivered normally');
  assert.strictEqual(h4.state.ackCalls, 1, 'the delivery is ACKed only after it is really visible');
  const observedIndex = h4.state.observeCalls.findIndex((call) => call.phase === 'delivery_observed');
  assert(observedIndex > absentIndex, 'absence is established before the first real send');

  // --- 7. a streaming page does not claim or touch the composer -----------
  const h5 = newHarness();
  h5.document.visibilityState = 'visible';
  h5.state.streaming = true;
  h5.state.claimedEvent = { id: 'evt-6', type: 'complete', message: 'must wait', deliver: true };
  await h5.api.pollNow();
  assert.strictEqual(h5.state.claimCalls, 0, 'streaming page must not claim delivery work');
  assert.strictEqual(h5.composer.textContent, '', 'streaming page must not stage re-entry text');
  assert.strictEqual(h5.state.sendClicks, 0);

  // --- 8. an active tool/thinking request stays blocked without Stop ------
  const activeNoStop = newHarness();
  activeNoStop.document.visibilityState = 'hidden';
  activeNoStop.state.activeRequestWithoutStop = true;
  activeNoStop.state.claimedEvent = { id: 'evt-active', type: 'complete', message: 'must not interrupt', deliver: true };
  await activeNoStop.api.pollNow();
  assert.strictEqual(activeNoStop.state.claimCalls, 0,
    'an active assistant request must not be interrupted merely because Stop is absent');
  assert.strictEqual(activeNoStop.state.heartbeatCalls.length >= 1, true,
    'active request must report health while waiting');
  activeNoStop.api.destroy();

  // --- 8. a semantically identical staged draft belongs to this event -----
  const h6 = newHarness();
  h6.document.visibilityState = 'visible';
  h6.composer.textContent = 'same\u00a0message';
  h6.state.claimedEvent = { id: 'evt-7', type: 'complete', message: 'same message', deliver: true };
  await h6.api.pollNow();
  assert.strictEqual(h6.state.sendClicks, 1, 'same-event staged text must be resumed, not treated as a foreign draft');
  assert.strictEqual(h6.state.ackCalls, 1);

  // --- 9. direct Experience exposes a stable transcript identity -----------
  assert.deepStrictEqual(
    Array.from(h.api.transcript.identityAnchors('EXPERIENCE_RUN_ID: run-123\nNEXT_ACTION: continue')),
    ['run-123']);

  // --- 10. the transcript helpers stay pure and testable ------------------
  assert.strictEqual(h.api.transcript.normalizeText('  a\u00a0 b '), 'a b');
  assert.strictEqual(
    JSON.stringify(h.api.transcript.identityAnchors('CONTINUATION_ID: reentry:x#1\nNEXT_ACTION: go')),
    JSON.stringify(['reentry:x#1']));

  h.api.destroy();
  h2.api.destroy();
  h3.api.destroy();
  h4.api.destroy();
  h5.api.destroy();
  h6.api.destroy();
}

runBehavior().then(() => {
  console.log(JSON.stringify({
    ok: true,
    background_tab_claim: true,
    successful_send_is_acked_after_visible_delivery: true,
    occupied_composer_is_not_overwritten: true,
    failed_send_is_not_acked: true,
    already_visible_is_acked_without_resending: true,
    unconfirmed_send_is_resolved_from_the_transcript: true,
    proven_absence_is_reported_then_delivered: true,
    client_health_is_reported: true
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
