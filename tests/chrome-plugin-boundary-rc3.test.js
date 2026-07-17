'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));

for (const ref of index.units) {
  const relative = new URL(ref.code_url).pathname.split('/chrome-extension/')[1];
  const file = path.join(root, 'chrome-extension', relative);
  const code = fs.readFileSync(file, 'utf8');
  assert(/^\s*(?:\(function|!function)/.test(code), `${ref.id} is not a self-contained IIFE`);
  assert(!/\brequire\s*\(|\bimport\s+/.test(code), `${ref.id} has a runtime module dependency`);
  assert(code.includes("type:'unit.started'") || code.includes("type: 'unit.started'") || code.includes('type:"unit.started"'), `${ref.id} lacks startup evidence`);
  assert(code.includes('destroy'), `${ref.id} lacks cleanup boundary`);
  assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
}

const shell = fs.readFileSync(path.join(root, 'chrome-extension/code-units/shell/main.js'), 'utf8');
assert(shell.includes('data-dcf-panel-root'));
assert(!shell.includes('DCF_AMMO'));
assert(shell.includes("style.setProperty('display', visible ? '' : 'none', 'important')"));
assert(shell.includes('document.documentElement.append(panelHost)'));
assert(shell.indexOf('previousHost.shadowRoot.querySelectorAll(PANEL_SELECTOR)') < shell.indexOf('previous.destroy'));
assert(shell.includes('let appearanceState = {}'));
assert(shell.includes('appearanceState = { ...appearanceState, ...patch }'));
assert(shell.includes('applyAppearance({ collapsed })'));
assert(shell.includes('scrollbar-width:none'));
assert(shell.includes('.body::-webkit-scrollbar{display:none}'));
assert(shell.includes('scroll-hint up'));
assert(shell.includes('scroll-hint down'));

const appearance = fs.readFileSync(path.join(root, 'chrome-extension/code-units/appearance/main.js'), 'utf8');
assert(appearance.includes('type="range"'));
assert(appearance.includes("width: { label: '宽度', min: 280, max: 900, step: 20 }"));
assert(appearance.includes("height: { label: '高度', min: 240, max: 1200, step: 20 }"));

const ammo = fs.readFileSync(path.join(root, 'chrome-extension/code-units/ammo/main.js'), 'utf8');
assert(ammo.includes('language-ammo-library/data/language-ammo/library.json'));
assert(ammo.includes('data-action="fire"'));
assert(ammo.includes('data-action="insert"'));
assert(ammo.includes('setSelectionRange'));
assert(ammo.includes('.ammo-actions{display:grid'));
assert(ammo.includes('grid-template-columns:repeat(4,minmax(0,1fr))'));
assert(!ammo.includes('overflow-x:auto'));

const hostAdapter = fs.readFileSync(path.join(root, 'chrome-extension/src/host-opencode.js'), 'utf8');
assert(hostAdapter.includes("const OPENCODE_ORIGIN = 'http://localhost:4096'"));
assert(hostAdapter.includes("type === 'local_agent.host_permission.request'"));
assert(hostAdapter.includes("type === 'local_agent.session.prompt'"));
assert(hostAdapter.includes("type === 'local_agent.session.abort'"));
assert(hostAdapter.includes("type === 'local_agent.permissions.list'"));
assert(hostAdapter.includes("type === 'local_agent.questions.list'"));
assert(hostAdapter.includes('chrome.storage.session'));
assert(hostAdapter.includes('local_agent_untrusted_sender'));
assert(!hostAdapter.includes('message.url'));
assert(!hostAdapter.includes('message.path'));

const localAgent = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent/main.js'), 'utf8');
for (const marker of [
  'local_agent.config.get',
  'local_agent.host_permission.request',
  'local_agent.sessions.list',
  'local_agent.session.create',
  'local_agent.session.prompt',
  'local_agent.session.status',
  'local_agent.session.messages',
  'local_agent.session.todo',
  'local_agent.session.diff',
  'local_agent.session.abort',
  'local_agent.permissions.list',
  'local_agent.questions.list',
  'data-action="run-new"',
  'data-action="run-current"',
  'data-action="insert-result"',
  'data-action="diagnostics"'
]) assert(localAgent.includes(marker), `local agent missing ${marker}`);
assert(localAgent.includes('允许一次'));
assert(localAgent.includes('本会话允许'));
assert(localAgent.includes('填入输入框'));
assert(localAgent.includes('文件差异'));
assert(localAgent.includes('任务清单'));
assert(localAgent.includes('OpenCode 需要补充信息'));
assert(localAgent.includes('setSelectionRange'));
assert(localAgent.includes('plugin.data.set'));

const refs = Object.fromEntries(index.units.map((unit) => [unit.id, unit]));
assert.strictEqual(refs['dcf.firstparty.shell'].version, '1.0.0-rc.2-shell.4');
assert.strictEqual(refs['dcf.firstparty.ammo'].version, '1.0.0-rc.2-ammo.2');
assert.strictEqual(refs['dcf.firstparty.appearance'].version, '1.0.0-rc.2-appearance.1');
assert.strictEqual(refs['dcf.firstparty.local-agent'].version, '1.0.0-rc.3-local-agent.1');
assert.strictEqual(refs['dcf.firstparty.local-agent'].host_api, '3');
assert.strictEqual(refs['dcf.firstparty.local-agent'].required, false);
assert.strictEqual(refs['dcf.firstparty.local-agent'].default_enabled, false);
assert(!index.defaults.includes('dcf.firstparty.local-agent'));
for (const [id, ref] of Object.entries(refs)) {
  if (!['dcf.firstparty.shell', 'dcf.firstparty.ammo', 'dcf.firstparty.appearance', 'dcf.firstparty.local-agent'].includes(id)) {
    assert.strictEqual(ref.version, '1.0.0-rc.2');
  }
}

console.log(JSON.stringify({
  ok: true,
  self_contained_plugins: index.units.length,
  default_enabled_plugins: index.defaults.length,
  existing_plugin_versions_preserved: true,
  local_agent_complete_panel: true,
  restricted_opencode_adapter: true,
  session_only_secret: true,
  permission_and_question_controls: true,
  result_diff_todo_surfaces: true
}, null, 2));
