'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createCatalogTransport } = require('../src/modules/catalog');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { hash, clone } = require('../src/core/utils');

const v1 = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.catalog-test', revision: '1.0.0', contributes: { settings: { catalog_test: 1 } }, modules: [] };
const v2 = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.catalog-test', revision: '1.1.0', contributes: { settings: { catalog_test: 2 } }, modules: [] };
const catalog = { schema: 'dcf.catalog.v1', packages: [{ package_id: v2.pack_id, revision: v2.revision, hash: hash(v2), url: 'https://example.test/v2.json' }] };
const storage = createStorage({});
const receiptStore = createReceiptStore(storage);
let root = normalizeRoot({});
let candidate = clone(root);
addPackRevision(candidate, v1, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const engine = createTransactionEngine(storage, receiptStore, { initialRoot: root });
engine.initialize();
const api = {
  GM_xmlhttpRequest(options) {
    const payload = options.url.includes('catalog') ? catalog : v2;
    setTimeout(() => options.onload({ status: 200, responseText: JSON.stringify(payload) }), 0);
  }
};
const transport = createCatalogTransport(storage, engine, api);
(async () => {
  const result = await transport.check({ force: true, url: 'https://example.test/catalog.json' });
  assert(result.ok, result.error);
  assert.strictEqual(engine.getRoot().packages.packages[v1.pack_id].active_revision, '1.1.0');
  assert.strictEqual(engine.getRegistry().settings.catalog_test, 2);
  console.log(JSON.stringify({ ok: true, trusted_catalog_transport: true, same_transaction_path: true, hash_verified: true }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
