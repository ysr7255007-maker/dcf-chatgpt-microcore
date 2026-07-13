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
