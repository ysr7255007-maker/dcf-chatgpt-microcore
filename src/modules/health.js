'use strict';

const { VERSION, ROOT_KEY } = require('../core/constants');
const { nowIso } = require('../core/utils');

function sortedUnique(values) {
  return Array.from(new Set((values || []).map(String))).sort();
}

function difference(left, right) {
  const rightSet = new Set(right || []);
  return sortedUnique((left || []).filter((value) => !rightSet.has(value)));
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values || []) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return Array.from(duplicate).sort();
}

function activePackModules(packageState) {
  const result = [];
  for (const [packageId, entry] of Object.entries(packageState && packageState.packages || {})) {
    if (!entry || entry.enabled === false) continue;
    const revision = entry.active_revision;
    const pack = entry.revisions && entry.revisions[revision] && entry.revisions[revision].pack;
    for (const module of Array.isArray(pack && pack.modules) ? pack.modules : []) {
      if (module && module.id) result.push({ module_id: String(module.id), package_id: String(packageId) });
    }
  }
  return result;
}

function legacyInventory(storage, backend) {
  const packages = storage.getFrom(backend, 'dcf.package.sources.v1', null);
  const registry = storage.getFrom(backend, 'dcf.kernel.registry.v1', null);
  const root = storage.getFrom(backend, ROOT_KEY, null);
  const packageIds = Object.keys(packages && packages.packages || {}).sort();
  const moduleProviders = activePackModules(packages);
  const moduleIds = new Set(moduleProviders.map((item) => item.module_id));
  for (const module of Array.isArray(registry && registry.modules) ? registry.modules : []) {
    if (module && module.id) moduleIds.add(String(module.id));
  }
  return {
    backend,
    dcf_keys: storage.dcfKeys(backend),
    root_present: !!root,
    package_ids: packageIds,
    runtime_module_ids: Array.from(moduleIds).sort(),
    module_providers: moduleProviders
  };
}

function receiptSummary(receipt) {
  return {
    at: receipt.at || null,
    status: receipt.status || null,
    stage: receipt.stage || null,
    intent_type: receipt.intent && receipt.intent.type || null,
    package_id: receipt.intent && receipt.intent.package_id || null,
    error: receipt.error || null,
    errors: Array.isArray(receipt.errors) ? receipt.errors.slice(0, 4) : []
  };
}

function skippedPackageIds(root) {
  const items = root && root.system && root.system.storage_bridge && root.system.storage_bridge.skipped && root.system.storage_bridge.skipped.packages || [];
  return new Set(items.map((item) => String(typeof item === 'string' ? item : item && (item.package_id || item.id) || '')).filter(Boolean));
}

function createHealthReporter(engine, receiptStore, storage, host, requiredPackages = [], runtime = {}) {
  function report() {
    const generatedAt = nowIso();
    const root = engine.getRoot();
    const registry = engine.getRegistry();
    const runtimeObject = typeof runtime.getRuntime === 'function' ? runtime.getRuntime() : null;
    const app = typeof runtime.getApp === 'function' ? runtime.getApp() : null;
    const deviations = [];

    function add(code, severity, subject, expected, actual, evidence, explanation) {
      deviations.push({ code, severity, subject: subject || null, expected, actual, evidence: evidence || null, explanation });
    }

    let ui = null;
    if (app && typeof app.captureRuntimeViews === 'function') {
      try {
        ui = app.captureRuntimeViews();
      } catch (error) {
        add('runtime_ui_snapshot_failed', 'error', 'dcf-ui', 'runtime UI can be observed without changing authoritative state', 'snapshot threw', { error: String(error && error.message || error) }, 'The report could not observe the real Shadow DOM, so UI/runtime consistency is unknown.');
      }
    } else {
      add('runtime_app_unavailable', 'error', 'dcf-app', 'a mounted app exposes captureRuntimeViews()', 'app or runtime observer missing', null, 'The userscript runtime exists without an observable app instance, or boot did not finish.');
    }

    if (!runtimeObject) {
      add('runtime_global_missing', 'error', '__DCF_RUNTIME__', 'the current userscript instance publishes its runtime object', 'missing', null, 'The browser page does not expose the runtime object created at the end of DCF boot.');
    } else if (runtimeObject.version !== VERSION) {
      add('runtime_version_mismatch', 'error', '__DCF_RUNTIME__.version', VERSION, runtimeObject.version || null, null, 'The in-memory runtime and the installed userscript source are not the same version.');
    }

    if (ui) {
      if (ui.host_count !== 1) add('runtime_host_count_mismatch', 'error', '#dcf-chatgpt-microcore-host', 1, ui.host_count, null, ui.host_count === 0 ? 'DCF boot produced no host in the real document.' : 'The userscript appears to have been injected more than once in the same page.');
      if (!ui.host_connected || !ui.shadow_root_attached || !ui.shell_connected) add('runtime_ui_detached', 'error', 'dcf-ui', 'host, shadow root and shell are connected', { host_connected: ui.host_connected, shadow_root_attached: ui.shadow_root_attached, shell_connected: ui.shell_connected }, null, 'The in-memory app exists but part of its real DOM is detached.');
      if (!ui.shell_visible || !ui.shell_intersects_viewport) add('runtime_shell_not_visible', 'warning', 'dcf-shell', 'the shell has a visible rectangle intersecting the viewport', { shell_visible: ui.shell_visible, shell_intersects_viewport: ui.shell_intersects_viewport }, { rect: ui.shell_rect }, 'DCF is mounted but its real browser geometry makes it unavailable to the user.');
      if (!String(ui.version_text || '').includes(VERSION)) add('runtime_ui_version_mismatch', 'warning', 'dcf-ui-version', VERSION, ui.version_text || null, null, 'The visible sidebar version text does not match the running source version.');
    }

    const persistedRoot = storage.getFrom(storage.primaryBackend, ROOT_KEY, null);
    if (!persistedRoot) {
      add('runtime_authoritative_root_missing', 'error', `${storage.primaryBackend}:${ROOT_KEY}`, 'the authoritative backend contains the current root', 'missing', null, 'The in-memory runtime has no corresponding persisted authority in the backend it claims to use.');
    } else if (persistedRoot.state_hash !== root.state_hash || persistedRoot.revision !== root.revision) {
      add('runtime_memory_storage_diverged', 'error', ROOT_KEY, { revision: root.revision, state_hash: root.state_hash }, { revision: persistedRoot.revision, state_hash: persistedRoot.state_hash }, null, 'The current in-memory root and the actual persisted root have diverged.');
    }
    if (!registry || registry.state_hash !== root.state_hash) {
      add('runtime_projection_stale', 'error', 'runtime-registry', root.state_hash, registry && registry.state_hash || null, { root_revision: root.revision, projection_revision: registry && registry.state_revision }, 'The registry currently used by the browser was not built from the current in-memory root.');
    }

    const probeKey = `dcf.runtime.probe.${Date.now()}`;
    const probeValue = `ok:${Math.random().toString(36).slice(2)}`;
    try {
      storage.set(probeKey, probeValue);
      const readBack = storage.get(probeKey, null);
      storage.remove(probeKey);
      if (readBack !== probeValue) add('runtime_storage_roundtrip_failed', 'error', storage.primaryBackend, probeValue, readBack, null, 'The browser storage API accepted a write call but did not return the same value.');
    } catch (error) {
      try { storage.remove(probeKey); } catch (_) {}
      add('runtime_storage_roundtrip_failed', 'error', storage.primaryBackend, 'write/read/delete succeeds', 'probe threw', { error: String(error && error.message || error) }, 'The actual browser storage backend is not usable by this running userscript instance.');
    }

    const currentPackageIds = Object.keys(root.packages && root.packages.packages || {}).sort();
    const missingRequired = requiredPackages.filter((id) => {
      const entry = root.packages && root.packages.packages && root.packages.packages[id];
      return !entry || entry.enabled === false;
    });
    if (missingRequired.length) add('runtime_required_packages_missing', 'error', 'product-baseline', 'all required first-party packages installed and enabled', missingRequired, null, 'The running browser state cannot provide the language-ammunition value loop.');

    const currentRuntimeModuleIds = sortedUnique((registry && registry.modules || []).map((module) => module.id));
    const providerMap = registry && registry.build && registry.build.resource_ownership || {};
    const orphanModules = currentRuntimeModuleIds.filter((id) => !providerMap[`module:${id}`]);
    if (orphanModules.length) add('runtime_modules_without_provider', 'error', 'runtime-registry', 'every runtime module is traceable to an active package resource', orphanModules, null, 'These modules exist in memory without a provider that can explain why they are present.');

    const legacy = legacyInventory(storage, 'localStorage');
    const skipped = skippedPackageIds(root);
    const unexplainedLegacyPackages = legacy.package_ids.filter((id) => !currentPackageIds.includes(id) && !skipped.has(id));
    if (unexplainedLegacyPackages.length) add('runtime_storage_bridge_gap', 'error', 'legacy-packages', 'every legacy package is migrated or has an explicit skip record', unexplainedLegacyPackages, { bridge_present: !!(root.system && root.system.storage_bridge) }, 'The actual browser still contains legacy packages that neither reached the current root nor received an explicit conflict explanation.');
    const enabledPackageIds = new Set(Object.entries(root.packages && root.packages.packages || {}).filter(([, entry]) => entry && entry.enabled !== false).map(([id]) => id));
    const supersededModuleIds = new Set(Object.keys(registry && registry.moduleSupersession && registry.moduleSupersession.entries || {}));
    const legacyModulesMissingFromPresentPackages = legacy.module_providers.filter((item) => enabledPackageIds.has(item.package_id) && !currentRuntimeModuleIds.includes(item.module_id) && !supersededModuleIds.has(item.module_id));
    if (legacyModulesMissingFromPresentPackages.length) add('runtime_legacy_module_projection_gap', 'error', 'legacy-runtime-modules', 'modules from migrated active packages enter the current runtime registry or have an explicit active supersession', legacyModulesMissingFromPresentPackages, null, 'The package exists in the current browser state, but one or more of its legacy modules neither reached the running registry nor have an explicit active replacement.');

    const expectedDiscoverableModules = sortedUnique((registry && registry.modules || []).filter((module) => module.kind !== 'ammo').map((module) => module.id));
    if (ui && ui.views) {
      const actualPackages = sortedUnique(ui.views.packages && ui.views.packages.entry_ids);
      const missingPackageCards = difference(currentPackageIds, actualPackages);
      const extraPackageCards = difference(actualPackages, currentPackageIds);
      if (missingPackageCards.length || extraPackageCards.length) add('runtime_package_view_diverged', 'error', 'package-management-dom', currentPackageIds, actualPackages, { missing: missingPackageCards, extra: extraPackageCards }, 'The package list rendered in the real Shadow DOM does not match the packages held by the running authoritative state.');

      const actualDaily = sortedUnique(ui.views.functions && ui.views.functions.module_ids);
      const actualMaintenance = sortedUnique(ui.views.maintenance && ui.views.maintenance.module_ids);
      const actualDiscoverable = sortedUnique(actualDaily.concat(actualMaintenance));
      const missingEntries = difference(expectedDiscoverableModules, actualDiscoverable);
      const extraEntries = difference(actualDiscoverable, expectedDiscoverableModules);
      const crossSectionDuplicates = actualDaily.filter((id) => actualMaintenance.includes(id));
      if (missingEntries.length || extraEntries.length || crossSectionDuplicates.length) {
        add('runtime_module_entry_coverage_gap', 'error', 'module-entry-dom', expectedDiscoverableModules, actualDiscoverable, { missing: missingEntries, extra: extraEntries, present_in_both_sections: crossSectionDuplicates, daily_dom: actualDaily, maintenance_dom: actualMaintenance }, 'The real browser entry points do not provide exactly one discoverable header for every non-ammo runtime module. This comparison does not reuse the UI role resolver; it checks runtime identity coverage against the actual DOM. Folded cards still count as present.');
      }
      const duplicateCards = {
        daily: duplicates(ui.views.functions && ui.views.functions.module_ids),
        maintenance: duplicates(ui.views.maintenance && ui.views.maintenance.module_ids),
        packages: duplicates(ui.views.packages && ui.views.packages.entry_ids)
      };
      if (duplicateCards.daily.length || duplicateCards.maintenance.length || duplicateCards.packages.length) add('runtime_duplicate_entries', 'warning', 'dcf-shadow-dom', 'each package or module has one entry in its owning view', duplicateCards, null, 'The real DOM contains duplicate entries even though the underlying runtime identities are unique.');
    }

    const hostDiagnostics = host && typeof host.diagnostics === 'function' ? host.diagnostics() : null;
    if (!hostDiagnostics || !hostDiagnostics.conversation_root_found) {
      add('runtime_conversation_root_missing', 'warning', 'chatgpt-main', 'the current ChatGPT route exposes a conversation root', hostDiagnostics && hostDiagnostics.conversation_root_found || false, { route_kind: hostDiagnostics && hostDiagnostics.route_kind || null }, 'The Host Adapter cannot observe replies on the current page because the expected live page root is absent.');
    } else {
      if (!hostDiagnostics.reply_root_observer_attached) add('runtime_reply_observer_missing', 'error', 'reply-observer', 'observer attached to the current conversation root', false, hostDiagnostics, 'Automatic reply ingestion is not connected in this browser tab.');
      else if (!hostDiagnostics.observed_root_connected || hostDiagnostics.observed_root_is_current === false) add('runtime_reply_observer_stale', 'error', 'reply-observer', 'the observed node is connected and is the current conversation root', { connected: hostDiagnostics.observed_root_connected, is_current: hostDiagnostics.observed_root_is_current }, hostDiagnostics, 'ChatGPT navigation replaced the page root while DCF kept observing an old node.');
    }
    if (!hostDiagnostics || !hostDiagnostics.composer_found) add('runtime_composer_missing', 'warning', 'chatgpt-composer', 'the current page exposes a writable composer', false, { route_kind: hostDiagnostics && hostDiagnostics.route_kind || null }, 'DCF cannot insert or send ammunition in the current browser state.');

    const cutoff = Date.now() - 30 * 60 * 1000;
    const recentFailures = receiptStore.list().filter((item) => (item.status === 'rejected' || item.status === 'error') && (!item.at || Date.parse(item.at) >= cutoff)).slice(-8).map(receiptSummary);
    if (recentFailures.length) add('runtime_recent_failures', 'warning', 'runtime-receipts', 'no rejected or failed operations in the last 30 minutes', recentFailures.length, { failures: recentFailures }, 'The current browser session recently attempted operations that did not complete successfully.');

    const status = deviations.some((item) => item.severity === 'error') ? 'error' : deviations.some((item) => item.severity === 'warning') ? 'warning' : 'healthy';
    return {
      schema: 'dcf.runtime.health.diff.v1',
      generated_at: generatedAt,
      status,
      runtime: {
        version: VERSION,
        route_kind: hostDiagnostics && hostDiagnostics.route_kind || null,
        primary_backend: storage.primaryBackend,
        current_tab: ui && ui.current_tab || null
      },
      deviations,
      privacy: {
        conversation_text_included: false,
        ammo_bodies_included: false,
        package_payloads_included: false,
        command_arguments_included: false,
        authentication_data_included: false
      }
    };
  }

  function format() {
    return `<<<DCF_RUNTIME_HEALTH\n${JSON.stringify(report(), null, 2)}\nDCF_RUNTIME_HEALTH>>>`;
  }

  return { report, format };
}

module.exports = { createHealthReporter, legacyInventory, activePackModules, difference, duplicates };
