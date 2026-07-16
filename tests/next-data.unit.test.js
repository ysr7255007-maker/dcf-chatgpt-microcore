'use strict';

const assert = require('assert');
const { collectLegacyAmmo } = require('../src-next/plugins/ammo');
const {
  LIBRARY_SCHEMA,
  encodeAmmoLibrary,
  decodeAmmoLibrary,
  classifyLibraryMerge
} = require('../src-next/plugins/ammo-artifacts');
const { collectTurns } = require('../src-next/plugins/conversation-performance');

const found = collectLegacyAmmo({
  user: {
    content: {
      ammo: {
        one: { id: 'one', title: 'One', purpose: '', body: 'Body' }
      }
    }
  }
});
assert.equal(found.length, 1);
assert.equal(found[0].body, 'Body');

const exported = encodeAmmoLibrary([
  { id: 'b', title: 'B', purpose: 'two', body: 'Body B', tags: ['x'] },
  { id: 'a', title: 'A', purpose: 'one', body: 'Body A', tags: [] }
], '2026-07-15T00:00:00.000Z');
const payload = JSON.parse(exported);
assert.equal(payload.schema, LIBRARY_SCHEMA);
assert.equal(payload.count, 2);
assert.deepEqual(payload.items.map((item) => item.id), ['a', 'b']);

const decoded = decodeAmmoLibrary(exported);
assert.equal(decoded.items.length, 2);
assert.equal(decoded.items[0].id, 'a');

assert.throws(
  () => decodeAmmoLibrary(JSON.stringify({ schema: LIBRARY_SCHEMA, items: [{ id: 'same' }, { id: 'same' }] })),
  /duplicate_id/
);

const classified = classifyLibraryMerge({
  a: { id: 'a', title: 'A', purpose: 'one', body: 'Body A', tags: [] },
  b: { id: 'b', title: 'Old B', purpose: 'two', body: 'Body B', tags: ['x'] }
}, decoded.items);
assert.deepEqual(classified.added.map((item) => item.id), []);
assert.deepEqual(classified.updated.map((item) => item.id), ['b']);
assert.deepEqual(classified.unchanged.map((item) => item.id), ['a']);

const root = {
  querySelectorAll(selector) {
    return selector.startsWith('[data-testid') ? [{ id: 1 }, { id: 2 }] : [];
  }
};
assert.equal(collectTurns(root).length, 2);

console.log('next data tests passed');
