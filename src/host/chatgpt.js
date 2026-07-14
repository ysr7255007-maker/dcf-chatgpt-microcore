'use strict';

const { nowIso } = require('../core/utils');

function createChatGPTHost(windowObject = window, options = {}) {
  const doc = windowObject.document;
  const quietMs = Number(options.quietMs || 900);
  const recoveryCount = Number(options.recoveryCount || 3);
  let rootObserver = null;
  let observedRoot = null;
  let activeObserver = null;
  let activeNode = null;
  let quietTimer = null;
  let onReplyComplete = null;
  let onReplyStart = null;
  let onSend = null;
  let sendClickHandler = null;
  let sendKeyHandler = null;
  let lastSendSignalAt = 0;
  let lastUrl = String(windowObject.location && windowObject.location.href || '');
  let urlTimer = null;
  let rootLocatorTimer = null;
  const processedNodes = new WeakSet();

  function normalizeAssistantNode(node) {
    if (!(node instanceof windowObject.Element)) return null;
    if (node.matches('[data-message-author-role="assistant"]')) return node.closest('article') || node;
    if (node.tagName === 'ARTICLE') {
      if (node.querySelector(':scope > [data-message-author-role="user"]')) return null;
      if (node.querySelector(':scope [data-message-author-role="assistant"]')) return node;
      const testId = node.getAttribute('data-testid') || '';
      if (/conversation-turn/i.test(testId) && !node.querySelector(':scope [data-message-author-role="user"]')) return node;
    }
    return null;
  }

  function findConversationRoot() {
    return doc.querySelector('main') || doc.querySelector('[role="main"]') || null;
  }

  function findRecentAssistantNodes(root, limit = recoveryCount) {
    const found = [];
    const hardVisitLimit = 5000;
    let visits = 0;
    let node = root && root.lastElementChild;

    function deepestLast(element) {
      let cursor = element;
      while (cursor && cursor.lastElementChild) cursor = cursor.lastElementChild;
      return cursor;
    }

    node = deepestLast(node);
    while (node && node !== root && found.length < limit && visits < hardVisitLimit) {
      visits += 1;
      const normalized = normalizeAssistantNode(node);
      if (normalized && !found.includes(normalized)) found.push(normalized);
      if (node.previousElementSibling) node = deepestLast(node.previousElementSibling);
      else node = node.parentElement;
    }
    return found;
  }

  function isStreaming() {
    return !!doc.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"]');
  }

  function readReplyText(node) {
    if (!node) return '';
    const content = node.querySelector('[data-message-author-role="assistant"]') || node;
    return String(content.textContent || '').trim();
  }

  function disconnectActive() {
    if (activeObserver) activeObserver.disconnect();
    activeObserver = null;
    activeNode = null;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
  }

  function scheduleCompletion(node, source) {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      if (!node.isConnected) {
        disconnectActive();
        return;
      }
      if (isStreaming()) {
        scheduleCompletion(node, source);
        return;
      }
      const text = readReplyText(node);
      disconnectActive();
      if (!text || processedNodes.has(node)) return;
      processedNodes.add(node);       if (typeof onReplyComplete === 'function') onReplyComplete({ node, text, source, completed_at: nowIso(), at_epoch_ms: Date.now(), quiet_ms: quietMs });
    }, quietMs);
  }

  function trackReply(node, source = 'live') {
    const normalized = normalizeAssistantNode(node);
    if (!normalized || processedNodes.has(normalized)) return;
    if (activeNode === normalized) {
      scheduleCompletion(normalized, source);
      return;
    }
    disconnectActive();
    activeNode = normalized;
    if (typeof onReplyStart === 'function') onReplyStart({ source, started_at: nowIso(), at_epoch_ms: Date.now(), timeline_ms: windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0 });
    activeObserver = new windowObject.MutationObserver(() => scheduleCompletion(normalized, source));
    activeObserver.observe(normalized, { childList: true, subtree: true, characterData: true });
    scheduleCompletion(normalized, source);
  }

  function inspectAddedNode(node) {
    if (!(node instanceof windowObject.Element)) return;
    const normalized = normalizeAssistantNode(node);
    if (normalized) {
      trackReply(normalized, 'live');
      return;
    }
    const nested = node.querySelector('[data-message-author-role="assistant"]');
    if (nested) trackReply(nested, 'live');
  }

  function attachReplyRoot(root) {
    if (!root || rootObserver) return false;
    observedRoot = root;
    rootObserver = new windowObject.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) inspectAddedNode(node);
      }
    });
    rootObserver.observe(root, { childList: true, subtree: true });

    const newestFirst = findRecentAssistantNodes(root, recoveryCount);
    const recent = newestFirst.slice().reverse();
    for (let index = 0; index < recent.length; index += 1) {
      const node = recent[index];
      const isNewest = index === recent.length - 1;
      if (isNewest && isStreaming()) {
        trackReply(node, 'recovered-stream');
        continue;
      }
      const text = readReplyText(node);
      if (text && typeof onReplyComplete === 'function') {
        processedNodes.add(node);
        onReplyComplete({ node, text, source: 'bounded-recovery', completed_at: nowIso() });
      }
    }
    return true;
  }

  function scheduleRootAttach() {
    if (rootObserver || rootLocatorTimer) return;
    const attempt = () => {
      rootLocatorTimer = null;
      if (attachReplyRoot(findConversationRoot())) return;
      rootLocatorTimer = windowObject.setTimeout(attempt, 600);
    };
    attempt();
  }

  function startReplyObserver(callback, observerOptions = {}) {
    onReplyComplete = callback;
    onReplyStart = typeof observerOptions.onReplyStart === 'function' ? observerOptions.onReplyStart : null;
    scheduleRootAttach();
    urlTimer = windowObject.setInterval(() => {
      const href = String(windowObject.location && windowObject.location.href || '');
      if (href === lastUrl) return;
      lastUrl = href;
      stopReplyObserver();       startReplyObserver(callback, observerOptions);
    }, 1200);
    return () => stopReplyObserver();
  }

  function stopReplyObserver() {
    if (rootObserver) rootObserver.disconnect();
    rootObserver = null;
    observedRoot = null;
    disconnectActive();
    if (urlTimer) windowObject.clearInterval(urlTimer);
    urlTimer = null;
    if (rootLocatorTimer) windowObject.clearTimeout(rootLocatorTimer);
    rootLocatorTimer = null;
  }

  function composer() {
    return doc.querySelector('#prompt-textarea,[contenteditable="true"][data-placeholder],textarea[data-id="root"]');
  }

  function setComposerText(element, text) {
    element.focus();
    if (element.tagName === 'TEXTAREA') {
      element.value = text;
      element.dispatchEvent(new windowObject.Event('input', { bubbles: true }));
      return;
    }
    element.textContent = text;
    element.dispatchEvent(new windowObject.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  async function insertComposer(text, options = {}) {
    const element = composer();
    if (!element) throw new Error('ChatGPT composer not found');
    const existing = String(element.value || element.textContent || '').trim();
    if (existing && existing !== text) throw new Error('composer contains an existing draft');
    setComposerText(element, text);
    if (!options.send) return { inserted: true, sent: false };
    await new Promise((resolve) => windowObject.setTimeout(resolve, 80));
    const button = doc.querySelector('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
    if (!button || button.disabled) throw new Error('ChatGPT send button not available');
    button.click();
    return { inserted: true, sent: true };
  }


  function eventTimelineMs(event) {
    const raw = Number(event && event.timeStamp);
    const perf = windowObject.performance;
    if (Number.isFinite(raw) && raw >= 0) {
      if (raw > 1e12 && perf && Number.isFinite(Number(perf.timeOrigin))) return Math.max(0, raw - Number(perf.timeOrigin));
      return raw;
    }
    return perf && typeof perf.now === 'function' ? perf.now() : 0;
  }

  function emitSend(kind, event) {
    if (typeof onSend !== 'function') return;
    const epoch = Date.now();
    if (epoch - lastSendSignalAt < 250) return;
    lastSendSignalAt = epoch;
    onSend({ kind, at: nowIso(), at_epoch_ms: epoch, timeline_ms: eventTimelineMs(event) });
  }

  function startSendObserver(callback) {
    stopSendObserver();
    onSend = callback;
    sendClickHandler = (event) => {
      const target = event && event.target instanceof windowObject.Element ? event.target : null;
      const button = target && target.closest('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
      if (button && !button.disabled) emitSend('click', event);
    };
    sendKeyHandler = (event) => {
      if (!event || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const input = composer();
      const target = event.target instanceof windowObject.Element ? event.target : null;
      if (!input || !target || !(target === input || input.contains(target))) return;
      const button = doc.querySelector('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
      if (button && !button.disabled) emitSend('enter', event);
    };
    doc.addEventListener('click', sendClickHandler, true);
    doc.addEventListener('keydown', sendKeyHandler, true);
    return () => stopSendObserver();
  }

  function stopSendObserver() {
    if (sendClickHandler) doc.removeEventListener('click', sendClickHandler, true);
    if (sendKeyHandler) doc.removeEventListener('keydown', sendKeyHandler, true);
    sendClickHandler = null;
    sendKeyHandler = null;
    onSend = null;
  }

  async function copy(text) {
    if (typeof globalThis.GM_setClipboard === 'function') {
      globalThis.GM_setClipboard(text);
      return { copied: true, method: 'GM_setClipboard' };
    }
    if (windowObject.navigator && windowObject.navigator.clipboard) {
      await windowObject.navigator.clipboard.writeText(text);
      return { copied: true, method: 'clipboard' };
    }
    throw new Error('clipboard unavailable');
  }

  async function notify(text) {
    if (typeof globalThis.GM_notification === 'function') {
      globalThis.GM_notification({ title: 'DCF', text });
      return { notified: true };
    }
    return { notified: false };
  }

  function routeKind() {
    const pathname = String(windowObject.location && windowObject.location.pathname || '/');
    if (/^\/c\/[^/]+/.test(pathname)) return '/c/:conversation';
    if (/^\/g\/[^/]+\/c\/[^/]+/.test(pathname)) return '/g/:gpt/c/:conversation';
    return pathname.replace(/[0-9a-f]{8,}/gi, ':id');
  }

  function diagnostics() {
    const root = findConversationRoot();
    const input = composer();
    const sendButton = doc.querySelector('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
    return {
      schema: 'dcf.host.diagnostics.v1',
      origin: String(windowObject.location && windowObject.location.origin || ''),
      route_kind: routeKind(),
      conversation_root_found: !!root,
      reply_root_observer_attached: !!rootObserver,
      observed_root_connected: !!(observedRoot && observedRoot.isConnected),
      observed_root_is_current: !!(observedRoot && root && observedRoot === root),
      active_reply_tracked: !!activeNode,
      active_reply_connected: !!(activeNode && activeNode.isConnected),
      streaming: isStreaming(),
      composer_found: !!input,
      composer_has_draft: !!(input && String(input.value || input.textContent || '').trim()),
      send_button_found: !!sendButton,
      send_button_enabled: !!(sendButton && !sendButton.disabled),
      observer_scope: 'conversation-root-added-nodes + current-reply',
      recovery_count: recoveryCount,
      quiet_ms: quietMs,
      root_locator_pending: !!rootLocatorTimer,       url_watch_active: !!urlTimer,
       send_observer_attached: !!(sendClickHandler && sendKeyHandler)
    };
  }

  return {
    startReplyObserver,
    stopReplyObserver,
    startSendObserver,
    stopSendObserver,
    findConversationRoot,
    findRecentAssistantNodes,
    readReplyText,
    insertComposer,
    copy,
    notify,
    isStreaming,
    diagnostics
  };
}

module.exports = { createChatGPTHost };
