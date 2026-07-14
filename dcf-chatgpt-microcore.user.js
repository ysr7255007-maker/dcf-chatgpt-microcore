// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.16.0
// @description  DCF conversation-environment runtime with unified intents, resources, profiles, reconciliation and independent Runtime observation.
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

const VERSION = '0.16.0';
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

const RESOURCE_FAMILIES = { content: 'content', action: 'action', view: 'view', style: 'style', policy: 'policy' };

function resourceFamily(address) {
  const value = String(address || '');
  if (value.startsWith('content:') || value.startsWith('content-type:')) return RESOURCE_FAMILIES.content;
  if (value.startsWith('module:')) return RESOURCE_FAMILIES.action;
  if (value.startsWith('surface:') || value.startsWith('ui-view:') || value.startsWith('module-display:')) return RESOURCE_FAMILIES.view;
  if (value.startsWith('appearance-') || value.startsWith('appearance-var:') || value.startsWith('style:')) return RESOURCE_FAMILIES.style;
  return RESOURCE_FAMILIES.policy;
}

function observationContract(address) {
  const family = resourceFamily(address);
  if (family === 'action') return { registry: 'modules', runtime: 'module-entry' };
  if (family === 'view') return { registry: 'uiViews/surfaces/moduleDisplay', runtime: 'view-entry' };
  if (family === 'content') return { registry: 'content/contentTypes', runtime: 'content-entry' };
  if (family === 'style') return { registry: 'appearance', runtime: 'computed-style' };
  return { registry: 'settings/policies', runtime: 'state-only' };
}

function normalizeClaim(address, value, provider, mode = 'exclusive', replaces = []) {
  return {
    address: String(address),
    value: clone(value),
    provider: String(provider),
    mode: mode === 'extend' ? 'extend' : 'exclusive',
    replaces: Array.isArray(replaces) ? replaces.map(String) : [],
    family: resourceFamily(address),
    observation: observationContract(address)
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
  for (const view of Array.isArray(contributions.ui_views) ? contributions.ui_views : []) {
    if (view && view.id) claims.push(normalizeClaim(`ui-view:${view.id}`, view, provider, 'exclusive', replaces));
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
  for (const [key, value] of Object.entries(isObject(contributions.policies) ? contributions.policies : {})) {
    claims.push(normalizeClaim(`policy-default:${key}`, value, provider, 'exclusive', replaces));
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
  const resources = Array.from(claims.entries()).map(([address, claim]) => ({ address, family: claim.family || resourceFamily(address), provider: claim.provider, observation: clone(claim.observation || observationContract(address)) }));
  return { ok: errors.length === 0, errors, claims, ownership, styles, activePackages, resourceGraph: { schema: 'dcf.environment.resource-graph.v1', resources } };
}

module.exports = { RESOURCE_FAMILIES, resourceFamily, observationContract, normalizePack, compilePackageSet, styleViolations, resolveClaims };

},
"src/core/environment.js":function(module,exports,require){
'use strict';

const { clone, isObject, nowIso } = require("src/core/utils.js");

function packageSelections(root) {
  const packages = root && root.packages && root.packages.packages || {};
  return Object.values(packages).map((entry) => ({
    package_id: String(entry.package_id),
    active_revision: String(entry.active_revision || ''),
    enabled: entry.enabled !== false
  })).sort((a, b) => a.package_id.localeCompare(b.package_id));
}

function contentIndex(root) {
  const result = {};
  const content = root && root.user && root.user.content || {};
  for (const [type, items] of Object.entries(isObject(content) ? content : {})) {
    result[type] = Object.values(isObject(items) ? items : {}).map((item) => ({
      id: String(item && item.id || ''),
      title: String(item && (item.title || item.id) || '')
    })).filter((item) => item.id).sort((a, b) => a.id.localeCompare(b.id));
  }
  return result;
}

function profileItems(root) {
  const profiles = root && root.user && root.user.environmentProfiles || {};
  return Object.values(isObject(profiles) ? profiles : {}).map((profile) => ({
    id: String(profile.id),
    title: String(profile.title || profile.id),
    saved_at: profile.saved_at || null,
    package_count: Object.keys(profile.package_selection || {}).length
  })).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
}

function environmentSnapshot(root, registry) {
  const user = root && root.user || {};
  const build = registry && registry.build || {};
  return {
    schema: 'dcf.environment.snapshot.v1',
    state: {
      revision: Number(root && root.revision || 0),
      state_hash: String(root && root.state_hash || ''),
      kernel_version: String(root && root.kernel_version || '')
    },
    packages: packageSelections(root),
    capabilities: {
      packages: packageSelections(root)
    },
    user_resources: {
      content: contentIndex(root)
    },
    policies: {
      settings: clone(user.settings || {}),
      preferences: clone(user.preferences || {})
    },
    presentation: {
      appearance: clone(user.appearance || {}),
      module_display: clone(user.moduleDisplay || {}),
      views: clone(registry && registry.uiViews || {})
    },
    profiles: {
      active_id: user.active_environment_profile || null,
      items: profileItems(root)
    },
    provenance: {
      active_packages: clone(registry && registry.installedPacks || {}),
      resource_ownership: clone(build.resource_ownership || {})
    },
    runtime: {
      registry_schema: registry && registry.schema || null,
      build_id: build.build_id || null,
      resource_graph_schema: registry && registry.resources && registry.resources.schema || null
    }
  };
}

function captureEnvironmentProfile(root, id, title) {
  const packageSelection = {};
  for (const entry of packageSelections(root)) {
    packageSelection[entry.package_id] = {
      active_revision: entry.active_revision,
      enabled: entry.enabled
    };
  }
  const user = root.user || {};
  return {
    schema: 'dcf.environment.profile.v1',
    id: String(id),
    title: String(title || id),
    saved_at: nowIso(),
    package_selection: packageSelection,
    policies: {
      settings: clone(user.settings || {}),
      preferences: clone(user.preferences || {})
    },
    presentation: {
      appearance: clone(user.appearance || {}),
      moduleDisplay: clone(user.moduleDisplay || {})
    }
  };
}

function applyEnvironmentProfile(candidate, profile) {
  if (!profile || profile.schema !== 'dcf.environment.profile.v1') throw new Error('invalid environment profile');
  let packageChanged = false;
  for (const [packageId, selection] of Object.entries(profile.package_selection || {})) {
    const entry = candidate.packages.packages[packageId];
    if (!entry) throw new Error(`profile package ${packageId} is not installed`);
    const revision = String(selection.active_revision || '');
    if (!entry.revisions || !entry.revisions[revision]) throw new Error(`profile package revision ${packageId}@${revision} is not installed`);
    if (entry.active_revision !== revision || entry.enabled !== (selection.enabled !== false)) packageChanged = true;
    entry.active_revision = revision;
    entry.enabled = selection.enabled !== false;
  }
  if (packageChanged) candidate.packages.revision += 1;
  candidate.user.settings = clone(profile.policies && profile.policies.settings || {});
  candidate.user.preferences = clone(profile.policies && profile.policies.preferences || {});
  candidate.user.appearance = clone(profile.presentation && profile.presentation.appearance || candidate.user.appearance || {});
  candidate.user.moduleDisplay = clone(profile.presentation && profile.presentation.moduleDisplay || {});
  candidate.user.active_environment_profile = String(profile.id);
  candidate.user.revision += 1;
}

module.exports = {
  environmentSnapshot,
  packageSelections,
  captureEnvironmentProfile,
  applyEnvironmentProfile
};

},
"src/core/intents.js":function(module,exports,require){
'use strict';

const { clone, isObject, nowIso, safeId } = require("src/core/utils.js");
const { captureEnvironmentProfile, applyEnvironmentProfile } = require("src/core/environment.js");

const ENVIRONMENT_INTENT_TYPES = new Set([
  'environment.package.install',
  'environment.package.enable',
  'environment.package.remove',
  'environment.package.select',
  'environment.resource.upsert',
  'environment.resource.remove',
  'environment.user.set',
  'environment.profile.save',
  'environment.profile.activate',
  'environment.profile.remove',
  'environment.restore'
]);

function normalizeEnvironmentIntent(intent) {
  if (!isObject(intent) || !ENVIRONMENT_INTENT_TYPES.has(String(intent.type || ''))) {
    throw new Error(`unsupported environment intent ${intent && intent.type || '<missing>'}`);
  }
  return Object.assign({ schema: 'dcf.intent.v1', intent_id: `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }, clone(intent));
}

function normalizeActionIntent(intent) {
  if (!isObject(intent) || !String(intent.type || '').startsWith('action.')) throw new Error('invalid action intent');
  return Object.assign({ schema: 'dcf.intent.v1', intent_id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }, clone(intent));
}

function artifactToEnvironmentInput(artifact, source) {
  if (!artifact || !artifact.type) throw new Error('artifact missing');
  if (artifact.type === 'ammo') {
    return {
      intent: normalizeEnvironmentIntent({
        type: 'environment.resource.upsert',
        resource_type: 'ammo',
        resource_id: artifact.payload.id,
        source: clone(source || {})
      }),
      material: { value: clone(artifact.payload), artifact_identity: artifact.identity, logical_id: artifact.logical_id }
    };
  }
  if (artifact.type === 'package') {
    return {
      intent: normalizeEnvironmentIntent({
        type: 'environment.package.install',
        package_id: artifact.payload.pack_id,
        revision: artifact.payload.revision,
        source: clone(source || {})
      }),
      material: { pack: clone(artifact.payload), source: clone(source || {}), artifact_identity: artifact.identity, logical_id: artifact.logical_id }
    };
  }
  if (artifact.type === 'package-reference') {
    return {
      intent: { schema: 'dcf.intent.v1', type: 'environment.package.resolve', package_id: artifact.payload.package_id, target: artifact.payload.target, channel: artifact.payload.channel, source: clone(source || {}) },
      material: { reference: clone(artifact.payload), artifact_identity: artifact.identity, logical_id: artifact.logical_id }
    };
  }
  throw new Error(`unsupported artifact type ${artifact.type}`);
}

function setPath(target, path, value) {
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    cursor[key] = isObject(cursor[key]) ? cursor[key] : {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = clone(value);
}

function markProfileDrift(candidate, type) {
  if (!type.startsWith('environment.profile.') && type !== 'environment.restore') candidate.user.active_environment_profile = null;
}

function applyEnvironmentTransition(candidate, intent, material, helpers) {
  const normalized = normalizeEnvironmentIntent(intent);
  const payload = material || {};
  markProfileDrift(candidate, normalized.type);

  if (normalized.type === 'environment.package.install') {
    helpers.addPackRevision(candidate, payload.pack, payload.source || normalized.source || {});
  } else if (normalized.type === 'environment.package.enable') {
    const entry = candidate.packages.packages[normalized.package_id];
    if (!entry) throw new Error(`package ${normalized.package_id} not installed`);
    entry.enabled = normalized.enabled !== false;
    candidate.packages.revision += 1;
  } else if (normalized.type === 'environment.package.remove') {
    if (!candidate.packages.packages[normalized.package_id]) throw new Error(`package ${normalized.package_id} not installed`);
    delete candidate.packages.packages[normalized.package_id];
    candidate.packages.revision += 1;
  } else if (normalized.type === 'environment.package.select') {
    const entry = candidate.packages.packages[normalized.package_id];
    const revision = String(normalized.revision || '');
    if (!entry || !entry.revisions || !entry.revisions[revision]) throw new Error(`package revision ${normalized.package_id}@${revision} missing`);
    entry.active_revision = revision;
    entry.enabled = true;
    candidate.packages.revision += 1;
  } else if (normalized.type === 'environment.resource.upsert') {
    const type = String(normalized.resource_type);
    const id = String(normalized.resource_id);
    candidate.user.content[type] = candidate.user.content[type] || {};
    candidate.user.content[type][id] = clone(payload.value);
    candidate.user.revision += 1;
  } else if (normalized.type === 'environment.resource.remove') {
    const type = String(normalized.resource_type);
    const id = String(normalized.resource_id);
    if (candidate.user.content[type]) delete candidate.user.content[type][id];
    candidate.user.revision += 1;
  } else if (normalized.type === 'environment.user.set') {
    const path = Array.isArray(normalized.path) ? normalized.path.map(String) : String(normalized.path || '').split('.').filter(Boolean);
    if (!path.length) throw new Error('environment.user.set path missing');
    setPath(candidate.user, path, payload.value);
    candidate.user.revision += 1;
  } else if (normalized.type === 'environment.profile.save') {
    const title = String(normalized.title || '当前环境');
    const id = String(normalized.profile_id || safeId(title) || `profile-${Date.now().toString(36)}`);
    const profile = captureEnvironmentProfile(candidate, id, title);
    candidate.user.environmentProfiles[id] = profile;
    candidate.user.active_environment_profile = id;
    candidate.user.revision += 1;
  } else if (normalized.type === 'environment.profile.activate') {
    const profile = candidate.user.environmentProfiles[normalized.profile_id];
    if (!profile) throw new Error(`environment profile ${normalized.profile_id} missing`);
    applyEnvironmentProfile(candidate, profile);
  } else if (normalized.type === 'environment.profile.remove') {
    if (!candidate.user.environmentProfiles[normalized.profile_id]) throw new Error(`environment profile ${normalized.profile_id} missing`);
    delete candidate.user.environmentProfiles[normalized.profile_id];
    if (candidate.user.active_environment_profile === normalized.profile_id) candidate.user.active_environment_profile = null;
    candidate.user.revision += 1;
  } else if (normalized.type === 'environment.restore') {
    const restored = clone(payload.root);
    for (const key of Object.keys(candidate)) delete candidate[key];
    Object.assign(candidate, restored);
  }

  return {
    observations: [{
      schema: 'dcf.environment.transition.v1',
      intent_type: normalized.type,
      planned_at: nowIso()
    }]
  };
}

module.exports = {
  ENVIRONMENT_INTENT_TYPES,
  normalizeEnvironmentIntent,
  normalizeActionIntent,
  artifactToEnvironmentInput,
  applyEnvironmentTransition
};

},
"src/core/projection.js":function(module,exports,require){
'use strict';

const { clone, deepMerge, hash, isObject } = require("src/core/utils.js");
const { compilePackageSet } = require("src/core/resources.js");

function resolveModuleSupersession(modules) {
  const ids = new Set((modules || []).map((module) => String(module && module.id || '')).filter(Boolean));
  const direct = {};
  const errors = [];
  const ordered = (modules || []).slice().sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  for (const module of ordered) {
    const by = String(module && module.id || '');
    for (const rawTarget of Array.isArray(module && module.supersedes) ? module.supersedes : []) {
      const target = String(rawTarget || '').trim();
      if (!target) continue;
      if (target === by) {
        errors.push(`module ${by} cannot supersede itself`);
        continue;
      }
      if (direct[target] && direct[target] !== by) {
        errors.push(`module supersession conflict ${target}: ${direct[target]} vs ${by}`);
        continue;
      }
      direct[target] = by;
    }
  }
  function finalReplacement(target) {
    const seen = [target];
    let current = direct[target];
    while (current && direct[current]) {
      if (seen.includes(current)) {
        errors.push(`module supersession cycle: ${seen.concat(current).join(' -> ')}`);
        return '';
      }
      seen.push(current);
      current = direct[current];
    }
    return current || '';
  }
  const entries = {};
  for (const target of Object.keys(direct).sort()) {
    if (!ids.has(target)) continue;
    const by = finalReplacement(target);
    if (by) entries[target] = { by, direct_by: direct[target] };
  }
  return { ok: errors.length === 0, errors, entries };
}

function buildProjection(root) {
  const compiled = compilePackageSet(root.packages || {});
  if (!compiled.ok) return { ok: false, errors: compiled.errors, registry: null };
  const claims = compiled.claims;
  const user = root.user || {};
  const appearanceVars = {};
  const contentTypes = {};
  const packageContent = {};
  const surfaces = {};
  const uiViews = {};
  const modules = [];
  const moduleDisplayDefaults = {};
  const settingDefaults = {};
  const policyDefaults = {};

  for (const [address, claim] of claims.entries()) {
    if (address === 'appearance-side') continue;
    if (address.startsWith('appearance-var:')) appearanceVars[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('content-type:')) contentTypes[address.slice(13)] = clone(claim.value);
    else if (address.startsWith('surface:')) surfaces[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('ui-view:')) uiViews[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('module:')) modules.push(clone(claim.value));
    else if (address.startsWith('module-display:')) moduleDisplayDefaults[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('setting-default:')) settingDefaults[address.slice(16)] = clone(claim.value);
    else if (address.startsWith('policy-default:')) policyDefaults[address.slice(15)] = clone(claim.value);
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
  const supersession = resolveModuleSupersession(modules);
  if (!supersession.ok) return { ok: false, errors: supersession.errors, registry: null };
  const runtimeModules = modules.filter((module) => !supersession.entries[String(module.id)]);

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
    uiViews,
    modules: runtimeModules,
    moduleSupersession: { schema: 'dcf.runtime.module-supersession.v1', entries: clone(supersession.entries) },
    moduleDisplay: deepMerge(moduleDisplayDefaults, user.moduleDisplay || {}),
    settings: Object.assign({}, settingDefaults, clone(user.settings || {})),
    policies: Object.assign({}, policyDefaults, clone(user.preferences || {})),
    resources: clone(compiled.resourceGraph),
    installedPacks: compiled.activePackages,
    build: {
      schema: 'dcf.build.result.v2',
      build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership, resources: compiled.resourceGraph, module_supersession: supersession.entries }),
      resource_ownership: compiled.ownership,
      conflicts: []
    }
  };
  return { ok: true, errors: [], registry };
}

module.exports = { buildProjection, resolveModuleSupersession };

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
},
"src/core/artifacts.js":function(module,exports,require){
'use strict';

const { clone, hash, isObject } = require("src/core/utils.js");

const BLOCKS = [
  { marker: 'DCF_AMMO', type: 'ammo' },
  { marker: 'DCF_MODULE_PACK', type: 'package' },
  { marker: 'DCF_PACKAGE_UPDATE', type: 'package-reference' }
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

function normalizePackageReference(payload) {
  if (!isObject(payload) || !(payload.package_id || payload.pack_id)) throw new Error('DCF_PACKAGE_UPDATE requires package_id');
  const reference = {
    schema: 'dcf.package.reference.v1',
    package_id: String(payload.package_id || payload.pack_id),
    target: String(payload.target || payload.revision || 'latest'),
    channel: String(payload.channel || 'stable')
  };
  if (payload.catalog_url) reference.catalog_url = String(payload.catalog_url);
  return {
    schema: 'dcf.artifact.v1',
    type: 'package-reference',
    identity: `package-reference:${hash(reference)}`,
    logical_id: `package-reference:${reference.package_id}:${reference.target}`,
    payload: reference
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
        if (block.type === 'ammo') artifacts.push(normalizeAmmo(payload));
        else if (block.type === 'package') artifacts.push(normalizePackage(payload));
        else artifacts.push(normalizePackageReference(payload));
      } catch (error) {
        errors.push({ marker: block.marker, error: String(error && error.message || error), preview: { redacted: true, length: raw.length, hash: hash(raw) } });
      }
    }
  }
  return { artifacts, errors };
}

module.exports = { decodeArtifacts, normalizeAmmo, normalizePackage, normalizePackageReference, extractBlocks };

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
const { environmentSnapshot } = require("src/core/environment.js");
const { normalizeEnvironmentIntent, artifactToEnvironmentInput, applyEnvironmentTransition } = require("src/core/intents.js");

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
    return receiptStore.append({
      schema: 'dcf.receipt.v1', receipt_id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      intent: clone(intent), status: 'committed', previous_revision: previous.revision, revision: finalized.revision,
      previous_state_hash: previous.state_hash, state_hash: finalized.state_hash, build_id: built.registry.build.build_id,
      effects: clone(reduction.effects || []), observations: clone(reduction.observations || []), duration_ms: Date.now() - started
    });
  }

  function applyEnvironmentIntent(intent, material = {}) {
    const normalized = normalizeEnvironmentIntent(intent);
    if (material.artifact_identity && root.system.artifact_index[material.artifact_identity]) {
      return receiptStore.append({
        schema: 'dcf.receipt.v1',
        intent: clone(normalized),
        status: 'ignored',
        reason: 'already-applied',
        artifact_identity: material.artifact_identity
      });
    }
    return transact(normalized, (candidate) => {
      const reduction = applyEnvironmentTransition(candidate, normalized, material, { addPackRevision });
      if (material.artifact_identity) recordArtifact(candidate, material.artifact_identity, material.logical_id);
      return reduction;
    });
  }

  function installPackage(pack, source) {
    return applyEnvironmentIntent({ type: 'environment.package.install', package_id: pack.pack_id, revision: pack.revision, source }, { pack, source });
  }

  function setPackageEnabled(packageId, enabled) {
    return applyEnvironmentIntent({ type: 'environment.package.enable', package_id: packageId, enabled: !!enabled });
  }

  function uninstallPackage(packageId) {
    return applyEnvironmentIntent({ type: 'environment.package.remove', package_id: packageId });
  }

  function switchPackageRevision(packageId, revision) {
    return applyEnvironmentIntent({ type: 'environment.package.select', package_id: packageId, revision });
  }

  function upsertContent(type, item, artifactIdentity) {
    return applyEnvironmentIntent({ type: 'environment.resource.upsert', resource_type: type, resource_id: item.id }, { value: item, artifact_identity: artifactIdentity, logical_id: `${type}:${item.id}` });
  }

  function removeContent(type, id) {
    return applyEnvironmentIntent({ type: 'environment.resource.remove', resource_type: type, resource_id: id });
  }

  function setUserPath(path, value) {
    return applyEnvironmentIntent({ type: 'environment.user.set', path: path.slice() }, { value });
  }

  function applyArtifact(artifact, source) {
    if (artifact.type === 'package-reference') {
      return receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'environment.package.resolve' }, status: 'rejected', error: 'package reference requires resolver' });
    }
    const input = artifactToEnvironmentInput(artifact, source);
    return applyEnvironmentIntent(input.intent, input.material);
  }

  function rollbackTo(snapshotRevision) {
    const record = snapshots().slice().reverse().find((item) => Number(item.revision) === Number(snapshotRevision));
    if (!record) return receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'environment.restore', revision: snapshotRevision }, status: 'rejected', error: 'snapshot not found' });
    return applyEnvironmentIntent({ type: 'environment.restore', revision: snapshotRevision }, { root: record.root });
  }

  function saveEnvironmentProfile(title, profileId) {
    return applyEnvironmentIntent({ type: 'environment.profile.save', title, profile_id: profileId });
  }

  function activateEnvironmentProfile(profileId) {
    return applyEnvironmentIntent({ type: 'environment.profile.activate', profile_id: profileId });
  }

  function removeEnvironmentProfile(profileId) {
    return applyEnvironmentIntent({ type: 'environment.profile.remove', profile_id: profileId });
  }

  function getRoot() { return root; }
  function getRegistry() { return registry; }
  function getEnvironment() { return environmentSnapshot(root, registry); }

  return {
    initialize,
    transact,
    applyEnvironmentIntent,
    installPackage,
    setPackageEnabled,
    uninstallPackage,
    switchPackageRevision,
    upsertContent,
    removeContent,
    setUserPath,
    applyArtifact,
    rollbackTo,
    saveEnvironmentProfile,
    activateEnvironmentProfile,
    removeEnvironmentProfile,
    snapshots,
    getRoot,
    getRegistry,
    getEnvironment
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

function createEffectRunner(host, receiptStore, performanceController) {
  async function run(effect, context = {}) {
    const started = Date.now();
    try {
      let result;
      if (effect.type === 'composer.insert') result = await host.insertComposer(String(effect.text || ''), { send: false });
      else if (effect.type === 'composer.send') result = await host.insertComposer(String(effect.text || ''), { send: true });
      else if (effect.type === 'clipboard.write') result = await host.copy(String(effect.text || ''));
      else if (effect.type === 'notification') result = await host.notify(String(effect.text || 'DCF'));
      else if (effect.type === 'conversation.performance.reveal') {
        if (!performanceController) throw new Error('conversation performance controller unavailable');
        result = performanceController.revealPreviousBatch();
      } else if (effect.type === 'conversation.performance.report') {
        if (!performanceController) throw new Error('conversation performance controller unavailable');
        const report = `<<<DCF_CONVERSATION_PERFORMANCE\n${JSON.stringify(performanceController.diagnostics(), null, 2)}\nDCF_CONVERSATION_PERFORMANCE>>>`;
        result = await host.copy(report);
      } else throw new Error(`unsupported effect ${effect.type}`);
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

function createCommandRunner(engine, effectRunner, receiptStore, shellObserver, reconciler) {
  function environmentIntent(intent, material) {
    return reconciler ? reconciler.acceptIntent(intent, material) : engine.applyEnvironmentIntent(intent, material);
  }

  function adjustedAppearance(args) {
    const next = clone(engine.getRoot().user.appearance || { side: null, vars: {}, css: '', safe_mode: false });
    const vars = next.vars || (next.vars = {});
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
    if (args.side === 'toggle') next.side = engine.getRegistry().appearance.side === 'left' ? 'right' : 'left';
    else if (args.side) next.side = args.side === 'left' ? 'left' : 'right';
    return next;
  }

  async function runStep(step, context) {
    const call = String(step.call || '');
    const args = clone(step.with || step.args || {});
    const before = { state_hash: engine.getRoot().state_hash, revision: engine.getRoot().revision, appearance: clone(engine.getRegistry().appearance.vars) };
    let result;
    if (call === 'appearance.adjust') {
      result = environmentIntent({ type: 'environment.user.set', path: ['appearance'], source: { module_id: context.module_id, command_id: context.command_id } }, { value: adjustedAppearance(args) });
    } else if (call === 'appearance.set') {
      const next = clone(engine.getRoot().user.appearance || { side: null, vars: {}, css: '', safe_mode: false });
      if (args.side) next.side = args.side === 'left' ? 'left' : 'right';
      next.vars = Object.assign({}, next.vars || {}, args.vars || {});
      result = environmentIntent({ type: 'environment.user.set', path: ['appearance'], source: { module_id: context.module_id, command_id: context.command_id } }, { value: next });
    } else if (call === 'settings.set') {
      if (!args.key) throw new Error('settings.set requires key');
      result = environmentIntent({ type: 'environment.user.set', path: ['settings', String(args.key)], source: { module_id: context.module_id, command_id: context.command_id } }, { value: args.value });
    } else if (call === 'content.upsert') {
      const item = args.item || {};
      result = environmentIntent({ type: 'environment.resource.upsert', resource_type: String(args.type || 'ammo'), resource_id: String(item.id || ''), source: { module_id: context.module_id, command_id: context.command_id } }, { value: item });
    } else if (call === 'content.remove') {
      result = environmentIntent({ type: 'environment.resource.remove', resource_type: String(args.type || 'ammo'), resource_id: String(args.id || ''), source: { module_id: context.module_id, command_id: context.command_id } });
    } else if (call === 'conversation.performance.configure') {
      const current = clone(engine.getRoot().user.preferences && engine.getRoot().user.preferences.conversation_performance || engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});
      result = environmentIntent({ type: 'environment.user.set', path: ['preferences', 'conversation_performance'], source: { module_id: context.module_id, command_id: context.command_id } }, { value: Object.assign(current, args) });
    } else if (call === 'conversation.performance.reveal') {
      result = await effectRunner.run({ type: 'conversation.performance.reveal' }, context);
    } else if (call === 'conversation.performance.report') {
      result = await effectRunner.run({ type: 'conversation.performance.report' }, context);
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
    const after = { state_hash: engine.getRoot().state_hash, revision: engine.getRoot().revision, appearance: clone(engine.getRegistry().appearance.vars), shell: typeof shellObserver === 'function' ? shellObserver() : null };
    return { call, input: sanitizeValue(args), before, after, result: sanitizeValue(result, 'result') };
  }

  async function execute(module, command, block) {
    const context = { module_id: module.id, module_version: module.version || null, block_id: block && block.id || null, command_id: command.id };
    const trace = { schema: 'dcf.command.receipt.v3', trace_id: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, context, status: 'running', steps: [] };
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
"src/runtime/reconciler.js":function(module,exports,require){
'use strict';

const { clone, nowIso } = require("src/core/utils.js");
const { artifactToEnvironmentInput, normalizeEnvironmentIntent } = require("src/core/intents.js");

function createCapabilityReconciler(engine, catalog, receiptStore, options = {}) {
  let lastResult = null;

  function desiredState() {
    return engine.getEnvironment();
  }

  function activationFor(intent, status) {
    if (status !== 'committed') return 'none';
    if (String(intent.type).startsWith('environment.resource.')) return 'content-projected';
    return 'runtime-reprojected';
  }

  function resultFor(intent, receipt, metadata = {}) {
    const result = {
      schema: 'dcf.reconcile.result.v1',
      environment_schema: 'dcf.environment.reconcile.result.v1',
      at: nowIso(),
      input_mode: metadata.input_mode || 'intent',
      intent_type: intent.type,
      package_id: intent.package_id || null,
      revision: intent.revision || metadata.revision || null,
      status: receipt.status,
      activation: activationFor(intent, receipt.status),
      environment_revision: engine.getRoot().revision,
      receipt
    };
    lastResult = clone(result);
    if (receipt.status === 'committed' && typeof options.onCommitted === 'function') options.onCommitted(result);
    return result;
  }

  function acceptIntent(intent, material = {}, metadata = {}) {
    const normalized = normalizeEnvironmentIntent(intent);
    const receipt = engine.applyEnvironmentIntent(normalized, material);
    return resultFor(normalized, receipt, metadata);
  }

  function applyResolved(resolved) {
    const artifact = resolved && resolved.artifact || resolved;
    if (!artifact || artifact.type === 'package-reference') throw new Error('resolved artifact must contain value payload');
    const input = artifactToEnvironmentInput(artifact, resolved && resolved.source || { kind: 'resolved-artifact' });
    return acceptIntent(input.intent, input.material, {
      input_mode: resolved && resolved.input_mode || 'value',
      revision: artifact.type === 'package' ? artifact.payload.revision : null
    });
  }

  function rejectReference(artifact, source, error) {
    const message = String(error && error.message || error);
    const receipt = receiptStore.append({
      schema: 'dcf.receipt.v1',
      intent: { type: 'environment.package.resolve', input_mode: 'reference', package_id: artifact.payload.package_id, target: artifact.payload.target, source: clone(source || {}) },
      status: 'rejected',
      stage: 'resolve',
      error: message
    });
    return resultFor({ type: 'environment.package.resolve', package_id: artifact.payload.package_id }, receipt, { input_mode: 'reference' });
  }

  function accept(artifact, source = {}) {
    if (artifact.type !== 'package-reference') return applyResolved({ artifact, input_mode: 'value', source });
    return catalog.resolve(artifact.payload).then((resolved) => applyResolved(resolved)).catch((error) => rejectReference(artifact, source, error));
  }

  return {
    accept,
    acceptIntent,
    applyResolved,
    desiredState,
    lastResult: () => clone(lastResult)
  };
}

module.exports = { createCapabilityReconciler };

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
      observed_root_is_current: !!(observedRoot && root && observedRoot === root),
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

const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management', 'dcf.ui.runtime-workspace', 'dcf.standard.conversation-performance'];

const STANDARD_PACKS = [
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.ammo',
    revision: '1.3.0',
    title: '语言弹药工作台',
    description: '统一提供语言弹药的提取、新建、编辑、查找、语境化调用、实质更新与管理。',
    contributes: {
      content_types: [{ id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy', 'update', 'delete'] }],
      surfaces: [{ id: 'dcf.ammo', title: '弹药', area: 'primary', order: 10, kind: 'content-list', content_type: 'ammo' }],
      ui_views: [{ id: 'ammo', kind: 'content', projection: 'content:ammo', tab_label: '弹药', title: '语言弹药工作台', description: '在一个入口中提取、新建、编辑、查找、调用、更新和管理语言弹药。', order: 10, labels: { extract: '从当前对话提取', new_item: '新建弹药', search_placeholder: '查找标题、用途、标签或 ID', fire_mode: '发射', fire: '发射', copy: '复制', update: '更新', edit: '编辑', remove: '删除', save: '保存', cancel: '取消' } }],
      policies: {
        ammo_protocol: {
          invocation_marker: '〔DCF·语言弹药〕',
          update_marker: '〔DCF·弹药更新〕',
          update_intro: '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
          update_rules: [
            '保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
            '吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
            '这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。'
          ],
          output_instruction: '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
        }
      },
      appearance: { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } }
    },
    modules: [{ id: 'dcf.ammo.module', title: '语言弹药工作台', version: '1.3.0', kind: 'ammo', supersedes: ['dcf.ammo_workbench', 'dcf.ammo_workspace.unified', 'dcf.language_ammo'] }]
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.ui.runtime-workspace',
    revision: '1.0.0',
    title: '对话环境工作区',
    description: '把日常功能和维护观察呈现为同一期望对话环境的行动与观察视图。',
    contributes: {
      ui_views: [
        { id: 'functions', kind: 'actions', projection: 'actions:daily', tab_label: '功能', title: '日常功能', description: '主力能力始终保留入口；点击模块标题展开或收起具体操作。', order: 20 },
        { id: 'maintenance', kind: 'observation', projection: 'runtime:observation', tab_label: '维护', title: '环境观察与恢复', description: '观察期望环境在真实浏览器 Runtime 中是否成立，并提供恢复入口。', order: 40 }
      ],
      policies: { activation_mode: 'live-when-safe' }
    },
    modules: []
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.ui.package-management',
    revision: '1.0.0',
    title: '包管理界面',
    description: '提供可自更新的中文包总览、版本控制和安装入口。',
    contributes: {
      ui_views: [{
        id: 'packages',
        kind: 'package-management',
        projection: 'environment:capabilities',
        tab_label: '包管理',
        title: '安装包管理',
        description: '中文名称和功能说明用于日常识别；英文 ID 仅保留为技术标识。',
        order: 30,
        density: 'compact',
        show_technical_id: true,
        manual_install: 'folded',
        control_order: ['revision', 'switch', 'toggle', 'uninstall'],
        labels: { check_updates: '检查更新', manual_install: '手动安装能力包', install_json: '安装 JSON', package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON', switch_revision: '切换', enable: '启用', disable: '停用', uninstall: '卸载' },
        state_labels: { required: '核心', enabled: '已启用', disabled: '已停用' }
      }],
      styles: [{ id: 'package-management-compact', css: '.package-list.density-compact .package-card{padding:7px 0}.package-list.density-compact .package-description{line-height:1.3}' }]
    },
    modules: []
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.conversation-performance',
    revision: '1.0.0',
    title: '长对话减负',
    description: '降低 ChatGPT 长对话的浏览器渲染负担，并提供可逆的历史消息窗口。',
    contributes: {
      policies: {
        conversation_performance: {
          mode: 'safe', activation_turns: 24, keep_recent: 40, reveal_batch: 20,
          settle_ms: 1000, top_reveal_px: 220, intrinsic_block_px: 480
        }
      },
      module_display: { 'dcf.standard.conversation-performance': { area: 'work', role: 'daily', order: 40 } }
    },
    modules: [{
      id: 'dcf.standard.conversation-performance', title: '长对话减负', version: '1.0.0', kind: 'conversation-performance',
      blocks: [
        { id: 'mode', title: '减负模式', commands: [
          { id: 'safe', label: '透明减负（推荐）', steps: [{ call: 'conversation.performance.configure', with: { mode: 'safe' } }] },
          { id: 'window40', label: '窗口化：最近 40 条', steps: [{ call: 'conversation.performance.configure', with: { mode: 'window', keep_recent: 40 } }] },
          { id: 'window20', label: '窗口化：最近 20 条', steps: [{ call: 'conversation.performance.configure', with: { mode: 'window', keep_recent: 20 } }] },
          { id: 'off', label: '恢复全部并关闭', steps: [{ call: 'conversation.performance.configure', with: { mode: 'off' } }] }
        ] },
        { id: 'history', title: '历史消息与观察', commands: [
          { id: 'reveal', label: '展开上一批', steps: [{ call: 'conversation.performance.reveal' }] },
          { id: 'report', label: '复制性能摘要', steps: [{ call: 'conversation.performance.report' }] }
        ] }
      ]
    }]
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.shell-adjuster',
    revision: '1.0.0',
    title: '壳体调节',
    description: '调整侧栏宽度、高度、边距和停靠方向。',
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

const DEFAULT_AMMO_PROTOCOL = {
  invocation_marker: '〔DCF·语言弹药〕',
  update_marker: '〔DCF·弹药更新〕',
  update_intro: '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
  update_rules: [
    '保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
    '吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
    '这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。'
  ],
  output_instruction: '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
};

function ammoProtocol(registry) {
  const configured = registry && registry.policies && registry.policies.ammo_protocol || {};
  return {
    invocation_marker: String(configured.invocation_marker || DEFAULT_AMMO_PROTOCOL.invocation_marker),
    update_marker: String(configured.update_marker || DEFAULT_AMMO_PROTOCOL.update_marker),
    update_intro: String(configured.update_intro || DEFAULT_AMMO_PROTOCOL.update_intro),
    update_rules: Array.isArray(configured.update_rules) && configured.update_rules.length ? configured.update_rules.map(String) : DEFAULT_AMMO_PROTOCOL.update_rules.slice(),
    output_instruction: String(configured.output_instruction || DEFAULT_AMMO_PROTOCOL.output_instruction)
  };
}

function buildAmmoInvocation(item, protocol = DEFAULT_AMMO_PROTOCOL) {
  return [String(protocol.invocation_marker || DEFAULT_AMMO_PROTOCOL.invocation_marker), '', String(item && item.body || '')].join('\n');
}

function buildAmmoUpdateRequest(item, protocol = DEFAULT_AMMO_PROTOCOL) {
  const rules = Array.isArray(protocol.update_rules) ? protocol.update_rules : DEFAULT_AMMO_PROTOCOL.update_rules;
  return [
    String(protocol.update_marker || DEFAULT_AMMO_PROTOCOL.update_marker),
    '',
    String(protocol.update_intro || DEFAULT_AMMO_PROTOCOL.update_intro),
    ...rules.map((rule) => `- ${String(rule)}`),
    '',
    String(protocol.output_instruction || DEFAULT_AMMO_PROTOCOL.output_instruction),
    '',
    '当前弹药：',
    JSON.stringify(item, null, 2)
  ].join('\n');
}

function createAmmoModule(engine, effectRunner) {
  function items() {
    const registry = engine.getRegistry();
    return Object.values(registry.content && registry.content.ammo || {}).sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
  }

  function protocol() {
    return ammoProtocol(engine.getRegistry());
  }

  function fire(item) {
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    return effectRunner.run({ type: mode === 'send' ? 'composer.send' : 'composer.insert', text: buildAmmoInvocation(item, protocol()) }, { module: 'ammo', action: 'invoke', item_id: item.id });
  }

  function copy(item) {
    return effectRunner.run({ type: 'clipboard.write', text: String(item.body || '') }, { module: 'ammo', item_id: item.id });
  }

  function requestUpdate(item) {
    return effectRunner.run({ type: 'composer.send', text: buildAmmoUpdateRequest(item, protocol()) }, { module: 'ammo', action: 'update', item_id: item.id });
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

module.exports = { DEFAULT_AMMO_PROTOCOL, ammoProtocol, buildAmmoInvocation, buildAmmoUpdateRequest, createAmmoModule };
},
"src/modules/catalog.js":function(module,exports,require){
'use strict';

const { CATALOG_URL, CATALOG_STATE_KEY } = require("src/core/constants.js");
const { compareRevision, hash, nowIso } = require("src/core/utils.js");
const { normalizePackage } = require("src/core/artifacts.js");

function createCatalogTransport(storage, engine, api = globalThis) {
  let applyResolved = (resolved) => engine.applyArtifact(resolved.artifact, resolved.source);

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

  function validateCatalog(catalog) {
    if (!catalog || catalog.schema !== 'dcf.catalog.v1' || !Array.isArray(catalog.packages)) throw new Error('invalid catalog');
    return catalog;
  }

  async function loadCatalog(options = {}) {
    const url = options.url || CATALOG_URL;
    return { url, catalog: validateCatalog(await requestJson(url)) };
  }

  function selectEntry(catalog, reference) {
    const packageId = String(reference.package_id || '');
    const channel = String(reference.channel || 'stable');
    const target = String(reference.target || 'latest');
    const matches = catalog.packages.filter((entry) => String(entry.package_id) === packageId && String(entry.channel || 'stable') === channel);
    if (!matches.length) throw new Error(`catalog package ${packageId} not found on ${channel}`);
    if (target !== 'latest' && target !== 'stable') {
      const exact = matches.find((entry) => String(entry.revision) === target);
      if (!exact) throw new Error(`catalog package revision ${packageId}@${target} not found`);
      return exact;
    }
    return matches.slice().sort((a, b) => compareRevision(b.revision, a.revision))[0];
  }

  async function resolveFromCatalog(catalogInfo, reference) {
    const entry = selectEntry(catalogInfo.catalog, reference);
    const pack = await requestJson(entry.url);
    const expected = String(entry.hash || '');
    const actual = hash(pack);
    if (expected && expected !== actual) throw new Error(`catalog hash mismatch ${entry.package_id}@${entry.revision}`);
    const artifact = normalizePackage(pack);
    if (artifact.payload.pack_id !== String(entry.package_id) || artifact.payload.revision !== String(entry.revision)) {
      throw new Error(`catalog identity mismatch ${entry.package_id}@${entry.revision}`);
    }
    return {
      schema: 'dcf.resolved.artifact.v1',
      input_mode: 'reference',
      artifact,
      reference: Object.assign({}, reference),
      catalog_entry: { package_id: entry.package_id, revision: entry.revision, channel: entry.channel || 'stable', hash: expected },
      source: { kind: 'github-catalog-reference', catalog_url: catalogInfo.url, package_url: entry.url }
    };
  }

  async function resolve(reference, options = {}) {
    if (reference.catalog_url && !options.url && reference.catalog_url !== CATALOG_URL) throw new Error('untrusted catalog_url');
    const catalogInfo = await loadCatalog({ url: options.url || reference.catalog_url || CATALOG_URL });
    return resolveFromCatalog(catalogInfo, reference);
  }

  async function check(options = {}) {
    const currentState = storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null });
    const minInterval = Number(options.minIntervalMs || 6 * 60 * 60 * 1000);
    if (!options.force && currentState.last_checked_at && Date.now() - Date.parse(currentState.last_checked_at) < minInterval) {
      return { ok: true, skipped: true, reason: 'interval' };
    }
    try {
      const catalogInfo = await loadCatalog({ url: options.url || CATALOG_URL });
      const installed = engine.getRoot().packages.packages;
      const applied = [];
      for (const local of Object.values(installed)) {
        if (!local || local.enabled === false) continue;
        let resolved;
        try {
          resolved = await resolveFromCatalog(catalogInfo, { package_id: local.package_id, target: 'latest', channel: 'stable' });
        } catch (error) {
          if (/not found/.test(String(error && error.message || error))) continue;
          throw error;
        }
        if (compareRevision(resolved.artifact.payload.revision, local.active_revision) <= 0) continue;
        const result = await Promise.resolve(applyResolved(resolved));
        applied.push({ package_id: local.package_id, revision: resolved.artifact.payload.revision, status: result && result.status || result && result.receipt && result.receipt.status || null });
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

  function setApplyResolved(handler) {
    if (typeof handler === 'function') applyResolved = handler;
  }

  return { check, resolve, loadCatalog, setApplyResolved };
}

module.exports = { createCatalogTransport };

},
"src/modules/package-manager.js":function(module,exports,require){
'use strict';

const { decodeArtifacts } = require("src/core/artifacts.js");
const { REQUIRED_PRODUCT_PACKAGES } = require("src/modules/standard-packages.js");

const LEGACY_PRESENTATION = {
  'dcf.ammo.module': { title: '语言弹药核心', description: '提供语言弹药内容、主入口和低摩擦发射能力。' },
  'dcf.ammo_workbench': { title: '弹药工作台', description: '提供语言弹药的创建、编辑和常用操作。' },
  'dcf.ammo_workspace.unified': { title: '统一弹药工作区', description: '集中浏览、整理和使用语言弹药。' },
  'dcf.language_ammo': { title: '语言弹药', description: '提供旧版语言弹药工作流的兼容能力。' },
  'dcf.ammo_library.dcf_kernel_maintenance': { title: 'DCF 内核维护', description: '提供语言弹药库与内核维护相关操作。' },
  'dcf.block_scanner': { title: '对话块扫描', description: '扫描并识别对话中的 DCF 工件块。' },
  'dcf.capability_gap_probe': { title: '能力缺口探针', description: '检查当前运行能力与预期能力之间的差异。' },
  'dcf.command_runtime_probe': { title: '命令运行探针', description: '检查模块命令在当前 Runtime 中的执行情况。' },
  'dcf.feedback_safety_probe': { title: '草稿保护探针', description: '检查反馈操作与输入框草稿保护是否可靠。' },
  'dcf.kernel_acceptance': { title: '内核验收', description: '执行 DCF 内核关键能力的验收检查。' },
  'dcf.maintenance_feedback': { title: '维护回馈', description: '生成维护流程需要的反馈信息。' },
  'dcf.module_authoring': { title: '模块作者工具', description: '辅助创建、检查和维护 DCF 模块包。' },
  'dcf.runtime_inspector': { title: '运行检查', description: '查看当前 DCF Runtime 的实际运行状态。' },
  'dcf.shell_adjuster': { title: '壳体调节（旧版）', description: '调整 DCF 侧栏的位置和尺寸。' },
  'dcf.standard.shell-adjuster': { title: '壳体调节', description: '调整侧栏宽度、高度、边距和停靠方向。' },
  'dcf.store_probe': { title: '存储探针', description: '检查 DCF 存储读写与状态恢复。' },
  'dcf.ui_siderail_control': { title: '侧栏控制', description: '调整 DCF 侧栏布局与停靠方式。' },
  'dcf.ui_visual_control': { title: '视觉布局控制', description: '调整 DCF 界面的视觉与布局表现。' },
  'dcf.ui.runtime-workspace': { title: '对话环境工作区', description: '提供功能与维护两种期望环境投影视图。' }
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function unique(values) { return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))); }
function hasCjk(value) { return /[\u3400-\u9fff]/.test(String(value || '')); }
function activePack(entry) { const revision = entry && entry.active_revision; return entry && entry.revisions && entry.revisions[revision] && entry.revisions[revision].pack || null; }


function hasNonModuleRuntimeContribution(pack) {
  const source = pack && typeof pack === 'object' ? pack : {};
  if (Array.isArray(source.resources) && source.resources.length) return true;
  const contributes = source.contributes && typeof source.contributes === 'object' ? source.contributes : {};
  for (const key of ['content_types', 'surfaces', 'ui_views', 'styles']) {
    if (Array.isArray(contributes[key]) && contributes[key].length) return true;
  }
  for (const key of ['appearance', 'settings', 'policies', 'content']) {
    if (contributes[key] && typeof contributes[key] === 'object' && Object.keys(contributes[key]).length) return true;
  }
  return false;
}

function packageSupersessionStatus(entry, registry) {
  const pack = activePack(entry) || {};
  const moduleIds = (Array.isArray(pack.modules) ? pack.modules : []).map((module) => String(module && module.id || '')).filter(Boolean);
  const map = registry && registry.moduleSupersession && registry.moduleSupersession.entries || {};
  const superseded = moduleIds.filter((id) => !!map[id]);
  const replacements = unique(superseded.map((id) => map[id] && map[id].by));
  return {
    fully_superseded: moduleIds.length > 0 && superseded.length === moduleIds.length && !hasNonModuleRuntimeContribution(pack),
    module_ids: moduleIds,
    superseded_module_ids: superseded,
    replacements
  };
}

function packagePresentation(entry) {
  const pack = activePack(entry) || {};
  const modules = Array.isArray(pack.modules) ? pack.modules : [];
  const contributes = pack.contributes && typeof pack.contributes === 'object' ? pack.contributes : {};
  const surfaces = Array.isArray(contributes.surfaces) ? contributes.surfaces : [];
  const views = Array.isArray(contributes.ui_views) ? contributes.ui_views : [];
  const contentTypes = Array.isArray(contributes.content_types) ? contributes.content_types : [];
  const known = modules.map((module) => LEGACY_PRESENTATION[String(module && module.id || '')]).find(Boolean) || LEGACY_PRESENTATION[String(entry && entry.package_id || '')] || null;
  const explicitTitle = firstText(pack.title, pack.display_name, pack.name, pack.label);
  const moduleTitles = unique(modules.map((module) => module && module.title));
  const surfaceTitles = unique(surfaces.map((surface) => surface && surface.title));
  const viewTitles = unique(views.map((view) => view && (view.title || view.tab_label)));
  const contentTitles = unique(contentTypes.map((type) => type && type.title));
  let title = '';
  if (hasCjk(explicitTitle)) title = explicitTitle;
  else if (known) title = known.title;
  else if (moduleTitles.some(hasCjk)) title = moduleTitles.find(hasCjk);
  else if (viewTitles.some(hasCjk)) title = viewTitles.find(hasCjk);
  else if (surfaceTitles.some(hasCjk)) title = surfaceTitles.find(hasCjk);
  else if (contentTitles.some(hasCjk)) title = contentTitles.find(hasCjk);
  else if (modules.length) title = modules.some((module) => module && module.kind === 'ammo') ? '语言弹药功能包' : 'DCF 功能模块包';
  else if (views.length || surfaces.length) title = '界面入口扩展包';
  else if (contentTypes.length) title = '内容类型扩展包';
  else if (contributes.appearance) title = '界面外观扩展包';
  else title = 'DCF 扩展包';
  const explicitDescription = firstText(pack.description, pack.summary, pack.purpose);
  const moduleDescriptions = unique(modules.map((module) => firstText(module && module.description, module && module.summary, module && module.purpose)));
  const blockTitles = unique(modules.flatMap((module) => Array.isArray(module && module.blocks) ? module.blocks.map((block) => block && block.title) : []));
  const commandLabels = unique(modules.flatMap((module) => {
    const direct = Array.isArray(module && module.commands) ? module.commands : [];
    const blocked = Array.isArray(module && module.blocks) ? module.blocks.flatMap((block) => Array.isArray(block && block.commands) ? block.commands : []) : [];
    return direct.concat(blocked).map((command) => command && (command.label || command.title));
  }));
  let description = '';
  if (hasCjk(explicitDescription)) description = explicitDescription;
  else if (known) description = known.description;
  else if (moduleDescriptions.some(hasCjk)) description = moduleDescriptions.find(hasCjk);
  else if (blockTitles.some(hasCjk)) description = `功能包括：${blockTitles.filter(hasCjk).slice(0, 4).join('、')}。`;
  else if (commandLabels.some(hasCjk)) description = `提供：${commandLabels.filter(hasCjk).slice(0, 4).join('、')}${commandLabels.filter(hasCjk).length > 4 ? '等' : ''}。`;
  else if (viewTitles.some(hasCjk)) description = `提供「${viewTitles.filter(hasCjk).slice(0, 2).join('、')}」环境视图。`;
  else if (surfaceTitles.some(hasCjk)) description = `提供「${surfaceTitles.filter(hasCjk).slice(0, 2).join('、')}」界面入口。`;
  else if (contentTitles.some(hasCjk)) description = `提供「${contentTitles.filter(hasCjk).slice(0, 2).join('、')}」内容类型。`;
  else if (moduleTitles.some(hasCjk)) description = `包含：${moduleTitles.filter(hasCjk).slice(0, 3).join('、')}。`;
  else description = '提供 DCF 的扩展功能；英文 ID 保留为技术标识。';
  return { title, description };
}

function createPackageManager(engine, catalog, reconciler) {
  function sortedPackages() {
    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => packagePresentation(a).title.localeCompare(packagePresentation(b).title, 'zh-CN') || String(a.package_id).localeCompare(String(b.package_id)));
  }
  function status(entry) { return packageSupersessionStatus(entry, engine.getRegistry()); }
  function packages() { return sortedPackages().filter((entry) => !status(entry).fully_superseded); }
  function supersededPackages() { return sortedPackages().filter((entry) => status(entry).fully_superseded); }
  function installJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    const wrapper = `<<<DCF_MODULE_PACK\n${JSON.stringify(parsed)}\nDCF_MODULE_PACK>>>`;
    const decoded = decodeArtifacts(wrapper);
    if (decoded.errors.length || decoded.artifacts.length !== 1) throw new Error(decoded.errors[0] && decoded.errors[0].error || 'invalid package');
    return reconciler ? reconciler.accept(decoded.artifacts[0], { kind: 'manual-json' }) : engine.applyArtifact(decoded.artifacts[0], { kind: 'manual-json' });
  }
  function assertMutable(id) { if (REQUIRED_PRODUCT_PACKAGES.includes(String(id))) throw new Error(`${id} is required by the DCF product value loop`); }
  function intent(value, material) { return reconciler ? reconciler.acceptIntent(value, material) : engine.applyEnvironmentIntent(value, material); }
  return {
    packages,
    supersededPackages,
    supersessionStatus: status,
    environment: () => engine.getEnvironment(),
    presentation: packagePresentation,
    installJson,
    setEnabled: (id, enabled) => { if (!enabled) assertMutable(id); return intent({ type: 'environment.package.enable', package_id: id, enabled: !!enabled }); },
    uninstall: (id) => { assertMutable(id); return intent({ type: 'environment.package.remove', package_id: id }); },
    switchRevision: (id, revision) => intent({ type: 'environment.package.select', package_id: id, revision }),
    checkUpdates: (force) => catalog.check({ force: !!force }),
    isRequired: (id) => REQUIRED_PRODUCT_PACKAGES.includes(String(id))
  };
}

module.exports = { createPackageManager, packagePresentation, activePack, packageSupersessionStatus, LEGACY_PRESENTATION };

},
"src/modules/module-roles.js":function(module,exports,require){
'use strict';

const LEGACY_DAILY_MODULE_IDS = new Set([
  'dcf.ammo_workbench',
  'dcf.ammo_workspace.unified',
  'dcf.language_ammo'
]);

const LEGACY_MAINTENANCE_MODULE_IDS = new Set([
  'dcf.ammo_library.dcf_kernel_maintenance',
  'dcf.block_scanner',
  'dcf.capability_gap_probe',
  'dcf.command_runtime_probe',
  'dcf.feedback_safety_probe',
  'dcf.kernel_acceptance',
  'dcf.maintenance_feedback',
  'dcf.module_authoring',
  'dcf.runtime_inspector',
  'dcf.shell_adjuster',
  'dcf.standard.shell-adjuster',
  'dcf.store_probe',
  'dcf.ui_siderail_control',
  'dcf.ui_visual_control'
]);

function userDisplay(root, moduleId) {
  return root && root.user && root.user.moduleDisplay && root.user.moduleDisplay[moduleId] || null;
}

function projectedDisplay(registry, moduleId) {
  return registry && registry.moduleDisplay && registry.moduleDisplay[moduleId] || {};
}

function roleFrom(value) {
  if (!value) return null;
  if (value.role === 'daily' || value.role === 'maintenance') return value.role;
  if (value.area === 'maintenance') return 'maintenance';
  if (value.area === 'work' || value.area === 'primary') return 'daily';
  return null;
}

function classifyModule(root, registry, module) {
  const id = String(module && module.id || '');
  if (module && module.kind === 'ammo') return { role: 'ammo', source: 'module-kind' };

  const userRole = roleFrom(userDisplay(root, id));
  if (userRole) return { role: userRole, source: 'user' };

  if (LEGACY_MAINTENANCE_MODULE_IDS.has(id)) return { role: 'maintenance', source: 'legacy-product-map' };
  if (LEGACY_DAILY_MODULE_IDS.has(id)) return { role: 'daily', source: 'legacy-product-map' };

  const displayRole = roleFrom(projectedDisplay(registry, id));
  if (displayRole) return { role: displayRole, source: 'declaration' };

  const moduleRole = roleFrom(module);
  if (moduleRole) return { role: moduleRole, source: 'module' };

  return { role: 'daily', source: 'default' };
}

function modulesByRole(root, registry) {
  const result = { ammo: [], daily: [], maintenance: [] };
  for (const module of registry && registry.modules || []) {
    const classification = classifyModule(root, registry, module);
    result[classification.role].push(module);
  }
  for (const modules of Object.values(result)) modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return result;
}

module.exports = {
  LEGACY_DAILY_MODULE_IDS,
  LEGACY_MAINTENANCE_MODULE_IDS,
  classifyModule,
  modulesByRole
};

},
"src/modules/health.js":function(module,exports,require){
'use strict';

const { VERSION, ROOT_KEY } = require("src/core/constants.js");
const { nowIso } = require("src/core/utils.js");

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
    const performanceState = typeof runtime.getPerformance === 'function' ? runtime.getPerformance() : null;
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
    if (!performanceState) {
      add('runtime_conversation_performance_missing', 'error', 'conversation-performance', 'the current Runtime exposes the long-conversation performance controller', 'missing', null, 'The required performance package exists without its trusted Host controller.');
    } else if (performanceState.mode !== 'off' && performanceState.turn_count >= performanceState.activation_turns && !performanceState.content_visibility_supported) {
      add('runtime_content_visibility_unsupported', 'warning', 'conversation-performance', 'the browser supports content-visibility:auto', false, { mode: performanceState.mode }, 'The safe rendering optimization cannot be applied by this browser; window mode remains reversible but may provide less benefit.');
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
        current_tab: ui && ui.current_tab || null,
        conversation_performance: performanceState ? {
          mode: performanceState.mode, turn_count: performanceState.turn_count, optimized_count: performanceState.optimized_count, hidden_count: performanceState.hidden_count,
          selector_strategy: performanceState.selector_strategy, long_tasks_60s: performanceState.long_tasks_60s, long_task_duration_ms_60s: performanceState.long_task_duration_ms_60s
        } : null
      },
      deviations,
      privacy: {
        conversation_text_included: false,
        ammo_bodies_included: false,
        package_payloads_included: false,
        command_arguments_included: false,
        authentication_data_included: false,
        message_bodies_included: false
      }
    };
  }

  function format() {
    return `<<<DCF_RUNTIME_HEALTH\n${JSON.stringify(report(), null, 2)}\nDCF_RUNTIME_HEALTH>>>`;
  }

  return { report, format };
}

module.exports = { createHealthReporter, legacyInventory, activePackModules, difference, duplicates };

},
"src/modules/maintenance.js":function(module,exports,require){
'use strict';

const { CATALOG_STATE_KEY } = require("src/core/constants.js");
const { safeId } = require("src/core/utils.js");

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

},
"src/ui/app.js":function(module,exports,require){
'use strict';

const { UI_KEY } = require("src/core/constants.js");
const { commandList } = require("src/runtime/commands.js");
const { classifyModule, modulesByRole } = require("src/modules/module-roles.js");

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
  const { engine, ammo, packageManager, maintenance, commandRunner, reconciler, storage, version } = options;
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
      button{border:1px solid #9995;border-radius:9px;background:transparent;color:inherit;padding:6px 8px;cursor:pointer}button:hover{background:#8882}button.danger{border-color:#dc262666}.top{height:42px;flex:0 0 42px;display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #9993;box-sizing:border-box}.top b{margin-right:auto}.tabs{display:flex;gap:5px}.tabs button.on{background:#2563eb22;border-color:#2563eb66}.body{flex:1;min-height:0;overflow:auto;padding:9px;box-sizing:border-box}.card{border:1px solid #9994;border-radius:12px;background:#8881;padding:9px;margin-bottom:9px;box-sizing:border-box}.name{font-weight:700}.mini{font-size:11px;opacity:.7;word-break:break-all}.section-title{font-size:12px;font-weight:700;opacity:.8;margin:12px 2px 7px}.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}textarea,input{width:100%;box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:7px}select{box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:6px}textarea{min-height:120px}.notice{padding:6px 9px;border-bottom:1px solid #9993;font-size:12px}.notice:empty{display:none}.row{display:flex;gap:6px;align-items:center}.row>*{min-width:0}.grow{flex:1}.pkg{padding-top:8px;margin-top:8px;border-top:1px solid #9993}.receipt{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.health-healthy{border-color:#16a34a66}.health-warning{border-color:#d9770666}.health-error{border-color:#dc262666}.state-pill{font-size:10px;padding:2px 6px;border:1px solid #9995;border-radius:999px}.state-pill.daily{border-color:#16a34a66}.state-pill.maintenance{border-color:#2563eb66}
      details.card{padding:0}details.card>summary{list-style:none;cursor:pointer;padding:9px}details.card>summary::-webkit-details-marker{display:none}details.card>summary:before{content:'▸';display:inline-block;width:16px;opacity:.7}details.card[open]>summary:before{content:'▾'}details.card>.module-body,details.card>.detail-body{padding:0 9px 9px}.module-summary{display:flex;align-items:flex-start;gap:5px}.module-summary .grow{display:block}.module-summary .fold-hint{font-size:10px;opacity:.55;margin-left:auto}.health-count{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:6px}.package-toolbar{padding:8px}.package-toolbar>.row{align-items:flex-start}.package-toolbar>.row>button{white-space:nowrap}.package-install{margin-top:7px;border-top:1px solid #9993}.package-install>summary{cursor:pointer;padding-top:7px;font-size:11px;opacity:.75}.package-install>.detail-body{padding-top:7px}.package-list{padding:0 9px}.package-card{padding:8px 0;border-bottom:1px solid #9993}.package-card:last-child{border-bottom:0}.package-title-row{display:flex;align-items:center;gap:6px}.package-title-row .name{flex:1;min-width:0}.package-description{font-size:11px;line-height:1.35;opacity:.78;margin-top:2px}.package-id{margin-top:2px}.package-controls{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:6px}.package-controls select{width:auto;min-width:72px;max-width:118px;padding:4px 22px 4px 6px}.package-controls button{padding:4px 7px}.package-version{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;border:1px solid #9994;border-radius:8px}.state-pill.enabled{border-color:#16a34a66}.state-pill.disabled{border-color:#d9770666}.state-pill.required{border-color:#7c3aed66}
    </style><style id="package-style"></style><aside class="sh"><div class="top"></div><div class="notice"></div><div class="body"></div></aside>`;
  doc.documentElement.appendChild(hostElement);
  const shell = root.querySelector('.sh');
  const top = root.querySelector('.top');
  const body = root.querySelector('.body');
  const notice = root.querySelector('.notice');
  const packageStyle = root.querySelector('#package-style');
  const initialSession = storage.get(UI_KEY, { tab: 'ammo', collapsed_modules: {} }) || {};
  let tab = initialSession.tab || 'ammo';
  let collapsedModules = initialSession.collapsed_modules && typeof initialSession.collapsed_modules === 'object' ? Object.assign({}, initialSession.collapsed_modules) : {};
  let packageDraft = '';
  let profileDraft = '';
  let ammoQuery = '';
  let ammoDraft = null;
  let fenceFrame = 0;

  function saveSession() {
    storage.set(UI_KEY, { tab, collapsed_modules: collapsedModules });
  }

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

  function environmentViews() {
    const defaults = {
      ammo: { id: 'ammo', kind: 'content', tab_label: '弹药', title: '语言弹药', order: 10 },
      functions: { id: 'functions', kind: 'actions', tab_label: '功能', title: '日常功能', order: 20 },
      packages: { id: 'packages', kind: 'composition', tab_label: '构成', title: '期望环境构成', order: 30 },
      maintenance: { id: 'maintenance', kind: 'observation', tab_label: '维护', title: '环境观察与恢复', order: 40 }
    };
    const supplied = engine.getRegistry().uiViews || {};
    return Object.values(Object.assign({}, defaults, supplied)).filter((view) => ['ammo', 'functions', 'packages', 'maintenance'].includes(String(view.id))).sort((a, b) => Number(a.order || 1000) - Number(b.order || 1000));
  }

  function currentView() { return environmentViews().find((view) => String(view.id) === String(tab)) || environmentViews()[0]; }

  function renderTop() {
    const views = environmentViews();
    if (!views.some((view) => String(view.id) === String(tab))) tab = views[0] && views[0].id || 'ammo';
    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class="tabs">${views.map((view) => `<button data-tab="${escapeHtml(view.id)}" class="${tab === view.id ? 'on' : ''}">${escapeHtml(view.tab_label || view.title || view.id)}</button>`).join('')}</div>`;
  }

  function ammoLabels(view) {
    return Object.assign({
      extract: '从当前对话提取', new_item: '新建弹药', search_placeholder: '查找标题、用途、标签或 ID',
      fire_mode: '发射', fire: '发射', copy: '复制', update: '更新', edit: '编辑', remove: '删除',
      save: '保存', cancel: '取消', id: 'ID', title: '标题', purpose: '用途', tags: '标签', body: '正文'
    }, view.labels || {});
  }

  function startAmmoDraft(item) {
    ammoDraft = {
      original_id: item && item.id || '',
      id: item && item.id || `ammo-${Date.now().toString(36)}`,
      title: item && item.title || '',
      purpose: item && item.purpose || '',
      tags: Array.isArray(item && item.tags) ? item.tags.join(', ') : '',
      body: item && item.body || ''
    };
  }

  function saveAmmoDraft() {
    if (!ammoDraft) throw new Error('没有待保存的弹药');
    const id = String(ammoDraft.id || '').trim();
    const bodyText = String(ammoDraft.body || '').trim();
    if (!id) throw new Error('弹药 ID 不能为空');
    if (!bodyText) throw new Error('弹药正文不能为空');
    const existing = ammoDraft.original_id ? ammo.items().find((entry) => entry.id === ammoDraft.original_id) : null;
    if (!ammoDraft.original_id && ammo.items().some((entry) => entry.id === id)) throw new Error(`弹药 ${id} 已存在`);
    const value = Object.assign({}, existing || {}, {
      id,
      title: String(ammoDraft.title || id).trim() || id,
      purpose: String(ammoDraft.purpose || '').trim(),
      body: bodyText
    });
    const tags = String(ammoDraft.tags || '').split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) value.tags = Array.from(new Set(tags));
    else delete value.tags;
    ammoDraft = null;
    return reconciler.acceptIntent({ type: 'environment.resource.upsert', resource_type: 'ammo', resource_id: id }, { value });
  }

  function renderAmmo() {
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.ammo || {};
    const labels = ammoLabels(view);
    const items = ammo.items();
    const query = String(ammoQuery || '').trim().toLocaleLowerCase();
    const visibleItems = query ? items.filter((item) => [item.id, item.title, item.purpose, Array.isArray(item.tags) ? item.tags.join(' ') : ''].join(' ').toLocaleLowerCase().includes(query)) : items;
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    const editor = ammoDraft ? `<div class="card ammo-editor"><div class="name">${escapeHtml(ammoDraft.original_id ? '编辑语言弹药' : '新建语言弹药')}</div><div class="mini">${escapeHtml(labels.id)}</div><input data-role="ammo-draft-id" value="${escapeHtml(ammoDraft.id)}" ${ammoDraft.original_id ? 'readonly' : ''}><div class="mini">${escapeHtml(labels.title)}</div><input data-role="ammo-draft-title" value="${escapeHtml(ammoDraft.title)}"><div class="mini">${escapeHtml(labels.purpose)}</div><input data-role="ammo-draft-purpose" value="${escapeHtml(ammoDraft.purpose)}"><div class="mini">${escapeHtml(labels.tags)}</div><input data-role="ammo-draft-tags" value="${escapeHtml(ammoDraft.tags)}"><div class="mini">${escapeHtml(labels.body)}</div><textarea data-role="ammo-draft-body">${escapeHtml(ammoDraft.body)}</textarea><div class="actions"><button data-action="ammo-save">${escapeHtml(labels.save)}</button><button data-action="ammo-cancel">${escapeHtml(labels.cancel)}</button></div></div>` : '';
    const search = items.length ? `<div class="card"><input data-role="ammo-search" placeholder="${escapeHtml(labels.search_placeholder)}" value="${escapeHtml(ammoQuery)}"><div class="mini">${query ? `显示 ${visibleItems.length} / ${items.length}` : `共 ${items.length} 枚弹药`}</div></div>` : '';
    body.innerHTML = `<div class="card"><div class="name">${escapeHtml(view.title || '语言弹药工作台')}</div><div class="mini">${escapeHtml(view.description || '在一个入口中提取、新建、编辑、查找、调用、更新和管理语言弹药。')}</div><div class="actions"><button data-action="ammo-extract">${escapeHtml(labels.extract)}</button><button data-action="ammo-new">${escapeHtml(labels.new_item)}</button><button data-action="ammo-mode">${escapeHtml(labels.fire_mode)}：${mode === 'send' ? '直接发送' : '填入输入框'}</button></div></div>${editor}${search}` +
      (visibleItems.length ? visibleItems.map((item) => `<div class="card" data-ammo-id="${escapeHtml(item.id)}"><div class="name">${escapeHtml(item.title || item.id)}</div><div class="mini">${escapeHtml(item.purpose || item.id)}</div><div class="actions"><button data-action="ammo-fire">${escapeHtml(labels.fire)}</button><button data-action="ammo-copy">${escapeHtml(labels.copy)}</button><button data-action="ammo-update">${escapeHtml(labels.update)}</button><button data-action="ammo-edit">${escapeHtml(labels.edit)}</button><button data-action="ammo-delete" class="danger">${escapeHtml(labels.remove)}</button></div></div>`).join('') : `<div class="card mini">${query ? '没有匹配的语言弹药。' : '弹药库为空。可以直接新建，或从当前对话提取。'}</div>`);
  }

  function moduleDisplay(module) {
    return engine.getRegistry().moduleDisplay && engine.getRegistry().moduleDisplay[module.id] || {};
  }

  function moduleOrder(module) {
    const display = moduleDisplay(module);
    return Number(display.order != null ? display.order : module.order != null ? module.order : 1000);
  }

  function isCollapsed(module, role) {
    if (Object.prototype.hasOwnProperty.call(collapsedModules, module.id)) return collapsedModules[module.id] === true;
    return role === 'maintenance';
  }

  function renderModuleCards(modules, role, emptyText) {
    modules = modules.slice().sort((a, b) => moduleOrder(a) - moduleOrder(b) || String(a.id).localeCompare(String(b.id)));
    if (!modules.length) return `<div class="card mini">${escapeHtml(emptyText || '暂无功能')}</div>`;
    return modules.map((module) => {
      const display = moduleDisplay(module);
      const entries = commandList(module);
      const grouped = [];
      for (const entry of entries) {
        const blockTitle = entry.block && entry.block.title;
        if (blockTitle && !grouped.includes(blockTitle)) grouped.push(blockTitle);
      }
      const open = !isCollapsed(module, role);
      return `<details class="card module-card" data-module-id="${escapeHtml(module.id)}" data-module-role="${escapeHtml(role)}" ${open ? 'open' : ''}><summary class="module-summary"><span class="grow"><span class="name">${escapeHtml(display.title || module.title || module.id)}</span><br><span class="mini">${escapeHtml(module.version || '')} · ${escapeHtml(module.id)}</span></span><span class="fold-hint">${open ? '收起' : '展开'}</span></summary><div class="module-body">${grouped.length ? `<div class="mini">${grouped.map(escapeHtml).join(' · ')}</div>` : ''}<div class="actions">${entries.map((entry) => `<button data-action="module-command" data-module-id="${escapeHtml(module.id)}" data-command-id="${escapeHtml(entry.command.id)}">${escapeHtml(entry.command.label || entry.command.title || entry.command.id)}</button>`).join('') || '<span class="mini">无可执行命令</span>'}</div></div></details>`;
    }).join('');
  }

  function roleLabel(role) {
    return role === 'maintenance' ? '维护' : '日常';
  }

  function renderRoleManager() {
    const registry = engine.getRegistry();
    const currentRoot = engine.getRoot();
    const modules = registry.modules.filter((module) => module.kind !== 'ammo').slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const rows = modules.map((module) => {
      const display = moduleDisplay(module);
      const classification = classifyModule(currentRoot, registry, module);
      return `<div class="pkg" data-role-module-id="${escapeHtml(module.id)}"><div class="row"><span class="grow"><span class="name">${escapeHtml(display.title || module.title || module.id)}</span><br><span class="mini">${escapeHtml(module.id)} · ${escapeHtml(classification.source)}</span></span><span class="state-pill ${escapeHtml(classification.role)}">${escapeHtml(roleLabel(classification.role))}</span></div><div class="actions"><button data-action="module-role" data-module-id="${escapeHtml(module.id)}" data-module-role="daily">日常功能</button><button data-action="module-role" data-module-id="${escapeHtml(module.id)}" data-module-role="maintenance">维护工具</button></div></div>`;
    }).join('');
    return `<details class="card"><summary><span class="name">功能分区管理</span></summary><div class="detail-body"><div class="mini">这里只决定模块属于日常功能还是维护工具。界面密度由各模块卡片的展开与折叠处理，模块不会因显示偏好而消失。</div>${rows}</div></details>`;
  }

  function renderFunctions() {
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.functions || {};
    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());
    body.innerHTML = `<section data-runtime-section="daily"><div class="card"><div class="name">${escapeHtml(view.title || '日常功能')}</div><div class="mini">${escapeHtml(view.description || '主力能力始终保留入口；点击模块标题展开或收起具体操作。')}</div></div>${renderModuleCards(groups.daily, 'daily', '暂无日常功能')}</section>`;
  }

  function renderPackages() {
    const entries = packageManager.packages();
    const supersededEntries = packageManager.supersededPackages();
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.packages || {};
    const labels = Object.assign({
      check_updates: '检查更新', manual_install: '手动安装包', install_json: '安装 JSON',
      package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON', switch_revision: '切换',
      enable: '启用', disable: '停用', uninstall: '卸载'
    }, view.labels || {});
    const stateLabels = Object.assign({ required: '核心', enabled: '已启用', disabled: '已停用', superseded: '已替代' }, view.state_labels || {});
    const controlOrder = Array.isArray(view.control_order) && view.control_order.length ? view.control_order : ['revision', 'switch', 'toggle', 'uninstall'];
    const density = view.density === 'comfortable' ? 'comfortable' : 'compact';
    const manualInstall = view.manual_install !== false && view.manual_install !== 'hidden';
    const manualOpen = view.manual_install === 'open' ? 'open' : '';
    const installPanel = manualInstall ? `<details class="package-install" ${manualOpen}><summary>${escapeHtml(labels.manual_install)}</summary><div class="detail-body"><textarea data-role="package-json" placeholder="${escapeHtml(labels.package_json_placeholder)}">${escapeHtml(packageDraft)}</textarea><div class="actions"><button data-action="package-install">${escapeHtml(labels.install_json)}</button></div></div></details>` : '';
    function packageCard(entry, retired) {
      const revisions = Object.keys(entry.revisions || {}).sort();
      const required = packageManager.isRequired(entry.package_id);
      const presentation = packageManager.presentation(entry);
      const enabled = entry.enabled !== false;
      const status = packageManager.supersessionStatus(entry);
      const stateClass = retired ? 'disabled' : required ? 'required' : enabled ? 'enabled' : 'disabled';
      const stateLabel = retired ? stateLabels.superseded : required ? stateLabels.required : enabled ? stateLabels.enabled : stateLabels.disabled;
      const controls = [];
      if (retired) {
        controls.push(`<span class="package-version">v${escapeHtml(entry.active_revision)}</span>`);
        if (!required) controls.push(`<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">${escapeHtml(labels.uninstall)}</button>`);
      } else {
        for (const control of controlOrder) {
          if (control === 'revision') {
            controls.push(revisions.length > 1
              ? `<select aria-label="选择版本" data-role="package-revision" data-id="${escapeHtml(entry.package_id)}">${revisions.map((revision) => `<option ${revision === entry.active_revision ? 'selected' : ''}>${escapeHtml(revision)}</option>`).join('')}</select>`
              : `<span class="package-version">v${escapeHtml(entry.active_revision)}</span>`);
          } else if (control === 'switch' && revisions.length > 1) controls.push(`<button data-action="package-switch" data-id="${escapeHtml(entry.package_id)}">${escapeHtml(labels.switch_revision)}</button>`);
          else if (control === 'toggle' && !required) controls.push(`<button data-action="package-toggle" data-id="${escapeHtml(entry.package_id)}">${escapeHtml(enabled ? labels.disable : labels.enable)}</button>`);
          else if (control === 'uninstall' && !required) controls.push(`<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">${escapeHtml(labels.uninstall)}</button>`);
        }
      }
      const replacement = retired && status.replacements.length ? `<div class="mini">由 ${escapeHtml(status.replacements.join('、'))} 替代</div>` : '';
      return `<div class="package-card" data-package-id="${escapeHtml(entry.package_id)}"><div class="package-title-row"><span class="name">${escapeHtml(presentation.title)}</span><span class="state-pill ${stateClass}">${escapeHtml(stateLabel)}</span></div><div class="package-description">${escapeHtml(presentation.description)}</div>${replacement}${view.show_technical_id === false ? '' : `<div class="mini package-id">${escapeHtml(entry.package_id)}</div>`}<div class="package-controls">${controls.join('')}</div></div>`;
    }
    const history = supersededEntries.length ? `<details class="card package-history"><summary><span class="name">已替代历史包（${supersededEntries.length}）</span></summary><div class="detail-body"><div class="mini">这些包的运行能力已经由当前完整实现接管，不再占用功能或维护入口。历史 revision 仍保留供恢复，也可以直接卸载。</div>${supersededEntries.map((entry) => packageCard(entry, true)).join('')}</div></details>` : '';
    body.innerHTML = `<div class="card package-toolbar"><div class="row"><span class="grow"><span class="name">${escapeHtml(view.title || '安装包管理')}</span><br><span class="mini">${escapeHtml(view.description || '包与 revision 的期望状态控制面。')}</span></span><button data-action="package-update">${escapeHtml(labels.check_updates)}</button></div>${installPanel}</div><section class="card package-list density-${density}" data-runtime-section="packages">${entries.map((entry) => packageCard(entry, false)).join('')}</section>${history}`;
  }

  function renderMaintenance() {
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.maintenance || {};
    const summary = maintenance.summary();
    const lastHealth = maintenance.lastHealthReport();
    const receipts = maintenance.receipts().slice(-8).reverse();
    const snapshots = maintenance.snapshots().slice().reverse();
    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());
    const profileState = maintenance.profiles();
    const healthStatus = lastHealth ? lastHealth.status : 'healthy';
    const deviationCount = lastHealth && Array.isArray(lastHealth.deviations) ? lastHealth.deviations.length : 0;
    body.innerHTML = `<div class="card"><div class="name">${escapeHtml(view.title || '环境观察与恢复')}</div><div class="mini">${escapeHtml(view.description || '观察期望环境在真实浏览器 Runtime 中是否成立，并提供恢复入口。')}</div></div><div class="card health-${escapeHtml(healthStatus)}"><div class="name">一键 Runtime 体检</div><div class="mini">从真实浏览器现场核对脚本实例、存储、内存运行态、实际 DOM、ChatGPT 宿主连接和最近失败。正常项保持安静，只复制无法合理解释的 Runtime 偏差。</div>${lastHealth ? `<div class="health-count">上次结果：${escapeHtml(healthStatus)} · ${deviationCount} deviations</div>` : ''}<div class="actions"><button data-action="maintenance-health-copy">体检并复制</button></div></div>
      <section data-runtime-section="maintenance-tools"><div class="section-title">维护工具</div>${renderModuleCards(groups.maintenance, 'maintenance', '暂无维护工具')}</section>
      ${renderRoleManager()}
      <details class="card"><summary><span class="name">环境 Profile</span></summary><div class="detail-body"><div class="mini">Profile 保存包选择、政策和界面组织，不复制用户弹药正文。</div><div class="row"><input data-role="profile-title" placeholder="环境名称" value="${escapeHtml(profileDraft)}"><button data-action="profile-save">保存当前环境</button></div>${profileState.items.length ? profileState.items.map((profile) => `<div class="pkg row"><span class="grow mini">${escapeHtml(profile.title)} · ${profile.package_count} packages${profileState.active_id === profile.id ? ' · 当前' : ''}</span><button data-action="profile-activate" data-profile-id="${escapeHtml(profile.id)}">激活</button><button data-action="profile-remove" data-profile-id="${escapeHtml(profile.id)}" class="danger">删除</button></div>`).join('') : '<div class="mini">暂无环境 Profile</div>'}</div></details>
      <details class="card"><summary><span class="name">运行摘要</span></summary><div class="detail-body"><div class="receipt">${escapeHtml(JSON.stringify(summary, null, 2))}</div><div class="actions"><button data-action="maintenance-copy">复制简要诊断</button><button data-action="receipts-clear">清空回执</button></div></div></details>
      <details class="card"><summary><span class="name">最近回执</span></summary><div class="detail-body">${receipts.length ? receipts.map((item) => `<div class="receipt pkg">${escapeHtml(JSON.stringify(item, null, 2))}</div>`).join('') : '<div class="mini">暂无回执</div>'}</div></details>
      <details class="card"><summary><span class="name">状态快照</span></summary><div class="detail-body">${snapshots.length ? snapshots.map((item) => `<div class="pkg row"><span class="grow mini">r${item.revision} · ${escapeHtml(item.reason)}</span><button data-action="rollback" data-revision="${item.revision}">恢复</button></div>`).join('') : '<div class="mini">暂无快照</div>'}</div></details>`;
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
    const view = currentView();
    if (view.kind === 'actions' || view.id === 'functions') renderFunctions();
    else if (view.kind === 'composition' || view.id === 'packages') renderPackages();
    else if (view.kind === 'observation' || view.id === 'maintenance') renderMaintenance();
    else renderAmmo();
    applyAppearance();
  }

  function setModuleRole(moduleId, role) {
    const current = engine.getRoot().user.moduleDisplay && engine.getRoot().user.moduleDisplay[moduleId] || {};
    const next = Object.assign({}, current, {
      role,
      area: role === 'maintenance' ? 'maintenance' : 'work'
    });
    delete next.hidden;
    return reconciler.acceptIntent({ type: 'environment.user.set', path: ['moduleDisplay', moduleId] }, { value: next });
  }

  function collectIds(selector, attribute) {
    return Array.from(root.querySelectorAll(selector)).map((node) => String(node.getAttribute(attribute) || '')).filter(Boolean);
  }

  function captureRuntimeViews() {
    const originalTab = tab;
    const originalScroll = body.scrollTop;
    const views = {};
    try {
      tab = 'packages'; render();
      views.packages = { entry_ids: collectIds('[data-package-id]', 'data-package-id') };
      tab = 'functions'; render();
      views.functions = {
        module_ids: collectIds('[data-runtime-section="daily"] > details.module-card[data-module-id]', 'data-module-id'),
        collapsed_module_ids: collectIds('[data-runtime-section="daily"] > details.module-card[data-module-id]:not([open])', 'data-module-id')
      };
      tab = 'maintenance'; render();
      views.maintenance = {
        module_ids: collectIds('[data-runtime-section="maintenance-tools"] > details.module-card[data-module-id]', 'data-module-id'),
        collapsed_module_ids: collectIds('[data-runtime-section="maintenance-tools"] > details.module-card[data-module-id]:not([open])', 'data-module-id')
      };
    } finally {
      tab = originalTab;
      render();
      body.scrollTop = originalScroll;
    }
    const rect = shell.getBoundingClientRect();
    const style = typeof windowObject.getComputedStyle === 'function' ? windowObject.getComputedStyle(shell) : null;
    const viewport = windowObject.visualViewport ? { width: windowObject.visualViewport.width, height: windowObject.visualViewport.height, left: windowObject.visualViewport.offsetLeft || 0, top: windowObject.visualViewport.offsetTop || 0 } : { width: windowObject.innerWidth, height: windowObject.innerHeight, left: 0, top: 0 };
    const visible = !!(shell.isConnected && rect.width > 0 && rect.height > 0 && (!style || (style.display !== 'none' && style.visibility !== 'hidden')));
    const intersectsViewport = visible && rect.right > viewport.left && rect.bottom > viewport.top && rect.left < viewport.left + viewport.width && rect.top < viewport.top + viewport.height;
    return {
      schema: 'dcf.ui.runtime.snapshot.v1',
      host_count: doc.querySelectorAll('#dcf-chatgpt-microcore-host').length,
      host_connected: hostElement.isConnected,
      shadow_root_attached: hostElement.shadowRoot === root,
      shell_connected: shell.isConnected,
      shell_visible: visible,
      shell_intersects_viewport: intersectsViewport,
      shell_rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      current_tab: originalTab,
      tab_ids: collectIds('.tabs [data-tab]', 'data-tab'),
      version_text: String((top.querySelector('b') && top.querySelector('b').textContent) || ''),
      views
    };
  }

  root.addEventListener('input', (event) => {
    const role = event.target && event.target.dataset.role;
    if (role === 'package-json') packageDraft = event.target.value;
    if (role === 'profile-title') profileDraft = event.target.value;
    if (role === 'ammo-search') {
      ammoQuery = event.target.value;
      renderAmmo();
      const input = root.querySelector('[data-role=ammo-search]');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    if (ammoDraft && role && role.startsWith('ammo-draft-')) ammoDraft[role.slice('ammo-draft-'.length)] = event.target.value;
  });

  root.addEventListener('click', (event) => {
    const moduleSummary = event.target.closest('details[data-module-id] > summary');
    if (moduleSummary) {
      const details = moduleSummary.parentElement;
      collapsedModules[details.dataset.moduleId] = details.open;
      saveSession();
      return;
    }

    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) {
      tab = button.dataset.tab;
      saveSession();
      render();
      return;
    }
    const action = button.dataset.action;
    const card = button.closest('[data-ammo-id]');
    const item = card ? ammo.items().find((entry) => entry.id === card.dataset.ammoId) : null;
    if (action === 'ammo-new') { startAmmoDraft(null); render(); }
    else if (action === 'ammo-edit' && item) { startAmmoDraft(item); render(); }
    else if (action === 'ammo-save') runAndRender(() => saveAmmoDraft(), '语言弹药已保存');
    else if (action === 'ammo-cancel') { ammoDraft = null; render(); }
    else if (action === 'ammo-extract') runAndRender(() => ammo.requestExtract(), '提取请求已发送');
    else if (action === 'ammo-mode') {
      const current = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
      runAndRender(() => reconciler.acceptIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: current === 'send' ? 'insert' : 'send' }), '发射方式已更新');
    } else if (action === 'ammo-fire' && item) runAndRender(() => ammo.fire(item), '弹药已发射');
    else if (action === 'ammo-copy' && item) runAndRender(() => ammo.copy(item), '已复制');
    else if (action === 'ammo-update' && item) runAndRender(() => ammo.requestUpdate(item), '更新请求已发送');
    else if (action === 'ammo-delete' && item) runAndRender(() => reconciler.acceptIntent({ type: 'environment.resource.remove', resource_type: 'ammo', resource_id: item.id }), '已删除');
    else if (action === 'package-install') runAndRender(() => packageManager.installJson(packageDraft), '安装包已安装');
    else if (action === 'package-update') runAndRender(() => packageManager.checkUpdates(true), '更新检查完成');
    else if (action === 'package-toggle') {
      const entry = packageManager.packages().find((pkg) => pkg.package_id === button.dataset.id);
      runAndRender(() => packageManager.setEnabled(button.dataset.id, entry && entry.enabled === false), '安装包状态已更新');
    } else if (action === 'package-uninstall') runAndRender(() => packageManager.uninstall(button.dataset.id), '安装包已卸载');
    else if (action === 'package-switch') {
      const select = Array.from(root.querySelectorAll('select[data-role="package-revision"]')).find((entry) => entry.dataset.id === button.dataset.id);
      runAndRender(() => packageManager.switchRevision(button.dataset.id, select.value), '版本已切换');
    } else if (action === 'module-command') {
      const module = engine.getRegistry().modules.find((entry) => entry.id === button.dataset.moduleId);
      const found = module && commandList(module).find((entry) => String(entry.command.id) === String(button.dataset.commandId));
      if (module && found) runAndRender(() => commandRunner.execute(module, found.command, found.block), '命令已执行');
    } else if (action === 'module-role') {
      runAndRender(() => setModuleRole(button.dataset.moduleId, button.dataset.moduleRole), '功能分区已更新');
    } else if (action === 'maintenance-health-copy') runAndRender(() => maintenance.copyHealthReport(), 'Runtime 体检报告已复制');
    else if (action === 'maintenance-copy') runAndRender(() => maintenance.copySummary(), '简要诊断已复制');
    else if (action === 'receipts-clear') runAndRender(() => maintenance.clearReceipts(), '回执已清空');
    else if (action === 'profile-save') runAndRender(() => maintenance.saveProfile(profileDraft || '当前环境'), '环境 Profile 已保存');
    else if (action === 'profile-activate') runAndRender(() => maintenance.activateProfile(button.dataset.profileId), '环境 Profile 已激活');
    else if (action === 'profile-remove') runAndRender(() => maintenance.removeProfile(button.dataset.profileId), '环境 Profile 已删除');
    else if (action === 'rollback') runAndRender(() => maintenance.rollbackTo(Number(button.dataset.revision)), '状态已恢复');
  });

  windowObject.addEventListener('resize', scheduleFence, { passive: true });
  if (windowObject.visualViewport) {
    windowObject.visualViewport.addEventListener('resize', scheduleFence, { passive: true });
    windowObject.visualViewport.addEventListener('scroll', scheduleFence, { passive: true });
  }
  render();
  return { render, setNotice, captureRuntimeViews, destroy: () => hostElement.remove(), root, shell, hostElement };
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
const { createCapabilityReconciler } = require("src/runtime/reconciler.js");
const { createChatGPTHost } = require("src/host/chatgpt.js");
const { createConversationPerformanceController } = require("src/host/conversation-performance.js");
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require("src/modules/standard-packages.js");
const { createAmmoModule } = require("src/modules/ammo.js");
const { createCatalogTransport } = require("src/modules/catalog.js");
const { createPackageManager } = require("src/modules/package-manager.js");
const { createHealthReporter } = require("src/modules/health.js");
const { createMaintenanceModule } = require("src/modules/maintenance.js");
const { createApp } = require("src/ui/app.js");

function ensureProductBaseline(root) {
  let current = root;
  const projection = buildProjection(current);
  const candidate = clone(current);
  let changed = false;
  for (const packageId of REQUIRED_PRODUCT_PACKAGES) {
    const pack = STANDARD_PACKS.find((item) => item.pack_id === packageId);
    if (!pack) throw new Error(`required embedded package ${packageId} missing`);
    const entry = candidate.packages.packages[packageId];
    const resourceMissing = packageId === 'dcf.standard.ammo' && (!projection.ok || !projection.registry.contentTypes.ammo);
    const uiMissing = packageId === 'dcf.ui.package-management' && (!projection.ok || !projection.registry.uiViews || !projection.registry.uiViews.packages);
    if (!entry) {
      addPackRevision(candidate, pack, { kind: 'embedded-standard' });
      changed = true;
    } else if (entry.enabled === false || resourceMissing || uiMissing) {
      entry.enabled = true;
      candidate.packages.revision += 1;
      changed = true;
    }
  }
  return changed ? finalizeCandidate(current, candidate) : current;
}

function boot(api = globalThis) {
  const windowObject = api.window || (typeof window !== 'undefined' ? window : null);
  const storage = createStorage(api);
  const receiptStore = createReceiptStore(storage);
  let initialRoot = loadOrMigrate(storage, STANDARD_PACKS);
  initialRoot = ensureProductBaseline(initialRoot);
  const engine = createTransactionEngine(storage, receiptStore, { initialRoot });
  engine.initialize();
  const host = createChatGPTHost(windowObject);
  const conversationPerformance = createConversationPerformanceController(windowObject, { findConversationRoot: host.findConversationRoot, isStreaming: host.isStreaming });
  conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});
  const effects = createEffectRunner(host, receiptStore, conversationPerformance);
  const catalog = createCatalogTransport(storage, engine, api);
  const ammo = createAmmoModule(engine, effects);
  let app = null;
  const reconciler = createCapabilityReconciler(engine, catalog, receiptStore, {
    onCommitted: () => {
      conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});
      if (app) app.render();
    }
  });
  catalog.setApplyResolved((resolved) => reconciler.applyResolved(resolved));
  const packageManager = createPackageManager(engine, catalog, reconciler);
  const health = createHealthReporter(engine, receiptStore, storage, host, REQUIRED_PRODUCT_PACKAGES, {
    windowObject,
    getApp: () => app,
    getRuntime: () => api.__DCF_RUNTIME__ || null,
    getPerformance: () => conversationPerformance.diagnostics()
  });
  const maintenance = createMaintenanceModule(engine, receiptStore, effects, storage, health, reconciler);
  const commandRunner = createCommandRunner(engine, effects, receiptStore, () => {
    if (!app || !app.shell) return null;
    const rect = app.shell.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }, reconciler);
  app = createApp({ engine, ammo, packageManager, maintenance, commandRunner, reconciler, storage, version: VERSION });

  async function processReply(reply) {
    const decoded = decodeArtifacts(reply.text);
    let changed = false;
    let referenced = false;
    for (const artifact of decoded.artifacts) {
      const result = await Promise.resolve(reconciler.accept(artifact, { kind: 'chatgpt-reply', completed_at: reply.completed_at }));
      if (result.status === 'committed') changed = true;
      if (result.input_mode === 'reference') referenced = true;
    }
    for (const error of decoded.errors) receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'artifact.decode', source: reply.source }, status: 'rejected', error: error.error, marker: error.marker, preview: error.preview });
    if (changed) app.setNotice(referenced ? 'DCF 已拉取并协调指定能力包' : 'DCF 工件已协调到当前 Runtime');
    if (changed || decoded.errors.length) app.render();
  }

  host.startReplyObserver((reply) => {
    processReply(reply).catch((error) => receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'reply.reconcile' }, status: 'rejected', stage: 'runtime', error: String(error && error.message || error) }));
  });
  api.setTimeout(() => catalog.check().then((result) => { if (result && result.applied && result.applied.length) { app.setNotice('DCF 能力包已自动协调到最新版本'); app.render(); } }), 1600);

  if (typeof api.GM_registerMenuCommand === 'function') {
    api.GM_registerMenuCommand('DCF：检查能力包更新', () => catalog.check({ force: true }).then(() => app.render()));
    api.GM_registerMenuCommand('DCF：一键 Runtime 体检并复制', () => maintenance.copyHealthReport());
    api.GM_registerMenuCommand('DCF：复制简要诊断', () => maintenance.copySummary());
  }

  const runtime = { version: VERSION, engine, getEnvironment: () => engine.getEnvironment(), host, conversationPerformance, app, catalog, reconciler, receiptStore, health, maintenance };
  Object.defineProperty(runtime, 'environment', { enumerable: true, get: () => engine.getEnvironment() });
  api.__DCF_RUNTIME__ = runtime;
  return runtime;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot(globalThis);

module.exports = { boot, ensureProductBaseline };

}
};
const cache={};
function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}
require('src/index.js');
})();
