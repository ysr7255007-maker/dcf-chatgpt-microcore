// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.18.2.1
// @description  One-time bridge that copies the legacy DCF language-ammo library into the portable cross-system format.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROOT_KEY = 'dcf.state.root.v1';
  const LIBRARY_SCHEMA = 'dcf.language-ammo.library.v1';

  function normalize(raw) {
    const item = raw || {};
    const exported = {
      id: String(item.id || ''),
      title: String(item.title || item.id || ''),
      purpose: String(item.purpose || ''),
      body: String(item.body || ''),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : []
    };
    if (item.created_at) exported.created_at = String(item.created_at);
    if (item.updated_at) exported.updated_at = String(item.updated_at);
    return exported;
  }

  function readItems() {
    const root = GM_getValue(ROOT_KEY, null);
    const content = root?.user?.content?.ammo || root?.content?.ammo || root?.ammo || {};
    return Object.values(content).map(normalize).filter((item) => item.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function buildLibrary(items) {
    return JSON.stringify({
      schema: LIBRARY_SCHEMA,
      exported_at: new Date().toISOString(),
      count: items.length,
      items
    }, null, 2);
  }

  function notify(text) {
    if (typeof GM_notification === 'function') {
      GM_notification({ title: 'DCF 弹药迁移', text, timeout: 4500 });
    }
  }

  function copyLibrary() {
    const items = readItems();
    if (!items.length) {
      notify('没有在旧版存储中找到语言弹药。');
      return;
    }
    GM_setClipboard(buildLibrary(items), 'text');
    notify(`已复制 ${items.length} 枚语言弹药。现在把剪贴板内容粘贴给 ChatGPT 代为上传。`);
    const button = document.getElementById('dcf-ammo-export-bridge');
    if (button) button.textContent = `已复制 ${items.length} 枚`;
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('DCF：复制全部语言弹药（便携库）', copyLibrary);
  }

  const button = document.createElement('button');
  button.id = 'dcf-ammo-export-bridge';
  button.textContent = '复制旧版语言弹药';
  button.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:16px',
    'top:16px',
    'padding:9px 12px',
    'border:1px solid #8886',
    'border-radius:10px',
    'background:#171717',
    'color:#fff',
    'font:13px system-ui',
    'cursor:pointer',
    'box-shadow:0 8px 24px #0004'
  ].join(';');
  button.addEventListener('click', copyLibrary);
  document.documentElement.append(button);
})();
