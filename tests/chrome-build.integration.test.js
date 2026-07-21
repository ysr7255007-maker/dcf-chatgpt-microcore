'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
childProcess.execFileSync(process.execPath, ['scripts/build-chrome-extension.js'], { cwd: root, stdio: 'inherit' });

const extension = path.join(root, 'dist/dcf-chrome-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(extension, 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/code-unit-version-ledger.json'), 'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/build-manifest.json'), 'utf8'));

assert.strictEqual(manifest.version_name, '1.0.0-rc.3');
assert.strictEqual(manifest.version, '1.0.0.3');
assert.strictEqual(config.schema, 'dcf.chrome.config.v1');
assert(config.plugin_index_url.includes('/rebuild/chrome-native-host-v2/'));
assert.strictEqual(index.schema, 'dcf.plugin_index.v2');
assert.strictEqual(index.identity, 'unit_id+content_hash');
assert.strictEqual(index.units.length, 11);
assert.strictEqual(index.defaults.length, 11);
assert.strictEqual(new Set(index.units.map((unit) => unit.world_id)).size, index.units.length);
assert.strictEqual(new Set(index.units.map((unit) => unit.id)).size, index.units.length);

for (const unit of index.units) {
  assert(/^[a-f0-9]{64}$/.test(unit.hash));
  assert.strictEqual(unit.content_id, `sha256:${unit.hash}`);
  assert.strictEqual(unit.activation_requirement, 'loaded');
  assert(unit.code_url.includes('/chrome-extension/code-units/'));
  assert.strictEqual(unit.host_api, '3');
  assert.strictEqual(ledger.units[unit.id].versions[unit.version], unit.hash);
}
assert.strictEqual(ledger.schema, 'dcf.code_unit.version_ledger.v1');
assert(ledger.units['dcf.firstparty.shell'].legacy_collisions.some((item) => item.source_commit.startsWith('d67d070')));
assert.strictEqual(releaseManifest.schema, 'dcf.chrome.release.manifest.v1');
assert.strictEqual(releaseManifest.control_plane, 'desired-observed-committed-reconcile');
assert.strictEqual(releaseManifest.plugin_index_identity, 'unit_id+content_hash');
assert(/^[a-f0-9]{64}$/.test(releaseManifest.source_tree_digest));
assert.strictEqual(releaseManifest.units.length, 11);

const localAgent = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent');
assert.strictEqual(localAgent.version, '1.0.0-rc.2-local-agent.7');
const dialogue = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent-dialogue');
assert.strictEqual(dialogue.version, '1.0.0-rc.2-local-agent-dialogue.27');
const manager = index.units.find((unit) => unit.id === 'dcf.firstparty.plugin-manager');
assert.strictEqual(manager.version, '1.0.0-rc.2-plugin-manager.6');

assert(!fs.existsSync(path.join(extension, 'official/code-units.json')));
const extensionJs = fs.readdirSync(path.join(extension, 'src')).map((name) => fs.readFileSync(path.join(extension, 'src', name), 'utf8')).join('\n');
assert(!extensionJs.includes('〔DCF·语言弹药〕'));
assert(!extensionJs.includes('长对话减负'));
assert(!extensionJs.includes('OpenCode'));
assert(!extensionJs.includes('local_agent.'));
assert(extensionJs.includes('desired_snapshot'));
assert(extensionJs.includes('canary'));
assert(extensionJs.includes('dcf.activation.record.v1'));
assert(!JSON.stringify(manifest).includes('localhost'));
assert(!JSON.stringify(manifest).includes('127.0.0.1'));

const css = fs.readFileSync(path.join(extension, 'pages/common.css'), 'utf8');
assert(css.includes('--text:'));
assert(/@media\s*\(prefers-color-scheme:dark\)/.test(css));
const migration = fs.readFileSync(path.join(extension, 'static/migration-bridge.js'), 'utf8');
assert(migration.includes('dcf-next-shell-host'));
assert(!migration.includes('dcf-chatgpt-microcore-host'));

console.log(JSON.stringify({
  ok: true,
  pure_base: true,
  content_addressed_index: true,
  semantic_version_ledger: true,
  release_manifest_generated: true,
  canary_control_plane_built: true,
  independent_plugins: 11,
  base_unchanged_by_business_modules: true,
  dark_mode: true,
  next_migration_only: true
}, null, 2));
