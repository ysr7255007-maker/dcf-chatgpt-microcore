'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { clone } = require('../src/core/utils');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { ensureProductBaseline } = require('../src/index');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const previousPerformancePack = require('../catalog/packages/dcf.standard.conversation-performance/1.1.0.json');

let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) {
  addPackRevision(candidate, pack.pack_id === 'dcf.standard.conversation-performance' ? previousPerformancePack : pack, { kind: 'test' });
}
root = finalizeCandidate(root, candidate);

const preserved = ensureProductBaseline(root, { bootstrapChanged: false });
assert.strictEqual(
  preserved.packages.packages['dcf.standard.conversation-performance'].active_revision,
  '1.1.0',
  'same-bootstrap reload overrode an explicit older package revision'
);

const upgraded = ensureProductBaseline(root, { bootstrapChanged: true, previousKernelVersion: '0.17.0' });
const performanceEntry = upgraded.packages.packages['dcf.standard.conversation-performance'];
assert.strictEqual(performanceEntry.active_revision, '1.2.0', 'bootstrap upgrade did not activate the embedded required package revision');
assert(performanceEntry.revisions['1.1.0'], 'previous package revision was discarded');
assert(performanceEntry.revisions['1.2.0'], 'embedded current package revision was not installed');
assert.strictEqual(performanceEntry.source.kind, 'embedded-standard-bootstrap-sync');
assert(upgraded.revision > root.revision, 'bootstrap package synchronization did not create a new authoritative revision');

const secondReload = ensureProductBaseline(upgraded, { bootstrapChanged: false });
assert.strictEqual(secondReload, upgraded, 'same-bootstrap reload created an unnecessary package transaction');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert(indexSource.includes('catalog.check({ force: bootstrapChanged })'), 'bootstrap upgrade does not bypass the catalog throttle');
assert(indexSource.includes('previous_kernel_version: previousKernelVersion'), 'Runtime does not expose the detected bootstrap transition');

console.log(JSON.stringify({
  ok: true,
  embedded_required_package_sync: true,
  catalog_throttle_bypassed_on_upgrade: true,
  same_version_rollback_preserved: true,
  previous_revision_preserved: true
}, null, 2));
