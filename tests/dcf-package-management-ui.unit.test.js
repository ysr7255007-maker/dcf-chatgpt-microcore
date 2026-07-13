'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { packagePresentation } = require('../src/modules/package-manager');

function entry(pack) {
  return {
    package_id: pack.pack_id,
    active_revision: pack.revision,
    enabled: true,
    revisions: { [pack.revision]: { pack } }
  };
}

let view = packagePresentation(entry({
  schema: 'dcf.module_pack.v1',
  pack_id: 'example.explicit',
  revision: '1',
  title: '示例功能包',
  description: '用于验证显式中文包信息。',
  modules: []
}));
assert.deepStrictEqual(view, { title: '示例功能包', description: '用于验证显式中文包信息。' });

view = packagePresentation(entry({
  schema: 'dcf.module_pack.v1',
  pack_id: 'dcf.runtime_inspector',
  revision: '1',
  modules: [{ id: 'dcf.runtime_inspector', title: 'Runtime Inspector', commands: [] }]
}));
assert.strictEqual(view.title, '运行检查');
assert(view.description.includes('Runtime'));

view = packagePresentation(entry({
  schema: 'dcf.module_pack.v1',
  pack_id: 'dcf.surface.example',
  revision: '1',
  contributes: { surfaces: [{ id: 'example', title: '示例入口' }] },
  modules: []
}));
assert.strictEqual(view.title, '示例入口');
assert(view.description.includes('界面入口'));

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
assert(appSource.includes('packageManager.presentation(entry)'), 'package cards do not use the presentation model');
assert(appSource.includes('class="card package-list"'), 'packages are not rendered as one compact list');
assert(appSource.includes('class="package-controls"'), 'package operations do not share one compact control band');
assert(appSource.includes('.package-controls select{width:auto'), 'package revision selector still consumes the full card width');
assert(appSource.includes('<details class="package-install">'), 'low-frequency manual installation input is not folded');
assert(!appSource.includes('<div class="name">${escapeHtml(entry.package_id)}'), 'technical package ID is still used as the primary title');

console.log(JSON.stringify({ ok: true, localized_package_titles: true, derived_descriptions: true, compact_controls: true, folded_manual_install: true }, null, 2));
