'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
childProcess.execFileSync(process.execPath, ['scripts/build-chrome-extension.js'], {
  cwd: root,
  stdio: 'inherit'
});

const extension = path.join(root, 'dist/dcf-chrome-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(extension, 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/build-manifest.json'), 'utf8'));
const versionLedger = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/code-unit-version-ledger.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(root, 'dist/verification-summary.json'), 'utf8'));

assert.strictEqual(manifest.version_name, '1.0.0-rc.3');
assert.strictEqual(manifest.version, '1.0.0.3');
assert.strictEqual(config.schema, 'dcf.chrome.config.v2');
assert(config.plugin_index_url.includes('/rebuild/chrome-native-host-v2/'));
assert.strictEqual(index.schema, 'dcf.plugin_index.v2');
assert.strictEqual(index.units.length, 11);
assert.strictEqual(index.defaults.length, 11);
assert(index.default_snapshot);
assert(index.default_snapshot.id.startsWith('sha256:'));
assert.strictEqual(index.default_snapshot.entries.length, 11);
assert.strictEqual(releaseManifest.default_snapshot_id, index.default_snapshot.id);
assert.strictEqual(releaseManifest.code_unit_version_ledger, 'releases/chrome/code-unit-version-ledger.json');
assert.strictEqual(versionLedger.schema, 'dcf.code_unit.version_ledger.v1');
assert.strictEqual(summary.default_snapshot_id, index.default_snapshot.id);
assert.strictEqual(new Set(index.units.map((unit) => unit.world_id)).size, index.units.length);
assert.strictEqual(new Set(index.units.map((unit) => unit.id)).size, index.units.length);

for (const unit of index.units) {
  assert(/^[a-f0-9]{64}$/.test(unit.hash));
  assert.strictEqual(unit.artifact_id, `sha256:${unit.hash}`);
  assert(unit.code_url.includes('/chrome-extension/code-units/'));
  assert.strictEqual(unit.host_api, '3');
  const snapshotRef = index.default_snapshot.entries.find((entry) => entry.id === unit.id);
  assert(snapshotRef);
  assert.strictEqual(snapshotRef.hash, unit.hash);
  assert.strictEqual(snapshotRef.artifact_id, unit.artifact_id);
}

const localAgent = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent');
assert(localAgent);
assert.strictEqual(localAgent.version, '1.0.0-rc.2-local-agent.7');
assert.strictEqual(localAgent.default_enabled, true);
assert.strictEqual(localAgent.phase, 55);

const dialogue = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent-dialogue');
assert(dialogue);
assert.strictEqual(dialogue.version, '1.0.0-rc.2-local-agent-dialogue.27');
assert.strictEqual(dialogue.default_enabled, true);
assert.strictEqual(dialogue.phase, 57);

const manager = index.units.find((unit) => unit.id === 'dcf.firstparty.plugin-manager');
assert(manager);
assert.strictEqual(manager.version, '1.0.0-rc.2-plugin-manager.6');
assert.strictEqual(manager.default_enabled, true);
assert.strictEqual(manager.phase, 70);

assert(!fs.existsSync(path.join(extension, 'official/code-units.json')));
const extensionJs = fs.readdirSync(path.join(extension, 'src'))
  .map((name) => fs.readFileSync(path.join(extension, 'src', name), 'utf8'))
  .join('\n');
assert(!extensionJs.includes('〔DCF·语言弹药〕'));
assert(!extensionJs.includes('长对话减负'));
assert(!extensionJs.includes('OpenCode'));
assert(!extensionJs.includes('local_agent.'));
assert(!JSON.stringify(manifest).includes('localhost'));
assert(!JSON.stringify(manifest).includes('127.0.0.1'));

const core = ['core.js', 'core-store.js', 'core-snapshot.js', 'core-state.js', 'core-diagnostics.js'].map((name) => fs.readFileSync(path.join(extension, 'src', name), 'utf8')).join('\n');
const runtime = ['host-runtime.js', 'host-runtime-registration.js', 'host-runtime-canary.js', 'host-runtime-observation.js', 'host-runtime-reconcile.js'].map((name) => fs.readFileSync(path.join(extension, 'src', name), 'utf8')).join('\n');
assert(core.includes("dcf.chrome.host.state.v3"));
assert(core.includes('artifact_id'));
assert(core.includes('desired: emptyDesired()'));
assert(core.includes('committed: { current: null'));
assert(runtime.includes('ensureCanaryPage'));
assert(runtime.includes('commitDesiredIfProven'));
assert(runtime.includes('migrateExistingPages'));
assert(runtime.includes('current_unchanged_on_failure'));

const css = fs.readFileSync(path.join(extension, 'pages/common.css'), 'utf8');
assert(css.includes('--text:'));
assert(/@media\s*\(prefers-color-scheme:dark\)/.test(css));
assert(/--text:\s*#f3f4f6/.test(css));

const migration = fs.readFileSync(path.join(extension, 'static/migration-bridge.js'), 'utf8');
assert(migration.includes('dcf-next-shell-host'));
assert(!migration.includes('dcf-chatgpt-microcore-host'));

console.log(JSON.stringify({
  ok: true,
  chrome_base_version: '1.0.0-rc.3',
  pure_base: true,
  independent_plugins: 11,
  content_addressed_release: true,
  generated_default_snapshot: true,
  desired_observed_committed_reconcile: true,
  canary_activation_controller: true,
  page_migration_decoupled: true,
  release_manifest_generated: true,
  durable_version_ledger_generated: true,
  base_unchanged_by_business_plugins: true,
  dark_mode: true,
  next_migration_only: true
}, null, 2));
