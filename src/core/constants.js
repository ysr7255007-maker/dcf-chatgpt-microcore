'use strict';

const VERSION = '0.11.1';
const ROOT_KEY = 'dcf.state.root.v1';
const SNAPSHOT_KEY = 'dcf.state.snapshots.v1';
const RUNTIME_KEY = 'dcf.runtime.registry.v3';
const RECEIPT_KEY = 'dcf.receipts.v1';
const UI_KEY = 'dcf.ui.session.v1';
const CATALOG_STATE_KEY = 'dcf.catalog.state.v1';
const LEGACY_KEYS = {
  root: ROOT_KEY,
  packages: 'dcf.package.sources.v1',
  user: 'dcf.user.state.v1',
  ops: 'dcf.kernel.ops.v2',
  registry: 'dcf.kernel.registry.v1',
  state: 'dcf.kernel.state.v1',
  rollback: 'dcf.kernel.rollback.v1'
};
const CATALOG_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/catalog/index.json';

module.exports = {
  VERSION,
  ROOT_KEY,
  SNAPSHOT_KEY,
  RUNTIME_KEY,
  RECEIPT_KEY,
  UI_KEY,
  CATALOG_STATE_KEY,
  LEGACY_KEYS,
  CATALOG_URL
};