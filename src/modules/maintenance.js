'use strict';

const { CATALOG_STATE_KEY } = require('../core/constants');

function createMaintenanceModule(engine, receiptStore, effectRunner, storage, healthReporter) {
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
    return effectRunner.run({ type: 'clipboard.write', text: JSON.stringify(summary(), null, 2) }, { module: 'maintenance', report: 'summary' });
  }
  function healthReport() {
    return healthReporter ? healthReporter.report() : { schema: 'dcf.health.report.v1', overall: 'error', checks: [{ id: 'health.reporter', status: 'error', summary: '体检器未初始化' }] };
  }
  function copyHealthReport() {
    const text = healthReporter ? healthReporter.format() : `<<<DCF_HEALTH_REPORT\n${JSON.stringify(healthReport(), null, 2)}\nDCF_HEALTH_REPORT>>>`;
    return effectRunner.run({ type: 'clipboard.write', text }, { module: 'maintenance', report: 'health' });
  }
  return {
    summary,
    copySummary,
    healthReport,
    copyHealthReport,
    receipts: () => receiptStore.list(),
    clearReceipts: () => receiptStore.clear(),
    snapshots: () => engine.snapshots(),
    rollbackTo: (revision) => engine.rollbackTo(revision)
  };
}

module.exports = { createMaintenanceModule };