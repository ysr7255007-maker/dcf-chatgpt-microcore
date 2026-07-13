'use strict';

const { CATALOG_STATE_KEY } = require('../core/constants');
const { safeId } = require('../core/utils');

function createMaintenanceModule(engine, receiptStore, effectRunner, storage, healthReporter) {
  let lastHealth = null;
  function summary() {
    const root = engine.getRoot();
    const registry = engine.getRegistry();
    const environment = engine.getEnvironment();
    const receipts = receiptStore.list();
    return {
      schema: 'dcf.maintenance.summary.v2',
      kernel_version: root.kernel_version,
      revision: root.revision,
      state_hash: root.state_hash,
      build_id: registry && registry.build && registry.build.build_id,
      environment: {
        active_profile: environment.profiles.active_id,
        profile_count: environment.profiles.items.length,
        package_count: environment.capabilities.packages.length,
        resource_count: registry.resources && registry.resources.resources && registry.resources.resources.length || 0
      },
      active_packages: Object.keys(registry && registry.installedPacks || {}),
      recent_failures: receipts.filter((item) => item.status === 'rejected' || item.status === 'error').slice(-10),
      receipt_count: receipts.length,
      catalog: storage ? storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null }) : null
    };
  }
  function copySummary() { return effectRunner.run({ type: 'clipboard.write', text: JSON.stringify(summary(), null, 2) }, { module: 'maintenance', report: 'summary' }); }
  function healthReport() {
    lastHealth = healthReporter ? healthReporter.report() : { schema: 'dcf.runtime.health.diff.v1', status: 'error', deviations: [{ code: 'runtime_health_reporter_missing', severity: 'error', expected: 'reporter initialized', actual: 'missing', explanation: 'Boot did not create the Runtime health reporter.' }] };
    return lastHealth;
  }
  function copyHealthReport() {
    const report = healthReport();
    const text = `<<<DCF_RUNTIME_HEALTH\n${JSON.stringify(report, null, 2)}\nDCF_RUNTIME_HEALTH>>>`;
    return effectRunner.run({ type: 'clipboard.write', text }, { module: 'maintenance', report: 'runtime-health' });
  }
  return {
    summary,
    copySummary,
    healthReport,
    lastHealthReport: () => lastHealth,
    copyHealthReport,
    receipts: () => receiptStore.list(),
    clearReceipts: () => receiptStore.clear(),
    snapshots: () => engine.snapshots(),
    rollbackTo: (revision) => engine.rollbackTo(revision),
    profiles: () => engine.getEnvironment().profiles,
    saveProfile: (title) => engine.saveEnvironmentProfile(String(title || '当前环境'), safeId(String(title || '当前环境')) || undefined),
    activateProfile: (id) => engine.activateEnvironmentProfile(id),
    removeProfile: (id) => engine.removeEnvironmentProfile(id)
  };
}

module.exports = { createMaintenanceModule };
