'use strict';

const {
  CORE_REVIEW_VERSION,
  CORE_STATE_SCHEMA,
  CORE_STATE_KEY,
  PLUGIN_STORAGE_PREFIX
} = require('./core-review-constants');
const { clone, nowIso, isObject } = require('./core-review-storage');

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
