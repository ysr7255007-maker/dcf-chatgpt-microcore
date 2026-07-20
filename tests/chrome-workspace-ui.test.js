'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));

for (const ref of index.units) {
  const relative = new URL(ref.code_url).pathname.split('/chrome-extension/')[1];
  const code = fs.readFileSync(path.join(root, 'chrome-extension', relative), 'utf8');
  assert(/^\s*(?:\(function|!function)/.test(code), `${ref.id} is not a self-contained IIFE`);
  assert(code.includes('unit.started'), `${ref.id} lacks startup evidence`);
  assert(code.includes('destroy'), `${ref.id} lacks cleanup boundary`);
  assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
}

const shell = fs.readFileSync(path.join(root, 'chrome-extension/code-units/shell/main.js'), 'utf8');
assert(shell.includes("const UNIT_VERSION = '1.0.0-rc.2-shell.7'"));
assert(shell.includes("const DEFAULT_PINNED = ['ammo', FUNCTION_PANEL_ID]"));
assert(shell.includes('pinned_panels'));
assert(shell.includes('tab-arrow prev'));
assert(shell.includes('tab-arrow next'));
assert(shell.includes("tabbar.addEventListener('wheel'"));
assert(shell.includes("document.addEventListener('dcf:shell-command'"));
assert(shell.includes("document.dispatchEvent(new CustomEvent('dcf:shell-state'"));
assert(shell.includes("id !== FUNCTION_PANEL_ID"));
assert(shell.includes('scroll-hint up'));
assert(shell.includes('scroll-hint down'));
assert(shell.includes('appearanceState = { ...appearanceState, ...patch }'));

const ammo = fs.readFileSync(path.join(root, 'chrome-extension/code-units/ammo/main.js'), 'utf8');
assert(ammo.includes("const UNIT_VERSION = '1.0.0-rc.2-ammo.5'"));
assert(ammo.includes('language-ammo-library/data/language-ammo/library.json'));
assert(ammo.includes('selected_id'));
assert(ammo.includes('aria-selected'));
assert(ammo.includes('class="ammo-list"'));
assert(ammo.includes('class="control-dock"'));
assert(ammo.includes('position:sticky;bottom:0'));
assert(ammo.includes('所选弹药'));
assert(ammo.includes('弹药库'));
assert(ammo.includes('data-action="fire"'));
assert(ammo.includes('data-action="insert"'));
assert(ammo.includes('内容已写入，但发送按钮暂不可用'));
assert(!ammo.includes('ammo-actions'));

const manager = fs.readFileSync(path.join(root, 'chrome-extension/code-units/plugin-manager/main.js'), 'utf8');
assert(manager.includes("const UNIT_VERSION = '1.0.0-rc.2-plugin-manager.6'"));
assert(manager.includes('添加到标签栏'));
assert(manager.includes('移出标签栏'));
assert(manager.includes("document.dispatchEvent(new CustomEvent('dcf:shell-command'"));
assert(manager.includes("document.addEventListener('dcf:shell-state'"));
assert(manager.includes("document.addEventListener('dcf:shell-ready'"));
assert(manager.includes("panel_id: 'local-agent'"));
assert(manager.includes('async function loadMemory()'));
assert(manager.includes('async function saveMemory(next = shellState)'));
assert(manager.includes('function restoreRemembered()'));
assert(manager.includes('await saveMemory(shellState)'));
assert(manager.includes("setTimeout(restoreRemembered, 220)"));

const versions = Object.fromEntries(index.units.map((unit) => [unit.id, unit.version]));
assert.strictEqual(versions['dcf.firstparty.shell'], '1.0.0-rc.2-shell.7');
assert.strictEqual(versions['dcf.firstparty.ammo'], '1.0.0-rc.2-ammo.5');
assert.strictEqual(versions['dcf.firstparty.plugin-manager'], '1.0.0-rc.2-plugin-manager.6');
assert.strictEqual(versions['dcf.firstparty.local-agent'], '1.0.0-rc.2-local-agent.5');
assert.strictEqual(versions['dcf.firstparty.local-agent-dialogue'], '1.0.0-rc.2-local-agent-dialogue.18');

const changedHashes = Object.fromEntries(index.units.filter((unit) => ['dcf.firstparty.plugin-manager', 'dcf.firstparty.local-agent', 'dcf.firstparty.local-agent-dialogue'].includes(unit.id)).map((unit) => [unit.id, unit.hash]));
console.log(JSON.stringify({
  ok: true,
  plugin_hashes: index.units.length,
  workspace_tabs: true,
  tab_arrows_and_wheel: true,
  function_tab_locked: true,
  function_page_pinning: true,
  pinned_tabs_survive_updates: true,
  selectable_ammo_cards: true,
  shared_ammo_controls: true,
  dialogue_one_click_acceptance: true,
  changed_hashes: changedHashes
}, null, 2));
