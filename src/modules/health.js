'use strict';

const { VERSION, ROOT_KEY, SNAPSHOT_KEY, RUNTIME_KEY, RECEIPT_KEY, CATALOG_STATE_KEY, LEGACY_KEYS } = require('../core/constants');
const { computeStateHash, validateRoot } = require('../core/state');
const { hash, isObject, nowIso } = require('../core/utils');
const { commandList } = require('../runtime/commands');

function summarizeStoredValue(value) {
  if (value == null) return { present: false };
  const summary = { present: true, type: Array.isArray(value) ? 'array' : typeof value, hash: hash(value) };
  if (isObject(value)) {
    if (value.schema) summary.schema = value.schema;
    if (value.revision != null) summary.revision = value.revision;
    summary.key_count = Object.keys(value).length;
  }
  if (Array.isArray(value)) summary.item_count = value.length;
  return summary;
}

function activePackModuleIds(packageState) {
  const ids = [];
  for (const entry of Object.values(packageState && packageState.packages || {})) {
    if (!entry || entry.enabled === false) continue;
    const revision = entry.active_revision;
    const pack = entry.revisions && entry.revisions[revision] && entry.revisions[revision].pack;
    for (const module of Array.isArray(pack && pack.modules) ? pack.modules : []) {
      if (module && module.id) ids.push(String(module.id));
    }
  }
  return Array.from(new Set(ids)).sort();
}

function legacyInventory(storage, backend) {
  const packages = storage.getFrom(backend, LEGACY_KEYS.packages, null);
  const user = storage.getFrom(backend, LEGACY_KEYS.user, null);
  const ops = storage.getFrom(backend, LEGACY_KEYS.ops, null);
  const registry = storage.getFrom(backend, LEGACY_KEYS.registry, null);
  const root = storage.getFrom(backend, ROOT_KEY, null);
  const packageIds = Object.keys(packages && packages.packages || {}).sort();
  const moduleIds = new Set(activePackModuleIds(packages));
  for (const module of Array.isArray(registry && registry.modules) ? registry.modules : []) {
    if (module && module.id) moduleIds.add(String(module.id));
  }
  const ammoCount = Object.keys(user && user.content && user.content.ammo || registry && registry.content && registry.content.ammo || {}).length;
  return {
    backend,
    dcf_keys: storage.dcfKeys(backend),
    stores: {
      root: summarizeStoredValue(root),
      packages: summarizeStoredValue(packages),
      user: summarizeStoredValue(user),
      ops: summarizeStoredValue(ops),
      registry: summarizeStoredValue(registry)
    },
    package_ids: packageIds,
    module_ids: Array.from(moduleIds).sort(),
    ammo_count: ammoCount,
    settings_count: Object.keys(user && user.settings || registry && registry.settings || {}).length,
    module_display_count: Object.keys(user && user.moduleDisplay || registry && registry.moduleDisplay || {}).length
  };
}

function receiptSummary(receipt) {
  return {
    receipt_id: receipt.receipt_id || null,
    status: receipt.status || null,
    stage: receipt.stage || null,
    intent_type: receipt.intent && receipt.intent.type || null,
    package_id: receipt.intent && receipt.intent.package_id || null,
    content_type: receipt.intent && receipt.intent.content_type || null,
    error: receipt.error || null,
    errors: Array.isArray(receipt.errors) ? receipt.errors.slice(0, 8) : [],
    revision: receipt.revision == null ? null : receipt.revision,
    duration_ms: receipt.duration_ms == null ? null : receipt.duration_ms
  };
}

function createHealthReporter(engine, receiptStore, storage, host, requiredPackages = []) {
  function report() {
    const root = engine.getRoot();
    const registry = engine.getRegistry();
    const receipts = receiptStore.list();
    const snapshots = engine.snapshots();
    const currentPackageIds = Object.keys(root.packages && root.packages.packages || {}).sort();
    const currentModuleIds = (registry.modules || []).map((module) => String(module.id)).sort();
    const localLegacy = legacyInventory(storage, 'localStorage');
    const gmInventory = legacyInventory(storage, 'gm');
    const missingLegacyModules = localLegacy.module_ids.filter((id) => !currentModuleIds.includes(id));
    const missingLegacyPackages = localLegacy.package_ids.filter((id) => !currentPackageIds.includes(id));
    const rootValidation = validateRoot(root);
    const checks = [];

    function addCheck(id, status, summary, details) {
      checks.push({ id, status, summary, details: details || null });
    }

    const computedHash = computeStateHash(root);
    addCheck('state.root.valid', rootValidation.ok ? 'ok' : 'error', rootValidation.ok ? '权威状态根可验证' : '权威状态根验证失败', rootValidation.errors);
    addCheck('state.hash.matches', computedHash === root.state_hash ? 'ok' : 'error', computedHash === root.state_hash ? '状态哈希一致' : '状态哈希不一致');
    addCheck('projection.matches-root', registry && registry.state_hash === root.state_hash ? 'ok' : 'error', registry && registry.state_hash === root.state_hash ? '运行投影与权威根一致' : '运行投影与权威根不一致');

    const missingRequired = requiredPackages.filter((id) => {
      const entry = root.packages.packages[id];
      return !entry || entry.enabled === false;
    });
    addCheck('product.required-packages', missingRequired.length ? 'error' : 'ok', missingRequired.length ? '产品核心包缺失或停用' : '产品核心包完整', missingRequired);

    const localLegacyPresent = !!(localLegacy.package_ids.length || localLegacy.module_ids.length || localLegacy.ammo_count || localLegacy.stores.root.present);
    if (missingLegacyModules.length || missingLegacyPackages.length) {
      addCheck('migration.legacy-coverage', 'error', '检测到未进入当前运行态的旧模块或旧包', { missing_module_ids: missingLegacyModules, missing_package_ids: missingLegacyPackages });
    } else if (localLegacyPresent) {
      addCheck('migration.legacy-coverage', 'ok', '检测到旧存储，当前运行态已覆盖其模块与包');
    } else {
      addCheck('migration.legacy-coverage', 'ok', '未检测到需要迁移的旧模块存储');
    }

    if (storage.primaryBackend === 'gm' && localLegacyPresent && !root.system.storage_bridge) {
      addCheck('storage.backend-bridge', 'error', 'GM 存储与 localStorage 之间存在旧数据，但没有桥接记录');
    } else if (root.system.storage_bridge && root.system.storage_bridge.skipped && root.system.storage_bridge.skipped.packages && root.system.storage_bridge.skipped.packages.length) {
      addCheck('storage.backend-bridge', 'warning', '存储桥已运行，但有旧包因冲突被跳过', root.system.storage_bridge.skipped.packages);
    } else {
      addCheck('storage.backend-bridge', 'ok', root.system.storage_bridge ? '旧存储桥已完成' : '当前无需存储桥接');
    }

    const hostDiagnostics = host && typeof host.diagnostics === 'function' ? host.diagnostics() : null;
    addCheck('host.reply-observer', hostDiagnostics && hostDiagnostics.reply_root_observer_attached ? 'ok' : 'warning', hostDiagnostics && hostDiagnostics.reply_root_observer_attached ? '回复监听器已连接' : '回复监听器尚未连接', hostDiagnostics);
    addCheck('host.composer', hostDiagnostics && hostDiagnostics.composer_found ? 'ok' : 'warning', hostDiagnostics && hostDiagnostics.composer_found ? '输入框可用' : '当前页面未找到输入框');

    const recentFailures = receipts.filter((item) => item.status === 'rejected' || item.status === 'error').slice(-20).map(receiptSummary);
    addCheck('receipts.recent-failures', recentFailures.length ? 'warning' : 'ok', recentFailures.length ? `最近存在 ${recentFailures.length} 条失败回执` : '最近没有失败回执');

    const overall = checks.some((item) => item.status === 'error') ? 'error' : checks.some((item) => item.status === 'warning') ? 'warning' : 'ok';
    const statusCounts = receipts.reduce((result, item) => {
      const status = item.status || 'unknown';
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {});

    return {
      schema: 'dcf.health.report.v1',
      generated_at: nowIso(),
      overall,
      kernel_version: VERSION,
      checks,
      storage: {
        primary_backend: storage.primaryBackend,
        available_backends: storage.availableBackends,
        authoritative_keys: {
          root: ROOT_KEY,
          snapshots: SNAPSHOT_KEY,
          runtime_projection: RUNTIME_KEY,
          receipts: RECEIPT_KEY,
          catalog: CATALOG_STATE_KEY
        },
        bridge: root.system.storage_bridge || null,
        gm: gmInventory,
        local_storage: localLegacy
      },
      state: {
        schema: root.schema,
        revision: root.revision,
        parent_revision: root.parent_revision,
        state_hash: root.state_hash,
        computed_state_hash: computedHash,
        package_revision: root.packages.revision,
        user_revision: root.user.revision,
        migration: root.system.migration || null,
        artifact_index_count: Object.keys(root.system.artifact_index || {}).length,
        snapshot_count: snapshots.length
      },
      projection: {
        schema: registry.schema,
        build_id: registry.build && registry.build.build_id,
        state_revision: registry.state_revision,
        state_hash: registry.state_hash,
        package_count: currentPackageIds.length,
        module_count: currentModuleIds.length,
        surface_count: Object.keys(registry.surfaces || {}).length,
        content_type_count: Object.keys(registry.contentTypes || {}).length,
        style_source_count: (registry.appearance && registry.appearance.styles || []).length
      },
      packages: currentPackageIds.map((packageId) => {
        const entry = root.packages.packages[packageId];
        const active = entry.revisions && entry.revisions[entry.active_revision];
        return {
          package_id: packageId,
          enabled: entry.enabled !== false,
          active_revision: entry.active_revision,
          revision_count: Object.keys(entry.revisions || {}).length,
          active_hash: active && active.hash || null,
          source_kind: entry.source && entry.source.kind || null,
          required: requiredPackages.includes(packageId)
        };
      }),
      modules: (registry.modules || []).map((module) => ({
        module_id: module.id,
        title: module.title || null,
        version: module.version || null,
        area: registry.moduleDisplay && registry.moduleDisplay[module.id] && registry.moduleDisplay[module.id].area || module.area || 'work',
        hidden: !!(registry.moduleDisplay && registry.moduleDisplay[module.id] && registry.moduleDisplay[module.id].hidden),
        command_count: commandList(module).length,
        provider: registry.build && registry.build.resource_ownership && registry.build.resource_ownership[`module:${module.id}`] || null
      })),
      surfaces: Object.values(registry.surfaces || {}).map((surface) => ({ id: surface.id, title: surface.title || null, area: surface.area || null, kind: surface.kind || null, content_type: surface.content_type || null })),
      user_data: {
        content_counts: Object.fromEntries(Object.entries(root.user.content || {}).map(([type, items]) => [type, Object.keys(isObject(items) ? items : {}).length])),
        settings_keys: Object.keys(root.user.settings || {}).sort(),
        module_display_keys: Object.keys(root.user.moduleDisplay || {}).sort(),
        appearance: {
          side: root.user.appearance && root.user.appearance.side || null,
          variable_keys: Object.keys(root.user.appearance && root.user.appearance.vars || {}).sort(),
          has_user_css: !!(root.user.appearance && root.user.appearance.css),
          safe_mode: !!(root.user.appearance && root.user.appearance.safe_mode)
        }
      },
      host: hostDiagnostics,
      receipts: { count: receipts.length, status_counts: statusCounts, recent_failures: recentFailures },
      comparison: {
        legacy_local_module_ids: localLegacy.module_ids,
        current_module_ids: currentModuleIds,
        missing_legacy_module_ids: missingLegacyModules,
        legacy_local_package_ids: localLegacy.package_ids,
        current_package_ids: currentPackageIds,
        missing_legacy_package_ids: missingLegacyPackages
      },
      privacy: {
        conversation_text_included: false,
        ammo_bodies_included: false,
        package_payloads_included: false,
        authentication_data_included: false
      }
    };
  }

  function format() {
    return `<<<DCF_HEALTH_REPORT\n${JSON.stringify(report(), null, 2)}\nDCF_HEALTH_REPORT>>>`;
  }

  return { report, format };
}

module.exports = { createHealthReporter, legacyInventory, activePackModuleIds };