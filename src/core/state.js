'use strict';

const { VERSION, LEGACY_KEYS } = require('./constants');
const { clone, deepMerge, hash, isObject, nowIso } = require('./utils');
const { buildProjection } = require('./projection');
const { styleViolations } = require('./resources');

const EMPTY_ROOT = {
  schema: 'dcf.state.root.v1',
  kernel_version: VERSION,
  revision: 0,
  parent_revision: null,
  state_hash: '',
  created_at: '',
  updated_at: '',
  packages: { schema: 'dcf.package.sources.v2', revision: 0, packages: {} },
  user: {
    schema: 'dcf.user.state.v2',
    revision: 0,
    appearance: { side: null, vars: {}, css: '', safe_mode: false },
    settings: {},
    content: { ammo: {} },
    moduleDisplay: {},
    preferences: { ammo_fire_mode: 'insert' },
    environmentProfiles: {},
    active_environment_profile: null
  },
  system: {
    schema: 'dcf.system.state.v1',
    migration: null,
    storage_bridge: null,
    artifact_index: {}
  }
};

function normalizeRoot(value) {
  const root = deepMerge(EMPTY_ROOT, isObject(value) ? value : {});
  root.schema = EMPTY_ROOT.schema;
  root.kernel_version = VERSION;
  root.revision = Number(root.revision || 0);
  root.packages = deepMerge(EMPTY_ROOT.packages, root.packages || {});
  root.packages.packages = isObject(root.packages.packages) ? root.packages.packages : {};
  root.user = deepMerge(EMPTY_ROOT.user, root.user || {});
  root.user.content = isObject(root.user.content) ? root.user.content : { ammo: {} };
  root.user.content.ammo = isObject(root.user.content.ammo) ? root.user.content.ammo : {};
  root.user.settings = isObject(root.user.settings) ? root.user.settings : {};
  root.user.moduleDisplay = isObject(root.user.moduleDisplay) ? root.user.moduleDisplay : {};
  root.user.environmentProfiles = isObject(root.user.environmentProfiles) ? root.user.environmentProfiles : {};
  root.user.active_environment_profile = root.user.active_environment_profile || null;
  root.system = deepMerge(EMPTY_ROOT.system, root.system || {});
  root.system.artifact_index = isObject(root.system.artifact_index) ? root.system.artifact_index : {};
  root.state_hash = computeStateHash(root);
  return root;
}

function computeStateHash(root) {
  const copy = clone(root);
  delete copy.state_hash;
  delete copy.updated_at;
  return hash(copy);
}

function finalizeCandidate(previous, candidate) {
  const next = normalizeRoot(candidate);
  next.parent_revision = previous ? previous.revision : null;
  next.revision = previous ? previous.revision + 1 : Math.max(1, Number(next.revision || 0));
  next.created_at = previous && previous.created_at || next.created_at || nowIso();
  next.updated_at = nowIso();
  next.kernel_version = VERSION;
  next.packages.revision = Number(next.packages.revision || 0);
  next.user.revision = Number(next.user.revision || 0);
  next.state_hash = computeStateHash(next);
  return next;
}

function validateRoot(root) {
  const errors = [];
  if (!root || root.schema !== EMPTY_ROOT.schema) errors.push('invalid root schema');
  if (!root.packages || !isObject(root.packages.packages)) errors.push('invalid package state');
  if (!root.user || !isObject(root.user.content)) errors.push('invalid user state');
  if (!root.system || !isObject(root.system.artifact_index)) errors.push('invalid system state');
  if (!errors.length) {
    const build = buildProjection(root);
    if (!build.ok) errors.push(...build.errors);
  }
  return { ok: errors.length === 0, errors };
}

function synthesizeLegacyPack(id, revision, contributes, modules) {
  return {
    schema: 'dcf.module_pack.v1',
    pack_id: id,
    revision,
    contributes: contributes || {},
    modules: modules || []
  };
}

function addPackRevision(root, pack, source) {
  const id = String(pack.pack_id);
  const revision = String(pack.revision);
  const packHash = hash(pack);
  const current = root.packages.packages[id];
  if (current && current.revisions && current.revisions[revision]) {
    if (current.revisions[revision].hash !== packHash) throw new Error(`immutable revision conflict ${id}@${revision}`);
    return;
  }
  const entry = current || { package_id: id, enabled: true, active_revision: revision, source: clone(source || {}), revisions: {} };
  entry.revisions[revision] = { revision, hash: packHash, installed_at: nowIso(), pack: clone(pack) };
  entry.active_revision = revision;
  entry.enabled = true;
  entry.source = clone(source || entry.source || {});
  root.packages.packages[id] = entry;
  root.packages.revision += 1;
}

function migrateLegacyRegistry(registry, context = {}) {
  const root = normalizeRoot(EMPTY_ROOT);
  const source = isObject(registry) ? registry : {};
  const appearance = isObject(source.appearance) ? source.appearance : {};
  root.user.appearance.side = appearance.side || null;
  root.user.appearance.vars = clone(isObject(appearance.vars) ? appearance.vars : {});
  root.user.appearance.css = String(appearance.css || '');
  root.user.settings = clone(isObject(source.settings) ? source.settings : {});
  root.user.content = clone(isObject(source.content) ? source.content : { ammo: {} });
  root.user.content.ammo = isObject(root.user.content.ammo) ? root.user.content.ammo : {};
  root.user.moduleDisplay = clone(isObject(source.moduleDisplay) ? source.moduleDisplay : {});

  for (const module of Array.isArray(source.modules) ? source.modules : []) {
    if (!module || !module.id) continue;
    addPackRevision(root, synthesizeLegacyPack(String(module.id), String(module.version || 'legacy-1'), {
      module_display: source.moduleDisplay && source.moduleDisplay[module.id] ? { [module.id]: source.moduleDisplay[module.id] } : {}
    }, [module]), { kind: 'legacy-registry', backend: context.backend || null });
  }
  for (const surface of Object.values(isObject(source.surfaces) ? source.surfaces : {})) {
    if (!surface || !surface.id) continue;
    addPackRevision(root, synthesizeLegacyPack(`dcf.surface.${surface.id}`, 'legacy-1', { surfaces: [surface] }), { kind: 'legacy-registry', backend: context.backend || null });
  }
  for (const type of Object.values(isObject(source.contentTypes) ? source.contentTypes : {})) {
    if (!type || !type.id) continue;
    addPackRevision(root, synthesizeLegacyPack(`dcf.content-type.${type.id}`, 'legacy-1', { content_types: [type] }), { kind: 'legacy-registry', backend: context.backend || null });
  }
  root.system.migration = { from: LEGACY_KEYS.registry, backend: context.backend || null, at: nowIso() };
  return finalizeCandidate(null, root);
}

function migrateFromV10(packages, user, ops, context = {}) {
  const root = normalizeRoot(EMPTY_ROOT);
  root.packages = deepMerge(root.packages, packages || {});
  root.packages.schema = 'dcf.package.sources.v2';
  root.user = deepMerge(root.user, user || {});
  root.user.schema = 'dcf.user.state.v2';
  const legacyOps = isObject(ops) ? ops : {};
  root.system.migration = {
    from: 'dcf 0.10 source-build stores',
    backend: context.backend || null,
    at: nowIso(),
    legacy_ops_summary: {
      seen_blocks: Object.keys(isObject(legacyOps.seenBlocks) ? legacyOps.seenBlocks : {}).length,
      bad_blocks: Object.keys(isObject(legacyOps.badBlocks) ? legacyOps.badBlocks : {}).length,
      had_previous_migration: !!legacyOps.migration
    }
  };
  return finalizeCandidate(null, root);
}

function readFrom(storage, backend, key, fallback) {
  return storage && typeof storage.getFrom === 'function' ? storage.getFrom(backend, key, fallback) : storage.get(key, fallback);
}

function hasMeaningfulRoot(root) {
  if (!root) return false;
  const packageCount = Object.keys(root.packages && root.packages.packages || {}).length;
  const user = root.user || {};
  const contentCount = Object.values(user.content || {}).reduce((sum, items) => sum + Object.keys(isObject(items) ? items : {}).length, 0);
  return packageCount > 0 || contentCount > 0 || Object.keys(user.settings || {}).length > 0 || Object.keys(user.moduleDisplay || {}).length > 0 || Object.keys(user.environmentProfiles || {}).length > 0 || Object.keys(user.appearance && user.appearance.vars || {}).length > 0 || !!(user.appearance && (user.appearance.side || user.appearance.css));
}

function readLegacyRootFromBackend(storage, backend) {
  const rootValue = readFrom(storage, backend, LEGACY_KEYS.root, null);
  if (rootValue && rootValue.schema === EMPTY_ROOT.schema) return normalizeRoot(rootValue);
  const packages = readFrom(storage, backend, LEGACY_KEYS.packages, null);
  const user = readFrom(storage, backend, LEGACY_KEYS.user, null);
  const ops = readFrom(storage, backend, LEGACY_KEYS.ops, null);
  if (packages && user) return migrateFromV10(packages, user, ops, { backend });
  const registry = readFrom(storage, backend, LEGACY_KEYS.registry, null);
  if (registry && isObject(registry)) {
    const migrated = migrateLegacyRegistry(registry, { backend });
    if (hasMeaningfulRoot(migrated)) return migrated;
  }
  return null;
}

function copyMissing(target, source, recovered) {
  for (const [key, value] of Object.entries(isObject(source) ? source : {})) {
    if (Object.prototype.hasOwnProperty.call(target, key)) continue;
    target[key] = clone(value);
    recovered.push(key);
  }
}

function mergeLegacyRoot(currentRoot, legacyRoot, context = {}) {
  let candidate = clone(currentRoot);
  const recovered = { packages: [], revisions: [], settings: [], content: [], module_display: [], appearance: [] };
  const skipped = { packages: [] };

  for (const [packageId, legacyEntry] of Object.entries(legacyRoot.packages && legacyRoot.packages.packages || {})) {
    const currentEntry = candidate.packages.packages[packageId];
    if (!currentEntry) {
      const trial = clone(candidate);
      trial.packages.packages[packageId] = clone(legacyEntry);
      trial.packages.revision += 1;
      const build = buildProjection(trial);
      if (build.ok) {
        candidate = trial;
        recovered.packages.push(packageId);
      } else {
        skipped.packages.push({ package_id: packageId, errors: build.errors.slice(0, 8) });
      }
      continue;
    }
    currentEntry.revisions = isObject(currentEntry.revisions) ? currentEntry.revisions : {};
    for (const [revision, record] of Object.entries(legacyEntry.revisions || {})) {
      if (currentEntry.revisions[revision]) continue;
      currentEntry.revisions[revision] = clone(record);
      candidate.packages.revision += 1;
      recovered.revisions.push(`${packageId}@${revision}`);
    }
  }

  const currentAppearance = candidate.user.appearance || (candidate.user.appearance = clone(EMPTY_ROOT.user.appearance));
  const legacyAppearance = legacyRoot.user && legacyRoot.user.appearance || {};
  if (!currentAppearance.side && legacyAppearance.side) {
    currentAppearance.side = legacyAppearance.side;
    recovered.appearance.push('side');
  }
  copyMissing(currentAppearance.vars || (currentAppearance.vars = {}), legacyAppearance.vars, recovered.appearance);
  if (!currentAppearance.css && legacyAppearance.css) {
    currentAppearance.css = legacyAppearance.css;
    recovered.appearance.push('css');
  }
  copyMissing(candidate.user.settings || (candidate.user.settings = {}), legacyRoot.user && legacyRoot.user.settings, recovered.settings);
  copyMissing(candidate.user.moduleDisplay || (candidate.user.moduleDisplay = {}), legacyRoot.user && legacyRoot.user.moduleDisplay, recovered.module_display);
  for (const [type, items] of Object.entries(legacyRoot.user && legacyRoot.user.content || {})) {
    candidate.user.content[type] = isObject(candidate.user.content[type]) ? candidate.user.content[type] : {};
    const added = [];
    copyMissing(candidate.user.content[type], items, added);
    recovered.content.push(...added.map((id) => `${type}:${id}`));
  }

  const userRecovered = recovered.settings.length + recovered.content.length + recovered.module_display.length + recovered.appearance.length;
  if (userRecovered) candidate.user.revision += 1;
  candidate.system.storage_bridge = {
    schema: 'dcf.storage.bridge.v1',
    from_backend: context.from_backend || 'localStorage',
    to_backend: context.to_backend || null,
    at: nowIso(),
    legacy_state_hash: legacyRoot.state_hash,
    recovered,
    skipped
  };
  return finalizeCandidate(currentRoot, candidate);
}

function loadOrMigrate(storage, standardPacks) {
  const primaryBackend = storage.primaryBackend || 'primary';
  const existing = storage.get(LEGACY_KEYS.root || 'dcf.state.root.v1', null);
  let root;
  if (existing && existing.schema === EMPTY_ROOT.schema) {
    root = normalizeRoot(existing);
    if (primaryBackend !== 'localStorage' && !root.system.storage_bridge) {
      const localLegacy = readLegacyRootFromBackend(storage, 'localStorage');
      if (localLegacy && hasMeaningfulRoot(localLegacy) && localLegacy.state_hash !== root.state_hash) {
        root = mergeLegacyRoot(root, localLegacy, { from_backend: 'localStorage', to_backend: primaryBackend });
      }
    }
  } else {
    const localRoot = primaryBackend !== 'localStorage' ? readFrom(storage, 'localStorage', LEGACY_KEYS.root, null) : null;
    if (localRoot && localRoot.schema === EMPTY_ROOT.schema) {
      const normalized = normalizeRoot(localRoot);
      const candidate = clone(normalized);
      candidate.system.storage_bridge = { schema: 'dcf.storage.bridge.v1', from_backend: 'localStorage', to_backend: primaryBackend, at: nowIso(), recovered: { root: true }, skipped: { packages: [] } };
      root = finalizeCandidate(normalized, candidate);
    } else {
      root = readLegacyRootFromBackend(storage, primaryBackend);
      if (!root && primaryBackend !== 'localStorage') root = readLegacyRootFromBackend(storage, 'localStorage');
      if (!root) root = migrateLegacyRegistry({});
      if (root.system.migration && root.system.migration.backend === 'localStorage' && primaryBackend !== 'localStorage') {
        root.system.storage_bridge = { schema: 'dcf.storage.bridge.v1', from_backend: 'localStorage', to_backend: primaryBackend, at: nowIso(), recovered: { initial_migration: true }, skipped: { packages: [] } };
        root.state_hash = computeStateHash(root);
      }
    }
  }
  if (!Object.keys(root.packages.packages).length && Array.isArray(standardPacks)) {
    const candidate = clone(root);
    for (const pack of standardPacks) addPackRevision(candidate, pack, { kind: 'embedded-standard' });
    root = finalizeCandidate(root, candidate);
  }
  const userCss = String(root.user.appearance.css || '');
  const violations = styleViolations(userCss);
  if (violations.length) {
    const candidate = clone(root);
    candidate.user.appearance.css = '';
    candidate.user.revision += 1;
    candidate.system.migration = Object.assign({}, candidate.system.migration || {}, { quarantined_user_css: { at: nowIso(), violations, preview: { redacted: true, length: userCss.length, hash: hash(userCss) } } });
    root = finalizeCandidate(root, candidate);
  }
  root.state_hash = computeStateHash(root);
  return root;
}

module.exports = {
  EMPTY_ROOT,
  normalizeRoot,
  computeStateHash,
  finalizeCandidate,
  validateRoot,
  addPackRevision,
  migrateLegacyRegistry,
  migrateFromV10,
  readLegacyRootFromBackend,
  mergeLegacyRoot,
  loadOrMigrate
};