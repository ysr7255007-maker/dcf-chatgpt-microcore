'use strict';

function createStorage(api = globalThis) {
  const memory = new Map();
  function get(key, fallback) {
    try {
      if (typeof api.GM_getValue === 'function') return api.GM_getValue(key, fallback);
      if (api.localStorage) {
        const raw = api.localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      }
    } catch (_) {}
    return memory.has(key) ? memory.get(key) : fallback;
  }
  function set(key, value) {
    if (typeof api.GM_setValue === 'function') return api.GM_setValue(key, value);
    if (api.localStorage) return api.localStorage.setItem(key, JSON.stringify(value));
    memory.set(key, value);
    return undefined;
  }
  function remove(key) {
    if (typeof api.GM_deleteValue === 'function') return api.GM_deleteValue(key);
    if (api.localStorage) return api.localStorage.removeItem(key);
    memory.delete(key);
    return undefined;
  }
  return { get, set, remove };
}

module.exports = { createStorage };
