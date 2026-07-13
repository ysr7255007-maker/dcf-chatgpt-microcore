from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.lstrip('\n'))


def replace_once(path, old, new):
    target = ROOT / path
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'missing replacement in {path}: {old[:120]!r}')
    target.write_text(text.replace(old, new, 1))


write('src/core/environment.js', r'''
'use strict';

const { clone, isObject, nowIso } = require('./utils');

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
''')

write('src/core/intents.js', r'''
'use strict';

const { clone, isObject, nowIso, safeId } = require('./utils');
const { captureEnvironmentProfile, applyEnvironmentProfile } = require('./environment');

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
''')

write('src/core/transactions.js', r'''
'use strict';

const { ROOT_KEY, SNAPSHOT_KEY, RUNTIME_KEY } = require('./constants');
const { clone, nowIso, boundedPush } = require('./utils');
const { finalizeCandidate, validateRoot, addPackRevision } = require('./state');
const { buildProjection } = require('./projection');
const { environmentSnapshot } = require('./environment');
const { normalizeEnvironmentIntent, artifactToEnvironmentInput, applyEnvironmentTransition } = require('./intents');

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
''')

write('src/runtime/reconciler.js', r'''
'use strict';

const { clone, nowIso } = require('../core/utils');
const { artifactToEnvironmentInput, normalizeEnvironmentIntent } = require('../core/intents');

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
      schema: 'dcf.environment.reconcile.result.v1',
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
''')

# Root gains profile state without changing the authoritative schema.
replace_once('src/core/state.js',
"    moduleDisplay: {},\n    preferences: { ammo_fire_mode: 'insert' }",
"    moduleDisplay: {},\n    preferences: { ammo_fire_mode: 'insert' },\n    environmentProfiles: {},\n    active_environment_profile: null")
replace_once('src/core/state.js',
"  root.user.moduleDisplay = isObject(root.user.moduleDisplay) ? root.user.moduleDisplay : {};\n  root.system = deepMerge(EMPTY_ROOT.system, root.system || {});",
"  root.user.moduleDisplay = isObject(root.user.moduleDisplay) ? root.user.moduleDisplay : {};\n  root.user.environmentProfiles = isObject(root.user.environmentProfiles) ? root.user.environmentProfiles : {};\n  root.user.active_environment_profile = root.user.active_environment_profile || null;\n  root.system = deepMerge(EMPTY_ROOT.system, root.system || {});")
replace_once('src/core/state.js',
"return packageCount > 0 || contentCount > 0 || Object.keys(user.settings || {}).length > 0 || Object.keys(user.moduleDisplay || {}).length > 0 || Object.keys(user.appearance && user.appearance.vars || {}).length > 0 || !!(user.appearance && (user.appearance.side || user.appearance.css));",
"return packageCount > 0 || contentCount > 0 || Object.keys(user.settings || {}).length > 0 || Object.keys(user.moduleDisplay || {}).length > 0 || Object.keys(user.environmentProfiles || {}).length > 0 || Object.keys(user.appearance && user.appearance.vars || {}).length > 0 || !!(user.appearance && (user.appearance.side || user.appearance.css));")

# Resource compiler gains finite families and observation contracts.
replace_once('src/core/resources.js',
"const { clone, isObject, safeId } = require('./utils');\n",
"const { clone, isObject, safeId } = require('./utils');\n\nconst RESOURCE_FAMILIES = { content: 'content', action: 'action', view: 'view', style: 'style', policy: 'policy' };\n\nfunction resourceFamily(address) {\n  const value = String(address || '');\n  if (value.startsWith('content:') || value.startsWith('content-type:')) return RESOURCE_FAMILIES.content;\n  if (value.startsWith('module:')) return RESOURCE_FAMILIES.action;\n  if (value.startsWith('surface:') || value.startsWith('ui-view:') || value.startsWith('module-display:')) return RESOURCE_FAMILIES.view;\n  if (value.startsWith('appearance-') || value.startsWith('appearance-var:') || value.startsWith('style:')) return RESOURCE_FAMILIES.style;\n  return RESOURCE_FAMILIES.policy;\n}\n\nfunction observationContract(address) {\n  const family = resourceFamily(address);\n  if (family === 'action') return { registry: 'modules', runtime: 'module-entry' };\n  if (family === 'view') return { registry: 'uiViews/surfaces/moduleDisplay', runtime: 'view-entry' };\n  if (family === 'content') return { registry: 'content/contentTypes', runtime: 'content-entry' };\n  if (family === 'style') return { registry: 'appearance', runtime: 'computed-style' };\n  return { registry: 'settings/policies', runtime: 'state-only' };\n}\n")
replace_once('src/core/resources.js',
"    replaces: Array.isArray(replaces) ? replaces.map(String) : []\n",
"    replaces: Array.isArray(replaces) ? replaces.map(String) : [],\n    family: resourceFamily(address),\n    observation: observationContract(address)\n")
replace_once('src/core/resources.js',
"  for (const [key, value] of Object.entries(isObject(contributions.settings) ? contributions.settings : {})) {\n    claims.push(normalizeClaim(`setting-default:${key}`, value, provider, 'exclusive', replaces));\n  }",
"  for (const [key, value] of Object.entries(isObject(contributions.settings) ? contributions.settings : {})) {\n    claims.push(normalizeClaim(`setting-default:${key}`, value, provider, 'exclusive', replaces));\n  }\n  for (const [key, value] of Object.entries(isObject(contributions.policies) ? contributions.policies : {})) {\n    claims.push(normalizeClaim(`policy-default:${key}`, value, provider, 'exclusive', replaces));\n  }")
replace_once('src/core/resources.js',
"  const claims = resolveClaims(allClaims, ownership, errors);\n  return { ok: errors.length === 0, errors, claims, ownership, styles, activePackages };",
"  const claims = resolveClaims(allClaims, ownership, errors);\n  const resources = Array.from(claims.entries()).map(([address, claim]) => ({ address, family: claim.family || resourceFamily(address), provider: claim.provider, observation: clone(claim.observation || observationContract(address)) }));\n  return { ok: errors.length === 0, errors, claims, ownership, styles, activePackages, resourceGraph: { schema: 'dcf.environment.resource-graph.v1', resources } };" )
replace_once('src/core/resources.js',
"module.exports = { normalizePack, compilePackageSet, styleViolations, resolveClaims };",
"module.exports = { RESOURCE_FAMILIES, resourceFamily, observationContract, normalizePack, compilePackageSet, styleViolations, resolveClaims };")

# Projection publishes policy defaults and resource graph.
replace_once('src/core/projection.js',
"  const settingDefaults = {};",
"  const settingDefaults = {};\n  const policyDefaults = {};")
replace_once('src/core/projection.js',
"    else if (address.startsWith('setting-default:')) settingDefaults[address.slice(16)] = clone(claim.value);",
"    else if (address.startsWith('setting-default:')) settingDefaults[address.slice(16)] = clone(claim.value);\n    else if (address.startsWith('policy-default:')) policyDefaults[address.slice(15)] = clone(claim.value);")
replace_once('src/core/projection.js',
"    settings: Object.assign({}, settingDefaults, clone(user.settings || {})),\n    installedPacks: compiled.activePackages,",
"    settings: Object.assign({}, settingDefaults, clone(user.settings || {})),\n    policies: Object.assign({}, policyDefaults, clone(user.preferences || {})),\n    resources: clone(compiled.resourceGraph),\n    installedPacks: compiled.activePackages,")
replace_once('src/core/projection.js',
"      build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership }),",
"      build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership, resources: compiled.resourceGraph }),")

write('src/modules/package-manager.js', r'''
'use strict';

const { decodeArtifacts } = require('../core/artifacts');
const { REQUIRED_PRODUCT_PACKAGES } = require('./standard-packages');

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
  else if (moduleTitles.some(hasCjk)) description = `包含：${moduleTitles.filter(hasCjk).slice(0, 3).join('、')}。`;
  else description = '提供 DCF 的扩展功能；英文 ID 保留为技术标识。';
  return { title, description };
}

function createPackageManager(engine, catalog, reconciler) {
  function packages() {
    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => packagePresentation(a).title.localeCompare(packagePresentation(b).title, 'zh-CN') || String(a.package_id).localeCompare(String(b.package_id)));
  }
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

module.exports = { createPackageManager, packagePresentation, activePack, LEGACY_PRESENTATION };
''')

write('src/modules/maintenance.js', r'''
'use strict';

const { CATALOG_STATE_KEY } = require('../core/constants');
const { safeId } = require('../core/utils');

function createMaintenanceModule(engine, receiptStore, effectRunner, storage, healthReporter) {
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
  return {
    summary,
    copySummary,
    healthReport,
    lastHealthReport: () => lastHealth,
    copyHealthReport,
    receipts: () => receiptStore.list(),
    clearReceipts: () => receiptStore.clear(),
    snapshots: () => engine.snapshots(),
    rollbackTo: (revision) => engine.rollbackTo(revision),
    profiles: () => engine.getEnvironment().profiles,
    saveProfile: (title) => engine.saveEnvironmentProfile(String(title || '当前环境'), safeId(String(title || '当前环境')) || undefined),
    activateProfile: (id) => engine.activateEnvironmentProfile(id),
    removeProfile: (id) => engine.removeEnvironmentProfile(id)
  };
}

module.exports = { createMaintenanceModule };
''')

write('src/modules/standard-packages.js', r'''
'use strict';

const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management', 'dcf.ui.runtime-workspace'];

const STANDARD_PACKS = [
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.ammo',
    revision: '1.1.0',
    title: '语言弹药核心',
    description: '提供语言弹药内容、主入口和低摩擦发射能力。',
    contributes: {
      content_types: [{ id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy', 'update', 'delete'] }],
      surfaces: [{ id: 'dcf.ammo', title: '弹药', area: 'primary', order: 10, kind: 'content-list', content_type: 'ammo' }],
      ui_views: [{ id: 'ammo', kind: 'content', projection: 'content:ammo', tab_label: '弹药', title: '语言弹药', description: '自动提取、自动装填、更新与发射。', order: 10 }],
      appearance: { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } }
    },
    modules: [{ id: 'dcf.ammo.module', title: '语言弹药', version: '1.1.0', kind: 'ammo' }]
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
    revision: '1.1.0',
    title: '环境构成管理',
    description: '提供可自更新的中文能力构成总览、revision 控制和工件安装入口。',
    contributes: {
      ui_views: [{
        id: 'packages',
        kind: 'composition',
        projection: 'environment:capabilities',
        tab_label: '构成',
        title: '期望环境构成',
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
''')

# Index exposes the Environment Facade and injects unified reconciler into the app.
replace_once('src/index.js',
"  app = createApp({ engine, ammo, packageManager, maintenance, commandRunner, storage, version: VERSION });",
"  app = createApp({ engine, ammo, packageManager, maintenance, commandRunner, reconciler, storage, version: VERSION });")
replace_once('src/index.js',
"  api.__DCF_RUNTIME__ = { version: VERSION, engine, host, app, catalog, reconciler, receiptStore, health, maintenance };",
"  api.__DCF_RUNTIME__ = { version: VERSION, engine, environment: engine.getEnvironment(), getEnvironment: () => engine.getEnvironment(), host, app, catalog, reconciler, receiptStore, health, maintenance };")

# App reads package-owned views and sends persistent changes through environment intents.
replace_once('src/ui/app.js',
"  const { engine, ammo, packageManager, maintenance, commandRunner, storage, version } = options;",
"  const { engine, ammo, packageManager, maintenance, commandRunner, reconciler, storage, version } = options;")
replace_once('src/ui/app.js',
"  let packageDraft = '';\n  let fenceFrame = 0;",
"  let packageDraft = '';\n  let profileDraft = '';\n  let fenceFrame = 0;")
replace_once('src/ui/app.js',
"  function renderTop() {\n    const packageView = engine.getRegistry().uiViews && engine.getRegistry().uiViews.packages || {};\n    const packageTabLabel = packageView.tab_label || '包管理';\n    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class=\"tabs\">\n      <button data-tab=\"ammo\" class=\"${tab === 'ammo' ? 'on' : ''}\">弹药</button>\n      <button data-tab=\"functions\" class=\"${tab === 'functions' ? 'on' : ''}\">功能</button>\n      <button data-tab=\"packages\" class=\"${tab === 'packages' ? 'on' : ''}\">${escapeHtml(packageTabLabel)}</button>\n      <button data-tab=\"maintenance\" class=\"${tab === 'maintenance' ? 'on' : ''}\">维护</button>\n    </div>`;\n  }",
"  function environmentViews() {\n    const defaults = {\n      ammo: { id: 'ammo', kind: 'content', tab_label: '弹药', title: '语言弹药', order: 10 },\n      functions: { id: 'functions', kind: 'actions', tab_label: '功能', title: '日常功能', order: 20 },\n      packages: { id: 'packages', kind: 'composition', tab_label: '构成', title: '期望环境构成', order: 30 },\n      maintenance: { id: 'maintenance', kind: 'observation', tab_label: '维护', title: '环境观察与恢复', order: 40 }\n    };\n    const supplied = engine.getRegistry().uiViews || {};\n    return Object.values(Object.assign({}, defaults, supplied)).filter((view) => ['ammo', 'functions', 'packages', 'maintenance'].includes(String(view.id))).sort((a, b) => Number(a.order || 1000) - Number(b.order || 1000));\n  }\n\n  function currentView() { return environmentViews().find((view) => String(view.id) === String(tab)) || environmentViews()[0]; }\n\n  function renderTop() {\n    const views = environmentViews();\n    if (!views.some((view) => String(view.id) === String(tab))) tab = views[0] && views[0].id || 'ammo';\n    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class=\"tabs\">${views.map((view) => `<button data-tab=\"${escapeHtml(view.id)}\" class=\"${tab === view.id ? 'on' : ''}\">${escapeHtml(view.tab_label || view.title || view.id)}</button>`).join('')}</div>`;\n  }")
replace_once('src/ui/app.js',
"  function renderAmmo() {\n    const items = ammo.items();",
"  function renderAmmo() {\n    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.ammo || {};\n    const items = ammo.items();")
replace_once('src/ui/app.js',
"    body.innerHTML = `<div class=\"card\"><div class=\"name\">语言弹药</div><div class=\"mini\">自动提取、自动装填、更新与发射</div>",
"    body.innerHTML = `<div class=\"card\"><div class=\"name\">${escapeHtml(view.title || '语言弹药')}</div><div class=\"mini\">${escapeHtml(view.description || '自动提取、自动装填、更新与发射')}</div>")
replace_once('src/ui/app.js',
"  function renderFunctions() {\n    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());\n    body.innerHTML = `<section data-runtime-section=\"daily\"><div class=\"card\"><div class=\"name\">日常功能</div><div class=\"mini\">主力能力始终保留入口；点击模块标题展开或收起具体操作。</div></div>${renderModuleCards(groups.daily, 'daily', '暂无日常功能')}</section>`;\n  }",
"  function renderFunctions() {\n    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.functions || {};\n    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());\n    body.innerHTML = `<section data-runtime-section=\"daily\"><div class=\"card\"><div class=\"name\">${escapeHtml(view.title || '日常功能')}</div><div class=\"mini\">${escapeHtml(view.description || '主力能力始终保留入口；点击模块标题展开或收起具体操作。')}</div></div>${renderModuleCards(groups.daily, 'daily', '暂无日常功能')}</section>`;\n  }")
replace_once('src/ui/app.js',
"  function renderMaintenance() {\n    const summary = maintenance.summary();",
"  function renderMaintenance() {\n    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.maintenance || {};\n    const summary = maintenance.summary();")
replace_once('src/ui/app.js',
"    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());\n    const healthStatus",
"    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());\n    const profileState = maintenance.profiles();\n    const healthStatus")
replace_once('src/ui/app.js',
"    body.innerHTML = `<div class=\"card health-${escapeHtml(healthStatus)}\"><div class=\"name\">一键 Runtime 体检</div>",
"    body.innerHTML = `<div class=\"card\"><div class=\"name\">${escapeHtml(view.title || '环境观察与恢复')}</div><div class=\"mini\">${escapeHtml(view.description || '观察期望环境在真实浏览器 Runtime 中是否成立，并提供恢复入口。')}</div></div><div class=\"card health-${escapeHtml(healthStatus)}\"><div class=\"name\">一键 Runtime 体检</div>")
replace_once('src/ui/app.js',
"      ${renderRoleManager()}\n      <details class=\"card\"><summary><span class=\"name\">运行摘要</span></summary>",
"      ${renderRoleManager()}\n      <details class=\"card\"><summary><span class=\"name\">环境 Profile</span></summary><div class=\"detail-body\"><div class=\"mini\">Profile 保存包选择、政策和界面组织，不复制用户弹药正文。</div><div class=\"row\"><input data-role=\"profile-title\" placeholder=\"环境名称\" value=\"${escapeHtml(profileDraft)}\"><button data-action=\"profile-save\">保存当前环境</button></div>${profileState.items.length ? profileState.items.map((profile) => `<div class=\"pkg row\"><span class=\"grow mini\">${escapeHtml(profile.title)} · ${profile.package_count} packages${profileState.active_id === profile.id ? ' · 当前' : ''}</span><button data-action=\"profile-activate\" data-profile-id=\"${escapeHtml(profile.id)}\">激活</button><button data-action=\"profile-remove\" data-profile-id=\"${escapeHtml(profile.id)}\" class=\"danger\">删除</button></div>`).join('') : '<div class=\"mini\">暂无环境 Profile</div>'}</div></details>\n      <details class=\"card\"><summary><span class=\"name\">运行摘要</span></summary>")
replace_once('src/ui/app.js',
"  function render() {\n    renderTop();\n    if (tab === 'functions') renderFunctions();\n    else if (tab === 'packages') renderPackages();\n    else if (tab === 'maintenance') renderMaintenance();\n    else renderAmmo();",
"  function render() {\n    renderTop();\n    const view = currentView();\n    if (view.kind === 'actions' || view.id === 'functions') renderFunctions();\n    else if (view.kind === 'composition' || view.id === 'packages') renderPackages();\n    else if (view.kind === 'observation' || view.id === 'maintenance') renderMaintenance();\n    else renderAmmo();")
replace_once('src/ui/app.js',
"    return engine.setUserPath(['moduleDisplay', moduleId], next);",
"    return engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['moduleDisplay', moduleId] }, { value: next });")
replace_once('src/ui/app.js',
"  root.addEventListener('input', (event) => {\n    if (event.target && event.target.dataset.role === 'package-json') packageDraft = event.target.value;\n  });",
"  root.addEventListener('input', (event) => {\n    if (event.target && event.target.dataset.role === 'package-json') packageDraft = event.target.value;\n    if (event.target && event.target.dataset.role === 'profile-title') profileDraft = event.target.value;\n  });")
replace_once('src/ui/app.js',
"      runAndRender(() => engine.setUserPath(['preferences', 'ammo_fire_mode'], current === 'send' ? 'insert' : 'send'), '发射方式已更新');",
"      runAndRender(() => engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: current === 'send' ? 'insert' : 'send' }), '发射方式已更新');")
replace_once('src/ui/app.js',
"    else if (action === 'ammo-delete' && item) runAndRender(() => engine.removeContent('ammo', item.id), '已删除');",
"    else if (action === 'ammo-delete' && item) runAndRender(() => engine.applyEnvironmentIntent({ type: 'environment.resource.remove', resource_type: 'ammo', resource_id: item.id }), '已删除');")
replace_once('src/ui/app.js',
"    else if (action === 'receipts-clear') runAndRender(() => maintenance.clearReceipts(), '回执已清空');\n    else if (action === 'rollback') runAndRender(() => maintenance.rollbackTo(Number(button.dataset.revision)), '状态已恢复');",
"    else if (action === 'receipts-clear') runAndRender(() => maintenance.clearReceipts(), '回执已清空');\n    else if (action === 'profile-save') runAndRender(() => maintenance.saveProfile(profileDraft || '当前环境'), '环境 Profile 已保存');\n    else if (action === 'profile-activate') runAndRender(() => maintenance.activateProfile(button.dataset.profileId), '环境 Profile 已激活');\n    else if (action === 'profile-remove') runAndRender(() => maintenance.removeProfile(button.dataset.profileId), '环境 Profile 已删除');\n    else if (action === 'rollback') runAndRender(() => maintenance.rollbackTo(Number(button.dataset.revision)), '状态已恢复');")

# Build includes the new semantic core.
replace_once('scripts/build-userscript.js',
"  'src/core/resources.js',\n  'src/core/projection.js',",
"  'src/core/resources.js',\n  'src/core/environment.js',\n  'src/core/intents.js',\n  'src/core/projection.js',")
replace_once('scripts/build-userscript.js',
"// @description  DCF capability reconciler with value/reference artifacts, self-updating declarative views, Runtime health checks and bounded reply intake.",
"// @description  DCF conversation-environment runtime with unified intents, resources, profiles, reconciliation and independent Runtime observation.")

# Version bump is required because the bootstrap gains Environment/Intent protocols.
replace_once('src/core/constants.js', "const VERSION = '0.12.0';", "const VERSION = '0.13.0';")

# Tests for all six stages.
write('tests/dcf-conversation-environment.unit.test.js', r'''
'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { clone } = require('../src/core/utils');

const storage = createStorage({});
const receipts = createReceiptStore(storage);
let root = normalizeRoot({});
const candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const engine = createTransactionEngine(storage, receipts, { initialRoot: root });
engine.initialize();

const environment = engine.getEnvironment();
assert.strictEqual(environment.schema, 'dcf.environment.snapshot.v1');
assert(environment.capabilities.packages.some((entry) => entry.package_id === 'dcf.ui.runtime-workspace'));
assert(environment.presentation.views.ammo && environment.presentation.views.functions && environment.presentation.views.packages && environment.presentation.views.maintenance, 'four views are not package-owned environment projections');
assert.strictEqual(engine.getRegistry().resources.schema, 'dcf.environment.resource-graph.v1');
assert(engine.getRegistry().resources.resources.some((resource) => resource.family === 'action'));
assert(engine.getRegistry().resources.resources.some((resource) => resource.family === 'view'));

const ammoReceipt = engine.applyEnvironmentIntent({ type: 'environment.resource.upsert', resource_type: 'ammo', resource_id: 'environment-test' }, { value: { id: 'environment-test', title: '环境测试', body: 'test' } });
assert.strictEqual(ammoReceipt.status, 'committed');
assert(engine.getRoot().user.content.ammo['environment-test']);

const preferenceReceipt = engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: 'send' });
assert.strictEqual(preferenceReceipt.status, 'committed');
assert.strictEqual(engine.getRoot().user.preferences.ammo_fire_mode, 'send');

const save = engine.saveEnvironmentProfile('测试环境', 'test-environment');
assert.strictEqual(save.status, 'committed');
assert(engine.getRoot().user.environmentProfiles['test-environment']);
assert(!JSON.stringify(engine.getRoot().user.environmentProfiles['test-environment']).includes('environment-test'), 'profile copied user ammo content');

engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: 'insert' });
assert.strictEqual(engine.getRoot().user.active_environment_profile, null, 'profile drift was not exposed');
const activate = engine.activateEnvironmentProfile('test-environment');
assert.strictEqual(activate.status, 'committed');
assert.strictEqual(engine.getRoot().user.preferences.ammo_fire_mode, 'send');
assert.strictEqual(engine.getRoot().user.active_environment_profile, 'test-environment');

const snapshotRevision = engine.snapshots()[0].revision;
const rollback = engine.rollbackTo(snapshotRevision);
assert.strictEqual(rollback.status, 'committed');
assert.strictEqual(rollback.intent.type, 'environment.restore');

console.log(JSON.stringify({
  ok: true,
  environment_facade: true,
  unified_environment_intents: true,
  environment_reconciler_path: true,
  finite_resource_graph: true,
  package_owned_four_views: true,
  profiles_and_restore_are_environment_transitions: true
}, null, 2));
''')

# Update package scripts.
package_path = ROOT / 'package.json'
package = json.loads(package_path.read_text())
package['version'] = '0.13.0'
current = package['scripts']['test']
if 'dcf-conversation-environment.unit.test.js' not in current:
    package['scripts']['test'] = 'node tests/dcf-conversation-environment.unit.test.js && ' + current
package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')

# Architecture decision and current docs.
write('docs/adr/2026-07-13-dcf-conversation-environment-architecture.md', r'''
# ADR: DCF 以期望对话环境为统一架构对象

Date: 2026-07-13
Status: accepted

## Context

0.12.0 已把完整包与 GitHub 引用统一为能力重协调，但弹药、设置、页面、包管理、维护、Profile 与恢复仍容易被理解为并列子系统。整体高维概念内联表明，它们共同描述并维护“未来对话发生时的条件”。

## Decision

1. `dcf.state.root.v1` 继续是唯一权威状态；`dcf.environment.snapshot.v1` 只是只读 Facade。
2. 持久变化统一表达为有限的 `dcf.intent.v1` Environment Intent；即时 Action/Effect 保持独立失败语义。
3. Artifact 先编译为 Intent，再由 Environment Reconciler 形成候选、验证、原子提交和 Runtime 重投影。
4. content、action、view、style、policy 进入统一资源图，保留各自编译和观察契约。
5. 弹药、功能、构成、维护四页均由包声明的 `ui-view:*` 资源拥有；Core 只提供安全宿主和回退渲染。
6. Environment Profile 保存包选择、政策和产品组织，不复制用户弹药正文；Profile 激活和快照恢复都是环境迁移。

## Consequences

- 同一意图不再因来自对话、按钮、菜单或手动 JSON 而拥有不同语义。
- 包只是不可变交付容器，资源才是进入环境的能力单位。
- 页面成为同一期望环境的内容、行动、构成和观察投影。
- Runtime 体检继续独立比较期望投影与真实浏览器现场。
- 不建立第二权威状态，不执行远程 JavaScript。
''')

# Mark the implementation checklist complete after the source and tests exist.
todo = ROOT / 'docs/todo-conversation-environment-architecture.md'
text = todo.read_text().replace('- [ ]', '- [x]')
todo.write_text(text)

# Append concise current architecture/status statements.
for path, appendix in {
  'README.md': """\n\n## Conversation environment architecture\n\nDCF `0.13.0` treats the authoritative root as one desired conversation environment. A read-only Environment Snapshot exposes capabilities, user resources, policies, presentation, profiles and provenance. Persistent changes compile to typed environment intents and pass through one candidate/validate/commit/reproject path. Content, actions, views, styles and policies are finite resource families. Ammo, functions, composition and maintenance are package-owned views of the same environment. Profiles save package selection, policies and presentation without copying user ammo bodies.\n""",
  'docs/architecture-current.md': """\n\n## 10. 期望对话环境架构（0.13.0）\n\n`dcf.environment.snapshot.v1` 从唯一权威根和 registry 推导能力构成、用户认知资源、环境政策、产品组织、Profile 与来源，不另建第二状态。所有持久变化先成为 `dcf.intent.v1`，Artifact 只是 Intent 所需材料。Environment Reconciler 统一包、用户资源、政策、Profile 与历史恢复。registry 发布 content/action/view/style/policy 资源图及观察契约。弹药、功能、构成、维护四页均是包拥有的环境投影。Environment Profile 不复制弹药正文；激活 Profile 和恢复快照都属于环境迁移。\n""",
  'docs/current-state.md': """\n\n## 0.13.0 期望对话环境\n\n- 新增只读 `dcf.environment.snapshot.v1`，不改变单一权威根。\n- 持久变化统一为 `dcf.intent.v1` Environment Intent。\n- Package Reconciler 提升为 Environment Reconciler；包、内容、偏好、界面组织、Profile 和恢复共享迁移链路。\n- registry 输出 content/action/view/style/policy 资源图与观察契约。\n- 弹药、功能、构成、维护成为包拥有的四种环境投影。\n- Environment Profile 保存包选择、政策和产品组织，不复制用户弹药正文。\n""",
  'docs/dcf-basic-consensus-prompt.md': """\n\nDCF 的统一架构对象是期望对话环境。`dcf.state.root.v1` 仍是唯一权威状态，Environment Snapshot 只是 Facade。对话工件、按钮和菜单先编译成同一种 typed intent；持久环境变化与一次性 Action/Effect 分离。包是不可变交付容器，content/action/view/style/policy 是环境资源。弹药、功能、构成和维护是同一环境的不同投影。Profile 和历史恢复都走环境迁移，不得另建工作区状态。\n""",
  'docs/dcf-maintenance-skill.md': """\n\n维护时先判断变化属于 Environment Intent、Action Intent、Artifact Resolver、Resource Compiler、View Projection、Host Effect 还是 Runtime Observation。不得因为入口不同为同一意图增加旁路。所有持久变化必须经 Environment Reconciler；包只是交付容器，资源地址和观察契约才是 Runtime 编译依据。新增页面优先成为 `ui-view:*` 资源；新增工作模式优先成为 Environment Profile，不得另建平行工作区系统。\n"""
}.items():
    target = ROOT / path
    current = target.read_text()
    if appendix.strip() not in current:
        target.write_text(current.rstrip() + appendix)

# ADR index records the new canonical decision.
index = ROOT / 'docs/adr/status-index.md'
text = index.read_text()
needle = '## Current\n'
entry = '\n- `2026-07-13-dcf-conversation-environment-architecture.md` — **accepted**'
if entry.strip() not in text:
    text = text.replace(needle, needle + entry + '\n', 1)
index.write_text(text)

print(json.dumps({'ok': True, 'version': '0.13.0', 'stages': 6}, ensure_ascii=False))
