(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.qoder-watch';
  const UNIT_VERSION = '1.0.0-rc.2-qoder-watch.1';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_QODER_WATCH__';
  const BASE_URL = 'http://127.0.0.1:4937';
  const POLL_MS = 1500;

  globalThis[GLOBAL_KEY]?.destroy?.();

  let destroyed = false;
  let timer = null;
  let busy = false;
  let visibilityListener = null;
  let lastError = '';
  const clientId = globalThis.crypto?.randomUUID?.() || `qoder-watch-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const host = (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return Promise.reject(new Error('host_messaging_unavailable'));
    }
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
      return result;
    });
  };

  const composer = () => document.querySelector('#prompt-textarea')
    || document.querySelector('[data-testid="composer-text-input"]')
    || document.querySelector('form textarea')
    || document.querySelector('main [contenteditable="true"]');

  function composerValue(target) {
    return String(target ? ('value' in target ? target.value || '' : target.innerText || target.textContent || '') : '');
  }

  function dispatchInput(target, text) {
    try {
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (_) {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function setComposerText(target, text) {
    target.focus();
    if ('value' in target) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
      if (descriptor?.set) descriptor.set.call(target, text);
      else target.value = text;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(text.length, text.length);
      dispatchInput(target, text);
      return;
    }
    target.textContent = text;
    dispatchInput(target, text);
  }

  function sendButton() {
    return document.querySelector('[data-testid="send-button"]')
      || document.querySelector('button[aria-label*="Send"]')
      || document.querySelector('button[aria-label*="发送"]')
      || document.querySelector('form button[type="submit"]');
  }

  async function sendText(text) {
    const target = composer();
    if (!target) throw new Error('ChatGPT composer not found');
    const existing = composerValue(target).trim();
    if (existing && existing !== text) throw new Error('composer contains an existing draft');
    setComposerText(target, text);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const button = sendButton();
    if (!button || button.disabled) throw new Error('ChatGPT send button unavailable');
    button.click();
  }

  async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: options.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error'
    });
    if (!response.ok) throw new Error(`Qoder watch HTTP ${response.status}`);
    return response.json();
  }

  async function pollNow() {
    if (destroyed || busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const query = `?client_id=${encodeURIComponent(clientId)}&visible=1&conversation_path=${encodeURIComponent(location.pathname || '/')}`;
      const result = await request(`/events/claim${query}`);
      const event = result?.event;
      if (!event || event.type !== 'complete' || !event.id || !event.message) {
        lastError = '';
        return;
      }
      await sendText(String(event.message));
      const ack = await request(`/events/${encodeURIComponent(event.id)}/ack`, {
        method: 'POST',
        body: { client_id: clientId }
      });
      if (!ack?.ok) throw new Error('Qoder watch ACK rejected');
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
    } finally {
      busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (destroyed) return;
    timer = setTimeout(async () => {
      await pollNow();
      schedule();
    }, POLL_MS);
  }

  function destroy() {
    destroyed = true;
    clearTimeout(timer);
    timer = null;
    if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    pollNow,
    diagnostics: () => ({ client_id: clientId, busy, last_error: lastError, visible: document.visibilityState === 'visible' })
  };

  visibilityListener = () => {
    if (document.visibilityState === 'visible') pollNow().catch(() => {});
  };
  document.addEventListener('visibilitychange', visibilityListener);
  schedule();
  host({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }).catch(() => {});
})();
