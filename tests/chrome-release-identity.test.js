'use strict';
const assert = require('assert');
const { applyReleaseLedger, contentId } = require('../scripts/code-unit-release');

const shell9Old = 'a'.repeat(64);
const shell9Current = 'b'.repeat(64);
const base = {
  schema: 'dcf.code_unit.version_ledger.v1',
  units: {
    'dcf.firstparty.shell': {
      versions: { '1.0.0-rc.2-shell.9': shell9Current },
      legacy_collisions: [{ version: '1.0.0-rc.2-shell.9', previous_hash: shell9Old, current_hash: shell9Current }]
    }
  }
};
const same = applyReleaseLedger(base, [
  { id: 'dcf.firstparty.shell', version: '1.0.0-rc.2-shell.9', hash: shell9Current }
]);
assert.strictEqual(same.units['dcf.firstparty.shell'].versions['1.0.0-rc.2-shell.9'], shell9Current);
assert.strictEqual(same.units['dcf.firstparty.shell'].legacy_collisions.length, 1);
assert.throws(() => applyReleaseLedger(base, [
  { id: 'dcf.firstparty.shell', version: '1.0.0-rc.2-shell.9', hash: 'c'.repeat(64) }
]), /semantic_version_reuse/);
const next = applyReleaseLedger(base, [
  { id: 'dcf.firstparty.shell', version: '1.0.0-rc.2-shell.10', hash: 'c'.repeat(64) }
]);
assert.strictEqual(next.units['dcf.firstparty.shell'].versions['1.0.0-rc.2-shell.10'], 'c'.repeat(64));
assert.strictEqual(contentId(shell9Current), `sha256:${shell9Current}`);
console.log(JSON.stringify({
  ok: true,
  durable_version_ledger: true,
  legacy_collision_preserved: true,
  semantic_version_reuse_blocked: true,
  content_address_generated: true
}, null, 2));
