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
