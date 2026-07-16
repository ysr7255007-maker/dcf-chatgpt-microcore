'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildNextSnapshotUserscripts } = require('../scripts/build-next-snapshots');

const root = path.resolve(__dirname, '..');
const results = buildNextSnapshotUserscripts();
assert.equal(results.length, 3);

function read(profile) {
  return fs.readFileSync(path.join(root, `dcf-chatgpt-next-snapshot-${profile}.user.js`), 'utf8');
}

const minimal = read('minimal');
const standard = read('standard');
const complete = read('complete');

for (const [name, text] of Object.entries({ minimal, standard, complete })) {
  assert(text.includes('// @name         DCF ChatGPT Next Snapshot Review'));
  assert(text.includes(`Compiled DCF boot snapshot (${name})`));
  assert(text.includes('factory0()'));
  assert(text.includes('dcf.next.shell'));
  assert(text.includes('dcf.next.chatgpt'));
  assert(text.includes('dcf.next.plugin-manager'));
  assert(text.includes('dcf.next.diagnostics'));
}

assert(!minimal.includes('localAgentPlugin'));
assert(!minimal.includes('ammoPlugin'));
assert(!minimal.includes('// @connect      localhost'));
assert(standard.includes('ammoPlugin'));
assert(!standard.includes('localAgentPlugin'));
assert(!standard.includes('// @connect      localhost'));
assert(complete.includes('localAgentPlugin'));
assert(complete.includes('// @connect      localhost'));
assert(complete.length > standard.length && standard.length > minimal.length);

console.log('next snapshot build tests passed');
