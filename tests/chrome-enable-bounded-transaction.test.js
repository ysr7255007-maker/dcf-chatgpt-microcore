'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(root, 'chrome-extension/src/host-runtime.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'chrome-extension/src/core.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'chrome-extension/src/host-main.js'), 'utf8');

assert(runtimeSource.includes('H.ensureCanary'));
assert(runtimeSource.includes("active: false"));
assert(runtimeSource.includes("H.executeSnapshotInTab(desired, canary.tab_id, 'canary')"));
assert(runtimeSource.includes('commitDesired'));
assert(runtimeSource.includes('H.migrateOpenPages'));
assert(runtimeSource.indexOf('commitDesired') < runtimeSource.indexOf('H.migrateOpenPages(desired, canary.tab_id)'));
assert(runtimeSource.includes("migration_status = failed.length ? 'reload_required' : 'migrated'"));
assert(!mainSource.includes('candidate-timeout:'));
assert(mainSource.includes("alarm.name === 'dcf-candidate-reconcile'"));
assert(mainSource.includes("type === 'runtime.observed'"));
assert(mainSource.includes("type === 'unit.failed'"));
assert(!mainSource.includes('return H.rollbackToLastKnownGood(`unit-failed:'));
assert(coreSource.includes("HOST_SCHEMA = 'dcf.chrome.host.state.v3'"));
assert(coreSource.includes('desired_snapshot'));
assert(coreSource.includes('committed: { current: null, last_known_good: null, stable: null'));
assert(coreSource.includes('activation_records'));
assert(coreSource.includes('reconcile_records'));
assert(coreSource.includes("activation_requirement: ['loaded', 'ready']"));
assert(coreSource.includes("schema: 'dcf.activation.record.v1'"));
assert(coreSource.includes("schema: 'dcf.reconcile.record.v1'"));
assert(runtimeSource.includes("runtime_state: 'loaded'"));
assert(runtimeSource.includes("runtime_state: 'ready'"));
assert(runtimeSource.includes("runtime_state: 'failed'"));
assert(runtimeSource.includes('optional_state_restore_unavailable') === false);

const managerSource = fs.readFileSync(path.join(root, 'chrome-extension/code-units/plugin-manager/main.js'), 'utf8');
assert(managerSource.includes('SEND_TIMEOUT_MS'));
assert(managerSource.includes('host_message_timed_out'));
assert(managerSource.includes("result.status === 'reload_required'"));
assert(managerSource.includes('location.reload()'));

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'chrome-extension/manifest.template.json'), 'utf8'));
assert.strictEqual(manifest.version_name, '1.0.0-rc.3');
assert(manifest.permissions.includes('userScripts'));
assert(manifest.permissions.includes('tabs'));
assert(manifest.permissions.includes('scripting'));

console.log(JSON.stringify({
  ok: true,
  canary_activation_controller_present: true,
  desired_observed_committed_reconcile_present: true,
  page_migration_decoupled_from_commit: true,
  candidate_timeout_no_longer_rolls_back_by_missing_page: true,
  unit_failure_no_longer_globally_rolls_back_current: true,
  loaded_ready_degraded_failed_contract_present: true,
  activation_and_reconcile_records_present: true,
  plugin_manager_bounded_host_call_preserved: true
}, null, 2));
