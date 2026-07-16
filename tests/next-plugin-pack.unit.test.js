'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createPluginRegistry } = require('../src-next/plugin-registry');
const { readManifest, buildOfficialPluginPack } = require('../scripts/build-official-plugin-pack');

const root = path.resolve(__dirname, '..');
const pack = readManifest();
assert.equal(pack.id, 'dcf.official');
assert.equal(pack.plugins.length, 10);
assert.equal(new Set(pack.modules).size, pack.modules.length);
assert.equal(new Set(pack.plugins.map((item) => `${item.id}@${item.version}`)).size, pack.plugins.length);

for (const modulePath of pack.modules) {
  assert(modulePath.startsWith('src-next/plugins/'));
  assert(fs.existsSync(path.join(root, modulePath)), `missing module ${modulePath}`);
}
for (const plugin of pack.plugins) {
  assert(pack.modules.includes(plugin.entry), `entry is not listed as module: ${plugin.entry}`);
  const exported = require(path.join(root, plugin.entry));
  assert.equal(typeof exported[plugin.factory], 'function', `factory missing: ${plugin.factory}`);
  const definition = exported[plugin.factory]();
  assert.equal(definition.id, plugin.id);
  assert.equal(definition.version, plugin.version);
}

const registryKeys = createPluginRegistry().list().map((item) => `${item.id}@${item.version}`);
assert.deepEqual(registryKeys, pack.plugins.map((item) => `${item.id}@${item.version}`));

const localResources = pack.resources.filter((item) => item.plugin_id === 'dcf.next.local-agent');
assert.equal(localResources.length, 3);
for (const item of pack.resources) assert(fs.existsSync(path.join(root, item.path)), `missing resource ${item.path}`);

const first = buildOfficialPluginPack();
const second = buildOfficialPluginPack();
assert.equal(first, second);
const bundle = JSON.parse(first);
assert.equal(bundle.schema, 'dcf.plugin-pack.bundle.v1');
assert.equal(bundle.files.length, pack.modules.length + pack.resources.length);
for (const file of bundle.files) {
  assert.equal(file.sha256, crypto.createHash('sha256').update(file.content, 'utf8').digest('hex'));
}

console.log('next official plugin pack tests passed');
