'use strict';

const assert = require('assert');
const crypto = require('crypto').webcrypto;
const {
  defaultState,
  createCoreStorage,
  sha256Text,
  canonicalModuleId,
  createDynamicModuleRuntime,
  validatePluginPackBundle,
  installPluginPack,
  buildSnapshot,
  snapshotFromManifest
} = require('../src-next/experimental/core-review');

function memoryStorage() {
  const values = new Map();
  return createCoreStorage({
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))),
    deleteValue: (key) => values.delete(key),
    listValues: () => Array.from(values.keys())
  });
}

(async () => {
  assert.equal(canonicalModuleId('plugins/a/main.js', './helper'), 'plugins/a/helper.js');
  assert.equal(canonicalModuleId('plugins/a/main.js', '../shared'), 'plugins/shared.js');

  const helperSource = `'use strict'; module.exports = { value: 7 };`;
  const mainSource = `'use strict'; const helper = require('./helper'); module.exports = { make(){ return { id:'demo', version:'1', start: async (ctx) => ({ value: helper.value, marker: ctx.marker }) }; } };`;
  const helperHash = await sha256Text(helperSource, crypto);
  const mainHash = await sha256Text(mainSource, crypto);
  const units = new Map([
    ['plugins/demo/helper.js', { id: 'plugins/demo/helper.js', content: helperSource, sha256: helperHash }],
    ['plugins/demo/main.js', { id: 'plugins/demo/main.js', content: mainSource, sha256: mainHash }]
  ]);
  const runtime = createDynamicModuleRuntime({ readUnit: (id) => units.get(id) || null, expectedHashes: { 'plugins/demo/helper.js': helperHash, 'plugins/demo/main.js': mainHash } });
  const exported = runtime.load('plugins/demo/main.js');
  const definition = exported.make();
  assert.equal(definition.id, 'demo');
  assert.deepEqual(await definition.start({ marker: 'ok' }), { value: 7, marker: 'ok' });
  assert.throws(() => createDynamicModuleRuntime({ readUnit: (id) => units.get(id) || null, expectedHashes: { 'plugins/demo/main.js': 'bad' } }).load('plugins/demo/main.js'), /hash_mismatch/);

  const resourceSource = 'readme';
  const bundle = {
    schema: 'dcf.plugin-pack.bundle.v1',
    pack: {
      schema: 'dcf.plugin-pack.v1',
      id: 'test.pack',
      version: '1',
      title: 'Test',
      modules: ['plugins/demo/helper.js', 'plugins/demo/main.js'],
      resources: [{ path: 'resources/readme.txt', plugin_id: 'demo', role: 'documentation' }],
      plugins: [{ id: 'demo', version: '1', entry: 'plugins/demo/main.js', factory: 'make' }],
      recommended_snapshots: { minimal: ['demo@1'] }
    },
    files: [
      { path: 'plugins/demo/helper.js', content: helperSource, sha256: helperHash },
      { path: 'plugins/demo/main.js', content: mainSource, sha256: mainHash },
      { path: 'resources/readme.txt', content: resourceSource, sha256: await sha256Text(resourceSource, crypto) }
    ]
  };
  const validated = await validatePluginPackBundle(bundle, crypto);
  assert.equal(validated.pack.id, 'test.pack');
  const bad = JSON.parse(JSON.stringify(bundle));
  bad.files[0].content = 'tampered';
  await assert.rejects(() => validatePluginPackBundle(bad, crypto), /hash_mismatch/);

  const storage = memoryStorage();
  const state = defaultState();
  await installPluginPack(bundle, storage, state, crypto);
  assert(storage.readModule('plugins/demo/main.js'));
  const snapshot = buildSnapshot(state, storage, 'test.pack', 'minimal');
  assert.equal(snapshot.plugins[0].id, 'demo');
  assert.equal(snapshot.modules.length, 2);
  const custom = snapshotFromManifest(state, storage, [{ id: 'demo', version: '1', enabled: false }], snapshot);
  assert.equal(custom.plugins[0].enabled, false);

  console.log('next core review tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
