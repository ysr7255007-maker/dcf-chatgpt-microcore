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
assert.strictEqual(ref.version, '1.0.0-rc.2-qoder-watch.2');
assert.strictEqual(ref.phase, 58);
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);

for (const token of [
  "const UNIT_ID = 'dcf.firstparty.qoder-watch'",
  '127.0.0.1:4937',
  '/events/claim',
  '/ack',
  "document.visibilityState !== 'visible'",
  'composer contains an existing draft',
  "type: 'unit.started'"
]) assert(code.includes(token), `missing ${token}`);

function response(payload, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}

async function runBehavior() {
  let sendClicks = 0;
  let claimCalls = 0;
  let ackCalls = 0;
  let userMessages = 0;
  let submissionPending = false;
  let buttonReadyCountdown = null;
  let ackObservedUserMessages = -1;
  const inputEvents = [];
  let claimedEvent = { id: 'evt-1', type: 'complete', message: 'Qoder 完成' };
  const composer = { textContent: '', focus() {}, dispatchEvent(event) { inputEvents.push(event.type); if (event.type === 'beforeinput') buttonReadyCountdown = 2; } };
  const sendButton = { disabled: true, getAttribute(name) { return name === 'aria-disabled' && this.disabled ? 'true' : null; }, click() { sendClicks += 1; submissionPending = true; composer.textContent = ''; } };
  const document = {
    visibilityState: 'hidden',
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (selector.includes('prompt-textarea') || selector.includes('composer-text-input') || selector.includes('textarea') || selector.includes('contenteditable')) return composer;
      if (selector.includes('stop-button') || selector.includes('Stop') || selector.includes('停止')) return null;
      if (selector.includes('send-button') || selector.includes('Send') || selector.includes('发送') || selector.includes('type=\"submit\"')) return sendButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role=\"user\"]') return Array.from({ length: userMessages }, (_, i) => ({ innerText: i === userMessages - 1 ? 'Qoder 完成' : 'old' }));
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
      if (buttonReadyCountdown !== null && buttonReadyCountdown > 0) {
        buttonReadyCountdown -= 1;
        if (buttonReadyCountdown === 0) sendButton.disabled = false;
      }
      if (submissionPending) { userMessages += 1; submissionPending = false; }
      if (ms <= 500) fn();
      return 1;
    },
    clearTimeout() {},
    InputEvent: class InputEvent { constructor(type) { this.type = type; } },
    Event: class Event { constructor(type) { this.type = type; } },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/events/claim')) {
        claimCalls += 1;
        return response({ ok: true, event: claimedEvent });
      }
      if (String(url).includes('/ack')) {
        ackCalls += 1;
        ackObservedUserMessages = userMessages;
        assert.strictEqual(options.method, 'POST');
        return response({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  const api = context.__DCF_FIRSTPARTY_QODER_WATCH__;
  assert(api && typeof api.pollNow === 'function');
  await api.pollNow();
  assert.strictEqual(claimCalls, 0, 'hidden page must not claim events');

  document.visibilityState = 'visible';
  await api.pollNow();
  assert.strictEqual(claimCalls, 1);
  assert(inputEvents.includes('beforeinput'), 'contenteditable delivery must emit beforeinput so ChatGPT internal composer state updates');
  assert.strictEqual(sendClicks, 1);
  assert.strictEqual(ackCalls, 1);
  assert.strictEqual(ackObservedUserMessages, 1, 'event must be ACKed only after the user message is visibly delivered');
  assert.strictEqual(composer.textContent, '', 'successful delivery should leave the composer cleared by submission');

  composer.textContent = 'existing draft';
  claimedEvent = { id: 'evt-2', type: 'complete', message: 'second' };
  await api.pollNow();
  assert.strictEqual(claimCalls, 2);
  assert.strictEqual(sendClicks, 1, 'occupied composer must not send');
  assert.strictEqual(ackCalls, 1, 'failed send must not ack');

  api.destroy();
}

runBehavior().then(() => {
  console.log(JSON.stringify({
    ok: true,
    visible_only_claim: true,
    successful_send_is_acked: true,
    occupied_composer_is_not_overwritten: true,
    failed_send_is_not_acked: true
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
