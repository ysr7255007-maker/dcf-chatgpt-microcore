// ==UserScript==
// @name         DCF ChatGPT Next Snapshot Review
// @namespace    https://chatgpt.com/
// @version      0.2.0-alpha.8-minimal
// @description  Compiled DCF boot snapshot (minimal); plugin code is selected before installation and executed by Tampermonkey.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next-snapshot-minimal.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next-snapshot-minimal.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore/pull/21
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==
(function(){'use strict';
const modules={
"src-next/core/utils.js":function(module,exports,require){
'use strict';

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nowIso(now = Date.now) {
  return new Date(now()).toISOString();
}

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(text); } catch (_error) { return fallback; }
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
      return () => listeners.get(type)?.delete(handler);
    },
    emit(type, payload) {
      for (const handler of listeners.get(type) || []) {
        try { handler(payload); } catch (error) { console.error('[DCF Next event]', type, error); }
      }
    },
    clear() { listeners.clear(); }
  };
}

function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyText(text) {
  if (typeof GM_setClipboard === 'function') {
    GM_setClipboard(String(text), 'text');
    return Promise.resolve();
  }
  if (globalThis.navigator?.clipboard?.writeText) return navigator.clipboard.writeText(String(text));
  return Promise.reject(new Error('clipboard_unavailable'));
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

module.exports = { clone, isObject, nowIso, normalizeText, safeJsonParse, createEmitter, downloadText, copyText, debounce };

},
"src-next/index.js":function(module,exports,require){
'use strict';

const { createBrowserStorage } = require("src-next/survival/storage.js");
const { createSurvivalLoader } = require("src-next/survival/loader.js");
const { renderRecovery } = require("src-next/survival/recovery-ui.js");
const { createPluginRegistry, defaultManifest } = require("src-next/plugin-registry.js");

async function main() {
  const registry = createPluginRegistry();
  const storage = createBrowserStorage();
  const loader = createSurvivalLoader({
    registry,
    storage,
    defaultManifest: defaultManifest(registry),
    renderRecovery,
    platform: { window: globalThis.window, document: globalThis.document }
  });
  const result = await loader.boot();
  globalThis.DCF_NEXT = Object.freeze({ version: loader.getState().survival_version, result, state: () => loader.getState() });
}

main().catch((error) => {
  console.error('[DCF Next fatal]', error);
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;top:16px;max-width:420px;background:#8b1e1e;color:white;padding:14px;border-radius:10px;font:13px system-ui';
    host.textContent = `DCF Next 无法进入生存盒：${error?.message || String(error)}。请重新安装上一份可用 userscript。`;
    document.documentElement.append(host);
  } catch (_ignored) {}
});

},
"src-next/plugin-registry.js":function(module,exports,require){
'use strict';

const { shellPlugin: factory0 } = require("src-next/plugins/shell.js");
const { chatgptPlugin: factory1 } = require("src-next/plugins/chatgpt.js");
const { pluginManagerPlugin: factory2 } = require("src-next/plugins/plugin-manager.js");
const { diagnosticsPlugin: factory3 } = require("src-next/plugins/diagnostics.js");

function createPluginRegistry(plugins) {
  const values = plugins || [
    factory0(),
    factory1(),
    factory2(),
    factory3()
  ];
  const byKey = new Map();
  for (const plugin of values) {
    if (!plugin?.id || !plugin?.version || typeof plugin.start !== 'function') throw new Error('invalid_plugin_definition');
    const key = `${plugin.id}@${plugin.version}`;
    if (byKey.has(key)) throw new Error(`duplicate_plugin:${key}`);
    byKey.set(key, Object.freeze(plugin));
  }
  return {
    get(id, version) { return byKey.get(`${id}@${version}`) || null; },
    list() { return Array.from(byKey.values()); }
  };
}

function defaultManifest(registry) {
  return registry.list().map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: true }));
}

module.exports = { createPluginRegistry, defaultManifest };
},
"src-next/plugins/chatgpt.js":function(module,exports,require){
'use strict';

const { createEmitter } = require("src-next/core/utils.js");

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

},
"src-next/plugins/diagnostics.js":function(module,exports,require){
'use strict';

const { copyText, nowIso } = require("src-next/core/utils.js");

function diagnosticsPlugin() {
  return {
    id: 'dcf.next.diagnostics',
    version: '1.0.0',
    title: '维护诊断',
    description: '最小、隐私安全的启动与 Runtime 观察。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      function report() {
        const host = ctx.plugins.get('dcf.next.chatgpt');
        const localAgent = ctx.plugins.get('dcf.next.local-agent');
        const performancePlugin = ctx.plugins.get('dcf.next.conversation-performance');
        return {
          schema: 'dcf.next.runtime.diagnostics.v1',
          generated_at: nowIso(),
          survival_version: ctx.survival.version,
          route_kind: location.pathname,
          current_manifest: ctx.survival.currentManifest(),
          last_known_good_manifest: ctx.survival.lastKnownGoodManifest(),
          started_plugins: ctx.plugins.list(),
          shell: {
            connected: Boolean(shell.host?.isConnected),
            geometry: shell.getGeometry?.() || null
          },
          chatgpt: host?.status?.() || { available: false },
          local_agent: localAgent?.diagnostics?.() || { available: false },
          conversation_performance: performancePlugin?.report?.() || { available: false },
          privacy: {
            message_text: false,
            prompt_text: false,
            ammo_bodies: false,
            dom_dump: false,
            authentication: false,
            local_agent_session_token: false
          }
        };
      }
      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const card = document.createElement('section'); card.className = 'dcf-card dcf-stack';
        const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = JSON.stringify(report(), null, 2);
        const copy = document.createElement('button'); copy.className = 'dcf-btn'; copy.textContent = '复制诊断'; copy.onclick = () => copyText(JSON.stringify(report(), null, 2)).then(() => shell.notify('诊断已复制'));
        const safe = document.createElement('button'); safe.className = 'dcf-btn danger'; safe.textContent = '下次进入安全模式'; safe.onclick = () => ctx.survival.enterSafeMode('manual_diagnostics_request');
        const actions = document.createElement('div'); actions.className = 'dcf-row'; actions.append(copy, safe);
        card.append(pre, actions); root.append(card); container.append(root);
      }
      shell.registerPanel({ id: 'diagnostics', title: '维护', render });
      return { report };
    }
  };
}

module.exports = { diagnosticsPlugin };

},
"src-next/plugins/plugin-manager.js":function(module,exports,require){
'use strict';

const { clone, copyText } = require("src-next/core/utils.js");

function pluginManagerPlugin() {
  return {
    id: 'dcf.next.plugin-manager',
    version: '1.1.0',
    title: '插件管理',
    description: '管理已安装插件进入运行组合时的启停、顺序和版本。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      let working = ctx.survival.currentManifest();
      let combinations = ctx.storage.get('combinations', {});
      let importText = '';

      function saveCombination(name, manifest = working) {
        const cleanName = String(name || '').trim();
        if (!cleanName) throw new Error('组合名称不能为空');
        combinations = { ...combinations, [cleanName]: clone(manifest) };
        ctx.storage.set('combinations', combinations);
      }
      function removeCombination(name) {
        const next = { ...combinations };
        delete next[String(name)];
        combinations = next;
        ctx.storage.set('combinations', combinations);
      }

      function availableMap() {
        const map = new Map();
        for (const plugin of ctx.survival.availablePlugins()) {
          if (!map.has(plugin.id)) map.set(plugin.id, []);
          map.get(plugin.id).push(plugin);
        }
        return map;
      }
      function persist({ restart = true } = {}) { ctx.survival.setManifest(working, { restart }); }
      function move(index, delta) {
        const next = index + delta;
        if (next < 0 || next >= working.length) return;
        [working[index], working[next]] = [working[next], working[index]];
        shell.refresh('plugins');
      }
      function setEnabled(index, enabled) { working[index] = { ...working[index], enabled }; shell.refresh('plugins'); }
      function setVersion(index, version) { working[index] = { ...working[index], version }; shell.refresh('plugins'); }
      function addInstalledPlugin(info) {
        if (working.some((entry) => entry.id === info.id)) return;
        working.push({ id: info.id, version: info.version, enabled: true });
        shell.refresh('plugins');
      }

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const intro = document.createElement('div'); intro.className = 'dcf-muted'; intro.textContent = '这里修改生存核实际读取的运行组合。已安装插件只有加入组合后才会在下次启动运行；插件管理器本身不是唯一恢复入口。'; root.append(intro);
        const available = availableMap();
        working.forEach((entry, index) => {
          const info = available.get(entry.id)?.find((item) => item.version === entry.version) || { title: entry.id, description: '' };
          const card = document.createElement('article'); card.className = 'dcf-card dcf-stack';
          const header = document.createElement('div'); header.className = 'dcf-row';
          const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = entry.enabled !== false; toggle.onchange = () => setEnabled(index, toggle.checked);
          const title = document.createElement('div'); title.className = 'dcf-title'; title.style.flex = '1'; title.textContent = info.title || entry.id;
          const order = document.createElement('span'); order.className = 'dcf-badge'; order.textContent = `#${index + 1}`;
          header.append(toggle, title, order); card.append(header);
          const technical = document.createElement('div'); technical.className = 'dcf-muted'; technical.textContent = `${entry.id}@${entry.version}${info.description ? ` · ${info.description}` : ''}`; card.append(technical);
          const controls = document.createElement('div'); controls.className = 'dcf-row';
          const versions = available.get(entry.id) || [];
          if (versions.length > 1) {
            const select = document.createElement('select');
            for (const optionInfo of versions) { const option = document.createElement('option'); option.value = optionInfo.version; option.textContent = optionInfo.version; option.selected = optionInfo.version === entry.version; select.append(option); }
            select.onchange = () => setVersion(index, select.value); controls.append(select);
          }
          const up = document.createElement('button'); up.className = 'dcf-btn'; up.textContent = '上移'; up.disabled = index === 0; up.onclick = () => move(index, -1);
          const down = document.createElement('button'); down.className = 'dcf-btn'; down.textContent = '下移'; down.disabled = index === working.length - 1; down.onclick = () => move(index, 1);
          controls.append(up, down); card.append(controls); root.append(card);
        });

        const activeIds = new Set(working.map((entry) => entry.id));
        const availableButInactive = Array.from(available.values()).flatMap((versions) => versions.slice(0, 1)).filter((info) => !activeIds.has(info.id));
        if (availableButInactive.length) {
          const availableCard = document.createElement('section'); availableCard.className = 'dcf-card dcf-stack';
          const availableTitle = document.createElement('div'); availableTitle.className = 'dcf-title'; availableTitle.textContent = '已安装但未进入当前组合'; availableCard.append(availableTitle);
          for (const info of availableButInactive) {
            const row = document.createElement('div'); row.className = 'dcf-row';
            const label = document.createElement('div'); label.style.flex = '1'; label.textContent = `${info.title || info.id} · ${info.id}@${info.version}`;
            const add = document.createElement('button'); add.className = 'dcf-btn'; add.textContent = '加入组合'; add.onclick = () => addInstalledPlugin(info);
            row.append(label, add); availableCard.append(row);
          }
          root.append(availableCard);
        }

        const actions = document.createElement('div'); actions.className = 'dcf-row';
        const save = document.createElement('button'); save.className = 'dcf-btn primary'; save.textContent = '保存并重启'; save.onclick = () => persist({ restart: true });
        const reset = document.createElement('button'); reset.className = 'dcf-btn'; reset.textContent = '放弃改动'; reset.onclick = () => { working = ctx.survival.currentManifest(); shell.refresh('plugins'); };
        const exportButton = document.createElement('button'); exportButton.className = 'dcf-btn'; exportButton.textContent = '复制运行组合'; exportButton.onclick = () => copyText(JSON.stringify({ schema: 'dcf.next.plugin-manifest.v1', plugins: working }, null, 2)).then(() => shell.notify('运行组合已复制'));
        actions.append(save, reset, exportButton); root.append(actions);

        const savedCard = document.createElement('section'); savedCard.className = 'dcf-card dcf-stack';
        const savedTitle = document.createElement('div'); savedTitle.className = 'dcf-title'; savedTitle.textContent = '组合'; savedCard.append(savedTitle);
        const nameInput = document.createElement('input'); nameInput.placeholder = '组合名称';
        const saveCombo = document.createElement('button'); saveCombo.className = 'dcf-btn'; saveCombo.textContent = '保存当前组合'; saveCombo.onclick = () => { try { saveCombination(nameInput.value, working); shell.notify('组合已保存'); shell.refresh('plugins'); } catch (error) { shell.notify(error.message, 'error'); } };
        const comboRow = document.createElement('div'); comboRow.className = 'dcf-row'; comboRow.append(nameInput, saveCombo); savedCard.append(comboRow);
        for (const [name, manifest] of Object.entries(combinations)) {
          const row = document.createElement('div'); row.className = 'dcf-row';
          const label = document.createElement('span'); label.style.flex = '1'; label.textContent = name;
          const load = document.createElement('button'); load.className = 'dcf-btn'; load.textContent = '载入'; load.onclick = () => { working = clone(manifest); shell.refresh('plugins'); };
          const remove = document.createElement('button'); remove.className = 'dcf-btn danger'; remove.textContent = '删除'; remove.onclick = () => { removeCombination(name); shell.refresh('plugins'); };
          row.append(label, load, remove); savedCard.append(row);
        }
        root.append(savedCard);

        const importCard = document.createElement('section'); importCard.className = 'dcf-card dcf-stack';
        const importTitle = document.createElement('div'); importTitle.className = 'dcf-title'; importTitle.textContent = '导入运行组合';
        const area = document.createElement('textarea'); area.placeholder = '粘贴 dcf.next.plugin-manifest.v1 JSON'; area.value = importText; area.oninput = () => { importText = area.value; };
        const apply = document.createElement('button'); apply.className = 'dcf-btn'; apply.textContent = '校验并载入'; apply.onclick = () => {
          try {
            const parsed = JSON.parse(importText);
            if (parsed.schema !== 'dcf.next.plugin-manifest.v1' || !Array.isArray(parsed.plugins)) throw new Error('运行组合格式不正确');
            const known = availableMap();
            for (const entry of parsed.plugins) if (!known.get(entry.id)?.some((candidate) => candidate.version === entry.version)) throw new Error(`当前代码库不包含 ${entry.id}@${entry.version}`);
            working = clone(parsed.plugins); shell.refresh('plugins'); shell.notify('组合已载入，尚未保存');
          } catch (error) { shell.notify(error.message, 'error'); }
        };
        importCard.append(importTitle, area, apply); root.append(importCard);
        container.append(root);
      }

      shell.registerPanel({ id: 'plugins', title: '插件', render });
      return { manifest: () => clone(working), reload: () => { working = ctx.survival.currentManifest(); shell.refresh('plugins'); } };
    }
  };
}

module.exports = { pluginManagerPlugin };

},
"src-next/plugins/shell.js":function(module,exports,require){
'use strict';

const { createEmitter } = require("src-next/core/utils.js");

const DEFAULT_GEOMETRY = { side: 'right', width: 360, top: 72, height: 680, margin: 12, collapsed: false };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function shellPlugin() {
  return {
    id: 'dcf.next.shell',
    version: '1.0.0',
    title: '基础界面',
    description: 'DCF 的正常可见入口与插件面板宿主。',
    async start(ctx) {
      const doc = ctx.platform.document;
      if (!doc?.documentElement) throw new Error('document_unavailable');
      doc.getElementById('dcf-next-shell-host')?.remove();
      const host = doc.createElement('div');
      host.id = 'dcf-next-shell-host';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host{all:initial;--dcf-width:360px;--dcf-top:72px;--dcf-height:680px;--dcf-margin:12px}
        .shell{position:fixed;z-index:2147483000;top:var(--dcf-top);width:min(var(--dcf-width),calc(100vw - 24px));height:min(var(--dcf-height),calc(100vh - var(--dcf-top) - 12px));background:#fafafa;color:#202124;border:1px solid #d6d6d6;border-radius:14px;box-shadow:0 14px 42px #0003;font:13px/1.45 system-ui;display:flex;flex-direction:column;overflow:hidden}
        .shell.right{right:var(--dcf-margin)}.shell.left{left:var(--dcf-margin)}.shell.collapsed{height:auto;width:auto;min-width:160px}
        .head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#f0f0f0;border-bottom:1px solid #ddd}.brand{font-weight:700;flex:1}.status{font-size:11px;color:#666}.head button,.tabs button,.toast button{border:0;background:transparent;cursor:pointer;color:inherit}
        .tabs{display:flex;gap:4px;padding:7px;overflow:auto;border-bottom:1px solid #e2e2e2}.tabs button{padding:6px 8px;border-radius:8px;white-space:nowrap}.tabs button.active{background:#202124;color:white}
        .body{flex:1;overflow:auto;padding:10px}.panel[hidden],.shell.collapsed .tabs,.shell.collapsed .body{display:none!important}
        .toast{position:absolute;left:12px;right:12px;bottom:12px;background:#202124;color:#fff;border-radius:9px;padding:9px 11px;box-shadow:0 8px 22px #0004}.toast.error{background:#8b1e1e}
        button,input,textarea,select{font:inherit}.dcf-btn{border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 9px;cursor:pointer}.dcf-btn.primary{background:#202124;color:#fff;border-color:#202124}.dcf-btn.danger{color:#a11616}.dcf-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dcf-stack{display:grid;gap:9px}.dcf-card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff}.dcf-muted{color:#666;font-size:12px}.dcf-field{display:grid;gap:4px}.dcf-field input,.dcf-field textarea,.dcf-field select{border:1px solid #bbb;border-radius:8px;padding:7px;background:#fff;color:#202124}.dcf-field textarea{min-height:110px;resize:vertical}.dcf-grid{display:grid;gap:8px}.dcf-title{font-weight:700}.dcf-badge{display:inline-block;border-radius:999px;padding:2px 7px;background:#eee;font-size:11px}.dcf-empty{padding:18px;text-align:center;color:#777}
        @media(prefers-color-scheme:dark){.shell{background:#181818;color:#f3f3f3;border-color:#444}.head{background:#222;border-color:#444}.tabs{border-color:#444}.dcf-card{background:#222;border-color:#444}.dcf-btn,.dcf-field input,.dcf-field textarea,.dcf-field select{background:#292929;color:#f3f3f3;border-color:#555}.dcf-muted{color:#aaa}.dcf-badge{background:#333}}
      </style>`;
      const shell = element('section', null, 'shell right');
      const head = element('div', null, 'head');
      const brand = element('div', 'DCF Next', 'brand');
      const status = element('div', '已启动', 'status');
      const collapse = element('button', '收起');
      head.append(brand, status, collapse);
      const tabs = element('nav', null, 'tabs');
      const body = element('main', null, 'body');
      shell.append(head, tabs, body); shadow.append(shell); doc.documentElement.append(host);

      const panels = new Map();
      const emitter = createEmitter();
      let active = null;
      let geometry = { ...DEFAULT_GEOMETRY };

      function applyGeometry(next = {}) {
        geometry = { ...geometry, ...next };
        const viewportWidth = globalThis.visualViewport?.width || globalThis.innerWidth || 1280;
        const viewportHeight = globalThis.visualViewport?.height || globalThis.innerHeight || 800;
        geometry.width = Math.max(280, Math.min(Number(geometry.width) || 360, viewportWidth - 24));
        geometry.top = Math.max(8, Math.min(Number(geometry.top) || 72, viewportHeight - 120));
        geometry.height = Math.max(240, Math.min(Number(geometry.height) || 680, viewportHeight - geometry.top - 12));
        geometry.margin = Math.max(0, Math.min(Number(geometry.margin) || 12, 80));
        shell.style.setProperty('--dcf-width', `${geometry.width}px`);
        shell.style.setProperty('--dcf-top', `${geometry.top}px`);
        shell.style.setProperty('--dcf-height', `${geometry.height}px`);
        shell.style.setProperty('--dcf-margin', `${geometry.margin}px`);
        shell.classList.toggle('left', geometry.side === 'left');
        shell.classList.toggle('right', geometry.side !== 'left');
        shell.classList.toggle('collapsed', Boolean(geometry.collapsed));
        collapse.textContent = geometry.collapsed ? '展开' : '收起';
        emitter.emit('geometry', { ...geometry });
      }

      function activate(id) {
        if (!panels.has(id)) return;
        active = id;
        for (const [panelId, record] of panels) {
          record.button.classList.toggle('active', panelId === id);
          record.container.hidden = panelId !== id;
        }
        panels.get(id).render(panels.get(id).container);
      }

      function registerPanel(definition) {
        if (!definition?.id || typeof definition.render !== 'function') throw new Error('invalid_panel');
        panels.get(definition.id)?.button.remove();
        panels.get(definition.id)?.container.remove();
        const button = element('button', definition.title || definition.id);
        const container = element('section', null, 'panel');
        container.dataset.panelId = definition.id;
        const record = { ...definition, button, container };
        panels.set(definition.id, record);
        button.onclick = () => activate(definition.id);
        tabs.append(button); body.append(container);
        if (!active) activate(definition.id); else container.hidden = true;
        return () => { button.remove(); container.remove(); panels.delete(definition.id); if (active === definition.id) active = null; };
      }

      function refresh(id = active) {
        const record = panels.get(id);
        if (record) record.render(record.container);
      }

      let toastTimer = null;
      function notify(message, kind = 'success') {
        shadow.querySelector('.toast')?.remove();
        const toast = element('div', message, `toast ${kind === 'error' ? 'error' : ''}`);
        shell.append(toast);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.remove(), kind === 'error' ? 6500 : 2200);
      }

      collapse.onclick = () => applyGeometry({ collapsed: !geometry.collapsed });
      applyGeometry();

      return {
        host,
        shadow,
        registerPanel,
        activate,
        refresh,
        notify,
        setStatus: (text) => { status.textContent = String(text); },
        setGeometry: applyGeometry,
        getGeometry: () => ({ ...geometry }),
        onGeometry: (handler) => emitter.on('geometry', handler),
        ui: { element }
      };
    }
  };
}

module.exports = { shellPlugin, DEFAULT_GEOMETRY };

},
"src-next/survival/constants.js":function(module,exports,require){
'use strict';

const VERSION = '0.2.0-alpha.8';
const STATE_SCHEMA = 'dcf.next.survival.state.v1';
const STATE_KEY = 'dcf.next.survival.state.v1';
const PLUGIN_STORAGE_PREFIX = 'dcf.next.plugin.';

module.exports = { VERSION, STATE_SCHEMA, STATE_KEY, PLUGIN_STORAGE_PREFIX };

},
"src-next/survival/loader.js":function(module,exports,require){
'use strict';

const { VERSION, STATE_SCHEMA } = require("src-next/survival/constants.js");
const { cloneManifest, sameManifest, normalizeManifest } = require("src-next/survival/manifest.js");
const { clone, nowIso } = require("src-next/core/utils.js");

function defaultState(defaultManifest) {
  return {
    schema: STATE_SCHEMA,
    survival_version: VERSION,
    current_manifest: cloneManifest(defaultManifest),
    last_known_good_manifest: null,
    force_safe_mode: false,
    safe_mode_reason: null,
    boot: { status: 'idle', attempt_id: null, started_at: null, completed_at: null, plugins: [], error: null }
  };
}

function sanitizeState(raw, registry, defaultManifest) {
  const base = defaultState(defaultManifest);
  if (!raw || raw.schema !== STATE_SCHEMA) return base;
  const current = normalizeManifest(raw.current_manifest, registry, defaultManifest, { appendMissing: true });
  const knownGood = Array.isArray(raw.last_known_good_manifest)
    ? normalizeManifest(raw.last_known_good_manifest, registry, defaultManifest, { appendMissing: true, missingEnabled: false })
    : null;
  return {
    ...base,
    ...raw,
    schema: STATE_SCHEMA,
    survival_version: VERSION,
    current_manifest: current,
    last_known_good_manifest: knownGood,
    force_safe_mode: raw.force_safe_mode === true,
    safe_mode_reason: raw.safe_mode_reason || null,
    boot: {
      ...base.boot,
      ...(raw.boot || {}),
      plugins: Array.isArray(raw.boot?.plugins) ? raw.boot.plugins : []
    }
  };
}

function createSurvivalLoader(options) {
  const {
    registry,
    storage,
    defaultManifest,
    renderRecovery,
    reload = () => globalThis.location.reload(),
    now = () => Date.now(),
    platform = { window: globalThis.window, document: globalThis.document }
  } = options;
  const startedApis = new Map();
  let state = sanitizeState(storage.getState(null), registry, defaultManifest);

  function save() { storage.setState(state); }
  function manifest() { return cloneManifest(state.current_manifest); }
  function setManifest(next, { restart = true } = {}) {
    const normalized = normalizeManifest(next, registry, defaultManifest, { appendMissing: true });
    if (!normalized.length && next?.length) throw new Error('manifest_has_no_available_plugins');
    state.current_manifest = normalized;
    state.force_safe_mode = false;
    state.safe_mode_reason = null;
    state.boot.status = 'idle';
    save();
    if (restart) reload();
    return manifest();
  }

  function publicRuntime() {
    return {
      get: (id) => startedApis.get(id) || null,
      has: (id) => startedApis.has(id),
      list: () => Array.from(startedApis.keys())
    };
  }

  function survivalApi() {
    return {
      version: VERSION,
      currentManifest: manifest,
      lastKnownGoodManifest: () => cloneManifest(state.last_known_good_manifest || []),
      availablePlugins: () => registry.list().map((plugin) => ({ id: plugin.id, version: plugin.version, title: plugin.title || plugin.id, description: plugin.description || '' })),
      setManifest,
      restart: reload,
      enterSafeMode(reason = 'requested_by_plugin') {
        state.force_safe_mode = true;
        state.safe_mode_reason = reason;
        save();
        reload();
      },
      stateSnapshot: () => clone(state)
    };
  }

  function recoveryModel(reason) {
    return {
      version: VERSION,
      reason,
      state: clone(state),
      retry() {
        state.force_safe_mode = false;
        state.safe_mode_reason = null;
        state.boot.status = 'idle';
        state.boot.error = null;
        save(); reload();
      },
      skipFailed() {
        const failed = state.boot.plugins.find((item) => item.status === 'failed');
        if (failed) state.current_manifest = state.current_manifest.map((entry) => entry.id === failed.id ? { ...entry, enabled: false } : entry);
        state.force_safe_mode = false;
        state.safe_mode_reason = null;
        state.boot.status = 'idle';
        save(); reload();
      },
      loadKnownGood() {
        if (state.last_known_good_manifest) state.current_manifest = cloneManifest(state.last_known_good_manifest);
        state.force_safe_mode = false;
        state.safe_mode_reason = null;
        state.boot.status = 'idle';
        save(); reload();
      },
      loadMinimal() {
        state.current_manifest = state.current_manifest.map((entry) => ({ ...entry, enabled: false }));
        state.force_safe_mode = true;
        state.safe_mode_reason = 'minimal_combination';
        state.boot.status = 'idle';
        save(); reload();
      },
      diagnostics() {
        return JSON.stringify({
          schema: 'dcf.next.survival.diagnostics.v1',
          generated_at: nowIso(now),
          survival_version: VERSION,
          reason,
          current_manifest: state.current_manifest,
          last_known_good_manifest: state.last_known_good_manifest,
          boot: state.boot
        }, null, 2);
      }
    };
  }

  function enterRecovery(reason) {
    state.force_safe_mode = true;
    state.safe_mode_reason = reason;
    save();
    renderRecovery(recoveryModel(reason));
    return { ok: false, safe_mode: true, reason };
  }

  async function boot() {
    state = sanitizeState(storage.getState(null), registry, defaultManifest);
    if (state.force_safe_mode) return enterRecovery(state.safe_mode_reason || 'forced_safe_mode');
    if (state.boot.status === 'starting') return enterRecovery('incomplete_previous_boot');

    state.boot = {
      status: 'starting',
      attempt_id: `${now()}-${Math.random().toString(36).slice(2, 9)}`,
      started_at: nowIso(now),
      completed_at: null,
      plugins: [],
      error: null
    };
    save();

    for (const entry of state.current_manifest) {
      if (!entry.enabled) {
        state.boot.plugins.push({ ...entry, status: 'disabled' }); save(); continue;
      }
      const plugin = registry.get(entry.id, entry.version);
      if (!plugin) {
        state.boot.plugins.push({ ...entry, status: 'failed', error: 'plugin_not_found' });
        state.boot.status = 'failed';
        state.boot.error = { plugin_id: entry.id, message: 'plugin_not_found' };
        save();
        return enterRecovery('plugin_not_found');
      }
      const status = { ...entry, status: 'starting', started_at: nowIso(now) };
      state.boot.plugins.push(status); save();
      try {
        const api = await plugin.start({
          plugin: { id: plugin.id, version: plugin.version, title: plugin.title || plugin.id },
          platform,
          storage: storage.scope(plugin.id),
          rawStorage: storage,
          plugins: publicRuntime(),
          survival: survivalApi()
        });
        startedApis.set(plugin.id, api || Object.freeze({}));
        status.status = 'started';
        status.completed_at = nowIso(now);
        save();
      } catch (error) {
        const message = error?.message || String(error);
        status.status = 'failed';
        status.completed_at = nowIso(now);
        status.error = message;
        state.boot.status = 'failed';
        state.boot.error = { plugin_id: plugin.id, message };
        save();
        return enterRecovery('plugin_start_failed');
      }
    }

    state.boot.status = 'completed';
    state.boot.completed_at = nowIso(now);
    state.force_safe_mode = false;
    state.safe_mode_reason = null;
    if (!sameManifest(state.last_known_good_manifest, state.current_manifest)) state.last_known_good_manifest = cloneManifest(state.current_manifest);
    save();
    return { ok: true, safe_mode: false, started: Array.from(startedApis.keys()), manifest: manifest() };
  }

  return { boot, getState: () => clone(state), setManifest };
}

module.exports = { createSurvivalLoader, defaultState, sanitizeState };

},
"src-next/survival/manifest.js":function(module,exports,require){
'use strict';

function cloneManifest(manifest) {
  return (manifest || []).map((entry) => ({ id: entry.id, version: entry.version, enabled: entry.enabled !== false }));
}

function sameManifest(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return Boolean(other) && entry.id === other.id && entry.version === other.version && (entry.enabled !== false) === (other.enabled !== false);
  });
}

function normalizeManifest(input, registry, fallback, options = {}) {
  const fallbackEntries = cloneManifest(fallback);
  const fallbackById = new Map(fallbackEntries.map((entry) => [entry.id, entry]));
  const source = Array.isArray(input) ? input : fallbackEntries;
  const seen = new Set();
  const normalized = [];

  for (const raw of source || []) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.version !== 'string' || seen.has(raw.id)) continue;
    const fallbackEntry = fallbackById.get(raw.id);
    const version = registry.get(raw.id, raw.version)
      ? raw.version
      : fallbackEntry && registry.get(fallbackEntry.id, fallbackEntry.version)
        ? fallbackEntry.version
        : null;
    if (!version) continue;
    seen.add(raw.id);
    normalized.push({ id: raw.id, version, enabled: raw.enabled !== false });
  }

  const appendMissing = options.appendMissing !== false;
  if (appendMissing) {
    for (const entry of fallbackEntries) {
      if (seen.has(entry.id) || !registry.get(entry.id, entry.version)) continue;
      seen.add(entry.id);
      normalized.push({
        id: entry.id,
        version: entry.version,
        enabled: options.missingEnabled === undefined ? entry.enabled !== false : options.missingEnabled === true
      });
    }
  }

  return normalized;
}

module.exports = { cloneManifest, sameManifest, normalizeManifest };

},
"src-next/survival/recovery-ui.js":function(module,exports,require){
'use strict';

const { copyText } = require("src-next/core/utils.js");

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function renderRecovery(model) {
  const doc = globalThis.document;
  if (!doc?.documentElement) return;
  doc.getElementById('dcf-next-recovery-host')?.remove();
  const host = doc.createElement('div');
  host.id = 'dcf-next-recovery-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial} .box{position:fixed;z-index:2147483647;right:16px;top:16px;width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#171717;color:#f5f5f5;border:1px solid #555;border-radius:12px;padding:16px;font:13px/1.45 system-ui;box-shadow:0 16px 40px #0008}h2{margin:0 0 8px;font-size:16px}code{word-break:break-all}ul{padding-left:18px}.actions{display:flex;flex-wrap:wrap;gap:8px}button,a{border:1px solid #666;background:#292929;color:#fff;border-radius:8px;padding:7px 10px;text-decoration:none;cursor:pointer}.reason{color:#f8c36a}</style>`;
  const box = el('section'); box.className = 'box';
  box.append(el('h2', `DCF Next 安全模式 · ${model.version}`), el('p', `原因：${model.reason}`, { class: 'reason' }));
  const list = el('ul');
  for (const item of model.state.boot.plugins || []) list.append(el('li', `${item.id}@${item.version} — ${item.status}${item.error ? ` — ${item.error}` : ''}`));
  box.append(list);
  const actions = el('div'); actions.className = 'actions';
  const addButton = (label, action) => { const button = el('button', label); button.onclick = action; actions.append(button); };
  addButton('重试当前组合', model.retry);
  addButton('跳过失败插件', model.skipFailed);
  addButton('回到最近可用组合', model.loadKnownGood);
  addButton('加载最小组合', model.loadMinimal);
  addButton('复制诊断', () => copyText(model.diagnostics()));
  const reinstall = el('a', '重新安装审查脚本');
  reinstall.href = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.user.js';
  reinstall.target = '_blank'; actions.append(reinstall);
  box.append(actions); shadow.append(box); doc.documentElement.append(host);
}

module.exports = { renderRecovery };

},
"src-next/survival/storage.js":function(module,exports,require){
'use strict';

const { STATE_KEY, PLUGIN_STORAGE_PREFIX } = require("src-next/survival/constants.js");

function resolveStorageApi(overrides = {}) {
  return {
    getValue: overrides.getValue || (typeof GM_getValue === 'function' ? GM_getValue : null),
    setValue: overrides.setValue || (typeof GM_setValue === 'function' ? GM_setValue : null),
    deleteValue: overrides.deleteValue || (typeof GM_deleteValue === 'function' ? GM_deleteValue : null),
    listValues: overrides.listValues || (typeof GM_listValues === 'function' ? GM_listValues : null)
  };
}

function createBrowserStorage(overrides = {}) {
  const api = resolveStorageApi(overrides);
  const fallback = new Map();
  const persistent = Boolean(api.getValue && api.setValue && api.deleteValue && api.listValues);
  const browserLike = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (browserLike && !persistent) throw new Error('gm_storage_api_unavailable');

  function read(key, defaultValue) {
    return persistent ? api.getValue(key, defaultValue) : (fallback.has(key) ? fallback.get(key) : defaultValue);
  }
  function write(key, value) {
    if (persistent) return api.setValue(key, value);
    fallback.set(key, value);
  }
  function remove(key) {
    if (persistent) return api.deleteValue(key);
    fallback.delete(key);
  }
  function list() {
    return persistent ? api.listValues() : Array.from(fallback.keys());
  }
  return {
    getState(defaultValue) { return read(STATE_KEY, defaultValue); },
    setState(value) { write(STATE_KEY, value); },
    readRaw: read,
    writeRaw: write,
    removeRaw: remove,
    listRaw: list,
    scope(pluginId) {
      const prefix = `${PLUGIN_STORAGE_PREFIX}${pluginId}.`;
      return {
        get(key, defaultValue) { return read(`${prefix}${key}`, defaultValue); },
        set(key, value) { write(`${prefix}${key}`, value); },
        remove(key) { remove(`${prefix}${key}`); },
        keys() { return list().filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)); }
      };
    }
  };
}

module.exports = { createBrowserStorage, resolveStorageApi };

}
};
const cache={};
function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF Next module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}
require('src-next/index.js');
})();
