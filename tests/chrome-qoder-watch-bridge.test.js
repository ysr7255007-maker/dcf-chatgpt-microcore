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
assert.strictEqual(ref.version, '1.0.0-rc.2-qoder-watch.1');
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
  let claimedEvent = { id: 'evt-1', type: 'complete', message: 'Qoder 完成' };
  const composer = { value: '', focus() {}, dispatchEvent() {} };
  const sendButton = { disabled: false, click() { sendClicks += 1; } };
  const document = {
    visibilityState: 'hidden',
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (selector.includes('prompt-textarea') || selector.includes('composer-text-input') || selector.includes('textarea') || selector.includes('contenteditable')) return composer;
      if (selector.includes('send-button') || selector.includes('aria-label')) return sendButton;
      return null;
    }
  };
  const context = {
    console,
    document,
    location: { pathname: '/c/test', origin: 'https://chatgpt.com' },
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } },
    crypto: { randomUUID: () => 'client-1' },
    setTimeout: (fn, ms) => { if (ms <= 100) fn(); return 1; },
    clearTimeout() {},
    InputEvent: class InputEvent {},
    Event: class Event {},
    fetch: async (url, options = {}) => {
      if (String(url).includes('/events/claim')) {
        claimCalls += 1;
        return response({ ok: true, event: claimedEvent });
      }
      if (String(url).includes('/ack')) {
        ackCalls += 1;
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
  assert.strictEqual(sendClicks, 1);
  assert.strictEqual(ackCalls, 1);
  assert.strictEqual(composer.value, 'Qoder 完成');

  composer.value = 'existing draft';
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
