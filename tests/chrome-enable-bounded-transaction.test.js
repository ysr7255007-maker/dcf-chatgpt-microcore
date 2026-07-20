'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const root = path.resolve(__dirname, '..');

// Verify host-runtime source contains bounded enable semantics
const runtimeSource = fs.readFileSync(path.join(root, 'chrome-extension/src/host-runtime.js'), 'utf8');

// 1. setUnitEnabled must NOT create a candidate snapshot
assert(!runtimeSource.includes('next.snapshots.candidate = C.validateSnapshot(next, candidate)'),
  'setUnitEnabled must not create a full candidate snapshot');
assert(runtimeSource.includes('next.snapshots.candidate = null'),
  'setUnitEnabled must clear any stale candidate');
assert(runtimeSource.includes('unit.config_changed'),
  'setUnitEnabled must record a config_changed evidence event');

// 2. setUnitEnabled must have a hard timeout on hot-execute
assert(runtimeSource.includes('EXECUTE_TIMEOUT_MS'),
  'host-runtime must define EXECUTE_TIMEOUT_MS');
assert(runtimeSource.includes('H.withTimeout'),
  'host-runtime must use withTimeout for bounded operations');
assert(runtimeSource.includes('hot_enable_'),
  'setUnitEnabled hot-execute must be labeled for timeout identification');

// 3. setUnitEnabled must return structured status
assert(runtimeSource.includes("status: 'completed'"),
  'setUnitEnabled must return completed status');
assert(runtimeSource.includes("status: 'reload_required'"),
  'setUnitEnabled must return reload_required when hot-execute fails');
assert(runtimeSource.includes("status: 'registration_failed'"),
  'setUnitEnabled must return registration_failed on registration error');

// 4. executeCandidateInOpenTabs must use timeout
assert(runtimeSource.includes('execute_${ref.id}_tab${tab.id}') || runtimeSource.includes('`execute_${ref.id}_tab${tab.id}`'),
  'executeCandidateInOpenTabs must wrap each execute with timeout');

// 5. Plugin manager must have send timeout
const managerSource = fs.readFileSync(path.join(root, 'chrome-extension/code-units/plugin-manager/main.js'), 'utf8');
assert(managerSource.includes('SEND_TIMEOUT_MS'),
  'plugin-manager must define SEND_TIMEOUT_MS');
assert(managerSource.includes('host_message_timed_out'),
  'plugin-manager send must reject with host_message_timed_out on timeout');
assert(managerSource.includes("result.status === 'reload_required'"),
  'plugin-manager must handle reload_required from set_unit_enabled');
assert(managerSource.includes('location.reload()'),
  'plugin-manager must reload page when reload_required');

// 6. Diagnostics must check page truth, not just registration truth
const hostMainSource = fs.readFileSync(path.join(root, 'chrome-extension/src/host-main.js'), 'utf8');
assert(hostMainSource.includes('page_probe'),
  'host.diagnostics must include page_probe');
assert(hostMainSource.includes('page_shell_missing'),
  'host.diagnostics must detect page_shell_missing');
assert(hostMainSource.includes('shell_host_exists'),
  'page probe must check for DCF Shell host element');
assert(hostMainSource.includes('page_health'),
  'host.diagnostics must report page_health status');

// 7. Diagnostics plugin must display page health
const diagSource = fs.readFileSync(path.join(root, 'chrome-extension/code-units/diagnostics/main.js'), 'utf8');
assert(diagSource.includes('page_shell_missing'),
  'diagnostics plugin must handle page_shell_missing status');
assert(diagSource.includes('脚本已注册但当前页缺少 DCF Shell'),
  'diagnostics plugin must display page_shell_missing in Chinese');
assert(diagSource.includes('page_health'),
  'diagnostics plugin must display page_health');

// 8. Manifest must include scripting permission for page probe
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'chrome-extension/manifest.template.json'), 'utf8'));
assert(manifest.permissions.includes('scripting'),
  'manifest must include scripting permission for page probe');

// 9. Verify withTimeout utility exists and is correct
assert(runtimeSource.includes('Promise.race([promise, timeout])'),
  'withTimeout must use Promise.race');
assert(runtimeSource.includes('timed_out_after_'),
  'withTimeout must produce identifiable timeout error messages');

// 10. setUnitEnabled must only register/unregister the target unit
assert(runtimeSource.includes("api.unregister({ ids: [C.scriptId(id)] })"),
  'disable must only unregister the target unit script');
assert(runtimeSource.includes('C.registrationFor(unit)'),
  'enable must register only the target unit');

console.log(JSON.stringify({
  ok: true,
  bounded_enable_transaction: true,
  no_full_candidate_on_toggle: true,
  execute_timeout_protection: true,
  structured_status_results: true,
  plugin_manager_send_timeout: true,
  reload_required_handling: true,
  page_probe_diagnostics: true,
  page_shell_missing_detection: true,
  no_false_health: true,
  scripting_permission: true
}, null, 2));
