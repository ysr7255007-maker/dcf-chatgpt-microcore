// ==UserScript==
// @name         DCF ChatGPT Next Core Review
// @namespace    https://chatgpt.com/
// @version      0.1.0-alpha.1
// @description  Experimental minimal survival core for real plugin-pack and dynamic-loading acceptance.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next-core-review.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next-core-review.user.js
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
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==
(function(){'use strict';
const modules={
"src-next/experimental/core-review-constants.js":function(module,exports,require){
'use strict';

const CORE_REVIEW_VERSION = '0.1.0-alpha.1';
const CORE_STATE_SCHEMA = 'dcf.core-review.state.v1';
const CORE_STATE_KEY = 'dcf.core-review.state.v1';
const MODULE_PREFIX = 'dcf.core-review.module.';
const RESOURCE_PREFIX = 'dcf.core-review.resource.';
const PLUGIN_STORAGE_PREFIX = 'dcf.next.plugin.';
const DEFAULT_PACK_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dist/dcf-official-plugin-pack.json';

module.exports = {
  CORE_REVIEW_VERSION,
  CORE_STATE_SCHEMA,
  CORE_STATE_KEY,
  MODULE_PREFIX,
  RESOURCE_PREFIX,
  PLUGIN_STORAGE_PREFIX,
  DEFAULT_PACK_URL
};

},
"src-next/experimental/core-review-modules.js":function(module,exports,require){
'use strict';

const {
  CORE_REVIEW_VERSION,
  CORE_STATE_SCHEMA,
  CORE_STATE_KEY,
  PLUGIN_STORAGE_PREFIX
} = require("src-next/experimental/core-review-constants.js");
const { clone, nowIso, isObject } = require("src-next/experimental/core-review-storage.js");

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
        try { handler(payload); } catch (error) { console.error('[DCF Core Review event]', type, error); }
      }
    },
    clear() { listeners.clear(); }
  };
}
function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function copyText(text) {
  if (typeof GM_setClipboard === 'function') { GM_setClipboard(String(text), 'text'); return Promise.resolve(); }
  if (globalThis.navigator?.clipboard?.writeText) return navigator.clipboard.writeText(String(text));
  return Promise.reject(new Error('clipboard_unavailable'));
}
function debounce(fn, wait) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}
function normalizeText(value, fallback = '') { return typeof value === 'string' ? value : fallback; }
function safeJsonParse(text, fallback = null) { try { return JSON.parse(text); } catch (_error) { return fallback; } }

async function sha256Text(text, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle) throw new Error('webcrypto_subtle_unavailable');
  const bytes = new TextEncoder().encode(String(text));
  const digest = await cryptoObject.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function canonicalModuleId(fromId, request) {
  if (!String(request).startsWith('.')) return String(request);
  const parts = String(fromId).split('/');
  parts.pop();
  for (const part of String(request).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  let resolved = parts.join('/');
  if (!resolved.endsWith('.js')) resolved += '.js';
  return resolved;
}

function createBuiltInModules() {
  return {
    'src-next/core/utils.js': Object.freeze({ clone, isObject, nowIso, normalizeText, safeJsonParse, createEmitter, downloadText, copyText, debounce }),
    'src-next/survival/constants.js': Object.freeze({ VERSION: CORE_REVIEW_VERSION, STATE_SCHEMA: CORE_STATE_SCHEMA, STATE_KEY: CORE_STATE_KEY, PLUGIN_STORAGE_PREFIX })
  };
}

function createDynamicModuleRuntime(options) {
  const { readUnit, expectedHashes = {}, builtIns = createBuiltInModules(), FunctionCtor = Function } = options;
  const cache = new Map();
  function load(id) {
    if (Object.prototype.hasOwnProperty.call(builtIns, id)) return builtIns[id];
    if (cache.has(id)) return cache.get(id).exports;
    const unit = readUnit(id);
    if (!unit) throw new Error(`dynamic_module_missing:${id}`);
    const expected = expectedHashes[id];
    if (expected && unit.sha256 !== expected) throw new Error(`dynamic_module_hash_mismatch:${id}`);
    const module = { exports: {} };
    cache.set(id, module);
    const localRequire = (request) => load(canonicalModuleId(id, request));
    try {
      const execute = new FunctionCtor('module', 'exports', 'require', `${unit.content}\n//# sourceURL=dcf-core-review://${id}`);
      execute(module, module.exports, localRequire);
    } catch (error) {
      cache.delete(id);
      const wrapped = new Error(`dynamic_module_evaluation_failed:${id}:${error?.message || String(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
    return module.exports;
  }
  return { load, cacheKeys: () => Array.from(cache.keys()) };
}

module.exports = {
  createEmitter,
  downloadText,
  copyText,
  debounce,
  normalizeText,
  safeJsonParse,
  sha256Text,
  canonicalModuleId,
  createBuiltInModules,
  createDynamicModuleRuntime
};

},
"src-next/experimental/core-review-pack.js":function(module,exports,require){
'use strict';

const { clone, nowIso } = require("src-next/experimental/core-review-storage.js");
const { sha256Text } = require("src-next/experimental/core-review-modules.js");

async function validatePluginPackBundle(bundle, cryptoObject = globalThis.crypto) {
  if (!bundle || bundle.schema !== 'dcf.plugin-pack.bundle.v1') throw new Error('plugin_pack_bundle_schema_invalid');
  const pack = bundle.pack;
  if (!pack || pack.schema !== 'dcf.plugin-pack.v1' || !pack.id || !pack.version) throw new Error('plugin_pack_manifest_invalid');
  if (!Array.isArray(pack.modules) || !Array.isArray(pack.plugins) || !Array.isArray(pack.resources) || !Array.isArray(bundle.files)) throw new Error('plugin_pack_lists_invalid');
  const files = new Map();
  for (const file of bundle.files) {
    if (!file?.path || typeof file.content !== 'string' || !file.sha256) throw new Error('plugin_pack_file_invalid');
    if (files.has(file.path)) throw new Error(`plugin_pack_duplicate_file:${file.path}`);
    if (await sha256Text(file.content, cryptoObject) !== file.sha256) throw new Error(`plugin_pack_hash_mismatch:${file.path}`);
    files.set(file.path, file);
  }
  for (const path of pack.modules) if (!files.has(path)) throw new Error(`plugin_pack_module_missing:${path}`);
  for (const resource of pack.resources) if (!files.has(resource.path)) throw new Error(`plugin_pack_resource_missing:${resource.path}`);
  const keys = new Set();
  for (const plugin of pack.plugins) {
    const key = `${plugin.id}@${plugin.version}`;
    if (keys.has(key)) throw new Error(`plugin_pack_duplicate_plugin:${key}`);
    keys.add(key);
    if (!pack.modules.includes(plugin.entry)) throw new Error(`plugin_pack_entry_not_module:${plugin.entry}`);
  }
  return { pack: clone(pack), files };
}

async function installPluginPack(bundle, storage, state, cryptoObject = globalThis.crypto) {
  const validated = await validatePluginPackBundle(bundle, cryptoObject);
  for (const id of validated.pack.modules) {
    const file = validated.files.get(id);
    storage.writeModule({ id, content: file.content, sha256: file.sha256, pack_id: validated.pack.id, pack_version: validated.pack.version, installed_at: nowIso() });
  }
  for (const resource of validated.pack.resources) {
    const file = validated.files.get(resource.path);
    storage.writeResource({ id: resource.path, plugin_id: resource.plugin_id, role: resource.role, content: file.content, sha256: file.sha256, pack_id: validated.pack.id, pack_version: validated.pack.version, installed_at: nowIso() });
  }
  state.installed_packs[validated.pack.id] = { id: validated.pack.id, version: validated.pack.version, title: validated.pack.title || validated.pack.id, installed_at: nowIso(), manifest: validated.pack };
  storage.setState(state);
  return clone(state.installed_packs[validated.pack.id]);
}

function pluginCatalog(state) {
  const values = [];
  for (const pack of Object.values(state.installed_packs || {})) {
    for (const plugin of pack.manifest?.plugins || []) values.push({ ...plugin, pack_id: pack.id, pack_version: pack.version });
  }
  return values;
}

function buildSnapshot(state, storage, packId, recommendation) {
  const installed = state.installed_packs?.[packId];
  if (!installed) throw new Error(`plugin_pack_not_installed:${packId}`);
  const pack = installed.manifest;
  const requested = pack.recommended_snapshots?.[recommendation];
  if (!Array.isArray(requested)) throw new Error(`plugin_pack_snapshot_missing:${recommendation}`);
  const catalog = new Map((pack.plugins || []).map((plugin) => [`${plugin.id}@${plugin.version}`, plugin]));
  const plugins = requested.map((key) => {
    const plugin = catalog.get(key);
    if (!plugin) throw new Error(`plugin_pack_snapshot_plugin_missing:${key}`);
    return { ...plugin, pack_id: pack.id, pack_version: pack.version, enabled: true };
  });
  const modules = pack.modules.map((id) => {
    const unit = storage.readModule(id);
    if (!unit) throw new Error(`installed_module_missing:${id}`);
    return { id, sha256: unit.sha256 };
  });
  return { schema: 'dcf.boot-snapshot.v1', id: `${pack.id}:${pack.version}:${recommendation}`, created_at: nowIso(), pack: { id: pack.id, version: pack.version }, modules, plugins };
}

function snapshotFromManifest(state, storage, manifest, previousSnapshot = null) {
  const catalog = new Map(pluginCatalog(state).map((plugin) => [`${plugin.id}@${plugin.version}`, plugin]));
  const plugins = (manifest || []).map((item) => {
    const plugin = catalog.get(`${item.id}@${item.version}`);
    if (!plugin) throw new Error(`snapshot_plugin_not_installed:${item.id}@${item.version}`);
    return { ...plugin, enabled: item.enabled !== false };
  });
  const modules = [];
  const seen = new Set();
  for (const packId of new Set(plugins.map((plugin) => plugin.pack_id))) {
    for (const id of state.installed_packs[packId]?.manifest?.modules || []) {
      if (seen.has(id)) continue;
      const unit = storage.readModule(id);
      if (!unit) throw new Error(`installed_module_missing:${id}`);
      seen.add(id); modules.push({ id, sha256: unit.sha256 });
    }
  }
  return { schema: 'dcf.boot-snapshot.v1', id: `custom:${Date.now()}`, created_at: nowIso(), pack: previousSnapshot?.pack || null, modules, plugins };
}

module.exports = { validatePluginPackBundle, installPluginPack, pluginCatalog, buildSnapshot, snapshotFromManifest };

},
"src-next/experimental/core-review-runtime.js":function(module,exports,require){
'use strict';

const { CORE_REVIEW_VERSION } = require("src-next/experimental/core-review-constants.js");
const { clone, nowIso, createCoreStorage, sanitizeState } = require("src-next/experimental/core-review-storage.js");
const { createDynamicModuleRuntime } = require("src-next/experimental/core-review-modules.js");
const { installPluginPack, pluginCatalog, buildSnapshot, snapshotFromManifest } = require("src-next/experimental/core-review-pack.js");
const { createRecoveryRenderer } = require("src-next/experimental/core-review-ui.js");

function createCoreReview(options = {}) {
  const storage = options.storage || createCoreStorage();
  const platform = options.platform || { window: globalThis.window, document: globalThis.document };
  let state = sanitizeState(storage.getState(null));
  const startedApis = new Map();
  const save = () => storage.setState(state);
  const reload = () => platform.window.location.reload();
  const setState = (next) => { state = next; };
  const recovery = createRecoveryRenderer({ platform, storage, getState: () => state, setState, save, reload });

  const currentManifest = () => (state.current_snapshot?.plugins || []).map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: plugin.enabled !== false }));
  const lastKnownGoodManifest = () => (state.last_known_good_snapshot?.plugins || []).map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: plugin.enabled !== false }));
  const publicRuntime = () => ({ get: (id) => startedApis.get(id) || null, has: (id) => startedApis.has(id), list: () => Array.from(startedApis.keys()) });
  const availablePlugins = () => pluginCatalog(state).map((plugin) => ({ id: plugin.id, version: plugin.version, title: plugin.id, description: '', pack_id: plugin.pack_id }));

  function setManifest(manifest, { restart = true } = {}) {
    state.current_snapshot = snapshotFromManifest(state, storage, manifest, state.current_snapshot);
    state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle'; save();
    if (restart) reload();
    return currentManifest();
  }
  function survivalApi() {
    return {
      version: CORE_REVIEW_VERSION,
      currentManifest,
      lastKnownGoodManifest,
      availablePlugins,
      setManifest,
      restart: reload,
      enterSafeMode(reason = 'requested_by_plugin') { state.force_recovery = true; state.recovery_reason = reason; save(); reload(); },
      stateSnapshot: () => clone(state)
    };
  }

  async function boot() {
    state = sanitizeState(storage.getState(null));
    startedApis.clear();
    if (state.force_recovery) { recovery.render(state.recovery_reason || 'forced_recovery'); return { ok: false, recovery: true }; }
    if (state.boot.status === 'starting') {
      state.force_recovery = true; state.recovery_reason = 'incomplete_previous_boot'; save();
      recovery.render('incomplete_previous_boot'); return { ok: false, recovery: true };
    }
    if (!state.current_snapshot) { recovery.render('no_snapshot'); return { ok: false, recovery: true }; }

    const snapshot = state.current_snapshot;
    const expectedHashes = Object.fromEntries((snapshot.modules || []).map((unit) => [unit.id, unit.sha256]));
    const runtime = createDynamicModuleRuntime({ readUnit: (id) => storage.readModule(id), expectedHashes });
    state.boot = { status: 'starting', attempt_id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, started_at: nowIso(), completed_at: null, plugins: [], error: null };
    save();

    for (const entry of snapshot.plugins || []) {
      if (entry.enabled === false) { state.boot.plugins.push({ id: entry.id, version: entry.version, status: 'disabled' }); save(); continue; }
      const status = { id: entry.id, version: entry.version, status: 'starting', started_at: nowIso() };
      state.boot.plugins.push(status); save();
      try {
        const exported = runtime.load(entry.entry);
        const factory = exported?.[entry.factory];
        if (typeof factory !== 'function') throw new Error(`plugin_factory_missing:${entry.factory}`);
        const definition = factory();
        if (definition?.id !== entry.id || definition?.version !== entry.version || typeof definition.start !== 'function') throw new Error('plugin_definition_mismatch');
        const api = await definition.start({
          plugin: { id: definition.id, version: definition.version, title: definition.title || definition.id },
          platform,
          storage: storage.scope(definition.id),
          rawStorage: storage,
          plugins: publicRuntime(),
          survival: survivalApi()
        });
        startedApis.set(definition.id, api || Object.freeze({}));
        status.status = 'started'; status.completed_at = nowIso(); save();
      } catch (error) {
        status.status = 'failed'; status.completed_at = nowIso(); status.error = error?.message || String(error);
        state.boot.status = 'failed'; state.boot.error = { plugin_id: entry.id, message: status.error };
        state.force_recovery = true; state.recovery_reason = 'plugin_start_failed'; save();
        recovery.render(`plugin_start_failed:${entry.id}`);
        return { ok: false, recovery: true, error: state.boot.error };
      }
    }

    state.boot.status = 'completed'; state.boot.completed_at = nowIso();
    state.last_known_good_snapshot = clone(snapshot);
    state.force_recovery = false; state.recovery_reason = null; save();
    recovery.render('running');
    return { ok: true, started: Array.from(startedApis.keys()), snapshot: snapshot.id };
  }

  return {
    boot,
    state: () => clone(state),
    storage,
    importBundle: async (bundle) => { const result = await installPluginPack(bundle, storage, state); state = sanitizeState(storage.getState(null)); return result; },
    activateRecommendation(packId, name, { restart = true } = {}) {
      state.current_snapshot = buildSnapshot(state, storage, packId, name);
      state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle'; save();
      if (restart) reload();
      return clone(state.current_snapshot);
    },
    setManifest,
    renderRecovery: recovery.render,
    runtime: publicRuntime()
  };
}

module.exports = { createCoreReview };

},
"src-next/experimental/core-review-storage.js":function(module,exports,require){
'use strict';

const {
  CORE_REVIEW_VERSION,
  CORE_STATE_SCHEMA,
  CORE_STATE_KEY,
  MODULE_PREFIX,
  RESOURCE_PREFIX,
  PLUGIN_STORAGE_PREFIX
} = require("src-next/experimental/core-review-constants.js");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
function nowIso() { return new Date().toISOString(); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function resolveStorageApi(overrides = {}) {
  return {
    getValue: overrides.getValue || (typeof GM_getValue === 'function' ? GM_getValue : null),
    setValue: overrides.setValue || (typeof GM_setValue === 'function' ? GM_setValue : null),
    deleteValue: overrides.deleteValue || (typeof GM_deleteValue === 'function' ? GM_deleteValue : null),
    listValues: overrides.listValues || (typeof GM_listValues === 'function' ? GM_listValues : null)
  };
}

function createCoreStorage(overrides = {}) {
  const api = resolveStorageApi(overrides);
  const fallback = new Map();
  const persistent = Boolean(api.getValue && api.setValue && api.deleteValue && api.listValues);
  const browserLike = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (browserLike && !persistent) throw new Error('gm_storage_api_unavailable');

  const read = (key, fallbackValue) => persistent ? api.getValue(key, fallbackValue) : (fallback.has(key) ? fallback.get(key) : fallbackValue);
  const write = (key, value) => persistent ? api.setValue(key, value) : fallback.set(key, value);
  const remove = (key) => persistent ? api.deleteValue(key) : fallback.delete(key);
  const list = () => persistent ? api.listValues() : Array.from(fallback.keys());
  const encode = (value) => encodeURIComponent(value);

  return {
    getState(defaultValue) { return read(CORE_STATE_KEY, defaultValue); },
    setState(value) { write(CORE_STATE_KEY, value); },
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
    },
    writeModule(unit) { write(`${MODULE_PREFIX}${encode(unit.id)}`, unit); },
    readModule(id) { return read(`${MODULE_PREFIX}${encode(id)}`, null); },
    listModules() { return list().filter((key) => key.startsWith(MODULE_PREFIX)).map((key) => read(key, null)).filter(Boolean); },
    removeModule(id) { remove(`${MODULE_PREFIX}${encode(id)}`); },
    writeResource(unit) { write(`${RESOURCE_PREFIX}${encode(unit.id)}`, unit); },
    listResources() { return list().filter((key) => key.startsWith(RESOURCE_PREFIX)).map((key) => read(key, null)).filter(Boolean); }
  };
}

function defaultState() {
  return {
    schema: CORE_STATE_SCHEMA,
    core_version: CORE_REVIEW_VERSION,
    installed_packs: {},
    current_snapshot: null,
    last_known_good_snapshot: null,
    force_recovery: false,
    recovery_reason: null,
    boot: { status: 'idle', attempt_id: null, started_at: null, completed_at: null, plugins: [], error: null }
  };
}

function sanitizeState(raw) {
  const base = defaultState();
  if (!raw || raw.schema !== CORE_STATE_SCHEMA) return base;
  return {
    ...base,
    ...raw,
    schema: CORE_STATE_SCHEMA,
    core_version: CORE_REVIEW_VERSION,
    installed_packs: isObject(raw.installed_packs) ? raw.installed_packs : {},
    boot: { ...base.boot, ...(raw.boot || {}), plugins: Array.isArray(raw.boot?.plugins) ? raw.boot.plugins : [] }
  };
}

module.exports = { clone, nowIso, isObject, resolveStorageApi, createCoreStorage, defaultState, sanitizeState };

},
"src-next/experimental/core-review-ui.js":function(module,exports,require){
'use strict';

const { CORE_REVIEW_VERSION, DEFAULT_PACK_URL } = require("src-next/experimental/core-review-constants.js");
const { downloadText } = require("src-next/experimental/core-review-modules.js");
const { installPluginPack, buildSnapshot } = require("src-next/experimental/core-review-pack.js");

function fetchText(url) {
  if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('gm_xmlhttp_request_unavailable'));
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url, headers: { Accept: 'application/json' }, timeout: 15000,
      onload(response) {
        if (response.status >= 200 && response.status < 300) resolve(String(response.responseText || ''));
        else reject(new Error(`plugin_pack_http_${response.status}`));
      },
      onerror: () => reject(new Error('plugin_pack_network_error')),
      ontimeout: () => reject(new Error('plugin_pack_timeout'))
    });
  });
}

function createRecoveryRenderer(options) {
  const { platform, storage, getState, setState, save, reload } = options;
  let host = null;
  let panelOpen = true;
  function element(tag, text, className) {
    const node = platform.document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function remove() { host?.remove(); host = null; }

  function render(reason = 'manual') {
    remove();
    let state = getState();
    const doc = platform.document;
    host = doc.createElement('div');
    host.id = 'dcf-core-review-recovery';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial}.toggle{position:fixed;z-index:2147483646;left:12px;bottom:12px;border:0;border-radius:999px;padding:8px 11px;background:#17212b;color:#fff;font:12px system-ui;cursor:pointer}.panel{position:fixed;z-index:2147483645;left:12px;bottom:52px;width:min(520px,calc(100vw - 24px));max-height:min(760px,calc(100vh - 70px));overflow:auto;background:#f8f8f8;color:#202124;border:1px solid #bbb;border-radius:12px;box-shadow:0 14px 40px #0004;padding:12px;font:13px/1.45 system-ui}.panel[hidden]{display:none}.stack{display:grid;gap:9px}.row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.card{border:1px solid #ddd;border-radius:9px;background:#fff;padding:9px}.muted{font-size:12px;color:#666}button,input,textarea{font:inherit}button{border:1px solid #aaa;background:#fff;border-radius:7px;padding:6px 8px;cursor:pointer}button.primary{background:#17212b;color:#fff}button.danger{color:#a11616}input,textarea{box-sizing:border-box;width:100%;border:1px solid #aaa;border-radius:7px;padding:7px}textarea{min-height:120px;resize:vertical}pre{white-space:pre-wrap;word-break:break-word;margin:0}@media(prefers-color-scheme:dark){.panel{background:#181818;color:#eee;border-color:#555}.card{background:#242424;border-color:#555}.muted{color:#aaa}button,input,textarea{background:#2a2a2a;color:#eee;border-color:#666}}
    </style>`;
    const toggle = element('button', 'DCF Core Review', 'toggle');
    const panel = element('section', null, 'panel stack');
    panel.hidden = !panelOpen;
    toggle.onclick = () => { panelOpen = !panelOpen; panel.hidden = !panelOpen; };

    const heading = element('div', null, 'card');
    heading.append(element('strong', `DCF Core Review · ${reason}`));
    const status = element('pre');
    status.textContent = JSON.stringify({
      core_version: CORE_REVIEW_VERSION,
      boot: state.boot,
      current_snapshot: state.current_snapshot?.id || null,
      last_known_good_snapshot: state.last_known_good_snapshot?.id || null,
      installed_packs: Object.keys(state.installed_packs || {}),
      stored_modules: storage.listModules().length
    }, null, 2);
    heading.append(status); panel.append(heading);

    const importCard = element('section', null, 'card stack');
    importCard.append(element('strong', '导入插件工具包'));
    const url = element('input'); url.value = DEFAULT_PACK_URL;
    const paste = element('textarea'); paste.placeholder = '或粘贴 dcf.plugin-pack.bundle.v1 JSON';
    const message = element('div', '', 'muted');
    const importValue = async (text) => {
      state = getState();
      const installed = await installPluginPack(JSON.parse(text), storage, state);
      setState(state);
      message.textContent = `已导入 ${installed.id}@${installed.version}`;
      render('pack_imported');
    };
    const fetchButton = element('button', '从 URL 导入', 'primary');
    fetchButton.onclick = () => fetchText(url.value).then(importValue).catch((error) => { message.textContent = error.message; });
    const pasteButton = element('button', '导入粘贴内容');
    pasteButton.onclick = () => importValue(paste.value).catch((error) => { message.textContent = error.message; });
    const importActions = element('div', null, 'row'); importActions.append(fetchButton, pasteButton);
    importCard.append(url, paste, importActions, message); panel.append(importCard);

    for (const installed of Object.values(state.installed_packs || {})) {
      const card = element('section', null, 'card stack');
      card.append(element('strong', `${installed.title || installed.id} · ${installed.version}`));
      const actions = element('div', null, 'row');
      for (const name of Object.keys(installed.manifest?.recommended_snapshots || {})) {
        const button = element('button', `加载 ${name}`, name === 'minimal' ? 'primary' : '');
        button.onclick = () => {
          try {
            state = getState();
            state.current_snapshot = buildSnapshot(state, storage, installed.id, name);
            state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle';
            setState(state); save(); reload();
          } catch (error) { message.textContent = error.message; }
        };
        actions.append(button);
      }
      card.append(actions); panel.append(card);
    }

    const recovery = element('section', null, 'card stack');
    recovery.append(element('strong', '原始恢复'));
    const actions = element('div', null, 'row');
    const knownGood = element('button', '加载上次可用快照', 'primary');
    knownGood.disabled = !state.last_known_good_snapshot;
    knownGood.onclick = () => {
      state = getState();
      state.current_snapshot = JSON.parse(JSON.stringify(state.last_known_good_snapshot));
      state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle';
      setState(state); save(); reload();
    };
    const clear = element('button', '清空当前快照', 'danger');
    clear.onclick = () => {
      state = getState();
      state.current_snapshot = null; state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle';
      setState(state); save(); reload();
    };
    const exportState = element('button', '下载状态');
    exportState.onclick = () => downloadText(`dcf-core-review-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ state: getState(), modules: storage.listModules().map((unit) => ({ id: unit.id, sha256: unit.sha256, pack_id: unit.pack_id, pack_version: unit.pack_version })) }, null, 2));
    actions.append(knownGood, clear, exportState); recovery.append(actions); panel.append(recovery);

    shadow.append(toggle, panel); doc.documentElement.append(host);
  }
  return { render, remove };
}

module.exports = { fetchText, createRecoveryRenderer };

},
"src-next/experimental/core-review.js":function(module,exports,require){
'use strict';

const constants = require("src-next/experimental/core-review-constants.js");
const storage = require("src-next/experimental/core-review-storage.js");
const modules = require("src-next/experimental/core-review-modules.js");
const pack = require("src-next/experimental/core-review-pack.js");
const { createCoreReview } = require("src-next/experimental/core-review-runtime.js");

async function main() {
  const core = createCoreReview();
  const result = await core.boot();
  globalThis.DCF_CORE_REVIEW = Object.freeze({
    version: constants.CORE_REVIEW_VERSION,
    result,
    state: core.state,
    importBundle: core.importBundle,
    activateRecommendation: core.activateRecommendation,
    setManifest: core.setManifest,
    runtime: core.runtime,
    showRecovery: () => core.renderRecovery('manual')
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  main().catch((error) => {
    console.error('[DCF Core Review fatal]', error);
    try {
      const host = document.createElement('pre');
      host.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;max-width:520px;background:#8b1e1e;color:#fff;padding:12px;border-radius:8px;white-space:pre-wrap';
      host.textContent = `DCF Core Review fatal: ${error?.message || String(error)}`;
      document.documentElement.append(host);
    } catch (_ignored) {}
  });
}

module.exports = { ...constants, ...storage, ...modules, ...pack, createCoreReview };

}
};
const cache={};
function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF Core Review module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}
require('src-next/experimental/core-review.js');
})();
