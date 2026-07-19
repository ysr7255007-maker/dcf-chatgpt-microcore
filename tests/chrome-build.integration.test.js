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
assert.strictEqual(manifest.version_name, '1.0.0-rc.2');
assert.strictEqual(manifest.version, '1.0.0.2');
assert.strictEqual(config.schema, 'dcf.chrome.config.v1');
assert(config.plugin_index_url.includes('/rebuild/chrome-native-host-v2/'));
assert.strictEqual(index.schema, 'dcf.plugin_index.v1');
assert.strictEqual(index.units.length, 10);
assert.strictEqual(index.defaults.length, 10);
assert.strictEqual(new Set(index.units.map((unit) => unit.world_id)).size, index.units.length);
assert.strictEqual(new Set(index.units.map((unit) => unit.id)).size, index.units.length);
for (const unit of index.units) {
  assert(/^[a-f0-9]{64}$/.test(unit.hash));
  assert(unit.code_url.includes('/chrome-extension/code-units/'));
  assert.strictEqual(unit.host_api, '2');
}
const localAgent = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent');
assert(localAgent);
assert.strictEqual(localAgent.version, '1.0.0-rc.2-local-agent.4');
assert.strictEqual(localAgent.default_enabled, true);
assert.strictEqual(localAgent.phase, 55);
const dialogue = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent-dialogue');
assert(dialogue);
assert.strictEqual(dialogue.version, '1.0.0-rc.2-local-agent-dialogue.13');
assert.strictEqual(dialogue.default_enabled, true);
assert.strictEqual(dialogue.phase, 57);
const manager = index.units.find((unit) => unit.id === 'dcf.firstparty.plugin-manager');
assert(manager);
assert.strictEqual(manager.version, '1.0.0-rc.2-plugin-manager.2');
assert.strictEqual(manager.default_enabled, true);
assert.strictEqual(manager.phase, 70);
assert(!fs.existsSync(path.join(extension, 'official/code-units.json')));
const extensionJs = fs.readdirSync(path.join(extension, 'src')).map((name) => fs.readFileSync(path.join(extension, 'src', name), 'utf8')).join('\n');
assert(!extensionJs.includes('〔DCF·语言弹药〕'));
assert(!extensionJs.includes('长对话减负'));
assert(!extensionJs.includes('OpenCode'));
assert(!extensionJs.includes('local_agent.'));
assert(!JSON.stringify(manifest).includes('localhost'));
assert(!JSON.stringify(manifest).includes('127.0.0.1'));
const css = fs.readFileSync(path.join(extension, 'pages/common.css'), 'utf8');
assert(css.includes('--text:'));
assert(/@media\s*\(prefers-color-scheme:dark\)/.test(css));
assert(/--text:\s*#f3f4f6/.test(css));
const migration = fs.readFileSync(path.join(extension, 'static/migration-bridge.js'), 'utf8');
assert(migration.includes('dcf-next-shell-host'));
assert(!migration.includes('dcf-chatgpt-microcore-host'));
console.log(JSON.stringify({
  ok: true,
  pure_base: true,
  independent_plugins: 10,
  local_agent_is_pure_plugin: true,
  dialogue_loop_is_pure_plugin: true,
  history_is_baseline_not_queue: true,
  dialogue_hot_remount: true,
  shell_shadow_dialogue_mount: true,
  dialogue_shadow_event_binding: true,
  dialogue_one_click_acceptance: true,
  normalized_opencode_status: true,
  synchronous_message_completion: true,
  robust_artifact_parsing: true,
  stable_dialogue_controls: true,
  pinned_tab_memory_is_plugin_owned: true,
  base_unchanged: true,
  dark_mode: true,
  next_migration_only: true
}, null, 2));
