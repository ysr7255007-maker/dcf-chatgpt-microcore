'use strict';
// background.js — Service Worker (MV3)
// 职责：
//   1. 接收来自 popup 的内部消息（chrome.runtime.onMessage）
//   2. 接收来自 DCF Surface 的外部消息（chrome.runtime.onMessageExternal）
//   3. 将请求转发到当前活跃标签的 content script，并回传结果
// 本 worker 无持久状态，重启后自动恢复监听。

(function () {
  'use strict';

  function getActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function sendToTab(tabId, message) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        var err = chrome.runtime.lastError;
        resolve(err ? { success: false, error: err.message } : response);
      });
    });
  }

  async function handleRead() {
    var tab = await getActiveTab();
    if (!tab) return { success: false, error: '无活跃标签' };
    // 若 content script 未就绪，尝试注入（scripting 权限）
    var result = await sendToTab(tab.id, { action: 'read-conversation' });
    if (!result || result.error === 'Could not establish connection. Receiving end does not exist.') {
      await ensureContentScript(tab.id);
      result = await sendToTab(tab.id, { action: 'read-conversation' });
    }
    return Object.assign({}, result, { tabUrl: tab.url, tabId: tab.id });
  }

  async function handleSendCard(text) {
    var tab = await getActiveTab();
    if (!tab) return { success: false, error: '无活跃标签' };
    var result = await sendToTab(tab.id, { action: 'send-card', text: text });
    if (!result || result.error === 'Could not establish connection. Receiving end does not exist.') {
      await ensureContentScript(tab.id);
      result = await sendToTab(tab.id, { action: 'send-card', text: text });
    }
    return Object.assign({}, result, { tabUrl: tab.url, tabId: tab.id });
  }

  // 兜底注入：当页面在 content_scripts 注入前已加载时，手动注入脚本
  function ensureContentScript(tabId) {
    return new Promise(function (resolve) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          files: ['cpaste.js', 'content.js']
        },
        function () {
          // 忽略错误（例如 chrome:// 页面无法注入）
          void chrome.runtime.lastError;
          resolve();
        }
      );
    });
  }

  // ===== 内部消息（popup） =====
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message) return;
    (async function () {
      try {
        var type = message.type || message.action;
        if (type === 'dcf-read-request') {
          sendResponse(await handleRead());
        } else if (type === 'dcf-send-card-request') {
          sendResponse(await handleSendCard(message.text || message.cardText || ''));
        } else if (type === 'dcf-ping') {
          sendResponse({ success: true, pong: true, worker: true });
        } else {
          sendResponse({ success: false, error: 'unknown request: ' + type });
        }
      } catch (e) {
        sendResponse({ success: false, error: String(e && e.message || e) });
      }
    })();
    return true; // 异步响应
  });

  // ===== 外部消息（DCF Surface） =====
  chrome.runtime.onMessageExternal.addListener(function (message, sender, sendResponse) {
    if (!message) return;
    (async function () {
      try {
        var type = message.type || message.action;
        if (type === 'dcf-read-request') {
          sendResponse(await handleRead());
        } else if (type === 'dcf-send-card-request') {
          sendResponse(await handleSendCard(message.text || message.cardText || ''));
        } else if (type === 'dcf-ping') {
          sendResponse({ success: true, pong: true, worker: true, external: true, senderId: sender.id });
        } else {
          sendResponse({ success: false, error: 'unknown external request: ' + type });
        }
      } catch (e) {
        sendResponse({ success: false, error: String(e && e.message || e) });
      }
    })();
    return true; // 异步响应
  });
})();
