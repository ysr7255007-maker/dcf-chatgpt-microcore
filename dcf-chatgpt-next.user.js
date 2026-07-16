// ==UserScript==
// @name         DCF ChatGPT Next (Review)
// @namespace    https://chatgpt.com/
// @version      0.2.0-alpha.7
// @description  Minimal survival box plus the explicitly selected DCF official plugin pack.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.user.js
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

const { shellPlugin } = require("src-next/plugins/shell.js");
const { chatgptPlugin } = require("src-next/plugins/chatgpt.js");
const { localAgentPlugin } = require("src-next/plugins/local-agent.js");
const { ammoPlugin } = require("src-next/plugins/ammo.js");
const { pluginManagerPlugin } = require("src-next/plugins/plugin-manager.js");
const { appearancePlugin } = require("src-next/plugins/appearance.js");
const { backupPlugin } = require("src-next/plugins/backup.js");
const { conversationPerformancePlugin } = require("src-next/plugins/conversation-performance.js");
const { attributionPlugin } = require("src-next/plugins/attribution.js");
const { diagnosticsPlugin } = require("src-next/plugins/diagnostics.js");

function createPluginRegistry(plugins) {
  const values = plugins || [
    shellPlugin(),
    chatgptPlugin(),
    localAgentPlugin(),
    ammoPlugin(),
    conversationPerformancePlugin(),
    attributionPlugin(),
    appearancePlugin(),
    pluginManagerPlugin(),
    backupPlugin(),
    diagnosticsPlugin()
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
"src-next/plugins/ammo-artifacts.js":function(module,exports,require){
'use strict';

const { isObject } = require("src-next/core/utils.js");

const START = '<<<DCF_AMMO';
const END = 'DCF_AMMO>>>';
const LIBRARY_SCHEMA = 'dcf.language-ammo.library.v1';

function extractAmmoBlocks(text) {
  const source = String(text || '');
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(START, cursor);
    if (start < 0) break;
    const end = source.indexOf(END, start + START.length);
    if (end < 0) break;
    const bodyStart = source.indexOf('{', start + START.length);
    if (bodyStart >= 0 && bodyStart < end) blocks.push(source.slice(bodyStart, end).trim());
    cursor = end + END.length;
  }
  return blocks;
}

function normalizeAmmo(payload) {
  if (!isObject(payload) || !payload.id) throw new Error('DCF_AMMO requires id');
  return {
    id: String(payload.id),
    title: String(payload.title || payload.id),
    purpose: String(payload.purpose || ''),
    body: String(payload.body || ''),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    created_at: payload.created_at ? String(payload.created_at) : null,
    updated_at: payload.updated_at ? String(payload.updated_at) : null,
    source: payload.source ? String(payload.source) : null
  };
}

function decodeAmmoArtifacts(text) {
  const items = [];
  const errors = [];
  for (const block of extractAmmoBlocks(text)) {
    try { items.push(normalizeAmmo(JSON.parse(block))); }
    catch (error) { errors.push({ message: error?.message || String(error), length: block.length }); }
  }
  return { items, errors };
}

function portableAmmo(raw) {
  const item = normalizeAmmo(raw);
  const portable = {
    id: item.id,
    title: item.title,
    purpose: item.purpose,
    body: item.body,
    tags: item.tags
  };
  if (item.created_at) portable.created_at = item.created_at;
  if (item.updated_at) portable.updated_at = item.updated_at;
  return portable;
}

function encodeAmmoLibrary(items, exportedAt = new Date().toISOString()) {
  const values = (Array.isArray(items) ? items : Object.values(items || {}))
    .map(portableAmmo)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({
    schema: LIBRARY_SCHEMA,
    exported_at: String(exportedAt),
    count: values.length,
    items: values
  }, null, 2);
}

function decodeAmmoLibrary(text) {
  let payload;
  try { payload = JSON.parse(String(text || '')); }
  catch (_error) { throw new Error('language_ammo_library_invalid_json'); }
  if (!isObject(payload) || payload.schema !== LIBRARY_SCHEMA) throw new Error('language_ammo_library_schema_mismatch');
  if (!Array.isArray(payload.items)) throw new Error('language_ammo_library_items_required');
  const seen = new Set();
  const items = payload.items.map((raw) => {
    const item = normalizeAmmo(raw);
    if (seen.has(item.id)) throw new Error(`language_ammo_library_duplicate_id:${item.id}`);
    seen.add(item.id);
    return item;
  });
  return {
    schema: LIBRARY_SCHEMA,
    exported_at: payload.exported_at ? String(payload.exported_at) : null,
    items
  };
}

function comparableAmmo(raw) {
  const item = portableAmmo(raw);
  return JSON.stringify({
    id: item.id,
    title: item.title,
    purpose: item.purpose,
    body: item.body,
    tags: item.tags
  });
}

function classifyLibraryMerge(currentItems, incomingItems) {
  const current = currentItems || {};
  const result = { added: [], updated: [], unchanged: [] };
  for (const raw of incomingItems || []) {
    const item = normalizeAmmo(raw);
    const previous = current[item.id];
    if (!previous) result.added.push(item);
    else if (comparableAmmo(previous) === comparableAmmo(item)) result.unchanged.push(item);
    else result.updated.push(item);
  }
  return result;
}

function buildInvocation(item) {
  return ['〔DCF·语言弹药〕', '', String(item?.body || '')].join('\n');
}

function buildUpdateRequest(item) {
  return [
    '〔DCF·弹药更新〕',
    '',
    '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
    '- 保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
    '- 吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
    '- 这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。',
    '',
    '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。',
    '',
    '当前弹药：',
    JSON.stringify(item, null, 2)
  ].join('\n');
}

function buildExtractRequest() {
  return [
    '请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。',
    '先结合完整语境判断真正稳定、可迁移的认识，不要只摘录一句话。',
    '返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
  ].join('\n');
}

module.exports = {
  LIBRARY_SCHEMA,
  extractAmmoBlocks,
  normalizeAmmo,
  decodeAmmoArtifacts,
  encodeAmmoLibrary,
  decodeAmmoLibrary,
  classifyLibraryMerge,
  buildInvocation,
  buildUpdateRequest,
  buildExtractRequest
};

},
"src-next/plugins/ammo.js":function(module,exports,require){
'use strict';

const {
  normalizeAmmo,
  decodeAmmoArtifacts,
  encodeAmmoLibrary,
  decodeAmmoLibrary,
  classifyLibraryMerge,
  buildInvocation,
  buildUpdateRequest,
  buildExtractRequest
} = require("src-next/plugins/ammo-artifacts.js");
const { clone, nowIso, copyText } = require("src-next/core/utils.js");

const LEGACY_ROOT_KEY = 'dcf.state.root.v1';
const DEFAULT_LIBRARY_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/language-ammo-library/data/language-ammo/library.json';

function collectLegacyAmmo(raw) {
  const items = raw?.user?.content?.ammo || raw?.content?.ammo || raw?.ammo || {};
  return Object.values(items || {}).map((item) => normalizeAmmo(item));
}

function requestText(url) {
  if (typeof GM_xmlhttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        onload(response) {
          if (response.status >= 200 && response.status < 300) resolve(String(response.responseText || ''));
          else reject(new Error(`language_ammo_library_http_${response.status}`));
        },
        onerror() { reject(new Error('language_ammo_library_network_error')); },
        ontimeout() { reject(new Error('language_ammo_library_timeout')); }
      });
    });
  }
  if (typeof fetch === 'function') {
    return fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`language_ammo_library_http_${response.status}`);
      return response.text();
    });
  }
  return Promise.reject(new Error('language_ammo_library_transport_unavailable'));
}

function ammoPlugin() {
  return {
    id: 'dcf.next.ammo',
    version: '1.0.0',
    title: '语言弹药工作台',
    description: '语言弹药的数据、界面、发射、更新、自动装填和跨系统便携库。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const host = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell) throw new Error('shell_plugin_required');
      if (!host) throw new Error('chatgpt_plugin_required');

      let items = ctx.storage.get('items', {});
      let settings = {
        fire_mode: 'insert',
        library_url: DEFAULT_LIBRARY_URL,
        ...ctx.storage.get('settings', {})
      };
      let search = '';
      let editingId = null;

      function persist() {
        ctx.storage.set('items', items);
        ctx.storage.set('settings', settings);
      }
      function list() {
        return Object.values(items).filter((item) => {
          const haystack = `${item.title} ${item.purpose} ${(item.tags || []).join(' ')}`.toLowerCase();
          return !search || haystack.includes(search.toLowerCase());
        }).sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'));
      }
      function get(id) { return items[id] ? clone(items[id]) : null; }
      function upsert(raw, source = 'manual', options = {}) {
        const item = normalizeAmmo(raw);
        const previous = items[item.id];
        const timestamp = nowIso();
        items[item.id] = {
          ...previous,
          ...item,
          created_at: previous?.created_at || item.created_at || timestamp,
          updated_at: options.preserveTimestamps && item.updated_at ? item.updated_at : timestamp,
          source: source || item.source || previous?.source || 'manual'
        };
        persist();
        shell.refresh('ammo');
        return clone(items[item.id]);
      }
      function remove(id) {
        delete items[id];
        persist();
        shell.refresh('ammo');
      }

      async function exportLibrary() {
        const text = encodeAmmoLibrary(Object.values(items));
        await copyText(text);
        ctx.storage.set('last_library_export', {
          exported_at: nowIso(),
          count: Object.keys(items).length
        });
        return { count: Object.keys(items).length, text };
      }

      function importLibraryText(text, source = 'portable-library') {
        const library = decodeAmmoLibrary(text);
        const classified = classifyLibraryMerge(items, library.items);
        for (const item of [...classified.added, ...classified.updated]) {
          upsert(item, source, { preserveTimestamps: true });
        }
        const result = {
          imported_at: nowIso(),
          source,
          exported_at: library.exported_at,
          added: classified.added.length,
          updated: classified.updated.length,
          unchanged: classified.unchanged.length,
          total: library.items.length
        };
        ctx.storage.set('last_library_import', result);
        return result;
      }

      async function loadLibrary() {
        const text = await requestText(settings.library_url);
        return importLibraryText(text, 'github-library');
      }

      function actionError(error) {
        shell.notify(error?.message || String(error), 'error');
      }
      async function fire(item) {
        const text = buildInvocation(item);
        try {
          if (settings.fire_mode === 'send') await host.send(text);
          else await host.insert(text);
          shell.notify(settings.fire_mode === 'send' ? '弹药已发送' : '弹药已填入输入框');
        } catch (error) { actionError(error); }
      }
      async function requestUpdate(item) {
        try {
          await host.send(buildUpdateRequest(item));
          shell.notify('更新请求已发送');
        } catch (error) { actionError(error); }
      }
      async function requestExtract() {
        try {
          await host.send(buildExtractRequest());
          shell.notify('提取请求已发送');
        } catch (error) { actionError(error); }
      }

      function field(label, value, multiline = false) {
        const wrap = document.createElement('label');
        wrap.className = 'dcf-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        const input = document.createElement(multiline ? 'textarea' : 'input');
        input.value = value || '';
        wrap.append(caption, input);
        return { wrap, input };
      }

      function renderEditor(container, initial = {}) {
        container.replaceChildren();
        const stack = document.createElement('div');
        stack.className = 'dcf-stack';
        const id = field('稳定 ID', initial.id || '');
        const title = field('标题', initial.title || '');
        const purpose = field('用途', initial.purpose || '', true);
        const tags = field('标签（逗号分隔）', (initial.tags || []).join(', '));
        const body = field('正文', initial.body || '', true);
        body.input.style.minHeight = '220px';
        const actions = document.createElement('div');
        actions.className = 'dcf-row';
        const save = document.createElement('button');
        save.className = 'dcf-btn primary';
        save.textContent = '保存';
        const cancel = document.createElement('button');
        cancel.className = 'dcf-btn';
        cancel.textContent = '取消';
        save.onclick = () => {
          try {
            const stableId = id.input.value.trim();
            if (!stableId) throw new Error('必须填写稳定 ID');
            if (editingId && editingId !== stableId && items[stableId]) throw new Error('新的 ID 已经存在');
            if (editingId && editingId !== stableId) delete items[editingId];
            upsert({
              id: stableId,
              title: title.input.value,
              purpose: purpose.input.value,
              body: body.input.value,
              tags: tags.input.value.split(',').map((value) => value.trim()).filter(Boolean)
            });
            editingId = null;
            shell.refresh('ammo');
          } catch (error) { actionError(error); }
        };
        cancel.onclick = () => {
          editingId = null;
          shell.refresh('ammo');
        };
        actions.append(save, cancel);
        stack.append(id.wrap, title.wrap, purpose.wrap, tags.wrap, body.wrap, actions);
        container.append(stack);
      }

      function render(container) {
        container.replaceChildren();
        if (editingId !== null) {
          renderEditor(container, editingId ? items[editingId] : {});
          return;
        }

        const root = document.createElement('div');
        root.className = 'dcf-stack';
        const controls = document.createElement('div');
        controls.className = 'dcf-row';
        const input = document.createElement('input');
        input.placeholder = '搜索标题、用途或标签';
        input.value = search;
        input.style.flex = '1';
        input.oninput = () => {
          search = input.value;
          shell.refresh('ammo');
        };
        const create = document.createElement('button');
        create.className = 'dcf-btn primary';
        create.textContent = '新建';
        create.onclick = () => {
          editingId = '';
          shell.refresh('ammo');
        };
        const extract = document.createElement('button');
        extract.className = 'dcf-btn';
        extract.textContent = '从当前对话提取';
        extract.onclick = requestExtract;
        const mode = document.createElement('select');
        for (const [value, label] of [['insert', '填入输入框'], ['send', '直接发送']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = settings.fire_mode === value;
          mode.append(option);
        }
        mode.onchange = () => {
          settings.fire_mode = mode.value;
          persist();
        };
        controls.append(input, create, extract, mode);
        root.append(controls);

        const library = document.createElement('div');
        library.className = 'dcf-card dcf-stack';
        const libraryTitle = document.createElement('div');
        libraryTitle.className = 'dcf-title';
        libraryTitle.textContent = '跨系统便携库';
        const libraryText = document.createElement('div');
        libraryText.className = 'dcf-muted';
        libraryText.textContent = '复制后粘贴给 AI 代为上传；其他系统和 AI 从同一 GitHub 文件读取。';
        const libraryActions = document.createElement('div');
        libraryActions.className = 'dcf-row';
        const copyLibrary = document.createElement('button');
        copyLibrary.className = 'dcf-btn';
        copyLibrary.textContent = '复制便携库';
        copyLibrary.onclick = async () => {
          try {
            const result = await exportLibrary();
            shell.notify(`已复制 ${result.count} 枚语言弹药`);
          } catch (error) { actionError(error); }
        };
        const loadLibraryButton = document.createElement('button');
        loadLibraryButton.className = 'dcf-btn';
        loadLibraryButton.textContent = '从 GitHub 加载';
        loadLibraryButton.onclick = async () => {
          try {
            const result = await loadLibrary();
            shell.notify(`GitHub 载入完成：新增 ${result.added}，更新 ${result.updated}，未变 ${result.unchanged}`);
          } catch (error) { actionError(error); }
        };
        libraryActions.append(copyLibrary, loadLibraryButton);
        library.append(libraryTitle, libraryText, libraryActions);
        root.append(library);

        const shown = list();
        if (!shown.length) {
          const empty = document.createElement('div');
          empty.className = 'dcf-empty';
          empty.textContent = '还没有语言弹药';
          root.append(empty);
        }
        for (const item of shown) {
          const card = document.createElement('article');
          card.className = 'dcf-card dcf-stack';
          const header = document.createElement('div');
          header.className = 'dcf-row';
          const titleNode = document.createElement('div');
          titleNode.className = 'dcf-title';
          titleNode.textContent = item.title;
          titleNode.style.flex = '1';
          const idNode = document.createElement('span');
          idNode.className = 'dcf-badge';
          idNode.textContent = item.id;
          header.append(titleNode, idNode);
          card.append(header);
          if (item.purpose) {
            const purposeNode = document.createElement('div');
            purposeNode.className = 'dcf-muted';
            purposeNode.textContent = item.purpose;
            card.append(purposeNode);
          }
          const actions = document.createElement('div');
          actions.className = 'dcf-row';
          const button = (label, handler, extra = '') => {
            const node = document.createElement('button');
            node.className = `dcf-btn ${extra}`;
            node.textContent = label;
            node.onclick = handler;
            actions.append(node);
          };
          button('发射', () => fire(item), 'primary');
          button('复制正文', () => copyText(item.body).then(() => shell.notify('正文已复制')).catch(actionError));
          button('更新', () => requestUpdate(item));
          button('编辑', () => {
            editingId = item.id;
            shell.refresh('ammo');
          });
          button('删除', () => {
            if (confirm(`删除“${item.title}”？`)) remove(item.id);
          }, 'danger');
          card.append(actions);
          root.append(card);
        }
        container.append(root);
      }

      shell.registerPanel({ id: 'ammo', title: '弹药', render });
      host.onReplyCompleted(({ text }) => {
        const decoded = decodeAmmoArtifacts(text);
        for (const item of decoded.items) upsert(item, 'assistant-reply');
        if (decoded.items.length) shell.notify(`已自动装填 ${decoded.items.length} 枚语言弹药`);
        if (decoded.errors.length) shell.notify(`发现 DCF_AMMO，但有 ${decoded.errors.length} 个解析失败`, 'error');
      });

      return {
        list: () => Object.values(items).map(clone),
        get,
        upsert,
        remove,
        settings: () => clone(settings),
        setFireMode(mode) {
          if (!['insert', 'send'].includes(mode)) throw new Error('invalid_fire_mode');
          settings.fire_mode = mode;
          persist();
          shell.refresh('ammo');
        },
        exportLibrary,
        importLibraryText,
        loadLibrary,
        exportData: () => ({
          schema: 'dcf.next.ammo.export.v1',
          exported_at: nowIso(),
          items: Object.values(items),
          settings: clone(settings)
        }),
        importData(data) {
          for (const item of data?.items || []) upsert(item, 'import');
          if (data?.settings?.fire_mode) settings.fire_mode = data.settings.fire_mode;
          persist();
        }
      };
    }
  };
}

module.exports = {
  ammoPlugin,
  collectLegacyAmmo,
  requestText,
  DEFAULT_LIBRARY_URL
};

},
"src-next/plugins/appearance.js":function(module,exports,require){
'use strict';

const { DEFAULT_GEOMETRY } = require("src-next/plugins/shell.js");

function appearancePlugin() {
  return {
    id: 'dcf.next.appearance',
    version: '1.0.0',
    title: '外观与位置',
    description: '侧栏停靠、尺寸、位置与恢复默认值。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      let geometry = { ...DEFAULT_GEOMETRY, ...ctx.storage.get('geometry', {}) };
      shell.setGeometry(geometry);
      const unsubscribe = shell.onGeometry((next) => { geometry = { ...next }; ctx.storage.set('geometry', geometry); });

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const makeField = (label, key, type = 'number', options = null) => {
          const wrap = document.createElement('label'); wrap.className = 'dcf-field';
          const caption = document.createElement('span'); caption.textContent = label;
          const input = document.createElement(options ? 'select' : 'input');
          if (options) {
            for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = geometry[key] === value; input.append(option); }
          } else { input.type = type; input.value = geometry[key]; }
          input.onchange = () => {
            const value = options ? input.value : Number(input.value);
            geometry = { ...geometry, [key]: value }; shell.setGeometry(geometry); ctx.storage.set('geometry', geometry);
          };
          wrap.append(caption, input); root.append(wrap);
        };
        makeField('停靠', 'side', 'text', [['right', '右侧'], ['left', '左侧']]);
        makeField('宽度（px）', 'width');
        makeField('顶部位置（px）', 'top');
        makeField('高度（px）', 'height');
        makeField('边距（px）', 'margin');
        const reset = document.createElement('button'); reset.className = 'dcf-btn'; reset.textContent = '恢复默认位置';
        reset.onclick = () => { geometry = { ...DEFAULT_GEOMETRY }; ctx.storage.set('geometry', geometry); shell.setGeometry(geometry); shell.refresh('appearance'); };
        root.append(reset); container.append(root);
      }

      shell.registerPanel({ id: 'appearance', title: '外观', render });
      return { get: () => ({ ...geometry }), set: (next) => { geometry = { ...geometry, ...next }; ctx.storage.set('geometry', geometry); shell.setGeometry(geometry); }, destroy: unsubscribe };
    }
  };
}

module.exports = { appearancePlugin };

},
"src-next/plugins/attribution.js":function(module,exports,require){
'use strict';

const { copyText, nowIso } = require("src-next/core/utils.js");

function attributionPlugin() {
  return {
    id: 'dcf.next.attribution',
    version: '1.0.0',
    title: '问答性能归因',
    description: '从下一次发送到回复完成的有界浏览器性能样本。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const host = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell || !host) throw new Error('shell_and_chatgpt_required');
      let state = 'idle';
      let session = null;
      let report = null;
      let observers = [];
      let timeout = null;

      function clearObservers() { for (const observer of observers) try { observer.disconnect(); } catch (_error) {} observers = []; clearTimeout(timeout); }
      function addObserver(type, handler) {
        try {
          const observer = new PerformanceObserver((list) => handler(list.getEntries()));
          observer.observe({ type, buffered: false }); observers.push(observer);
        } catch (_error) {}
      }
      function startSampling(sendEvent) {
        if (state !== 'armed') return;
        state = 'running';
        session = {
          started_at_wall: nowIso(),
          send_at: sendEvent.at,
          first_activity_at: null,
          completion_at: null,
          entries: { loaf: [], longtask: [], event: [], layout_shift: [] },
          dcf_self_start: ctx.plugins.get('dcf.next.conversation-performance')?.selfTiming?.() || null
        };
        addObserver('long-animation-frame', (entries) => session.entries.loaf.push(...entries.map((entry) => ({ startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration || null, renderStart: entry.renderStart || null, styleAndLayoutStart: entry.styleAndLayoutStart || null }))));
        addObserver('longtask', (entries) => session.entries.longtask.push(...entries.map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))));
        addObserver('event', (entries) => session.entries.event.push(...entries.filter((entry) => entry.duration >= 16).slice(0, 80).map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd }))));
        addObserver('layout-shift', (entries) => session.entries.layout_shift.push(...entries.filter((entry) => !entry.hadRecentInput).map((entry) => ({ startTime: entry.startTime, value: entry.value }))));
        timeout = setTimeout(() => finish('timeout'), 10 * 60 * 1000);
        shell.refresh('attribution');
      }
      function finish(reason = 'completed') {
        if (state !== 'running' || !session) return;
        clearObservers();
        session.completion_at = session.completion_at || performance.now();
        const first = session.first_activity_at;
        const end = session.completion_at;
        report = {
          schema: 'dcf.next.conversation-turn-attribution.v1',
          generated_at: nowIso(),
          reason,
          route_kind: location.pathname,
          send_to_first_reply_activity_ms: first ? Math.round(first - session.send_at) : null,
          first_reply_activity_to_completion_ms: first ? Math.round(end - first) : null,
          total_ms: Math.round(end - session.send_at),
          completion_quiet_window_ms: 1100,
          browser_observation: {
            loaf_count: session.entries.loaf.length,
            loaf_total_duration_ms: Math.round(session.entries.loaf.reduce((sum, item) => sum + item.duration, 0)),
            longtask_count: session.entries.longtask.length,
            longtask_total_duration_ms: Math.round(session.entries.longtask.reduce((sum, item) => sum + item.duration, 0)),
            slow_event_count: session.entries.event.length,
            layout_shift_value: Math.round(session.entries.layout_shift.reduce((sum, item) => sum + item.value, 0) * 10000) / 10000,
            loaf: session.entries.loaf.slice(0, 80),
            longtasks: session.entries.longtask.slice(0, 80),
            events: session.entries.event.slice(0, 80),
            layout_shifts: session.entries.layout_shift.slice(0, 80)
          },
          dcf_self: {
            before: session.dcf_self_start,
            after: ctx.plugins.get('dcf.next.conversation-performance')?.selfTiming?.() || null
          },
          limits: [
            '等待阶段同时包含服务端、网络、页面调度和浏览器工作，不能仅凭耗时归因给前端。',
            'Long Animation Frames 和 Long Tasks 只能描述浏览器可观察工作；扩展隔离世界、跨域与未知来源可能缺失。',
            '报告不包含提示词、回复正文、DOM 文本、事件目标、完整 URL、调用栈或认证信息。'
          ]
        };
        state = 'completed'; session = null; shell.refresh('attribution'); shell.notify('本轮问答归因已完成');
      }
      function arm() { clearObservers(); state = 'armed'; report = null; session = null; shell.refresh('attribution'); }
      function cancel() { clearObservers(); state = 'idle'; report = null; session = null; shell.refresh('attribution'); }

      host.onSend(startSampling);
      host.onReplyFirstActivity(({ at }) => { if (state === 'running' && session && !session.first_activity_at) { session.first_activity_at = at; shell.refresh('attribution'); } });
      host.onReplyCompleted(({ at }) => { if (state === 'running' && session) { session.completion_at = at; finish('completed'); } });

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const card = document.createElement('section'); card.className = 'dcf-card dcf-stack';
        const status = document.createElement('div'); status.className = 'dcf-title';
        status.textContent = ({ idle: '未启动', armed: '等待下一次发送', running: '记录中', completed: '已完成，可复制' })[state]; card.append(status);
        const actions = document.createElement('div'); actions.className = 'dcf-row';
        const armButton = document.createElement('button'); armButton.className = 'dcf-btn primary'; armButton.textContent = '记录下一轮问答'; armButton.disabled = state === 'running'; armButton.onclick = arm;
        const finishButton = document.createElement('button'); finishButton.className = 'dcf-btn'; finishButton.textContent = '手动结束'; finishButton.disabled = state !== 'running'; finishButton.onclick = () => finish('manual');
        const copyButton = document.createElement('button'); copyButton.className = 'dcf-btn'; copyButton.textContent = '复制本轮归因报告'; copyButton.disabled = !report; copyButton.onclick = () => copyText(JSON.stringify(report, null, 2)).then(() => shell.notify('归因报告已复制'));
        const cancelButton = document.createElement('button'); cancelButton.className = 'dcf-btn'; cancelButton.textContent = '清除'; cancelButton.onclick = cancel;
        actions.append(armButton, finishButton, copyButton, cancelButton); card.append(actions);
        if (report) { const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = JSON.stringify({ total_ms: report.total_ms, send_to_first_reply_activity_ms: report.send_to_first_reply_activity_ms, first_reply_activity_to_completion_ms: report.first_reply_activity_to_completion_ms, browser_observation: report.browser_observation }, null, 2); card.append(pre); }
        root.append(card); container.append(root);
      }

      shell.registerPanel({ id: 'attribution', title: '归因', render });
      return { arm, cancel, finish, state: () => state, report: () => report };
    }
  };
}

module.exports = { attributionPlugin };

},
"src-next/plugins/backup.js":function(module,exports,require){
'use strict';

const { nowIso, downloadText } = require("src-next/core/utils.js");
const { STATE_KEY, PLUGIN_STORAGE_PREFIX } = require("src-next/survival/constants.js");

function validateBackup(data) {
  if (!data || data.schema !== 'dcf.next.backup.v1' || !data.values || typeof data.values !== 'object') throw new Error('备份格式不正确');
  for (const key of Object.keys(data.values)) {
    if (key !== STATE_KEY && !key.startsWith(PLUGIN_STORAGE_PREFIX)) throw new Error(`备份包含不允许恢复的键：${key}`);
  }
  return data;
}

function backupPlugin() {
  return {
    id: 'dcf.next.backup',
    version: '1.0.0',
    title: '数据备份与恢复',
    description: '导出和恢复新版插件数据、外观与启动组合。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      let importText = '';

      function buildBackup() {
        const values = {};
        for (const key of ctx.rawStorage.listRaw()) {
          if (key === STATE_KEY || key.startsWith(PLUGIN_STORAGE_PREFIX)) values[key] = ctx.rawStorage.readRaw(key, null);
        }
        return { schema: 'dcf.next.backup.v1', version: ctx.survival.version, exported_at: nowIso(), values };
      }
      function restore(data) {
        validateBackup(data);
        const snapshot = buildBackup();
        ctx.storage.set('pre_restore_backup', snapshot);
        for (const [key, value] of Object.entries(data.values)) ctx.rawStorage.writeRaw(key, value);
      }

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const exportCard = document.createElement('section'); exportCard.className = 'dcf-card dcf-stack';
        const title = document.createElement('div'); title.className = 'dcf-title'; title.textContent = '导出当前数据';
        const note = document.createElement('div'); note.className = 'dcf-muted'; note.textContent = '包括语言弹药、插件设置、外观、启动清单与组合；不包含对话正文、Cookie 或认证信息。';
        const button = document.createElement('button'); button.className = 'dcf-btn primary'; button.textContent = '下载 JSON 备份';
        button.onclick = () => downloadText(`dcf-next-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildBackup(), null, 2));
        exportCard.append(title, note, button); root.append(exportCard);

        const importCard = document.createElement('section'); importCard.className = 'dcf-card dcf-stack';
        const importTitle = document.createElement('div'); importTitle.className = 'dcf-title'; importTitle.textContent = '恢复备份';
        const area = document.createElement('textarea'); area.placeholder = '粘贴 dcf.next.backup.v1 JSON'; area.value = importText; area.oninput = () => { importText = area.value; };
        const restoreButton = document.createElement('button'); restoreButton.className = 'dcf-btn danger'; restoreButton.textContent = '校验、恢复并重启';
        restoreButton.onclick = () => {
          try {
            const parsed = validateBackup(JSON.parse(importText));
            if (!confirm(`恢复 ${Object.keys(parsed.values).length} 个数据项？当前数据会先自动备份。`)) return;
            restore(parsed); ctx.survival.restart();
          } catch (error) { shell.notify(error.message, 'error'); }
        };
        importCard.append(importTitle, area, restoreButton); root.append(importCard);
        container.append(root);
      }

      shell.registerPanel({ id: 'backup', title: '备份', render });
      return { exportData: buildBackup, restore, validateBackup };
    }
  };
}

module.exports = { backupPlugin, validateBackup };

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
"src-next/plugins/conversation-performance.js":function(module,exports,require){
'use strict';

const { debounce } = require("src-next/core/utils.js");

const TURN_SELECTORS = ['[data-testid^="conversation-turn-"]', 'article[data-testid*="conversation-turn"]', 'main article'];

function collectTurns(root) {
  for (const selector of TURN_SELECTORS) {
    const nodes = Array.from(root?.querySelectorAll?.(selector) || []);
    if (nodes.length) return nodes;
  }
  return [];
}

function conversationPerformancePlugin() {
  return {
    id: 'dcf.next.conversation-performance',
    version: '1.0.0',
    title: '长对话减负',
    description: '可逆的 content-visibility 与显式历史窗口模式。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const host = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell || !host) throw new Error('shell_and_chatgpt_required');
      let settings = { mode: 'safe', threshold: 24, window_size: 40, batch_size: 20, ...ctx.storage.get('settings', {}) };
      const original = new Map();
      let root = null;
      let observer = null;
      let hiddenCount = 0;
      let lastApplyDuration = 0;
      let applyCount = 0;
      let applyTotal = 0;
      let lastReason = 'startup';

      function persist() { ctx.storage.set('settings', settings); }
      function conversationRoot() { return document.querySelector('main') || document.querySelector('[role="main"]'); }
      function isStreaming() { return host.status().streaming; }
      function remember(node) {
        if (!original.has(node)) original.set(node, { contentVisibility: node.style.contentVisibility, containIntrinsicSize: node.style.containIntrinsicSize, display: node.style.display });
      }
      function restoreNode(node) {
        const previous = original.get(node);
        if (!previous) return;
        node.style.contentVisibility = previous.contentVisibility;
        node.style.containIntrinsicSize = previous.containIntrinsicSize;
        node.style.display = previous.display;
        node.removeAttribute('data-dcf-next-performance');
        original.delete(node);
      }
      function restoreAll() { for (const node of Array.from(original.keys())) restoreNode(node); hiddenCount = 0; }

      function apply(reason = 'mutation') {
        const started = performance.now();
        lastReason = reason;
        if (isStreaming()) return;
        const nextRoot = conversationRoot();
        if (!nextRoot) return;
        root = nextRoot;
        const turns = collectTurns(root);
        for (const node of Array.from(original.keys())) if (!node.isConnected) original.delete(node);
        hiddenCount = 0;
        if (settings.mode === 'off' || turns.length < settings.threshold) {
          restoreAll();
        } else if (settings.mode === 'safe') {
          for (const node of turns) {
            remember(node);
            node.style.display = original.get(node).display;
            node.style.contentVisibility = 'auto';
            node.style.containIntrinsicSize = 'auto 320px';
            node.dataset.dcfNextPerformance = 'safe';
          }
        } else {
          const cutoff = Math.max(0, turns.length - settings.window_size);
          turns.forEach((node, index) => {
            remember(node);
            if (index < cutoff) {
              node.style.display = 'none';
              node.style.contentVisibility = original.get(node).contentVisibility;
              node.style.containIntrinsicSize = original.get(node).containIntrinsicSize;
              node.dataset.dcfNextPerformance = 'hidden';
              hiddenCount += 1;
            } else {
              node.style.display = original.get(node).display;
              node.style.contentVisibility = 'auto';
              node.style.containIntrinsicSize = 'auto 320px';
              node.dataset.dcfNextPerformance = 'window';
            }
          });
        }
        lastApplyDuration = performance.now() - started;
        applyCount += 1; applyTotal += lastApplyDuration;
        shell.refresh('performance');
      }

      const scheduleApply = debounce((reason) => apply(reason), 240);
      function attach() {
        const next = conversationRoot();
        if (!next || next === root) return;
        observer?.disconnect(); root = next;
        observer = new MutationObserver(() => scheduleApply('mutation'));
        observer.observe(root, { childList: true, subtree: true });
        apply('root-change');
      }
      attach();
      const attachTimer = setInterval(() => {
        if (!root?.isConnected) attach();
      }, 1800);
      host.onReplyCompleted(() => scheduleApply('reply-completed'));
      host.onNavigation(() => { root = null; attach(); });
      const scrollListener = () => {
        if (settings.mode !== 'window' || window.scrollY > 180 || isStreaming()) return;
        settings.window_size += settings.batch_size; persist(); apply('top-expand');
      };
      window.addEventListener('scroll', scrollListener, { passive: true });

      function report() {
        const turns = collectTurns(conversationRoot());
        return {
          schema: 'dcf.next.conversation-performance.runtime.v1',
          route_kind: location.pathname,
          mode: settings.mode,
          turn_count: turns.length,
          optimized_count: turns.filter((node) => node.dataset.dcfNextPerformance).length,
          hidden_count: hiddenCount,
          content_visibility_supported: CSS?.supports?.('content-visibility', 'auto') || false,
          apply_count: applyCount,
          last_apply_duration_ms: Math.round(lastApplyDuration * 100) / 100,
          total_apply_duration_ms: Math.round(applyTotal * 100) / 100,
          last_reason: lastReason
        };
      }

      function render(container) {
        container.replaceChildren();
        const rootNode = document.createElement('div'); rootNode.className = 'dcf-stack';
        const card = document.createElement('section'); card.className = 'dcf-card dcf-stack';
        const mode = document.createElement('select');
        for (const [value, label] of [['off', '关闭'], ['safe', '透明减负'], ['window', '历史窗口']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = settings.mode === value; mode.append(option); }
        mode.onchange = () => { settings.mode = mode.value; if (settings.mode === 'off') restoreAll(); persist(); apply('mode-change'); };
        const windowSize = document.createElement('select');
        for (const value of [20, 40, 80]) { const option = document.createElement('option'); option.value = String(value); option.textContent = `保留最近 ${value} 条`; option.selected = settings.window_size === value; windowSize.append(option); }
        windowSize.onchange = () => { settings.window_size = Number(windowSize.value); persist(); apply('window-size'); };
        const row = document.createElement('div'); row.className = 'dcf-row'; row.append(mode, windowSize); card.append(row);
        const summary = document.createElement('pre'); summary.style.whiteSpace = 'pre-wrap'; summary.textContent = JSON.stringify(report(), null, 2); card.append(summary);
        const actions = document.createElement('div'); actions.className = 'dcf-row';
        const expand = document.createElement('button'); expand.className = 'dcf-btn'; expand.textContent = '展开上一批'; expand.onclick = () => { settings.window_size += settings.batch_size; persist(); apply('manual-expand'); };
        const restore = document.createElement('button'); restore.className = 'dcf-btn'; restore.textContent = '恢复全部并关闭'; restore.onclick = () => { settings.mode = 'off'; persist(); restoreAll(); shell.refresh('performance'); };
        actions.append(expand, restore); card.append(actions); rootNode.append(card); container.append(rootNode);
      }

      shell.registerPanel({ id: 'performance', title: '性能', render });
      return { report, apply, restoreAll, selfTiming: () => ({ apply_count: applyCount, total_ms: applyTotal, max_or_last_ms: lastApplyDuration }), destroy() { clearInterval(attachTimer); observer?.disconnect(); window.removeEventListener('scroll', scrollListener); restoreAll(); } };
    }
  };
}

module.exports = { conversationPerformancePlugin, collectTurns };

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
"src-next/plugins/local-agent-envelope.js":function(module,exports,require){
'use strict';

const TASK_OPEN = '[DCF_LOCAL_TASK]';
const TASK_CLOSE = '[/DCF_LOCAL_TASK]';
const RESULT_OPEN = '[DCF_LOCAL_RESULT]';
const RESULT_CLOSE = '[/DCF_LOCAL_RESULT]';

function validateTask(value) {
  if (!value || value.schema !== 'dcf.local-task.v1') throw new Error('local_task_schema_invalid');
  if (typeof value.instruction !== 'string' || !value.instruction.trim()) throw new Error('local_task_instruction_required');
  if (value.workspace !== undefined && (typeof value.workspace !== 'string' || !value.workspace.trim())) throw new Error('local_task_workspace_invalid');
  return {
    ...value,
    instruction: value.instruction.trim(),
    workspace: value.workspace === undefined ? undefined : value.workspace.trim()
  };
}

function extractLocalTaskEnvelopes(text) {
  const source = String(text || '');
  const tasks = [];
  const errors = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(TASK_OPEN, cursor);
    if (start < 0) break;
    const contentStart = start + TASK_OPEN.length;
    const end = source.indexOf(TASK_CLOSE, contentStart);
    if (end < 0) {
      errors.push({ code: 'local_task_envelope_unclosed', start });
      break;
    }
    const raw = source.slice(contentStart, end).trim();
    try {
      const task = validateTask(JSON.parse(raw));
      tasks.push({ task, raw, start, end: end + TASK_CLOSE.length });
    } catch (error) {
      errors.push({ code: error?.message || 'local_task_invalid', start });
    }
    cursor = end + TASK_CLOSE.length;
  }

  return { tasks, errors };
}

function buildLocalResultEnvelope(result) {
  const value = {
    ...result,
    schema: 'dcf.local-result.v1'
  };
  return `${RESULT_OPEN}\n${JSON.stringify(value, null, 2)}\n${RESULT_CLOSE}`;
}

module.exports = {
  TASK_OPEN,
  TASK_CLOSE,
  RESULT_OPEN,
  RESULT_CLOSE,
  validateTask,
  extractLocalTaskEnvelopes,
  buildLocalResultEnvelope
};

},
"src-next/plugins/local-agent.js":function(module,exports,require){
'use strict';

const { extractLocalTaskEnvelopes, buildLocalResultEnvelope } = require("src-next/plugins/local-agent-envelope.js");

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:48321';
const SESSION_TOKEN_KEY = 'dcf.next.local-agent.session-token.v1';
const TERMINAL_TASK_STATES = new Set(['completed', 'failed']);

function createId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function normalizeBridgeUrl(value) {
  const parsed = new URL(String(value || DEFAULT_BRIDGE_URL));
  const allowedHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1';
  if (parsed.protocol !== 'http:' || !allowedHost || parsed.username || parsed.password) throw new Error('bridge_url_must_be_loopback_http');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.origin;
}

function createRegistration({ installationId, pageSessionId, version, win = globalThis.window }) {
  return {
    schema: 'dcf.local-instance.v1',
    installation_id: installationId,
    page_session_id: pageSessionId,
    platform: 'chatgpt',
    conversation_key: String(win?.location?.pathname || '/'),
    dcf_version: version,
    page_url: String(win?.location?.href || ''),
    viewport: {
      width: Number(win?.visualViewport?.width || win?.innerWidth || 0),
      height: Number(win?.visualViewport?.height || win?.innerHeight || 0)
    }
  };
}

function resolveGmRequest(explicit) {
  if (typeof explicit === 'function') return explicit;
  if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
  return null;
}

function createJsonRequester(explicitRequest) {
  const gmRequest = resolveGmRequest(explicitRequest);
  return function requestJson({ method = 'GET', url, token, body, timeout = 8000 }) {
    if (!gmRequest) return Promise.reject(new Error('gm_xmlhttp_request_unavailable'));
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers['X-DCF-Session-Token'] = token;
      gmRequest({
        method,
        url,
        headers,
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout,
        onload(response) {
          let parsed = null;
          try { parsed = response.responseText ? JSON.parse(response.responseText) : null; } catch (_ignored) {}
          if (response.status >= 200 && response.status < 300) return resolve(parsed || {});
          const error = new Error(parsed?.error || `bridge_http_${response.status}`);
          error.status = response.status;
          reject(error);
        },
        ontimeout: () => reject(new Error('bridge_request_timeout')),
        onerror: () => reject(new Error('bridge_request_failed'))
      });
    });
  };
}

function localAgentPlugin(options = {}) {
  return {
    id: 'dcf.next.local-agent',
    version: '1.0.0',
    title: '本机 Agent',
    description: '把当前网页实例绑定到 loopback 本机执行端，并回收任务结果。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const chatgpt = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell) throw new Error('shell_plugin_required');
      if (!chatgpt) throw new Error('chatgpt_plugin_required');

      const win = ctx.platform.window || globalThis.window;
      const requestJson = createJsonRequester(options.gmRequest);
      const installationId = ctx.storage.get('installation_id', null) || createId('install');
      ctx.storage.set('installation_id', installationId);
      const pageSessionId = createId('page');
      let bridgeUrl;
      try { bridgeUrl = normalizeBridgeUrl(ctx.storage.get('bridge_url', DEFAULT_BRIDGE_URL)); }
      catch (_error) { bridgeUrl = DEFAULT_BRIDGE_URL; ctx.storage.set('bridge_url', bridgeUrl); }
      let sessionToken = null;
      try { sessionToken = win?.sessionStorage?.getItem(SESSION_TOKEN_KEY) || null; } catch (_ignored) {}

      const state = {
        connection: 'disconnected',
        binding_id: null,
        workspace_alias: null,
        agent: null,
        pending_task: null,
        active_task: null,
        last_result: null,
        last_error: null
      };
      let pollTimer = null;

      function saveToken(token) {
        sessionToken = token || null;
        try {
          if (sessionToken) win?.sessionStorage?.setItem(SESSION_TOKEN_KEY, sessionToken);
          else win?.sessionStorage?.removeItem(SESSION_TOKEN_KEY);
        } catch (_ignored) {}
      }

      function refresh() { shell.refresh('local-agent'); }
      function setError(error) {
        state.last_error = error?.message || String(error);
        if (error?.status === 401) { saveToken(null); state.binding_id = null; }
        state.connection = 'disconnected';
        refresh();
      }

      async function register() {
        if (!sessionToken) throw new Error('pairing_required');
        state.connection = 'connecting'; state.last_error = null; refresh();
        const response = await requestJson({
          method: 'POST',
          url: `${bridgeUrl}/v1/register`,
          token: sessionToken,
          body: createRegistration({ installationId, pageSessionId, version: ctx.survival.version, win })
        });
        state.connection = 'ready';
        state.binding_id = response.binding_id;
        state.workspace_alias = response.workspace_alias || null;
        state.agent = response.agent || null;
        refresh();
        return response;
      }

      async function pair(code) {
        state.connection = 'connecting'; state.last_error = null; refresh();
        try {
          const response = await requestJson({ method: 'POST', url: `${bridgeUrl}/v1/pair`, body: { code: String(code || '').trim() } });
          if (!response.session_token) throw new Error('pairing_response_invalid');
          saveToken(response.session_token);
          return await register();
        } catch (error) { setError(error); throw error; }
      }

      function taskResultEnvelope(taskRecord) {
        const result = taskRecord.result || {};
        return buildLocalResultEnvelope({
          ...result,
          task_id: taskRecord.task_id,
          status: taskRecord.status,
          error: taskRecord.error || result.error
        });
      }

      async function pollTask(taskId) {
        try {
          const response = await requestJson({ method: 'GET', url: `${bridgeUrl}/v1/tasks/${encodeURIComponent(taskId)}`, token: sessionToken });
          state.active_task = response;
          if (TERMINAL_TASK_STATES.has(response.status)) {
            clearInterval(pollTimer); pollTimer = null;
            state.last_result = taskResultEnvelope(response);
          }
          refresh();
          return response;
        } catch (error) { clearInterval(pollTimer); pollTimer = null; setError(error); throw error; }
      }

      async function submit(task = state.pending_task) {
        if (!task) throw new Error('local_task_missing');
        if (!state.binding_id) await register();
        const response = await requestJson({
          method: 'POST',
          url: `${bridgeUrl}/v1/tasks`,
          token: sessionToken,
          body: { binding_id: state.binding_id, task }
        });
        state.pending_task = null;
        state.active_task = response;
        clearInterval(pollTimer);
        pollTimer = setInterval(() => { pollTask(response.task_id).catch(() => {}); }, 1000);
        refresh();
        return response;
      }

      function acceptReply(text) {
        const decoded = extractLocalTaskEnvelopes(text);
        for (const item of decoded.tasks) state.pending_task = item.task;
        if (decoded.tasks.length || decoded.errors.length) {
          state.last_error = decoded.errors.length ? decoded.errors.map((item) => item.code).join(', ') : null;
          refresh();
        }
        return decoded;
      }

      function status() {
        return {
          connection: state.connection,
          bridge_url: bridgeUrl,
          installation_id: installationId,
          page_session_id: pageSessionId,
          binding_id: state.binding_id,
          workspace_alias: state.workspace_alias,
          agent: state.agent,
          pending_task: state.pending_task ? { workspace: state.pending_task.workspace || null, instruction: state.pending_task.instruction } : null,
          active_task: state.active_task ? { task_id: state.active_task.task_id, status: state.active_task.status } : null,
          has_result: Boolean(state.last_result),
          last_error: state.last_error
        };
      }

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const connectionCard = document.createElement('section'); connectionCard.className = 'dcf-card dcf-stack';
        const title = document.createElement('div'); title.className = 'dcf-title'; title.textContent = '本地协作实例';
        const summary = document.createElement('div'); summary.className = 'dcf-muted'; summary.textContent = `${state.connection} · ${state.agent || '未绑定 Agent'} · ${state.workspace_alias || '未绑定工作区'}`;
        const urlField = document.createElement('label'); urlField.className = 'dcf-field';
        const urlLabel = document.createElement('span'); urlLabel.textContent = '本地桥地址';
        const urlInput = document.createElement('input'); urlInput.value = bridgeUrl;
        urlInput.onchange = () => {
          try { bridgeUrl = normalizeBridgeUrl(urlInput.value); ctx.storage.set('bridge_url', bridgeUrl); state.last_error = null; }
          catch (error) { state.last_error = error.message; }
          refresh();
        };
        urlField.append(urlLabel, urlInput);
        const pairRow = document.createElement('div'); pairRow.className = 'dcf-row';
        const code = document.createElement('input'); code.placeholder = '本地桥配对码';
        const pairButton = document.createElement('button'); pairButton.className = 'dcf-btn primary'; pairButton.textContent = sessionToken ? '重新连接' : '配对并连接';
        pairButton.onclick = () => {
          const action = sessionToken && !code.value.trim() ? register() : pair(code.value);
          action.then(() => shell.notify('本机 Agent 已连接')).catch((error) => shell.notify(error.message, 'error'));
        };
        pairRow.append(code, pairButton);
        connectionCard.append(title, summary, urlField, pairRow);
        if (state.last_error) { const error = document.createElement('div'); error.className = 'dcf-muted'; error.textContent = `错误：${state.last_error}`; connectionCard.append(error); }
        root.append(connectionCard);

        const taskCard = document.createElement('section'); taskCard.className = 'dcf-card dcf-stack';
        const taskTitle = document.createElement('div'); taskTitle.className = 'dcf-title'; taskTitle.textContent = '当前任务'; taskCard.append(taskTitle);
        if (state.pending_task) {
          const workspace = document.createElement('div'); workspace.className = 'dcf-muted'; workspace.textContent = `工作区：${state.pending_task.workspace || state.workspace_alias || '由本地桥决定'}`;
          const instruction = document.createElement('pre'); instruction.style.whiteSpace = 'pre-wrap'; instruction.textContent = state.pending_task.instruction;
          const run = document.createElement('button'); run.className = 'dcf-btn primary'; run.textContent = '执行任务';
          run.onclick = () => submit().then(() => shell.notify('任务已交给本机 Agent')).catch((error) => shell.notify(error.message, 'error'));
          taskCard.append(workspace, instruction, run);
        } else if (state.active_task) {
          const active = document.createElement('div'); active.className = 'dcf-muted'; active.textContent = `${state.active_task.task_id} · ${state.active_task.status}`;
          taskCard.append(active);
        } else {
          const empty = document.createElement('div'); empty.className = 'dcf-empty'; empty.textContent = '当前回复中没有待执行的 DCF_LOCAL_TASK。'; taskCard.append(empty);
        }
        root.append(taskCard);

        if (state.last_result) {
          const resultCard = document.createElement('section'); resultCard.className = 'dcf-card dcf-stack';
          const resultTitle = document.createElement('div'); resultTitle.className = 'dcf-title'; resultTitle.textContent = '本机执行结果';
          const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = state.last_result;
          const fill = document.createElement('button'); fill.className = 'dcf-btn primary'; fill.textContent = '填入当前输入框';
          fill.onclick = () => chatgpt.insert(state.last_result).then(() => shell.notify('结果已填入输入框')).catch((error) => shell.notify(error.message, 'error'));
          resultCard.append(resultTitle, pre, fill); root.append(resultCard);
        }
        container.append(root);
      }

      shell.registerPanel({ id: 'local-agent', title: '本机', render });
      chatgpt.onReplyCompleted(({ text }) => acceptReply(text));
      chatgpt.onNavigation(() => { if (sessionToken) register().catch(setError); });
      if (sessionToken) register().catch(setError);

      return {
        pair,
        register,
        submit,
        pollTask,
        acceptReply,
        status,
        diagnostics: status,
        fillLastResult: () => state.last_result ? chatgpt.insert(state.last_result) : Promise.reject(new Error('local_result_missing')),
        destroy() { clearInterval(pollTimer); }
      };
    }
  };
}

module.exports = {
  DEFAULT_BRIDGE_URL,
  SESSION_TOKEN_KEY,
  createId,
  normalizeBridgeUrl,
  createRegistration,
  createJsonRequester,
  localAgentPlugin
};

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

const VERSION = '0.2.0-alpha.7';
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
