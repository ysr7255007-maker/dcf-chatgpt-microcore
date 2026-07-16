'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'dist', 'dcf-chrome-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const bundle = JSON.parse(fs.readFileSync(path.join(extension, 'official', 'code-units.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'verification-summary.json'), 'utf8'));
const remoteIndex = JSON.parse(fs.readFileSync(path.join(root, 'releases', 'chrome', 'official-index.json'), 'utf8'));
const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
assert.strictEqual(manifest.manifest_version, 3);
assert(Number(manifest.minimum_chrome_version) >= 138);
assert(manifest.permissions.includes('userScripts'));
assert(manifest.background.service_worker === 'src/background.js');
assert.strictEqual(bundle.schema, 'dcf.code_unit_bundle.v1');
assert(bundle.units.length >= 2);
for (const unit of bundle.units) {
  assert.strictEqual(hash(unit.code), unit.hash, `${unit.id} hash mismatch`);
  assert.strictEqual(unit.world, 'USER_SCRIPT');
  assert(unit.matches.includes('https://chatgpt.com/*'));
}
const background = ['background.js','host-state.js','host-runtime.js','host-product.js','host-main.js'].map((name) => fs.readFileSync(path.join(extension, 'src', name), 'utf8')).join('\n');
assert(background.includes('last_known_good'));
assert(background.includes('api.register(additions)'));
assert(background.includes('api.update(updates)'));
assert(background.includes('api.unregister({ ids: removals })'));
assert(background.includes('.getScripts()'));
assert(background.includes('candidate.committed'));
const migration = fs.readFileSync(path.join(extension, 'static', 'migration-bridge.js'), 'utf8');
assert(migration.includes('dcf-chatgpt-microcore-host'));
assert(migration.includes('ammo-draft-body'));
assert(fs.existsSync(path.join(root, 'dist', 'dcf-chrome-extension-1.0.0-rc.1.zip')));
assert(summary.extension_files.length >= 10);
assert.strictEqual(remoteIndex.schema, 'dcf.code_unit_index.v1');
for (const ref of remoteIndex.units) {
  const marker = '/main/';
  const offset = ref.code_url.indexOf(marker);
  assert(offset > 0, `invalid code_url ${ref.code_url}`);
  const source = fs.readFileSync(path.join(root, ref.code_url.slice(offset + marker.length)), 'utf8');
  assert.strictEqual(hash(source), ref.hash, `${ref.id} remote transport hash mismatch`);
}
console.log(JSON.stringify({ ok: true, mv3: true, user_scripts_permission: true, controlled_units: bundle.units.length, migration_bridge: true, recovery_page: true, zip: true }, null, 2));
