'use strict';

const {
  CORE_REVIEW_VERSION,
  CORE_STATE_SCHEMA,
  CORE_STATE_KEY,
  MODULE_PREFIX,
  RESOURCE_PREFIX,
  PLUGIN_STORAGE_PREFIX
} = require('./core-review-constants');

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
