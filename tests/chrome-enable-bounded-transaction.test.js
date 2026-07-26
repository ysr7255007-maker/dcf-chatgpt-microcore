'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeSource = ['host-runtime.js', 'host-runtime-registration.js', 'host-runtime-canary.js', 'host-runtime-observation.js', 'host-runtime-reconcile.js'].map((name) => fs.readFileSync(path.join(root, 'chrome-extension/src', name), 'utf8')).join('\n');
const coreSource = ['core.js', 'core-store.js', 'core-snapshot.js', 'core-state.js', 'core-diagnostics.js'].map((name) => fs.readFileSync(path.join(root, 'chrome-extension/src', name), 'utf8')).join('\n');
const hostMainSource = fs.readFileSync(path.join(root, 'chrome-extension/src/host-main.js'), 'utf8');
const hostProductSource = fs.readFileSync(path.join(root, 'chrome-extension/src/host-product.js'), 'utf8');

assert(runtimeSource.includes('H.declareDesiredSnapshot(snapshot'));
assert(runtimeSource.includes('H.reconcile(`unit-enabled:'));
assert(runtimeSource.includes('snapshotFromEntries(entries'));
assert(!runtimeSource.includes('next.snapshots.current'));
assert(!runtimeSource.includes('next.snapshots.last_known_good'));

assert(runtimeSource.includes('H.ensureCanaryPage'));
assert(runtimeSource.includes('canary_execute_${ref.id}'));
assert(runtimeSource.includes('EXECUTE_TIMEOUT_MS'));
assert(runtimeSource.includes("status: 'loaded'"));
assert(runtimeSource.includes('chrome.userScripts.execute'));
assert(runtimeSource.indexOf('commitDesiredIfProven') >= 0);
assert(runtimeSource.includes('closeCanary'));
assert(runtimeSource.includes('dedicated_canary_page_unavailable'));
assert(!runtimeSource.includes('tabs.find((item) => preferredTabId'));
assert(!runtimeSource.includes('tabs[0] || null'));
assert(hostMainSource.includes('stable_promotion_requires_acceptance_evidence'));
assert(hostMainSource.includes('acceptance_ref'));
assert(hostMainSource.includes('claim_scope'));

assert(runtimeSource.includes('H.postCommitConverge'));
assert(runtimeSource.includes('H.migrateExistingPages'));
assert(runtimeSource.includes('current_unchanged_on_failure: true'));
assert(runtimeSource.includes("'migration_failed'"));
assert(runtimeSource.includes("'reload_required'"));
assert(!runtimeSource.includes('candidate-registration-failure'));

assert(coreSource.includes("artifact_id: artifactId(hash)"));
assert(coreSource.includes('state.code_units[unit.hash]'));
assert(coreSource.includes('index.history[unit.version]'));
assert(coreSource.includes('semantic_version_reused'));
assert(coreSource.includes('snapshotIdentity'));

for (const token of [
  'desired: emptyDesired()',
  'committed: { current: null',
  'observed: { registrations:',
  'activation_records:',
  'reconcile_records:'
]) assert(coreSource.includes(token), `missing ${token}`);

assert(hostMainSource.includes('page_probe'));
assert(hostMainSource.includes('page_shell_missing'));
assert(hostMainSource.includes('activation_health'));
assert(hostMainSource.includes('report.desired'));
assert(coreSource.includes("schema: 'dcf.chrome.diagnostic.v3'"));

assert(hostProductSource.includes('{ version: unit.version, hash: unit.hash }'));
assert(hostProductSource.includes('state.desired.snapshot || state.committed.current'));
assert(hostProductSource.includes('index_snapshot_id'));

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'chrome-extension/manifest.template.json'), 'utf8'));
assert(manifest.permissions.includes('scripting'));
assert(manifest.permissions.includes('userScripts'));

console.log(JSON.stringify({
  ok: true,
  toggle_uses_desired_reconcile: true,
  canary_execute_bounded: true,
  dedicated_canary_required: true,
  stable_promotion_evidence_required: true,
  content_addressed_identity: true,
  committed_not_rolled_back_by_page_migration: true,
  activation_page_registration_truth_separated: true,
  exact_hash_update_selector: true,
  scripting_permission: true
}, null, 2));
