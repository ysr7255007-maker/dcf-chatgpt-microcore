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
  assert(code.startsWith('(function'), `${ref.id} is not a self-contained IIFE`);
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
assert(!shell.includes('record.host.hidden = panelId !== id'));
assert(shell.includes('let appearanceState = {}'));
assert(shell.includes('appearanceState = { ...appearanceState, ...patch }'));
assert(shell.includes('applyAppearance({ collapsed })'));
assert(shell.includes('Object.assign({}, appearance.data || {}, shellState.data || {})'));

const appearance = fs.readFileSync(path.join(root, 'chrome-extension/code-units/appearance/main.js'), 'utf8');
assert(appearance.includes('type="range"'));
assert(appearance.includes("width: { label: '宽度', min: 280, max: 900, step: 20 }"));
assert(appearance.includes("height: { label: '高度', min: 240, max: 1200, step: 20 }"));
assert(!appearance.includes('collapsed:false'));
assert(!appearance.includes('collapsed: false'));

const ammo = fs.readFileSync(path.join(root, 'chrome-extension/code-units/ammo/main.js'), 'utf8');
assert(ammo.includes('language-ammo-library/data/language-ammo/library.json'));
assert(ammo.includes('slice(-3)'));
assert(ammo.includes('data-action="fire"'));
assert(ammo.includes('data-action="insert"'));
assert(ammo.includes('已插入当前光标位置'));
assert(ammo.includes('内容已写入，但发送按钮暂不可用'));
assert(ammo.includes('setSelectionRange'));
assert(ammo.includes('.click()'));
assert(ammo.includes('flex-wrap:nowrap'));
assert(ammo.includes('overflow-x:auto'));
assert(!ammo.includes('data-action="mode"'));

const versions = Object.fromEntries(index.units.map((unit) => [unit.id, unit.version]));
assert.strictEqual(versions['dcf.firstparty.shell'], '1.0.0-rc.2-shell.3');
assert.strictEqual(versions['dcf.firstparty.ammo'], '1.0.0-rc.2-ammo.1');
assert.strictEqual(versions['dcf.firstparty.appearance'], '1.0.0-rc.2-appearance.1');
for (const [id, version] of Object.entries(versions)) {
  if (!['dcf.firstparty.shell', 'dcf.firstparty.ammo', 'dcf.firstparty.appearance'].includes(id)) {
    assert.strictEqual(version, '1.0.0-rc.2');
  }
}

const performance = fs.readFileSync(path.join(root, 'chrome-extension/code-units/conversation-performance/main.js'), 'utf8');
assert(performance.includes('contentVisibility'));
const attribution = fs.readFileSync(path.join(root, 'chrome-extension/code-units/attribution/main.js'), 'utf8');
assert(attribution.includes('PerformanceObserver'));

console.log(JSON.stringify({
  ok: true,
  self_contained_plugins: index.units.length,
  shell_tab_visibility: true,
  shell_collapse_preserves_appearance: true,
  appearance_range_controls: true,
  ammo_direct_fire: true,
  ammo_cursor_insert: true,
  ammo_single_row_actions: true,
  per_plugin_versions: true
}, null, 2));
