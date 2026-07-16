'use strict';

const { STATE_KEY, PLUGIN_STORAGE_PREFIX } = require('./constants');

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
