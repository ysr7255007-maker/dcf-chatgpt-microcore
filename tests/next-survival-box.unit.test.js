'use strict';
const assert = require('assert');
const { createPluginRegistry, defaultManifest } = require('../src-next/plugin-registry');
const { createSurvivalLoader } = require('../src-next/survival/loader');
const { createBrowserStorage } = require('../src-next/survival/storage');

function memoryStorage(initial = null) {
  let state = initial;
  const values = new Map();
  return {
    getState: (fallback) => state || fallback,
    setState: (next) => { state = JSON.parse(JSON.stringify(next)); },
    scope(id) { return { get: (k, d) => values.has(`${id}.${k}`) ? values.get(`${id}.${k}`) : d, set: (k, v) => values.set(`${id}.${k}`, v), remove: (k) => values.delete(`${id}.${k}`), keys: () => [] }; },
    readRaw: (k, d) => values.has(k) ? values.get(k) : d,
    writeRaw: (k, v) => values.set(k, v),
    removeRaw: (k) => values.delete(k),
    listRaw: () => Array.from(values.keys()),
    snapshot: () => state
  };
}

function verifyPersistentPluginStorage() {
  const backing = new Map();
  const api = {
    getValue: (key, fallback) => backing.has(key) ? backing.get(key) : fallback,
    setValue: (key, value) => backing.set(key, value),
    deleteValue: (key) => backing.delete(key),
    listValues: () => Array.from(backing.keys())
  };
  const first = createBrowserStorage(api);
  first.scope('dcf.next.appearance').set('geometry', { side: 'left', width: 430 });
  first.scope('dcf.next.ammo').set('items', { a: { id: 'a' } });

  const afterReload = createBrowserStorage(api);
  assert.deepEqual(afterReload.scope('dcf.next.appearance').get('geometry', {}), { side: 'left', width: 430 });
  assert.deepEqual(afterReload.scope('dcf.next.ammo').get('items', {}), { a: { id: 'a' } });
  assert.deepEqual(afterReload.scope('dcf.next.appearance').keys(), ['geometry']);

  const oldWindow = global.window;
  const oldDocument = global.document;
  global.window = {};
  global.document = {};
  assert.throws(() => createBrowserStorage({}), /gm_storage_api_unavailable/);
  if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
  if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
}

verifyPersistentPluginStorage();

(async () => {
  const starts = [];
  const registry = createPluginRegistry([
    { id: 'one', version: '1', start: async () => { starts.push('one'); return { ok: true }; } },
    { id: 'two', version: '1', start: async (ctx) => { assert(ctx.plugins.has('one')); starts.push('two'); } }
  ]);
  const storage = memoryStorage();
  const loader = createSurvivalLoader({ registry, storage, defaultManifest: defaultManifest(registry), renderRecovery: () => { throw new Error('unexpected recovery'); }, reload: () => {}, platform: {} });
  const result = await loader.boot();
  assert(result.ok);
  assert.deepEqual(starts, ['one', 'two']);
  assert.equal(storage.snapshot().last_known_good_manifest.length, 2);

  const badRegistry = createPluginRegistry([{ id: 'bad', version: '1', start: () => { throw new Error('boom'); } }]);
  const badStorage = memoryStorage();
  let recoveryReason = null;
  const badLoader = createSurvivalLoader({ registry: badRegistry, storage: badStorage, defaultManifest: defaultManifest(badRegistry), renderRecovery: (model) => { recoveryReason = model.reason; }, reload: () => {}, platform: {} });
  const failed = await badLoader.boot();
  assert(!failed.ok);
  assert.equal(recoveryReason, 'plugin_start_failed');
  assert.equal(badStorage.snapshot().boot.plugins[0].status, 'failed');
  console.log('next survival tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
