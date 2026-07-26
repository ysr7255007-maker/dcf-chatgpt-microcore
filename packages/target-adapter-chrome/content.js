'use strict';
// content.js — 对话读取与卡片注入（运行于 ISOLATED world，可访问 DOM）
// 职责：
//   1. 响应 read-conversation：从目标页 DOM 提取对话轮次
//   2. 响应 send-card：找到输入框并写入卡片文本
// 本脚本不持有权威事实，仅做静默观察与动作翻译。

(function () {
  'use strict';

  // ===== 对话读取 =====

  // 多组选择器，按优先级尝试，适配 ChatGPT 页面结构变化
  var TURN_SELECTORS = [
    '[data-testid="conversation-turn"]',
    'article[class*="message"]',
    'article',
    '[class*="message"]:not([class*="input"])',
    '[class*="markdown"]'
  ];

  function extractText(node) {
    return (node.innerText || node.textContent || '').trim();
  }

  function classifyRole(turnEl) {
    // 优先用 data-testid 标识判定
    if (turnEl.querySelector('[data-testid="user-message"]')) return 'user';
    var html = turnEl.innerHTML || '';
    if (html.indexOf('data-testid="user-message"') !== -1) return 'user';
    // ChatGPT 的 turn 通常按顺序交替，但结构上难以稳定推断，
    // 这里用 data-testid 数字奇偶做兜底（奇数=assistant 在旧版曾成立）
    var tid = turnEl.getAttribute('data-testid') || '';
    var m = tid.match(/conversation-turn-(\d+)/);
    if (m) {
      // 0-indexed: 偶数=user, 奇数=assistant（ChatGPT 早期约定，仅作兜底）
      return (Number(m[1]) % 2 === 0) ? 'user' : 'assistant';
    }
    return 'assistant';
  }

  function readConversation() {
    var messages = [];
    var turns = [];
    var usedSelector = '';
    for (var i = 0; i < TURN_SELECTORS.length; i++) {
      var found = document.querySelectorAll(TURN_SELECTORS[i]);
      if (found && found.length > 0) {
        turns = Array.prototype.slice.call(found);
        usedSelector = TURN_SELECTORS[i];
        break;
      }
    }
    for (var j = 0; j < turns.length; j++) {
      var content = extractText(turns[j]);
      if (!content) continue;
      messages.push({
        role: classifyRole(turns[j]),
        content: content,
        timestamp: new Date().toISOString()
      });
    }
    return {
      success: true,
      messages: messages,
      count: messages.length,
      selector: usedSelector,
      url: location.href,
      title: document.title
    };
  }

  // ===== 卡片注入 =====

  function findInputElement() {
    var candidates = [
      'textarea#prompt-textarea',
      'textarea[data-testid="prompt-textarea"]',
      'div#prompt-textarea[contenteditable]',
      'textarea',
      '[contenteditable="true"]',
      '[contenteditable]'
    ];
    for (var i = 0; i < candidates.length; i++) {
      var el = document.querySelector(candidates[i]);
      if (el) return el;
    }
    return null;
  }

  function setNativeValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      // execCommand insertText 能触发 input 事件，兼容 React 受控组件
      var ok = document.execCommand('insertText', false, value);
      if (!ok) {
        // 降级：直接写 innerText 并派发 input
        el.innerText = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      }
      return true;
    }
    var proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : (el.tagName === 'INPUT' ? HTMLInputElement.prototype : null);
    if (proto) {
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function sendCard(text) {
    var el = findInputElement();
    if (!el) {
      return { success: false, error: '未找到输入框', url: location.href };
    }
    try {
      setNativeValue(el, text);
      // 辅助：将卡片文本同步写入剪贴板，便于手动粘贴兜底
      if (globalThis.DCFCpaste && typeof globalThis.DCFCpaste.sendCardToActiveTab === 'function') {
        globalThis.DCFCpaste.sendCardToActiveTab(text).catch(function () {});
      }
      return { success: true, message: 'Card inserted', url: location.href };
    } catch (e) {
      return { success: false, error: String(e && e.message || e), url: location.href };
    }
  }

  // ===== 消息监听 =====

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.action) return;
    try {
      if (message.action === 'read-conversation') {
        sendResponse(readConversation());
      } else if (message.action === 'send-card') {
        sendResponse(sendCard(message.text || ''));
      } else if (message.action === 'ping') {
        sendResponse({ success: true, pong: true, url: location.href, title: document.title });
      } else {
        sendResponse({ success: false, error: 'unknown action: ' + message.action });
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message || e) });
    }
    return true; // 保持消息通道开放以支持异步响应
  });
})();
