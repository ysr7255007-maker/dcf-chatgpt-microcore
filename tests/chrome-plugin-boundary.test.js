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
  assert(code.includes("type:'unit.started'") || code.includes("type: 'unit.started'"), `${ref.id} lacks startup evidence`);
  assert(code.includes('destroy'), `${ref.id} lacks cleanup boundary`);
  assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);
}
const shell = fs.readFileSync(path.join(root, 'chrome-extension/code-units/shell/main.js'), 'utf8');
assert(shell.includes('data-dcf-panel-root'));
assert(!shell.includes('DCF_AMMO'));
const ammo = fs.readFileSync(path.join(root, 'chrome-extension/code-units/ammo/main.js'), 'utf8');
assert(ammo.includes('language-ammo-library/data/language-ammo/library.json'));
assert(ammo.includes("slice(-3)"));
const performance = fs.readFileSync(path.join(root, 'chrome-extension/code-units/conversation-performance/main.js'), 'utf8');
assert(performance.includes('contentVisibility'));
const attribution = fs.readFileSync(path.join(root, 'chrome-extension/code-units/attribution/main.js'), 'utf8');
assert(attribution.includes('PerformanceObserver'));
console.log(JSON.stringify({ ok: true, self_contained_plugins: index.units.length, cleanup_boundary: true, github_ammo_library: true, next_features_present: true }, null, 2));
