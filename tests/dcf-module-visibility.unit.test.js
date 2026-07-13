'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createHealthReporter } = require('../src/modules/health');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { clone } = require('../src/core/utils');

let root = normalizeRoot({});
const candidate = clone(root);
addPackRevision(candidate, {
  schema: 'dcf.module_pack.v1',
  pack_id: 'legacy.hidden-pack',
  revision: '1.0.0',
  modules: [{ id: 'legacy.hidden-module', title: '旧隐藏模块', version: '1.0.0', commands: [] }],
  contributes: {
    module_display: {
      'legacy.hidden-module': { area: 'work', order: 20, hidden: true }
    }
  }
}, { kind: 'test' });
root = finalizeCandidate(root, candidate);

const storage = createStorage({});
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();
const host = { diagnostics: () => ({ reply_root_observer_attached: true, composer_found: true }) };
const reporter = createHealthReporter(engine, receipts, storage, host, []);

let report = reporter.report();
assert.strictEqual(report.projection.module_count, 1);
assert.strictEqual(report.projection.visible_module_count, 0);
assert.strictEqual(report.projection.hidden_module_count, 1);
assert(report.comparison.current_module_ids.includes('legacy.hidden-module'));
assert(report.modules.some((item) => item.module_id === 'legacy.hidden-module' && item.hidden === true));
const hiddenCheck = report.checks.find((item) => item.id === 'ui.hidden-modules');
assert(hiddenCheck, 'hidden module check missing');
assert.strictEqual(hiddenCheck.status, 'info');
assert(hiddenCheck.details.hidden_module_ids.includes('legacy.hidden-module'));

const receipt = engine.setUserPath(['moduleDisplay', 'legacy.hidden-module'], { hidden: false });
assert.strictEqual(receipt.status, 'committed');
report = reporter.report();
assert.strictEqual(report.projection.visible_module_count, 1);
assert.strictEqual(report.projection.hidden_module_count, 0);
assert(report.modules.some((item) => item.module_id === 'legacy.hidden-module' && item.hidden === false));
assert(engine.getRoot().packages.packages['legacy.hidden-pack'], 'showing module removed its package');

console.log(JSON.stringify({ ok: true, hidden_modules_observable: true, user_visibility_override: true, package_preserved: true }, null, 2));
