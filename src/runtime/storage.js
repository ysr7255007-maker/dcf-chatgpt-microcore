'use strict';

function createStorage(api = globalThis) {
  const memory = new Map();
  const hasGM = typeof api.GM_getValue === 'function' && typeof api.GM_setValue === 'function';
  const hasLocalStorage = !!api.localStorage;
  const primaryBackend = hasGM ? 'gm' : hasLocalStorage ? 'localStorage' : 'memory';

  function localGet(key, fallback) {
    try {
      const raw = api.localStorage && api.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function localSet(key, value) {
    if (!api.localStorage) return undefined;
    return api.localStorage.setItem(key, JSON.stringify(value));
  }

  function localRemove(key) {
    if (!api.localStorage) return undefined;
    return api.localStorage.removeItem(key);
  }

  function getFrom(backend, key, fallback) {
    try {
      if (backend === 'gm' && hasGM) return api.GM_getValue(key, fallback);
      if (backend === 'localStorage' && hasLocalStorage) return localGet(key, fallback);
      if (backend === 'memory') return memory.has(key) ? memory.get(key) : fallback;
    } catch (_) {}
    return fallback;
  }

  function setTo(backend, key, value) {
    if (backend === 'gm' && hasGM) return api.GM_setValue(key, value);
    if (backend === 'localStorage' && hasLocalStorage) return localSet(key, value);
    memory.set(key, value);
    return undefined;
  }

  function removeFrom(backend, key) {
    if (backend === 'gm' && typeof api.GM_deleteValue === 'function') return api.GM_deleteValue(key);
    if (backend === 'localStorage' && hasLocalStorage) return localRemove(key);
    memory.delete(key);
    return undefined;
  }

  function listKeys(backend) {
    try {
      if (backend === 'gm' && typeof api.GM_listValues === 'function') return api.GM_listValues().map(String);
      if (backend === 'localStorage' && hasLocalStorage) {
        const keys = [];
        for (let index = 0; index < api.localStorage.length; index += 1) {
          const key = api.localStorage.key(index);
          if (key != null) keys.push(String(key));
        }
        return keys;
      }
      if (backend === 'memory') return Array.from(memory.keys());
    } catch (_) {}
    return [];
  }

  function hasIn(backend, key) {
    const listed = listKeys(backend);
    if (listed.length || backend === 'memory') return listed.includes(String(key));
    const sentinel = { __dcf_missing__: true };
    return getFrom(backend, key, sentinel) !== sentinel;
  }

  function get(key, fallback) {
    return getFrom(primaryBackend, key, fallback);
  }

  function set(key, value) {
    return setTo(primaryBackend, key, value);
  }

  function remove(key) {
    return removeFrom(primaryBackend, key);
  }

  function dcfKeys(backend) {
    return listKeys(backend).filter((key) => /^dcf[._-]/i.test(key)).sort();
  }

  return {
    get,
    set,
    remove,
    getFrom,
    setTo,
    removeFrom,
    hasIn,
    listKeys,
    dcfKeys,
    primaryBackend,
    availableBackends: ['gm', 'localStorage', 'memory'].filter((backend) => backend === 'gm' ? hasGM : backend === 'localStorage' ? hasLocalStorage : true)
  };
}

module.exports = { createStorage };