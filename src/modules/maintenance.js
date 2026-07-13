'use strict';

const { CATALOG_STATE_KEY } = require('../core/constants');
const { safeId } = require('../core/utils');

function createMaintenanceModule(engine, receiptStore, effectRunner, storage, healthReporter, reconciler) {
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
  function environmentIntent(intent, material) { return reconciler ? reconciler.acceptIntent(intent, material) : engine.applyEnvironmentIntent(intent, material); }

  function restoreRevision(revision) {
    const record = engine.snapshots().slice().reverse().find((item) => Number(item.revision) === Number(revision));
    if (!record) return engine.rollbackTo(revision);
    return environmentIntent({ type: 'environment.restore', revision }, { root: record.root });
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
    rollbackTo: restoreRevision,
    profiles: () => engine.getEnvironment().profiles,
    saveProfile: (title) => environmentIntent({ type: 'environment.profile.save', title: String(title || '当前环境'), profile_id: safeId(String(title || '当前环境')) || undefined }),
    activateProfile: (id) => environmentIntent({ type: 'environment.profile.activate', profile_id: id }),
    removeProfile: (id) => environmentIntent({ type: 'environment.profile.remove', profile_id: id })
  };
}

module.exports = { createMaintenanceModule };
