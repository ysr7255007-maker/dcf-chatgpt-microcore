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
    preferences: { ammo_fire_mode: 'insert' }
  },
  system: {
    schema: 'dcf.system.state.v1',
    migration: null,
    artifact_index: {},
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

function migrateLegacyRegistry(registry) {
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
    }, [module]), { kind: 'legacy-registry' });
  }
  for (const surface of Object.values(isObject(source.surfaces) ? source.surfaces : {})) {
    if (!surface || !surface.id) continue;
    addPackRevision(root, synthesizeLegacyPack(`dcf.surface.${surface.id}`, 'legacy-1', { surfaces: [surface] }), { kind: 'legacy-registry' });
  }
  for (const type of Object.values(isObject(source.contentTypes) ? source.contentTypes : {})) {
    if (!type || !type.id) continue;
    addPackRevision(root, synthesizeLegacyPack(`dcf.content-type.${type.id}`, 'legacy-1', { content_types: [type] }), { kind: 'legacy-registry' });
  }
  root.system.migration = { from: LEGACY_KEYS.registry, at: nowIso() };
  return finalizeCandidate(null, root);
}

function migrateFromV10(packages, user, ops) {
  const root = normalizeRoot(EMPTY_ROOT);
  root.packages = deepMerge(root.packages, packages || {});
  root.packages.schema = 'dcf.package.sources.v2';
  root.user = deepMerge(root.user, user || {});
  root.user.schema = 'dcf.user.state.v2';
  const legacyOps = isObject(ops) ? ops : {};
  root.system.migration = {
    from: 'dcf 0.10 source-build stores',
    at: nowIso(),
    legacy_ops_summary: {
      seen_blocks: Object.keys(isObject(legacyOps.seenBlocks) ? legacyOps.seenBlocks : {}).length,
      bad_blocks: Object.keys(isObject(legacyOps.badBlocks) ? legacyOps.badBlocks : {}).length,
      had_previous_migration: !!legacyOps.migration
    }
  };
  return finalizeCandidate(null, root);
}

function loadOrMigrate(storage, standardPacks) {
  const existing = storage.get(LEGACY_KEYS.root || 'dcf.state.root.v1', null);
  let root;
  if (existing && existing.schema === EMPTY_ROOT.schema) {
    root = normalizeRoot(existing);
  } else {
    const p = storage.get(LEGACY_KEYS.packages, null);
    const u = storage.get(LEGACY_KEYS.user, null);
    const o = storage.get(LEGACY_KEYS.ops, null);
    if (p && u) root = migrateFromV10(p, u, o);
    else root = migrateLegacyRegistry(storage.get(LEGACY_KEYS.registry, {}));
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
    candidate.system.migration = Object.assign({}, candidate.system.migration || {}, { quarantined_user_css: { at: nowIso(), violations, preview: userCss.slice(0, 180) } });
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
  loadOrMigrate
};
