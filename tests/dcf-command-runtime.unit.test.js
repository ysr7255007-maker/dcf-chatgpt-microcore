'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createCommandRunner } = require('../src/runtime/commands');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { clone } = require('../src/core/utils');

const storage = createStorage({});
const receipts = createReceiptStore(storage);
let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
const legacy = {
  schema: 'dcf.module_pack.v1', pack_id: 'dcf.legacy-command', revision: '1',
  modules: [{ id: 'dcf.legacy-command', title: 'Legacy', blocks: [{ id: 'main', commands: [
    { id: 'grow', label: 'Grow', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] },
    { id: 'secret', label: 'Secret', steps: [{ call: 'composer.replace', with: { text: 'TOP-SECRET' } }] }
  ] }] }]
};
addPackRevision(candidate, legacy, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();
let inserted = '';
const effects = { run: async (effect) => { inserted = effect.text || ''; return { ok: true }; } };
const runner = createCommandRunner(engine, effects, receipts, () => ({ width: 360 }));
const moduleDef = engine.getRegistry().modules.find((item) => item.id === 'dcf.legacy-command');

(async () => {
  const grow = moduleDef.blocks[0].commands[0];
  const growTrace = await runner.execute(moduleDef, grow, moduleDef.blocks[0]);
  assert.strictEqual(growTrace.status, 'ok');
  assert.strictEqual(engine.getRegistry().appearance.vars.w, '360px');
  const secret = moduleDef.blocks[0].commands[1];
  const secretTrace = await runner.execute(moduleDef, secret, moduleDef.blocks[0]);
  assert.strictEqual(secretTrace.status, 'ok');
  assert.strictEqual(inserted, 'TOP-SECRET');
  const serialized = JSON.stringify(receipts.list());
  assert(!serialized.includes('TOP-SECRET'), 'sensitive command payload leaked into receipts');
  console.log(JSON.stringify({ ok: true, legacy_commands_preserved: true, generic_capability_execution: true, privacy_redaction: true }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
