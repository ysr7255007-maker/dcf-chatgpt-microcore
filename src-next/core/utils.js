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
