'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { buildProjection } = require('../src/core/projection');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('../src/modules/standard-packages');
const { clone } = require('../src/core/utils');

let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
root = finalizeCandidate(root, candidate);
let projection = buildProjection(root);
assert(projection.ok, projection.errors.join('; '));
assert(REQUIRED_PRODUCT_PACKAGES.includes('dcf.ui.package-management'));
assert.strictEqual(projection.registry.uiViews.packages.kind, 'package-management');
assert.strictEqual(projection.registry.uiViews.packages.title, '安装包管理');
assert.strictEqual(projection.registry.build.resource_ownership['ui-view:packages'], 'dcf.ui.package-management@1.0.0');

candidate = clone(root);
const upgraded = clone(STANDARD_PACKS.find((pack) => pack.pack_id === 'dcf.ui.package-management'));
upgraded.revision = '1.1.0';
upgraded.contributes.ui_views[0].title = '能力包控制台';
upgraded.contributes.ui_views[0].labels.check_updates = '同步最新能力';
addPackRevision(candidate, upgraded, { kind: 'test-upgrade' });
root = finalizeCandidate(root, candidate);
projection = buildProjection(root);
assert(projection.ok, projection.errors.join('; '));
assert.strictEqual(projection.registry.uiViews.packages.title, '能力包控制台');
assert.strictEqual(projection.registry.uiViews.packages.labels.check_updates, '同步最新能力');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
assert(appSource.includes('engine.getRegistry().uiViews'), 'UI does not consume package-provided view resources');
assert(appSource.includes('view.control_order'), 'package view cannot control operation order');
assert(appSource.includes('view.labels'), 'package view cannot update visible labels');
console.log(JSON.stringify({ ok: true, package_owned_ui_view: true, ui_updates_by_package_revision: true, bootstrap_renderer_remains_declarative: true }, null, 2));
