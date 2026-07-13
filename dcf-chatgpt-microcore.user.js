// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.11.2
// @description  DCF modular runtime with storage bridge, one-click health report, visible hidden-module state, bounded reply intake and unified transactions.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==
(function(){'use strict';
const modules={
"src/core/utils.js":function(module,exports,require){
'use strict';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergeShallow(base, extra) {
  return Object.assign({}, isObject(base) ? base : {}, isObject(extra) ? extra : {});
}

function deepMerge(base, extra) {
  if (!isObject(base)) return clone(extra);
  const out = clone(base);
  if (!isObject(extra)) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

function boundedPush(list, value, limit) {
  const out = Array.isArray(list) ? list.slice() : [];
  out.push(value);
  return out.slice(-Math.max(1, Number(limit) || 1));
}

function compareRevision(a, b) {
  const tokenize = (value) => String(value || '').split(/[._-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const aa = tokenize(a);
  const bb = tokenize(b);
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) {
    const av = aa[i] == null ? 0 : aa[i];
    const bv = bb[i] == null ? 0 : bb[i];
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av > bv ? 1 : -1;
    return String(av).localeCompare(String(bv));
  }
  return 0;
}

module.exports = {
  isObject,
  clone,
  mergeShallow,
  deepMerge,
  stableStringify,
  hash,
  nowIso,
  safeId,
  boundedPush,
  compareRevision
};

},
"src/core/constants.js":function(module,exports,require){
'use strict';

const VERSION = '0.11.2';
const ROOT_KEY = 'dcf.state.root.v1';
const SNAPSHOT_KEY = 'dcf.state.snapshots.v1';
const RUNTIME_KEY = 'dcf.runtime.registry.v3';
const RECEIPT_KEY = 'dcf.receipts.v1';
const UI_KEY = 'dcf.ui.session.v1';
const CATALOG_STATE_KEY = 'dcf.catalog.state.v1';
const LEGACY_KEYS = {
  root: ROOT_KEY,
  packages: 'dcf.package.sources.v1',
  user: 'dcf.user.state.v1',
  ops: 'dcf.kernel.ops.v2',
  registry: 'dcf.kernel.registry.v1',
  state: 'dcf.kernel.state.v1',
  rollback: 'dcf.kernel.rollback.v1'
};
const CATALOG_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/catalog/index.json';

module.exports = {
  VERSION,
  ROOT_KEY,
  SNAPSHOT_KEY,
  RUNTIME_KEY,
  RECEIPT_KEY,
  UI_KEY,
  CATALOG_STATE_KEY,
  LEGACY_KEYS,
  CATALOG_URL
};

},
"src/core/resources.js":function(module,exports,require){
'use strict';

const { clone, isObject, safeId } = require("src/core/utils.js");

function normalizeClaim(address, value, provider, mode = 'exclusive', replaces = []) {
  return {
    address: String(address),
    value: clone(value),
    provider: String(provider),
    mode: mode === 'extend' ? 'extend' : 'exclusive',
    replaces: Array.isArray(replaces) ? replaces.map(String) : []
  };
}

function styleViolations(css) {
  const text = String(css || '');
  const violations = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(text))) {
    const selectors = match[1].split(',').map((s) => s.trim());
    const ownsShell = selectors.some((selector) => selector === '.sh' || selector.endsWith(' .sh') || selector.endsWith('>.sh'));
    if (!ownsShell) continue;
    const declarations = match[2].toLowerCase();
    for (const property of ['position', 'top', 'right', 'bottom', 'left', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'transform']) {
      if (new RegExp(`(^|;)\\s*${property}\\s*:`).test(declarations)) violations.push(property);
    }
  }
  return Array.from(new Set(violations));
}

function normalizePack(pack, fallbackId, fallbackRevision) {
  const source = isObject(pack) ? clone(pack) : {};
  const packageId = String(source.pack_id || source.package_id || fallbackId || '').trim();
  const revision = String(source.revision || fallbackRevision || '').trim();
  const errors = [];
  if (!packageId) errors.push('package id missing');
  if (!revision) errors.push(`package ${packageId || '<unknown>'} revision missing`);
  if (source.schema && source.schema !== 'dcf.module_pack.v1' && source.schema !== 'dcf.package.v2') {
    errors.push(`package ${packageId || '<unknown>'} unsupported schema ${source.schema}`);
  }
  const provider = `${packageId}@${revision}`;
  const claims = [];
  const styles = [];
  const replaces = Array.isArray(source.replaces) ? source.replaces.map(String) : [];
  const contributions = isObject(source.contributes) ? source.contributes : {};

  if (Array.isArray(source.resources)) {
    for (const resource of source.resources) {
      if (!resource || !resource.address) continue;
      claims.push(normalizeClaim(resource.address, resource.value, provider, resource.mode, resource.replaces || replaces));
    }
  }

  const appearance = isObject(contributions.appearance) ? contributions.appearance : {};
  if (appearance.side != null) claims.push(normalizeClaim('appearance-side', appearance.side, provider, 'exclusive', replaces));
  for (const [key, value] of Object.entries(isObject(appearance.vars) ? appearance.vars : {})) {
    claims.push(normalizeClaim(`appearance-var:${key}`, value, provider, 'exclusive', replaces));
  }
  if (appearance.css) styles.push({ source_id: provider, css: String(appearance.css) });
  for (const style of Array.isArray(contributions.styles) ? contributions.styles : []) {
    if (style && style.css) styles.push({ source_id: `${provider}:${safeId(style.id || styles.length)}`, css: String(style.css) });
  }
  for (const type of Array.isArray(contributions.content_types) ? contributions.content_types : []) {
    if (type && type.id) claims.push(normalizeClaim(`content-type:${type.id}`, type, provider, 'exclusive', replaces));
  }
  for (const surface of Array.isArray(contributions.surfaces) ? contributions.surfaces : []) {
    if (surface && surface.id) claims.push(normalizeClaim(`surface:${surface.id}`, surface, provider, 'exclusive', replaces));
  }
  for (const module of Array.isArray(source.modules) ? source.modules : []) {
    if (module && module.id) claims.push(normalizeClaim(`module:${module.id}`, module, provider, 'exclusive', replaces));
  }
  for (const [id, display] of Object.entries(isObject(contributions.module_display) ? contributions.module_display : {})) {
    claims.push(normalizeClaim(`module-display:${id}`, display, provider, 'exclusive', replaces));
  }
  for (const [key, value] of Object.entries(isObject(contributions.settings) ? contributions.settings : {})) {
    claims.push(normalizeClaim(`setting-default:${key}`, value, provider, 'exclusive', replaces));
  }
  for (const [type, items] of Object.entries(isObject(contributions.content) ? contributions.content : {})) {
    const list = Array.isArray(items) ? items : Object.values(isObject(items) ? items : {});
    for (const item of list) {
      if (item && item.id) claims.push(normalizeClaim(`content:${type}:${item.id}`, item, provider, 'exclusive', replaces));
    }
  }

  for (const style of styles) {
    const violations = styleViolations(style.css);
    if (violations.length) errors.push(`package ${packageId} style violates shell geometry ownership: ${violations.join(', ')}`);
  }

  return { ok: errors.length === 0, errors, package_id: packageId, revision, claims, styles, pack: source };
}

function resolveAddressClaims(address, addressClaims, ownership, errors) {
  if (addressClaims.length === 1) {
    const claim = addressClaims[0];
    ownership[address] = claim.provider;
    return claim;
  }

  if (addressClaims.every((claim) => claim.mode === 'extend')) {
    const first = addressClaims[0];
    const mergedValue = addressClaims.slice(1).reduce((value, claim) => {
      if (Array.isArray(value) && Array.isArray(claim.value)) return value.concat(claim.value);
      return Object.assign({}, isObject(value) ? value : {}, isObject(claim.value) ? claim.value : {});
    }, clone(first.value));
    const provider = addressClaims.map((claim) => claim.provider).sort().join('+');
    ownership[address] = provider;
    return Object.assign({}, first, { value: mergedValue, provider });
  }

  const replacers = addressClaims.filter((claim) => claim.replaces.includes(address));
  if (replacers.length === 1) {
    const replacement = replacers[0];
    ownership[address] = replacement.provider;
    return replacement;
  }

  const providers = addressClaims.map((claim) => claim.provider).sort();
  errors.push(`resource conflict ${address}: ${providers.join(' vs ')}`);
  return null;
}

function resolveClaims(allClaims, ownership, errors) {
  const grouped = new Map();
  for (const claim of allClaims) {
    if (!grouped.has(claim.address)) grouped.set(claim.address, []);
    grouped.get(claim.address).push(claim);
  }
  const resolved = new Map();
  for (const address of Array.from(grouped.keys()).sort()) {
    const claims = grouped.get(address).slice().sort((a, b) => a.provider.localeCompare(b.provider));
    const claim = resolveAddressClaims(address, claims, ownership, errors);
    if (claim) resolved.set(address, claim);
  }
  return resolved;
}

function compilePackageSet(packageState) {
  const allClaims = [];
  const ownership = {};
  const styles = [];
  const errors = [];
  const activePackages = {};
  const packages = isObject(packageState && packageState.packages) ? packageState.packages : {};
  const enabled = Object.values(packages).filter((entry) => entry && entry.enabled !== false).sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)));
  for (const entry of enabled) {
    const revision = String(entry.active_revision || '');
    const stored = entry.revisions && entry.revisions[revision];
    if (!stored || !stored.pack) {
      errors.push(`package ${entry.package_id} active revision ${revision} missing`);
      continue;
    }
    const normalized = normalizePack(stored.pack, entry.package_id, revision);
    if (!normalized.ok) {
      errors.push(...normalized.errors);
      continue;
    }
    allClaims.push(...normalized.claims);
    styles.push(...normalized.styles);
    activePackages[`${entry.package_id}@${revision}`] = {
      package_id: entry.package_id,
      revision,
      hash: stored.hash || '',
      source: clone(entry.source || {})
    };
  }
  const claims = resolveClaims(allClaims, ownership, errors);
  return { ok: errors.length === 0, errors, claims, ownership, styles, activePackages };
}

module.exports = { normalizePack, compilePackageSet, styleViolations, resolveClaims };

},
"src/core/projection.js":function(module,exports,require){
'use strict';

const { clone, deepMerge, hash, isObject } = require("src/core/utils.js");
const { compilePackageSet } = require("src/core/resources.js");

function buildProjection(root) {
  const compiled = compilePackageSet(root.packages || {});
  if (!compiled.ok) return { ok: false, errors: compiled.errors, registry: null };
  const claims = compiled.claims;
  const user = root.user || {};
  const appearanceVars = {};
  const contentTypes = {};
  const packageContent = {};
  const surfaces = {};
  const modules = [];
  const moduleDisplayDefaults = {};
  const settingDefaults = {};

  for (const [address, claim] of claims.entries()) {
    if (address === 'appearance-side') continue;
    if (address.startsWith('appearance-var:')) appearanceVars[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('content-type:')) contentTypes[address.slice(13)] = clone(claim.value);
    else if (address.startsWith('surface:')) surfaces[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('module:')) modules.push(clone(claim.value));
    else if (address.startsWith('module-display:')) moduleDisplayDefaults[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('setting-default:')) settingDefaults[address.slice(16)] = clone(claim.value);
    else if (address.startsWith('content:')) {
      const rest = address.slice(8);
      const split = rest.indexOf(':');
      if (split > 0) {
        const type = rest.slice(0, split);
        const id = rest.slice(split + 1);
        packageContent[type] = packageContent[type] || {};
        packageContent[type][id] = clone(claim.value);
      }
    }
  }

  Object.assign(appearanceVars, clone(user.appearance && user.appearance.vars || {}));
  const side = user.appearance && user.appearance.side || claims.get('appearance-side') && claims.get('appearance-side').value || 'right';
  const styleFragments = compiled.styles.slice();
  if (!(user.appearance && user.appearance.safe_mode) && user.appearance && user.appearance.css) {
    styleFragments.push({ source_id: 'user', css: String(user.appearance.css) });
  }
  const content = clone(packageContent);
  for (const [type, items] of Object.entries(isObject(user.content) ? user.content : {})) {
    content[type] = content[type] || {};
    for (const [id, item] of Object.entries(isObject(items) ? items : {})) content[type][id] = clone(item);
  }
  for (const type of Object.keys(contentTypes)) content[type] = content[type] || {};
  modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const registry = {
    schema: 'dcf.runtime.registry.v3',
    kernel_version: root.kernel_version,
    state_revision: root.revision,
    state_hash: root.state_hash,
    appearance: {
      side,
      vars: appearanceVars,
      styles: styleFragments,
      css: styleFragments.map((style) => `/* DCF source: ${style.source_id} */\n${style.css}`).join('\n')
    },
    contentTypes,
    content,
    surfaces,
    modules,
    moduleDisplay: deepMerge(moduleDisplayDefaults, user.moduleDisplay || {}),
    settings: Object.assign({}, settingDefaults, clone(user.settings || {})),
    installedPacks: compiled.activePackages,
    build: {
      schema: 'dcf.build.result.v2',
      build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership }),
      resource_ownership: compiled.ownership,
      conflicts: []
    }
  };
  return { ok: true, errors: [], registry };
}

module.exports = { buildProjection };

},
"src/core/state.js":function(module,exports,require){
'use strict';

const { VERSION, LEGACY_KEYS } = require("src/core/constants.js");
const { clone, deepMerge, hash, isObject, nowIso } = require("src/core/utils.js");
const { buildProjection } = require("src/core/projection.js");
const { styleViolations } = require("src/core/resources.js");

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
  return packageCount > 0 || contentCount > 0 || Object.keys(user.settings || {}).length > 0 || Object.keys(user.moduleDisplay || {}).length > 0 || Object.keys(user.appearance && user.appearance.vars || {}).length > 0 || !!(user.appearance && (user.appearance.side || user.appearance.css));
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
},
"src/core/artifacts.js":function(module,exports,require){
'use strict';

const { clone, hash, isObject } = require("src/core/utils.js");

const BLOCKS = [
  { marker: 'DCF_AMMO', type: 'ammo' },
  { marker: 'DCF_MODULE_PACK', type: 'package' }
];

function extractBlocks(text, marker) {
  const source = String(text || '');
  const startToken = `<<<${marker}`;
  const endToken = `${marker}>>>`;
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(startToken, cursor);
    if (start < 0) break;
    const end = source.indexOf(endToken, start + startToken.length);
    if (end < 0) break;
    const bodyStart = source.indexOf('{', start + startToken.length);
    if (bodyStart < 0 || bodyStart >= end) { cursor = end + endToken.length; continue; }
    blocks.push(source.slice(bodyStart, end).trim());
    cursor = end + endToken.length;
  }
  return blocks;
}

function normalizeAmmo(payload) {
  if (!isObject(payload) || !payload.id) throw new Error('DCF_AMMO requires id');
  const item = clone(payload);
  item.id = String(item.id);
  item.title = String(item.title || item.id);
  item.body = String(item.body || '');
  return {
    schema: 'dcf.artifact.v1',
    type: 'ammo',
    identity: `ammo:${item.id}:${hash(item)}`,
    logical_id: `ammo:${item.id}`,
    payload: item
  };
}

function normalizePackage(payload) {
  if (!isObject(payload) || !(payload.pack_id || payload.package_id) || !payload.revision) throw new Error('DCF_MODULE_PACK requires pack_id and revision');
  const pack = clone(payload);
  pack.pack_id = String(pack.pack_id || pack.package_id);
  pack.revision = String(pack.revision);
  pack.schema = pack.schema || 'dcf.module_pack.v1';
  const contentHash = hash(pack);
  return {
    schema: 'dcf.artifact.v1',
    type: 'package',
    identity: `package:${pack.pack_id}:${pack.revision}:${contentHash}`,
    logical_id: `package:${pack.pack_id}:${pack.revision}`,
    payload: pack
  };
}

function decodeArtifacts(text) {
  const artifacts = [];
  const errors = [];
  for (const block of BLOCKS) {
    for (const raw of extractBlocks(text, block.marker)) {
      const trimmed = raw.trim();
      if (!trimmed || /^(?:\.\.\.|…+|placeholder|example)$/i.test(trimmed)) continue;
      if (!trimmed.startsWith('{') || !/["'](?:schema|id|pack_id|package_id)["']\s*:/.test(trimmed)) continue;
      try {
        const payload = JSON.parse(trimmed);
        artifacts.push(block.type === 'ammo' ? normalizeAmmo(payload) : normalizePackage(payload));
      } catch (error) {
        errors.push({ marker: block.marker, error: String(error && error.message || error), preview: { redacted: true, length: raw.length, hash: hash(raw) } });
      }
    }
  }
  return { artifacts, errors };
}

module.exports = { decodeArtifacts, normalizeAmmo, normalizePackage, extractBlocks };

},
"src/core/receipts.js":function(module,exports,require){
'use strict';

const { RECEIPT_KEY } = require("src/core/constants.js");
const { boundedPush, clone, nowIso } = require("src/core/utils.js");

function createReceiptStore(storage, limit = 80) {
  function list() {
    const value = storage.get(RECEIPT_KEY, []);
    return Array.isArray(value) ? value : [];
  }
  function append(receipt) {
    const safe = clone(receipt);
    safe.at = safe.at || nowIso();
    storage.set(RECEIPT_KEY, boundedPush(list(), safe, limit));
    return safe;
  }
  function clear() {
    storage.set(RECEIPT_KEY, []);
  }
  return { list, append, clear };
}

module.exports = { createReceiptStore };

},
"src/core/transactions.js":function(module,exports,require){
'use strict';

const { ROOT_KEY, SNAPSHOT_KEY, RUNTIME_KEY } = require("src/core/constants.js");
const { clone, nowIso, boundedPush } = require("src/core/utils.js");
const { finalizeCandidate, validateRoot, addPackRevision } = require("src/core/state.js");
const { buildProjection } = require("src/core/projection.js");

function createTransactionEngine(storage, receiptStore, options = {}) {
  const snapshotLimit = Number(options.snapshotLimit || 20);
  let root = options.initialRoot;
  let registry = null;

  function persistProjection(nextRegistry) {
    registry = nextRegistry;
    storage.set(RUNTIME_KEY, nextRegistry);
  }

  function recordArtifact(candidate, identity, logicalId) {
    const index = candidate.system.artifact_index || (candidate.system.artifact_index = {});
    index[identity] = { at: nowIso(), logical_id: logicalId || identity };
    const entries = Object.entries(index);
    if (entries.length > 512) {
      entries.sort((a, b) => String(a[1].at || '').localeCompare(String(b[1].at || '')));
      for (const [key] of entries.slice(0, entries.length - 512)) delete index[key];
    }
  }

  function initialize() {
    const built = buildProjection(root);
    if (!built.ok) throw new Error(`DCF build failed at boot: ${built.errors.join('; ')}`);
    storage.set(ROOT_KEY, root);
    persistProjection(built.registry);
    return { root, registry };
  }

  function snapshots() {
    const value = storage.get(SNAPSHOT_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function saveSnapshot(value, reason) {
    const record = { at: nowIso(), reason, revision: value.revision, state_hash: value.state_hash, root: clone(value) };
    storage.set(SNAPSHOT_KEY, boundedPush(snapshots(), record, snapshotLimit));
    return record;
  }

  function transact(intent, reducer) {
    const started = Date.now();
    const previous = root;
    const candidate = clone(previous);
    let reduction;
    try {
      reduction = reducer(candidate) || {};
    } catch (error) {
      return receiptStore.append({
        schema: 'dcf.receipt.v1', receipt_id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        intent: clone(intent), status: 'rejected', stage: 'transition', error: String(error && error.message || error), duration_ms: Date.now() - started
      });
    }
    const finalized = finalizeCandidate(previous, candidate);
    const validation = validateRoot(finalized);
    if (!validation.ok) {
      return receiptStore.append({
        schema: 'dcf.receipt.v1', receipt_id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        intent: clone(intent), status: 'rejected', stage: 'validation', errors: validation.errors, previous_state_hash: previous.state_hash,
        candidate_state_hash: finalized.state_hash, duration_ms: Date.now() - started
      });
    }
    const built = buildProjection(finalized);
    if (!built.ok) {
      return receiptStore.append({
        schema: 'dcf.receipt.v1', receipt_id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        intent: clone(intent), status: 'rejected', stage: 'projection', errors: built.errors, previous_state_hash: previous.state_hash,
        candidate_state_hash: finalized.state_hash, duration_ms: Date.now() - started
      });
    }
    saveSnapshot(previous, intent.type || 'transaction');
    storage.set(ROOT_KEY, finalized);
    root = finalized;
    persistProjection(built.registry);
    const receipt = receiptStore.append({
      schema: 'dcf.receipt.v1', receipt_id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      intent: clone(intent), status: 'committed', previous_revision: previous.revision, revision: finalized.revision,
      previous_state_hash: previous.state_hash, state_hash: finalized.state_hash, build_id: built.registry.build.build_id,
      effects: clone(reduction.effects || []), observations: clone(reduction.observations || []), duration_ms: Date.now() - started
    });
    return receipt;
  }

  function installPackage(pack, source) {
    return transact({ type: 'package.install', package_id: pack.pack_id, revision: pack.revision, source }, (candidate) => {
      addPackRevision(candidate, pack, source);
      return {};
    });
  }

  function setPackageEnabled(packageId, enabled) {
    return transact({ type: enabled ? 'package.enable' : 'package.disable', package_id: packageId }, (candidate) => {
      const entry = candidate.packages.packages[packageId];
      if (!entry) throw new Error(`package ${packageId} not installed`);
      entry.enabled = !!enabled;
      candidate.packages.revision += 1;
    });
  }

  function uninstallPackage(packageId) {
    return transact({ type: 'package.uninstall', package_id: packageId }, (candidate) => {
      if (!candidate.packages.packages[packageId]) throw new Error(`package ${packageId} not installed`);
      delete candidate.packages.packages[packageId];
      candidate.packages.revision += 1;
    });
  }

  function switchPackageRevision(packageId, revision) {
    return transact({ type: 'package.switch-revision', package_id: packageId, revision }, (candidate) => {
      const entry = candidate.packages.packages[packageId];
      if (!entry || !entry.revisions || !entry.revisions[revision]) throw new Error(`package revision ${packageId}@${revision} missing`);
      entry.active_revision = revision;
      entry.enabled = true;
      candidate.packages.revision += 1;
    });
  }

  function upsertContent(type, item, artifactIdentity) {
    return transact({ type: 'content.upsert', content_type: type, content_id: item.id, artifact_identity: artifactIdentity }, (candidate) => {
      candidate.user.content[type] = candidate.user.content[type] || {};
      candidate.user.content[type][item.id] = clone(item);
      candidate.user.revision += 1;
      if (artifactIdentity) recordArtifact(candidate, artifactIdentity, `${type}:${item.id}`);
    });
  }

  function removeContent(type, id) {
    return transact({ type: 'content.remove', content_type: type, content_id: id }, (candidate) => {
      if (candidate.user.content[type]) delete candidate.user.content[type][id];
      candidate.user.revision += 1;
    });
  }

  function setUserPath(path, value) {
    return transact({ type: 'user.set', path: path.join('.') }, (candidate) => {
      let cursor = candidate.user;
      for (let i = 0; i < path.length - 1; i += 1) {
        cursor[path[i]] = cursor[path[i]] && typeof cursor[path[i]] === 'object' ? cursor[path[i]] : {};
        cursor = cursor[path[i]];
      }
      cursor[path[path.length - 1]] = clone(value);
      candidate.user.revision += 1;
    });
  }

  function applyArtifact(artifact, source) {
    if (root.system.artifact_index[artifact.identity]) {
      return receiptStore.append({
        schema: 'dcf.receipt.v1', receipt_id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        intent: { type: 'artifact.apply', artifact_identity: artifact.identity, source }, status: 'ignored', reason: 'already-applied'
      });
    }
    if (artifact.type === 'ammo') return upsertContent('ammo', artifact.payload, artifact.identity);
    if (artifact.type === 'package') {
      return transact({ type: 'artifact.apply', artifact_type: 'package', artifact_identity: artifact.identity, source }, (candidate) => {
        addPackRevision(candidate, artifact.payload, source);
        recordArtifact(candidate, artifact.identity, artifact.logical_id);
      });
    }
    return receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'artifact.apply' }, status: 'rejected', error: `unsupported artifact type ${artifact.type}` });
  }

  function rollbackTo(snapshotRevision) {
    const record = snapshots().slice().reverse().find((item) => Number(item.revision) === Number(snapshotRevision));
    if (!record) return receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'state.rollback', revision: snapshotRevision }, status: 'rejected', error: 'snapshot not found' });
    return transact({ type: 'state.rollback', revision: snapshotRevision }, (candidate) => {
      const restored = clone(record.root);
      for (const key of Object.keys(candidate)) delete candidate[key];
      Object.assign(candidate, restored);
    });
  }

  function getRoot() { return root; }
  function getRegistry() { return registry; }

  return {
    initialize,
    transact,
    installPackage,
    setPackageEnabled,
    uninstallPackage,
    switchPackageRevision,
    upsertContent,
    removeContent,
    setUserPath,
    applyArtifact,
    rollbackTo,
    snapshots,
    getRoot,
    getRegistry
  };
}

module.exports = { createTransactionEngine };

},
"src/runtime/storage.js":function(module,exports,require){
'use strict';

function createStorage(api = globalThis) {
  const memory = new Map();
  const hasGM = typeof api.GM_getValue === 'function' && typeof api.GM_setValue === 'function';
  const hasLocalStorage = !!api.localStorage;
  const primaryBackend = hasGM ? 'gm' : hasLocalStorage ? 'localStorage' : 'memory';

  function localGet(key, fallback) {
    try {
      const raw = api.localStorage && api.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function localSet(key, value) {
    if (!api.localStorage) return undefined;
    return api.localStorage.setItem(key, JSON.stringify(value));
  }

  function localRemove(key) {
    if (!api.localStorage) return undefined;
    return api.localStorage.removeItem(key);
  }

  function getFrom(backend, key, fallback) {
    try {
      if (backend === 'gm' && hasGM) return api.GM_getValue(key, fallback);
      if (backend === 'localStorage' && hasLocalStorage) return localGet(key, fallback);
      if (backend === 'memory') return memory.has(key) ? memory.get(key) : fallback;
    } catch (_) {}
    return fallback;
  }

  function setTo(backend, key, value) {
    if (backend === 'gm' && hasGM) return api.GM_setValue(key, value);
    if (backend === 'localStorage' && hasLocalStorage) return localSet(key, value);
    memory.set(key, value);
    return undefined;
  }

  function removeFrom(backend, key) {
    if (backend === 'gm' && typeof api.GM_deleteValue === 'function') return api.GM_deleteValue(key);
    if (backend === 'localStorage' && hasLocalStorage) return localRemove(key);
    memory.delete(key);
    return undefined;
  }

  function listKeys(backend) {
    try {
      if (backend === 'gm' && typeof api.GM_listValues === 'function') return api.GM_listValues().map(String);
      if (backend === 'localStorage' && hasLocalStorage) {
        const keys = [];
        for (let index = 0; index < api.localStorage.length; index += 1) {
          const key = api.localStorage.key(index);
          if (key != null) keys.push(String(key));
        }
        return keys;
      }
      if (backend === 'memory') return Array.from(memory.keys());
    } catch (_) {}
    return [];
  }

  function hasIn(backend, key) {
    const listed = listKeys(backend);
    if (listed.length || backend === 'memory') return listed.includes(String(key));
    const sentinel = { __dcf_missing__: true };
    return getFrom(backend, key, sentinel) !== sentinel;
  }

  function get(key, fallback) {
    return getFrom(primaryBackend, key, fallback);
  }

  function set(key, value) {
    return setTo(primaryBackend, key, value);
  }

  function remove(key) {
    return removeFrom(primaryBackend, key);
  }

  function dcfKeys(backend) {
    return listKeys(backend).filter((key) => /^dcf[._-]/i.test(key)).sort();
  }

  return {
    get,
    set,
    remove,
    getFrom,
    setTo,
    removeFrom,
    hasIn,
    listKeys,
    dcfKeys,
    primaryBackend,
    availableBackends: ['gm', 'localStorage', 'memory'].filter((backend) => backend === 'gm' ? hasGM : backend === 'localStorage' ? hasLocalStorage : true)
  };
}

module.exports = { createStorage };
},
"src/runtime/effects.js":function(module,exports,require){
'use strict';

const { hash } = require("src/core/utils.js");

function safeEffect(effect) {
  const copy = Object.assign({}, effect);
  if ('text' in copy) {
    const text = String(copy.text || '');
    copy.text = { redacted: true, length: text.length, hash: hash(text) };
  }
  return copy;
}

function createEffectRunner(host, receiptStore) {
  async function run(effect, context = {}) {
    const started = Date.now();
    try {
      let result;
      if (effect.type === 'composer.insert') result = await host.insertComposer(String(effect.text || ''), { send: false });
      else if (effect.type === 'composer.send') result = await host.insertComposer(String(effect.text || ''), { send: true });
      else if (effect.type === 'clipboard.write') result = await host.copy(String(effect.text || ''));
      else if (effect.type === 'notification') result = await host.notify(String(effect.text || 'DCF'));
      else throw new Error(`unsupported effect ${effect.type}`);
      receiptStore.append({ schema: 'dcf.effect.receipt.v1', effect: safeEffect(effect), context, status: 'ok', result, duration_ms: Date.now() - started });
      return { ok: true, result };
    } catch (error) {
      receiptStore.append({ schema: 'dcf.effect.receipt.v1', effect: safeEffect(effect), context, status: 'error', error: String(error && error.message || error), duration_ms: Date.now() - started });
      return { ok: false, error };
    }
  }
  return { run };
}

module.exports = { createEffectRunner };

},
"src/runtime/commands.js":function(module,exports,require){
'use strict';

const { clone, hash } = require("src/core/utils.js");

function sanitizeValue(value, key = '') {
  const lower = String(key).toLowerCase();
  if (/text|body|prompt|content|token|secret|password|authorization|cookie/.test(lower)) {
    const text = String(value == null ? '' : value);
    return { redacted: true, length: text.length, hash: hash(text) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = sanitizeValue(childValue, childKey);
    return out;
  }
  return value;
}

function commandList(module) {
  const out = [];
  for (const command of Array.isArray(module.commands) ? module.commands : []) out.push({ block: null, command });
  for (const block of Array.isArray(module.blocks) ? module.blocks : []) {
    for (const command of Array.isArray(block.commands) ? block.commands : []) out.push({ block, command });
  }
  return out;
}

function createCommandRunner(engine, effectRunner, receiptStore, shellObserver) {
  async function runStep(step, context) {
    const call = String(step.call || '');
    const args = clone(step.with || step.args || {});
    const before = {
      state_hash: engine.getRoot().state_hash,
      revision: engine.getRoot().revision,
      appearance: clone(engine.getRegistry().appearance.vars)
    };
    let result;
    if (call === 'appearance.adjust') {
      result = engine.transact({ type: 'capability.appearance.adjust', module_id: context.module_id, command_id: context.command_id }, (candidate) => {
        const vars = candidate.user.appearance.vars || (candidate.user.appearance.vars = {});
        for (const key of ['w', 'h', 'top', 'bottom']) {
          if (args[key] == null) continue;
          const current = Number.parseInt(String(vars[key] || engine.getRegistry().appearance.vars[key] || '0'), 10) || 0;
          const minimum = key === 'w' ? 240 : key === 'h' ? 300 : 0;
          vars[key] = `${Math.max(minimum, current + Number(args[key]))}px`;
        }
        if (args.offset != null) {
          const anchor = vars.anchor || engine.getRegistry().appearance.vars.anchor || 'bottom';
          const key = anchor === 'top' ? 'top' : 'bottom';
          const current = Number.parseInt(String(vars[key] || engine.getRegistry().appearance.vars[key] || (key === 'top' ? '12px' : '112px')), 10) || 0;
          vars[key] = `${Math.max(0, current + Number(args.offset))}px`;
        }
        if (args.anchor) vars.anchor = args.anchor === 'top' ? 'top' : 'bottom';
        if (args.side === 'toggle') candidate.user.appearance.side = engine.getRegistry().appearance.side === 'left' ? 'right' : 'left';
        else if (args.side) candidate.user.appearance.side = args.side === 'left' ? 'left' : 'right';
        candidate.user.revision += 1;
      });
    } else if (call === 'appearance.set') {
      result = engine.transact({ type: 'capability.appearance.set', module_id: context.module_id, command_id: context.command_id }, (candidate) => {
        if (args.side) candidate.user.appearance.side = args.side === 'left' ? 'left' : 'right';
        for (const [key, value] of Object.entries(args.vars || {})) candidate.user.appearance.vars[key] = value;
        candidate.user.revision += 1;
      });
    } else if (call === 'settings.set') {
      if (!args.key) throw new Error('settings.set requires key');
      result = engine.setUserPath(['settings', String(args.key)], args.value);
    } else if (call === 'content.upsert') {
      result = engine.upsertContent(String(args.type || 'ammo'), args.item || {}, null);
    } else if (call === 'content.remove') {
      result = engine.removeContent(String(args.type || 'ammo'), String(args.id || ''));
    } else if (call === 'composer.replace' || call === 'composer.insert') {
      result = await effectRunner.run({ type: 'composer.insert', text: String(args.text || '') }, context);
    } else if (call === 'composer.send') {
      result = await effectRunner.run({ type: 'composer.send', text: String(args.text || '') }, context);
    } else if (call === 'clipboard.write') {
      result = await effectRunner.run({ type: 'clipboard.write', text: String(args.text || '') }, context);
    } else if (call === 'notification.show') {
      result = await effectRunner.run({ type: 'notification', text: String(args.text || '') }, context);
    } else {
      throw new Error(`unknown capability ${call}`);
    }
    const after = {
      state_hash: engine.getRoot().state_hash,
      revision: engine.getRoot().revision,
      appearance: clone(engine.getRegistry().appearance.vars),
      shell: typeof shellObserver === 'function' ? shellObserver() : null
    };
    return { call, input: sanitizeValue(args), before, after, result: sanitizeValue(result, 'result') };
  }

  async function execute(module, command, block) {
    const context = { module_id: module.id, module_version: module.version || null, block_id: block && block.id || null, command_id: command.id };
    const trace = {
      schema: 'dcf.command.receipt.v3',
      trace_id: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      context,
      status: 'running',
      steps: []
    };
    try {
      for (const step of Array.isArray(command.steps) ? command.steps : []) trace.steps.push(await runStep(step, context));
      trace.status = 'ok';
    } catch (error) {
      trace.status = 'error';
      trace.error = String(error && error.message || error);
    }
    receiptStore.append(trace);
    return trace;
  }

  return { execute, commandList, sanitizeValue };
}

module.exports = { createCommandRunner, commandList, sanitizeValue };

},
"src/host/chatgpt.js":function(module,exports,require){
'use strict';

const { nowIso } = require("src/core/utils.js");

function createChatGPTHost(windowObject = window, options = {}) {
  const doc = windowObject.document;
  const quietMs = Number(options.quietMs || 900);
  const recoveryCount = Number(options.recoveryCount || 3);
  let rootObserver = null;
  let observedRoot = null;
  let activeObserver = null;
  let activeNode = null;
  let quietTimer = null;
  let onReplyComplete = null;
  let lastUrl = String(windowObject.location && windowObject.location.href || '');
  let urlTimer = null;
  let rootLocatorTimer = null;
  const processedNodes = new WeakSet();

  function normalizeAssistantNode(node) {
    if (!(node instanceof windowObject.Element)) return null;
    if (node.matches('[data-message-author-role="assistant"]')) return node.closest('article') || node;
    if (node.tagName === 'ARTICLE') {
      if (node.querySelector(':scope > [data-message-author-role="user"]')) return null;
      if (node.querySelector(':scope [data-message-author-role="assistant"]')) return node;
      const testId = node.getAttribute('data-testid') || '';
      if (/conversation-turn/i.test(testId) && !node.querySelector(':scope [data-message-author-role="user"]')) return node;
    }
    return null;
  }

  function findConversationRoot() {
    return doc.querySelector('main') || doc.querySelector('[role="main"]') || null;
  }

  function findRecentAssistantNodes(root, limit = recoveryCount) {
    const found = [];
    const hardVisitLimit = 5000;
    let visits = 0;
    let node = root && root.lastElementChild;

    function deepestLast(element) {
      let cursor = element;
      while (cursor && cursor.lastElementChild) cursor = cursor.lastElementChild;
      return cursor;
    }

    node = deepestLast(node);
    while (node && node !== root && found.length < limit && visits < hardVisitLimit) {
      visits += 1;
      const normalized = normalizeAssistantNode(node);
      if (normalized && !found.includes(normalized)) found.push(normalized);
      if (node.previousElementSibling) node = deepestLast(node.previousElementSibling);
      else node = node.parentElement;
    }
    return found;
  }

  function isStreaming() {
    return !!doc.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"]');
  }

  function readReplyText(node) {
    if (!node) return '';
    const content = node.querySelector('[data-message-author-role="assistant"]') || node;
    return String(content.textContent || '').trim();
  }

  function disconnectActive() {
    if (activeObserver) activeObserver.disconnect();
    activeObserver = null;
    activeNode = null;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
  }

  function scheduleCompletion(node, source) {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      if (!node.isConnected) {
        disconnectActive();
        return;
      }
      if (isStreaming()) {
        scheduleCompletion(node, source);
        return;
      }
      const text = readReplyText(node);
      disconnectActive();
      if (!text || processedNodes.has(node)) return;
      processedNodes.add(node);
      if (typeof onReplyComplete === 'function') onReplyComplete({ node, text, source, completed_at: nowIso() });
    }, quietMs);
  }

  function trackReply(node, source = 'live') {
    const normalized = normalizeAssistantNode(node);
    if (!normalized || processedNodes.has(normalized)) return;
    if (activeNode === normalized) {
      scheduleCompletion(normalized, source);
      return;
    }
    disconnectActive();
    activeNode = normalized;
    activeObserver = new windowObject.MutationObserver(() => scheduleCompletion(normalized, source));
    activeObserver.observe(normalized, { childList: true, subtree: true, characterData: true });
    scheduleCompletion(normalized, source);
  }

  function inspectAddedNode(node) {
    if (!(node instanceof windowObject.Element)) return;
    const normalized = normalizeAssistantNode(node);
    if (normalized) {
      trackReply(normalized, 'live');
      return;
    }
    const nested = node.querySelector('[data-message-author-role="assistant"]');
    if (nested) trackReply(nested, 'live');
  }

  function attachReplyRoot(root) {
    if (!root || rootObserver) return false;
    observedRoot = root;
    rootObserver = new windowObject.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) inspectAddedNode(node);
      }
    });
    rootObserver.observe(root, { childList: true, subtree: true });

    const newestFirst = findRecentAssistantNodes(root, recoveryCount);
    const recent = newestFirst.slice().reverse();
    for (let index = 0; index < recent.length; index += 1) {
      const node = recent[index];
      const isNewest = index === recent.length - 1;
      if (isNewest && isStreaming()) {
        trackReply(node, 'recovered-stream');
        continue;
      }
      const text = readReplyText(node);
      if (text && typeof onReplyComplete === 'function') {
        processedNodes.add(node);
        onReplyComplete({ node, text, source: 'bounded-recovery', completed_at: nowIso() });
      }
    }
    return true;
  }

  function scheduleRootAttach() {
    if (rootObserver || rootLocatorTimer) return;
    const attempt = () => {
      rootLocatorTimer = null;
      if (attachReplyRoot(findConversationRoot())) return;
      rootLocatorTimer = windowObject.setTimeout(attempt, 600);
    };
    attempt();
  }

  function startReplyObserver(callback) {
    onReplyComplete = callback;
    scheduleRootAttach();
    urlTimer = windowObject.setInterval(() => {
      const href = String(windowObject.location && windowObject.location.href || '');
      if (href === lastUrl) return;
      lastUrl = href;
      stopReplyObserver();
      startReplyObserver(callback);
    }, 1200);
    return () => stopReplyObserver();
  }

  function stopReplyObserver() {
    if (rootObserver) rootObserver.disconnect();
    rootObserver = null;
    observedRoot = null;
    disconnectActive();
    if (urlTimer) windowObject.clearInterval(urlTimer);
    urlTimer = null;
    if (rootLocatorTimer) windowObject.clearTimeout(rootLocatorTimer);
    rootLocatorTimer = null;
  }

  function composer() {
    return doc.querySelector('#prompt-textarea,[contenteditable="true"][data-placeholder],textarea[data-id="root"]');
  }

  function setComposerText(element, text) {
    element.focus();
    if (element.tagName === 'TEXTAREA') {
      element.value = text;
      element.dispatchEvent(new windowObject.Event('input', { bubbles: true }));
      return;
    }
    element.textContent = text;
    element.dispatchEvent(new windowObject.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  async function insertComposer(text, options = {}) {
    const element = composer();
    if (!element) throw new Error('ChatGPT composer not found');
    const existing = String(element.value || element.textContent || '').trim();
    if (existing && existing !== text) throw new Error('composer contains an existing draft');
    setComposerText(element, text);
    if (!options.send) return { inserted: true, sent: false };
    await new Promise((resolve) => windowObject.setTimeout(resolve, 80));
    const button = doc.querySelector('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
    if (!button || button.disabled) throw new Error('ChatGPT send button not available');
    button.click();
    return { inserted: true, sent: true };
  }

  async function copy(text) {
    if (typeof globalThis.GM_setClipboard === 'function') {
      globalThis.GM_setClipboard(text);
      return { copied: true, method: 'GM_setClipboard' };
    }
    if (windowObject.navigator && windowObject.navigator.clipboard) {
      await windowObject.navigator.clipboard.writeText(text);
      return { copied: true, method: 'clipboard' };
    }
    throw new Error('clipboard unavailable');
  }

  async function notify(text) {
    if (typeof globalThis.GM_notification === 'function') {
      globalThis.GM_notification({ title: 'DCF', text });
      return { notified: true };
    }
    return { notified: false };
  }

  function routeKind() {
    const pathname = String(windowObject.location && windowObject.location.pathname || '/');
    if (/^\/c\/[^/]+/.test(pathname)) return '/c/:conversation';
    if (/^\/g\/[^/]+\/c\/[^/]+/.test(pathname)) return '/g/:gpt/c/:conversation';
    return pathname.replace(/[0-9a-f]{8,}/gi, ':id');
  }

  function diagnostics() {
    const root = findConversationRoot();
    const input = composer();
    const sendButton = doc.querySelector('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="发送"]');
    return {
      schema: 'dcf.host.diagnostics.v1',
      origin: String(windowObject.location && windowObject.location.origin || ''),
      route_kind: routeKind(),
      conversation_root_found: !!root,
      reply_root_observer_attached: !!rootObserver,
      observed_root_connected: !!(observedRoot && observedRoot.isConnected),
      active_reply_tracked: !!activeNode,
      active_reply_connected: !!(activeNode && activeNode.isConnected),
      streaming: isStreaming(),
      composer_found: !!input,
      composer_has_draft: !!(input && String(input.value || input.textContent || '').trim()),
      send_button_found: !!sendButton,
      send_button_enabled: !!(sendButton && !sendButton.disabled),
      observer_scope: 'conversation-root-added-nodes + current-reply',
      recovery_count: recoveryCount,
      quiet_ms: quietMs,
      root_locator_pending: !!rootLocatorTimer,
      url_watch_active: !!urlTimer
    };
  }

  return {
    startReplyObserver,
    stopReplyObserver,
    findConversationRoot,
    findRecentAssistantNodes,
    readReplyText,
    insertComposer,
    copy,
    notify,
    isStreaming,
    diagnostics
  };
}

module.exports = { createChatGPTHost };
},
"src/modules/standard-packages.js":function(module,exports,require){
'use strict';

const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo'];

const STANDARD_PACKS = [
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.ammo',
    revision: '1.0.0',
    contributes: {
      content_types: [{ id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy', 'update', 'delete'] }],
      surfaces: [{ id: 'dcf.ammo', title: '弹药', area: 'primary', order: 10, kind: 'content-list', content_type: 'ammo' }],
      appearance: { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } }
    },
    modules: [{ id: 'dcf.ammo.module', title: '语言弹药', version: '1.0.0', kind: 'ammo' }]
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.shell-adjuster',
    revision: '1.0.0',
    modules: [{ id: 'dcf.standard.shell-adjuster', title: '壳体调节', version: '1.0.0', kind: 'shell-adjuster', blocks: [{ id: 'geometry', title: '壳体几何', commands: [
      { id: 'width_minus', label: '窄', steps: [{ call: 'appearance.adjust', with: { w: -20 } }] },
      { id: 'width_plus', label: '宽', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] },
      { id: 'height_minus', label: '矮', steps: [{ call: 'appearance.adjust', with: { h: -40 } }] },
      { id: 'height_plus', label: '高', steps: [{ call: 'appearance.adjust', with: { h: 40 } }] },
      { id: 'offset_minus', label: '靠近边缘', steps: [{ call: 'appearance.adjust', with: { offset: -10 } }] },
      { id: 'offset_plus', label: '远离边缘', steps: [{ call: 'appearance.adjust', with: { offset: 10 } }] },
      { id: 'top', label: '贴顶', steps: [{ call: 'appearance.adjust', with: { anchor: 'top' } }] },
      { id: 'bottom', label: '贴底', steps: [{ call: 'appearance.adjust', with: { anchor: 'bottom' } }] },
      { id: 'side', label: '换边', steps: [{ call: 'appearance.adjust', with: { side: 'toggle' } }] }
    ]}] }],
    contributes: { module_display: { 'dcf.standard.shell-adjuster': { area: 'maintenance', order: 20 } } }
  }
];

module.exports = { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES };

},
"src/modules/ammo.js":function(module,exports,require){
'use strict';

function createAmmoModule(engine, effectRunner) {
  function items() {
    const registry = engine.getRegistry();
    return Object.values(registry.content && registry.content.ammo || {}).sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
  }

  function fire(item) {
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    return effectRunner.run({ type: mode === 'send' ? 'composer.send' : 'composer.insert', text: String(item.body || '') }, { module: 'ammo', item_id: item.id });
  }

  function copy(item) {
    return effectRunner.run({ type: 'clipboard.write', text: String(item.body || '') }, { module: 'ammo', item_id: item.id });
  }

  function requestUpdate(item) {
    const prompt = [
      '请根据当前对话更新下面这条 DCF 语言弹药。',
      '保留相同 id，返回且只返回一份完整的 DCF_AMMO 工件；DCF 会在回复完成后自动装填。',
      '',
      JSON.stringify(item, null, 2)
    ].join('\n');
    return effectRunner.run({ type: 'composer.send', text: prompt }, { module: 'ammo', action: 'update', item_id: item.id });
  }

  function requestExtract() {
    const prompt = [
      '请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。',
      '返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
    ].join('\n');
    return effectRunner.run({ type: 'composer.send', text: prompt }, { module: 'ammo', action: 'extract' });
  }

  return { items, fire, copy, requestUpdate, requestExtract };
}

module.exports = { createAmmoModule };

},
"src/modules/catalog.js":function(module,exports,require){
'use strict';

const { CATALOG_URL, CATALOG_STATE_KEY } = require("src/core/constants.js");
const { compareRevision, hash, nowIso } = require("src/core/utils.js");
const { normalizePackage } = require("src/core/artifacts.js");

function createCatalogTransport(storage, engine, api = globalThis) {
  function requestJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof api.GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest unavailable'));
      api.GM_xmlhttpRequest({
        method: 'GET', url,
        onload(response) {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`HTTP ${response.status}`));
          try { resolve(JSON.parse(response.responseText)); } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('network timeout'))
      });
    });
  }

  async function check(options = {}) {
    const currentState = storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null });
    const minInterval = Number(options.minIntervalMs || 6 * 60 * 60 * 1000);
    if (!options.force && currentState.last_checked_at && Date.now() - Date.parse(currentState.last_checked_at) < minInterval) {
      return { ok: true, skipped: true, reason: 'interval' };
    }
    try {
      const catalog = await requestJson(options.url || CATALOG_URL);
      if (!catalog || catalog.schema !== 'dcf.catalog.v1' || !Array.isArray(catalog.packages)) throw new Error('invalid catalog');
      const installed = engine.getRoot().packages.packages;
      const applied = [];
      for (const entry of catalog.packages) {
        const local = installed[entry.package_id];
        if (!local || local.enabled === false) continue;
        if (compareRevision(entry.revision, local.active_revision) <= 0) continue;
        const pack = await requestJson(entry.url);
        const expected = String(entry.hash || '');
        const actual = hash(pack);
        if (expected && expected !== actual) throw new Error(`catalog hash mismatch ${entry.package_id}@${entry.revision}`);
        const artifact = normalizePackage(pack);
        const receipt = engine.applyArtifact(artifact, { kind: 'github-catalog', url: entry.url });
        applied.push({ package_id: entry.package_id, revision: entry.revision, status: receipt.status });
      }
      const result = { ok: true, skipped: false, applied };
      storage.set(CATALOG_STATE_KEY, { last_checked_at: nowIso(), last_result: result });
      return result;
    } catch (error) {
      const result = { ok: false, error: String(error && error.message || error) };
      storage.set(CATALOG_STATE_KEY, { last_checked_at: nowIso(), last_result: result });
      return result;
    }
  }

  return { check };
}

module.exports = { createCatalogTransport };

},
"src/modules/package-manager.js":function(module,exports,require){
'use strict';

const { decodeArtifacts } = require("src/core/artifacts.js");
const { REQUIRED_PRODUCT_PACKAGES } = require("src/modules/standard-packages.js");

function createPackageManager(engine, catalog) {
  function packages() {
    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)));
  }
  function installJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    const wrapper = `<<<DCF_MODULE_PACK\n${JSON.stringify(parsed)}\nDCF_MODULE_PACK>>>`;
    const decoded = decodeArtifacts(wrapper);
    if (decoded.errors.length || decoded.artifacts.length !== 1) throw new Error(decoded.errors[0] && decoded.errors[0].error || 'invalid package');
    return engine.applyArtifact(decoded.artifacts[0], { kind: 'manual-json' });
  }
  function assertMutable(id) {
    if (REQUIRED_PRODUCT_PACKAGES.includes(String(id))) throw new Error(`${id} is required by the DCF product value loop`);
  }
  return {
    packages,
    installJson,
    setEnabled: (id, enabled) => { if (!enabled) assertMutable(id); return engine.setPackageEnabled(id, enabled); },
    uninstall: (id) => { assertMutable(id); return engine.uninstallPackage(id); },
    switchRevision: (id, revision) => engine.switchPackageRevision(id, revision),
    checkUpdates: (force) => catalog.check({ force: !!force }),
    isRequired: (id) => REQUIRED_PRODUCT_PACKAGES.includes(String(id))
  };
}

module.exports = { createPackageManager };

},
"src/modules/health.js":function(module,exports,require){
'use strict';

const { VERSION, ROOT_KEY, SNAPSHOT_KEY, RUNTIME_KEY, RECEIPT_KEY, CATALOG_STATE_KEY, LEGACY_KEYS } = require("src/core/constants.js");
const { computeStateHash, validateRoot } = require("src/core/state.js");
const { hash, isObject, nowIso } = require("src/core/utils.js");
const { commandList } = require("src/runtime/commands.js");

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
    const hiddenModuleIds = (registry.modules || []).filter((module) => registry.moduleDisplay && registry.moduleDisplay[module.id] && registry.moduleDisplay[module.id].hidden === true).map((module) => String(module.id)).sort();
    const localLegacy = legacyInventory(storage, 'localStorage');
    const gmInventory = legacyInventory(storage, 'gm');
    const missingLegacyModules = localLegacy.module_ids.filter((id) => !currentModuleIds.includes(id));
    const missingLegacyPackages = localLegacy.package_ids.filter((id) => !currentPackageIds.includes(id));
    const hiddenLegacyModules = localLegacy.module_ids.filter((id) => hiddenModuleIds.includes(id));
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

    addCheck('ui.hidden-modules', hiddenModuleIds.length ? 'info' : 'ok', hiddenModuleIds.length ? `${hiddenModuleIds.length} 个模块已安装但处于隐藏状态` : '没有隐藏模块', {
      hidden_module_ids: hiddenModuleIds,
      hidden_legacy_module_ids: hiddenLegacyModules
    });

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
        visible_module_count: currentModuleIds.length - hiddenModuleIds.length,
        hidden_module_count: hiddenModuleIds.length,
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
        hidden_legacy_module_ids: hiddenLegacyModules,
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

},
"src/modules/maintenance.js":function(module,exports,require){
'use strict';

const { CATALOG_STATE_KEY } = require("src/core/constants.js");

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
},
"src/ui/app.js":function(module,exports,require){
'use strict';

const { commandList } = require("src/runtime/commands.js");

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function computeFenceStyle(rect, viewport, margin = 12) {
  const originLeft = Number(viewport.left || 0);
  const originTop = Number(viewport.top || 0);
  const width = Math.min(Math.max(240, rect.width || 340), Math.max(240, viewport.width - margin * 2));
  const height = Math.min(Math.max(260, rect.height || 600), Math.max(260, viewport.height - margin * 2));
  const left = Math.min(Math.max(originLeft + margin, rect.left), Math.max(originLeft + margin, originLeft + viewport.width - width - margin));
  const top = Math.min(Math.max(originTop + margin, rect.top), Math.max(originTop + margin, originTop + viewport.height - height - margin));
  return { width, height, left, top };
}

function createApp(options) {
  const { engine, ammo, packageManager, maintenance, commandRunner, storage, version } = options;
  const doc = options.document || document;
  const windowObject = doc.defaultView || window;
  const hostElement = doc.createElement('div');
  hostElement.id = 'dcf-chatgpt-microcore-host';
  const root = hostElement.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style id="core-style">
      :host{all:initial}.sh{position:fixed;right:12px;bottom:var(--bottom,112px);top:auto;width:var(--w,340px);height:min(var(--h,800px),calc(100vh - 24px));z-index:2147483646;background:#fffffff2;color:#111;border:1px solid #9996;border-radius:14px;box-shadow:0 18px 44px #0002;font:13px system-ui;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column}
      .sh[data-side=left]{left:12px;right:auto}.sh[data-anchor=top]{top:var(--top,12px);bottom:auto}.sh[data-anchor=bottom]{bottom:var(--bottom,112px);top:auto}
      @media(prefers-color-scheme:dark){.sh{background:#171717ee;color:#eee}}
      button{border:1px solid #9995;border-radius:9px;background:transparent;color:inherit;padding:6px 8px;cursor:pointer}button:hover{background:#8882}button.danger{border-color:#dc262666}.top{height:42px;flex:0 0 42px;display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #9993;box-sizing:border-box}.top b{margin-right:auto}.tabs{display:flex;gap:5px}.tabs button.on{background:#2563eb22;border-color:#2563eb66}.body{flex:1;min-height:0;overflow:auto;padding:9px;box-sizing:border-box}.card{border:1px solid #9994;border-radius:12px;background:#8881;padding:9px;margin-bottom:9px;box-sizing:border-box}.name{font-weight:700}.mini{font-size:11px;opacity:.7;word-break:break-all}.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}textarea,input,select{width:100%;box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:7px}textarea{min-height:120px}.notice{padding:6px 9px;border-bottom:1px solid #9993;font-size:12px}.notice:empty{display:none}.row{display:flex;gap:6px;align-items:center}.row>*{min-width:0}.grow{flex:1}.pkg{padding-top:8px;margin-top:8px;border-top:1px solid #9993}.receipt{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.health-ok{border-color:#16a34a66}.health-warning{border-color:#d9770666}.health-error{border-color:#dc262666}.state-pill{font-size:10px;padding:2px 6px;border:1px solid #9995;border-radius:999px}.state-pill.hidden{border-color:#d9770666}.state-pill.visible{border-color:#16a34a66}
    </style><style id="package-style"></style><aside class="sh"><div class="top"></div><div class="notice"></div><div class="body"></div></aside>`;
  doc.documentElement.appendChild(hostElement);
  const shell = root.querySelector('.sh');
  const top = root.querySelector('.top');
  const body = root.querySelector('.body');
  const notice = root.querySelector('.notice');
  const packageStyle = root.querySelector('#package-style');
  let tab = storage.get('dcf.ui.session.v1', { tab: 'ammo' }).tab || 'ammo';
  let packageDraft = '';
  let selectedSurface = storage.get('dcf.ui.session.v1', { selectedSurface: null }).selectedSurface || null;
  let fenceFrame = 0;

  function setNotice(text) {
    notice.textContent = String(text || '');
    if (text) windowObject.setTimeout(() => { if (notice.textContent === text) notice.textContent = ''; }, 3200);
  }

  function runAndRender(action, successText) {
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        result.then((value) => {
          const failed = value && (value.ok === false || value.status === 'error' || value.status === 'rejected');
          setNotice(failed ? `操作失败${value.error ? `：${value.error}` : ''}` : successText);
          render();
        }).catch((error) => setNotice(`失败：${String(error && error.message || error)}`));
      } else {
        setNotice(result && result.status === 'rejected' ? `失败：${result.error || (result.errors || []).join('; ')}` : successText);
        render();
      }
    } catch (error) {
      setNotice(`失败：${String(error && error.message || error)}`);
    }
  }

  function renderTop() {
    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class="tabs">
      <button data-tab="ammo" class="${tab === 'ammo' ? 'on' : ''}">弹药</button>
      <button data-tab="functions" class="${tab === 'functions' ? 'on' : ''}">功能</button><button data-tab="packages" class="${tab === 'packages' ? 'on' : ''}">模块</button>
      <button data-tab="maintenance" class="${tab === 'maintenance' ? 'on' : ''}">维护</button>
    </div>`;
  }

  function renderAmmo() {
    const items = ammo.items();
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    body.innerHTML = `<div class="card"><div class="name">语言弹药</div><div class="mini">自动提取、自动装填、更新与发射</div><div class="actions"><button data-action="ammo-extract">从当前对话提取</button><button data-action="ammo-mode">发射：${mode === 'send' ? '直接发送' : '填入输入框'}</button></div></div>` +
      (items.length ? items.map((item) => `<div class="card" data-ammo-id="${escapeHtml(item.id)}"><div class="name">${escapeHtml(item.title || item.id)}</div><div class="mini">${escapeHtml(item.purpose || item.id)}</div><div class="actions"><button data-action="ammo-fire">发射</button><button data-action="ammo-copy">复制</button><button data-action="ammo-update">更新</button><button data-action="ammo-delete" class="danger">删除</button></div></div>`).join('') : '<div class="card mini">弹药库为空。完成一次提取后，回复中的 DCF_AMMO 会自动装填。</div>');
  }

  function moduleDisplay(module) {
    return engine.getRegistry().moduleDisplay && engine.getRegistry().moduleDisplay[module.id] || {};
  }

  function moduleArea(module) {
    const display = moduleDisplay(module);
    return display.area || module.area || 'work';
  }

  function moduleOrder(module) {
    const display = moduleDisplay(module);
    return Number(display.order != null ? display.order : module.order != null ? module.order : 1000);
  }

  function isModuleHidden(module) {
    return moduleDisplay(module).hidden === true;
  }

  function visibleModules(modules) {
    return modules.filter((module) => !isModuleHidden(module)).sort((a, b) => moduleOrder(a) - moduleOrder(b) || String(a.id).localeCompare(String(b.id)));
  }

  function renderModuleCards(modules) {
    modules = visibleModules(modules);
    if (!modules.length) return '<div class="card mini">暂无可见模块功能</div>';
    return modules.map((module) => {
      const display = moduleDisplay(module);
      const entries = commandList(module);
      const grouped = [];
      for (const entry of entries) {
        const blockTitle = entry.block && entry.block.title;
        if (blockTitle && !grouped.includes(blockTitle)) grouped.push(blockTitle);
      }
      return `<div class="card" data-module-id="${escapeHtml(module.id)}"><div class="name">${escapeHtml(display.title || module.title || module.id)}</div><div class="mini">${escapeHtml(module.version || '')} · ${escapeHtml(module.id)}</div>${grouped.length ? `<div class="mini">${grouped.map(escapeHtml).join(' · ')}</div>` : ''}<div class="actions">${entries.map((entry) => `<button data-action="module-command" data-module-id="${escapeHtml(module.id)}" data-command-id="${escapeHtml(entry.command.id)}">${escapeHtml(entry.command.label || entry.command.title || entry.command.id)}</button>`).join('') || '<span class="mini">无可执行命令</span>'}</div></div>`;
    }).join('');
  }

  function hiddenModules() {
    return engine.getRegistry().modules.filter((module) => module.kind !== 'ammo' && isModuleHidden(module)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function renderVisibilityManager() {
    const modules = engine.getRegistry().modules.filter((module) => module.kind !== 'ammo').slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const hidden = modules.filter(isModuleHidden);
    const rows = modules.map((module) => {
      const hiddenState = isModuleHidden(module);
      const display = moduleDisplay(module);
      return `<div class="pkg row" data-visibility-module-id="${escapeHtml(module.id)}"><span class="grow"><span class="name">${escapeHtml(display.title || module.title || module.id)}</span><br><span class="mini">${escapeHtml(module.id)} · ${escapeHtml(module.version || '')}</span></span><span class="state-pill ${hiddenState ? 'hidden' : 'visible'}">${hiddenState ? '隐藏' : '显示'}</span><button data-action="module-visibility-toggle" data-module-id="${escapeHtml(module.id)}">${hiddenState ? '恢复显示' : '隐藏'}</button></div>`;
    }).join('');
    return `<div class="card"><div class="name">模块显示状态</div><div class="mini">已安装不等于当前显示。隐藏模块仍在运行态中，不会丢失；这里可以明确查看并恢复显示。</div><div class="actions">${hidden.length ? `<button data-action="module-show-all-hidden">全部恢复显示（${hidden.length}）</button>` : '<span class="mini">当前没有隐藏模块</span>'}</div>${rows}</div>`;
  }

  function renderFunctions() {
    const registry = engine.getRegistry();
    const hidden = hiddenModules();
    const surfaces = Object.values(registry.surfaces || {}).filter((surface) => surface.id !== 'dcf.ammo' && surface.content_type !== 'ammo' && surface.area !== 'maintenance').sort((a, b) => Number(a.order || 1000) - Number(b.order || 1000));
    if (surfaces.length && !surfaces.some((surface) => surface.id === selectedSurface)) selectedSurface = surfaces[0].id;
    const surface = surfaces.find((entry) => entry.id === selectedSurface) || null;
    const modules = registry.modules.filter((module) => {
      if (module.kind === 'ammo' || moduleArea(module) === 'maintenance') return false;
      if (!surface) return true;
      const display = moduleDisplay(module);
      if (display.surface_id || module.surface_id) return (display.surface_id || module.surface_id) === surface.id;
      return !surface.area || moduleArea(module) === surface.area;
    });
    const hiddenNotice = hidden.length ? `<div class="card health-warning"><div class="name">${hidden.length} 个模块已安装但隐藏</div><div class="mini">它们没有丢失，只是不进入当前功能视图。</div><div class="actions"><button data-action="module-visibility-open">管理显示状态</button><button data-action="module-show-all-hidden">全部恢复显示</button></div></div>` : '';
    const rail = surfaces.length ? `<div class="card actions">${surfaces.map((entry) => `<button data-action="surface-select" data-surface-id="${escapeHtml(entry.id)}" class="${entry.id === selectedSurface ? 'on' : ''}">${escapeHtml(entry.title || entry.id)}</button>`).join('')}</div>` : '';
    body.innerHTML = hiddenNotice + rail + renderModuleCards(modules);
  }

  function renderPackages() {
    const entries = packageManager.packages();
    body.innerHTML = `<div class="card"><div class="name">安装模块包</div><div class="mini">粘贴完整 dcf.module_pack.v1 JSON；对话与 GitHub 更新仍会自动进入同一事务。</div><textarea data-role="package-json">${escapeHtml(packageDraft)}</textarea><div class="actions"><button data-action="package-install">安装</button><button data-action="package-update">检查 GitHub 更新</button></div></div>` + entries.map((entry) => {
      const revisions = Object.keys(entry.revisions || {}).sort();
      const required = packageManager.isRequired(entry.package_id);
      return `<div class="card"><div class="name">${escapeHtml(entry.package_id)}${required ? ' · 核心' : ''}</div><div class="mini">active ${escapeHtml(entry.active_revision)} · ${entry.enabled === false ? 'disabled' : 'enabled'}</div><div class="actions">${required ? '' : `<button data-action="package-toggle" data-id="${escapeHtml(entry.package_id)}">${entry.enabled === false ? '启用' : '停用'}</button>`}<select data-role="package-revision" data-id="${escapeHtml(entry.package_id)}">${revisions.map((revision) => `<option ${revision === entry.active_revision ? 'selected' : ''}>${escapeHtml(revision)}</option>`).join('')}</select><button data-action="package-switch" data-id="${escapeHtml(entry.package_id)}">切换</button>${required ? '' : `<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">卸载</button>`}</div></div>`;
    }).join('');
  }

  function renderMaintenance() {
    const summary = maintenance.summary();
    const health = maintenance.healthReport();
    const issues = (health.checks || []).filter((item) => item.status !== 'ok');
    const receipts = maintenance.receipts().slice(-8).reverse();
    const snapshots = maintenance.snapshots().slice().reverse();
    const healthText = issues.length ? issues.map((item) => `${item.status.toUpperCase()} · ${item.summary}`).join('\n') : '全部关键检查通过';
    body.innerHTML = `<div class="card health-${escapeHtml(health.overall || 'warning')}"><div class="name">一键体检 · ${(health.overall || 'warning').toUpperCase()}</div><div class="mini">覆盖双存储后端、旧模块迁移、权威根、运行投影、包、模块、Surface、宿主监听与失败回执。报告不包含对话正文和弹药正文。</div><div class="receipt">${escapeHtml(healthText)}</div><div class="actions"><button data-action="maintenance-health-copy">一键体检并复制</button></div></div>
      ${renderVisibilityManager()}
      <div class="card"><div class="name">运行状态</div><div class="receipt">${escapeHtml(JSON.stringify(summary, null, 2))}</div><div class="actions"><button data-action="maintenance-copy">复制简要诊断</button><button data-action="receipts-clear">清空回执</button></div></div>
      <div class="card"><div class="name">最近回执</div>${receipts.length ? receipts.map((item) => `<div class="receipt pkg">${escapeHtml(JSON.stringify(item, null, 2))}</div>`).join('') : '<div class="mini">暂无回执</div>'}</div>
      <div class="card"><div class="name">状态快照</div>${snapshots.length ? snapshots.map((item) => `<div class="pkg row"><span class="grow mini">r${item.revision} · ${escapeHtml(item.reason)}</span><button data-action="rollback" data-revision="${item.revision}">恢复</button></div>`).join('') : '<div class="mini">暂无快照</div>'}</div>` + renderModuleCards(engine.getRegistry().modules.filter((module) => moduleArea(module) === 'maintenance'));
  }

  function applyAppearance() {
    const appearance = engine.getRegistry().appearance;
    const vars = appearance.vars || {};
    for (const [key, value] of Object.entries(vars)) shell.style.setProperty(`--${key}`, String(value));
    shell.dataset.side = appearance.side === 'left' ? 'left' : 'right';
    shell.dataset.anchor = vars.anchor === 'top' ? 'top' : 'bottom';
    packageStyle.textContent = appearance.css || '';
    shell.style.left = ''; shell.style.top = ''; shell.style.right = ''; shell.style.bottom = '';
    scheduleFence();
  }

  function applyFence() {
    fenceFrame = 0;
    const viewport = windowObject.visualViewport ? { width: windowObject.visualViewport.width, height: windowObject.visualViewport.height, left: windowObject.visualViewport.offsetLeft || 0, top: windowObject.visualViewport.offsetTop || 0 } : { width: windowObject.innerWidth, height: windowObject.innerHeight, left: 0, top: 0 };
    shell.style.maxWidth = '';
    shell.style.maxHeight = '';
    const rect = shell.getBoundingClientRect();
    const target = computeFenceStyle(rect, viewport, 12);
    shell.style.maxWidth = `${target.width}px`;
    shell.style.maxHeight = `${target.height}px`;
    if (rect.left < viewport.left + 12 || rect.right > viewport.left + viewport.width - 12 || rect.top < viewport.top + 12 || rect.bottom > viewport.top + viewport.height - 12) {
      shell.style.left = `${target.left}px`;
      shell.style.top = `${target.top}px`;
      shell.style.right = 'auto';
      shell.style.bottom = 'auto';
    } else {
      shell.style.left = '';
      shell.style.top = '';
      shell.style.right = '';
      shell.style.bottom = '';
    }
  }

  function scheduleFence() {
    if (fenceFrame) return;
    fenceFrame = windowObject.requestAnimationFrame(applyFence);
  }

  function render() {
    renderTop();
    if (tab === 'functions') renderFunctions();
    else if (tab === 'packages') renderPackages();
    else if (tab === 'maintenance') renderMaintenance();
    else renderAmmo();
    applyAppearance();
  }

  function setModuleHidden(moduleId, hidden) {
    const current = engine.getRoot().user.moduleDisplay && engine.getRoot().user.moduleDisplay[moduleId] || {};
    return engine.setUserPath(['moduleDisplay', moduleId], Object.assign({}, current, { hidden: !!hidden }));
  }

  function showAllHiddenModules() {
    const hidden = hiddenModules();
    if (!hidden.length) return { status: 'ignored', reason: 'no-hidden-modules' };
    return engine.transact({ type: 'module-display.show-all', module_ids: hidden.map((module) => module.id) }, (candidate) => {
      candidate.user.moduleDisplay = candidate.user.moduleDisplay || {};
      for (const module of hidden) candidate.user.moduleDisplay[module.id] = Object.assign({}, candidate.user.moduleDisplay[module.id] || {}, { hidden: false });
      candidate.user.revision += 1;
    });
  }

  root.addEventListener('input', (event) => {
    if (event.target && event.target.dataset.role === 'package-json') packageDraft = event.target.value;
  });

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) {
      tab = button.dataset.tab;
      storage.set('dcf.ui.session.v1', { tab, selectedSurface });
      render();
      return;
    }
    const action = button.dataset.action;
    if (action === 'surface-select') {
      selectedSurface = button.dataset.surfaceId;
      storage.set('dcf.ui.session.v1', { tab, selectedSurface });
      render();
      return;
    }
    if (action === 'module-visibility-open') {
      tab = 'maintenance';
      storage.set('dcf.ui.session.v1', { tab, selectedSurface });
      render();
      return;
    }
    const card = button.closest('[data-ammo-id]');
    const item = card ? ammo.items().find((entry) => entry.id === card.dataset.ammoId) : null;
    if (action === 'ammo-extract') runAndRender(() => ammo.requestExtract(), '提取请求已发送');
    else if (action === 'ammo-mode') {
      const current = engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
      runAndRender(() => engine.setUserPath(['preferences', 'ammo_fire_mode'], current === 'send' ? 'insert' : 'send'), '发射方式已更新');
    } else if (action === 'ammo-fire' && item) runAndRender(() => ammo.fire(item), '弹药已发射');
    else if (action === 'ammo-copy' && item) runAndRender(() => ammo.copy(item), '已复制');
    else if (action === 'ammo-update' && item) runAndRender(() => ammo.requestUpdate(item), '更新请求已发送');
    else if (action === 'ammo-delete' && item) runAndRender(() => engine.removeContent('ammo', item.id), '已删除');
    else if (action === 'package-install') runAndRender(() => packageManager.installJson(packageDraft), '模块已安装');
    else if (action === 'package-update') runAndRender(() => packageManager.checkUpdates(true), '更新检查完成');
    else if (action === 'package-toggle') {
      const entry = packageManager.packages().find((pkg) => pkg.package_id === button.dataset.id);
      runAndRender(() => packageManager.setEnabled(button.dataset.id, entry && entry.enabled === false), '模块状态已更新');
    } else if (action === 'package-uninstall') runAndRender(() => packageManager.uninstall(button.dataset.id), '模块已卸载');
    else if (action === 'package-switch') {
      const select = Array.from(root.querySelectorAll('select[data-role="package-revision"]')).find((entry) => entry.dataset.id === button.dataset.id);
      runAndRender(() => packageManager.switchRevision(button.dataset.id, select.value), '版本已切换');
    } else if (action === 'module-command') {
      const module = engine.getRegistry().modules.find((entry) => entry.id === button.dataset.moduleId);
      const found = module && commandList(module).find((entry) => String(entry.command.id) === String(button.dataset.commandId));
      if (module && found) runAndRender(() => commandRunner.execute(module, found.command, found.block), '命令已执行');
    } else if (action === 'module-visibility-toggle') {
      const module = engine.getRegistry().modules.find((entry) => entry.id === button.dataset.moduleId);
      if (module) runAndRender(() => setModuleHidden(module.id, !isModuleHidden(module)), isModuleHidden(module) ? '模块已恢复显示' : '模块已隐藏');
    } else if (action === 'module-show-all-hidden') runAndRender(showAllHiddenModules, '所有隐藏模块已恢复显示');
    else if (action === 'maintenance-health-copy') runAndRender(() => maintenance.copyHealthReport(), '完整体检报告已复制');
    else if (action === 'maintenance-copy') runAndRender(() => maintenance.copySummary(), '简要诊断已复制');
    else if (action === 'receipts-clear') runAndRender(() => maintenance.clearReceipts(), '回执已清空');
    else if (action === 'rollback') runAndRender(() => maintenance.rollbackTo(Number(button.dataset.revision)), '状态已恢复');
  });

  windowObject.addEventListener('resize', scheduleFence, { passive: true });
  if (windowObject.visualViewport) {
    windowObject.visualViewport.addEventListener('resize', scheduleFence, { passive: true });
    windowObject.visualViewport.addEventListener('scroll', scheduleFence, { passive: true });
  }
  render();
  return { render, setNotice, destroy: () => hostElement.remove(), root, shell };
}

module.exports = { createApp, computeFenceStyle };

},
"src/index.js":function(module,exports,require){
'use strict';

const { VERSION } = require("src/core/constants.js");
const { clone } = require("src/core/utils.js");
const { buildProjection } = require("src/core/projection.js");
const { loadOrMigrate, addPackRevision, finalizeCandidate } = require("src/core/state.js");
const { decodeArtifacts } = require("src/core/artifacts.js");
const { createReceiptStore } = require("src/core/receipts.js");
const { createTransactionEngine } = require("src/core/transactions.js");
const { createStorage } = require("src/runtime/storage.js");
const { createEffectRunner } = require("src/runtime/effects.js");
const { createCommandRunner } = require("src/runtime/commands.js");
const { createChatGPTHost } = require("src/host/chatgpt.js");
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require("src/modules/standard-packages.js");
const { createAmmoModule } = require("src/modules/ammo.js");
const { createCatalogTransport } = require("src/modules/catalog.js");
const { createPackageManager } = require("src/modules/package-manager.js");
const { createHealthReporter } = require("src/modules/health.js");
const { createMaintenanceModule } = require("src/modules/maintenance.js");
const { createApp } = require("src/ui/app.js");

function ensureProductBaseline(root) {
  let current = root;
  const ammoPack = STANDARD_PACKS.find((pack) => pack.pack_id === REQUIRED_PRODUCT_PACKAGES[0]);
  const entry = current.packages.packages[ammoPack.pack_id];
  const projection = buildProjection(current);
  const needsAmmo = !projection.ok || !projection.registry.contentTypes.ammo || !entry || entry.enabled === false;
  if (!needsAmmo) return current;
  const candidate = clone(current);
  if (!entry) addPackRevision(candidate, ammoPack, { kind: 'embedded-standard' });
  else {
    candidate.packages.packages[ammoPack.pack_id].enabled = true;
    candidate.packages.revision += 1;
  }
  return finalizeCandidate(current, candidate);
}

function boot(api = globalThis) {
  const storage = createStorage(api);
  const receiptStore = createReceiptStore(storage);
  let initialRoot = loadOrMigrate(storage, STANDARD_PACKS);
  initialRoot = ensureProductBaseline(initialRoot);
  const engine = createTransactionEngine(storage, receiptStore, { initialRoot });
  engine.initialize();
  const host = createChatGPTHost(api.window || window);
  const effects = createEffectRunner(host, receiptStore);
  const catalog = createCatalogTransport(storage, engine, api);
  const ammo = createAmmoModule(engine, effects);
  const packageManager = createPackageManager(engine, catalog);
  const health = createHealthReporter(engine, receiptStore, storage, host, REQUIRED_PRODUCT_PACKAGES);
  const maintenance = createMaintenanceModule(engine, receiptStore, effects, storage, health);
  let app = null;
  const commandRunner = createCommandRunner(engine, effects, receiptStore, () => {
    if (!app || !app.shell) return null;
    const rect = app.shell.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
  app = createApp({ engine, ammo, packageManager, maintenance, commandRunner, storage, version: VERSION });

  function processReply(reply) {
    const decoded = decodeArtifacts(reply.text);
    let changed = false;
    for (const artifact of decoded.artifacts) {
      const receipt = engine.applyArtifact(artifact, { kind: 'chatgpt-reply', completed_at: reply.completed_at });
      if (receipt.status === 'committed') changed = true;
    }
    for (const error of decoded.errors) receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'artifact.decode', source: reply.source }, status: 'rejected', error: error.error, marker: error.marker, preview: error.preview });
    if (changed) app.setNotice('DCF 工件已自动应用');
    if (changed || decoded.errors.length) app.render();
  }

  host.startReplyObserver(processReply);
  api.setTimeout(() => catalog.check().then((result) => { if (result && result.applied && result.applied.length) { app.setNotice('DCF 模块已自动更新'); app.render(); } }), 1600);

  if (typeof api.GM_registerMenuCommand === 'function') {
    api.GM_registerMenuCommand('DCF：检查模块更新', () => catalog.check({ force: true }).then(() => app.render()));
    api.GM_registerMenuCommand('DCF：一键体检并复制', () => maintenance.copyHealthReport());
    api.GM_registerMenuCommand('DCF：复制简要诊断', () => maintenance.copySummary());
  }

  api.__DCF_RUNTIME__ = { version: VERSION, engine, host, app, catalog, receiptStore, health };
  return api.__DCF_RUNTIME__;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot(globalThis);

module.exports = { boot, ensureProductBaseline };
}
};
const cache={};
function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}
require('src/index.js');
})();
