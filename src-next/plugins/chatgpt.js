'use strict';

const { createEmitter } = require('../core/utils');

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  '[data-testid="composer-text-input"]',
  'form textarea',
  'main [contenteditable="true"]'
];
const SEND_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="发送"]'
];
const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';

function findFirst(root, selectors) {
  for (const selector of selectors) {
    const found = root?.querySelector?.(selector);
    if (found) return found;
  }
  return null;
}

function readComposer(node) {
  if (!node) return '';
  if ('value' in node) return String(node.value || '');
  return String(node.innerText || node.textContent || '');
}

function setComposer(node, text) {
  if (!node) throw new Error('composer_not_found');
  node.focus();
  if ('value' in node) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')?.set;
    if (setter) setter.call(node, text); else node.value = text;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const selection = globalThis.getSelection?.();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges(); selection.addRange(range);
  }
  const inserted = document.execCommand?.('insertText', false, text);
  if (!inserted) node.textContent = text;
  node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function chatgptPlugin() {
  return {
    id: 'dcf.next.chatgpt',
    version: '1.0.0',
    title: 'ChatGPT 页面交互',
    description: '输入框、发送动作和新完成回复的有界观察。',
    async start(ctx) {
      const doc = ctx.platform.document;
      if (!doc?.documentElement) throw new Error('document_unavailable');
      const emitter = createEmitter();
      const pending = new Map();
      let main = null;
      let observer = null;
      let navTimer = null;
      let lastRoute = location.pathname;

      function conversationRoot() {
        return doc.querySelector('main') || doc.querySelector('[role="main"]');
      }
      function composer() { return findFirst(doc, COMPOSER_SELECTORS); }
      function sendButton() { return findFirst(doc, SEND_SELECTORS); }
      function isStreaming() {
        return Boolean(doc.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]'));
      }
      function status() {
        return {
          route: location.pathname,
          root_connected: Boolean(main?.isConnected),
          observer_active: Boolean(observer),
          composer_found: Boolean(composer()),
          send_button_found: Boolean(sendButton()),
          streaming: isStreaming(),
          pending_replies: pending.size
        };
      }

      async function insert(text, { send = false, protectDraft = true } = {}) {
        const node = composer();
        if (!node) throw new Error('composer_not_found');
        const existing = readComposer(node).trim();
        if (protectDraft && existing && existing !== String(text).trim()) throw new Error('composer_contains_draft');
        setComposer(node, String(text));
        if (!send) return { inserted: true, sent: false };
        await new Promise((resolve) => setTimeout(resolve, 80));
        const button = sendButton();
        if (!button || button.disabled) throw new Error('send_button_unavailable');
        emitter.emit('send', { at: performance.now(), method: 'dcf' });
        button.click();
        return { inserted: true, sent: true };
      }

      function scheduleCompletion(node) {
        if (!node || pending.has(node)) return;
        const record = { lastText: '', stableSince: performance.now(), timer: null };
        pending.set(node, record);
        emitter.emit('reply:first-activity', { at: performance.now(), node });
        const check = () => {
          if (!node.isConnected) { pending.delete(node); return; }
          const text = String(node.innerText || node.textContent || '').trim();
          const now = performance.now();
          if (text !== record.lastText) { record.lastText = text; record.stableSince = now; }
          const quiet = now - record.stableSince;
          if (text && !isStreaming() && quiet >= 1100) {
            pending.delete(node);
            emitter.emit('reply:completed', { at: performance.now(), text, node });
            return;
          }
          record.timer = setTimeout(check, 350);
        };
        record.timer = setTimeout(check, 350);
      }

      function inspectAdded(node) {
        if (!(node instanceof Element)) return;
        if (node.matches?.(ASSISTANT_SELECTOR)) scheduleCompletion(node);
        for (const child of node.querySelectorAll?.(ASSISTANT_SELECTOR) || []) scheduleCompletion(child);
      }

      function attach() {
        const nextMain = conversationRoot();
        if (!nextMain || nextMain === main) return;
        observer?.disconnect();
        main = nextMain;
        observer = new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) inspectAdded(node);
        });
        observer.observe(main, { childList: true, subtree: true });
        emitter.emit('root', status());
      }

      attach();

      const sendListener = (event) => {
        const target = event.target;
        const button = target?.closest?.(SEND_SELECTORS.join(','));
        const input = target?.closest?.(COMPOSER_SELECTORS.join(','));
        if (button || (input && event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey)) {
          emitter.emit('send', { at: performance.now(), method: button ? 'button' : 'enter' });
        }
      };
      doc.addEventListener('click', sendListener, true);
      doc.addEventListener('keydown', sendListener, true);

      navTimer = setInterval(() => {
        if (location.pathname !== lastRoute) {
          lastRoute = location.pathname;
          pending.clear();
          attach();
          emitter.emit('navigation', status());
        } else if (!main?.isConnected) attach();
      }, 1600);

      return {
        insert: (text) => insert(text, { send: false }),
        send: (text) => insert(text, { send: true }),
        onSend: (handler) => emitter.on('send', handler),
        onReplyFirstActivity: (handler) => emitter.on('reply:first-activity', handler),
        onReplyCompleted: (handler) => emitter.on('reply:completed', handler),
        onNavigation: (handler) => emitter.on('navigation', handler),
        status,
        destroy() {
          clearInterval(navTimer); observer?.disconnect(); emitter.clear();
          doc.removeEventListener('click', sendListener, true); doc.removeEventListener('keydown', sendListener, true);
        }
      };
    }
  };
}

module.exports = { chatgptPlugin, findFirst, readComposer, setComposer };
