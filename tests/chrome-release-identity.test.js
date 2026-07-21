'use strict';
const assert = require('assert');
const { applyReleaseLedger, contentId } = require('../scripts/code-unit-release');

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const base = {
  schema: 'dcf.code_unit.version_ledger.v1',
  units: {
    'dcf.firstparty.test': {
      versions: { '1.0.0': hashA },
      legacy_collisions: []
    }
  }
};

const unchanged = applyReleaseLedger(base, [{ id: 'dcf.firstparty.test', version: '1.0.0', hash: hashA }]);
assert.strictEqual(unchanged.units['dcf.firstparty.test'].versions['1.0.0'], hashA);
assert.throws(
  () => applyReleaseLedger(base, [{ id: 'dcf.firstparty.test', version: '1.0.0', hash: hashB }]),
  /semantic_version_reuse/
);
const advanced = applyReleaseLedger(base, [{ id: 'dcf.firstparty.test', version: '1.0.1', hash: hashB }]);
assert.strictEqual(advanced.units['dcf.firstparty.test'].versions['1.0.1'], hashB);
assert.strictEqual(contentId(hashB), `sha256:${hashB}`);

console.log(JSON.stringify({
  ok: true,
  semantic_version_reuse_rejected_at_build: true,
  new_version_accepted: true,
  content_id_generated: true
}, null, 2));
