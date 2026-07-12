'use strict';

const { CATALOG_STATE_KEY } = require('../core/constants');

function createMaintenanceModule(engine, receiptStore, effectRunner, storage) {
  function summary() {
    const root = engine.getRoot();
    const registry = engine.getRegistry();
    const receipts = receiptStore.list();
    return {
      schema: 'dcf.maintenance.summary.v1',
      kernel_version: root.kernel_version,
      revision: root.revision,
      state_hash: root.state_hash,
      build_id: registry && registry.build && registry.build.build_id,
      active_packages: Object.keys(registry && registry.installedPacks || {}),
      recent_failures: receipts.filter((item) => item.status === 'rejected' || item.status === 'error').slice(-10),
      receipt_count: receipts.length,
      catalog: storage ? storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null }) : null
    };
  }
  function copySummary() {
    return effectRunner.run({ type: 'clipboard.write', text: JSON.stringify(summary(), null, 2) }, { module: 'maintenance' });
  }
  return {
    summary,
    copySummary,
    receipts: () => receiptStore.list(),
    clearReceipts: () => receiptStore.clear(),
    snapshots: () => engine.snapshots(),
    rollbackTo: (revision) => engine.rollbackTo(revision)
  };
}

module.exports = { createMaintenanceModule };
