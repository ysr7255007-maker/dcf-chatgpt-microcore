'use strict';

const { ROOT_KEY, SNAPSHOT_KEY, RUNTIME_KEY } = require('./constants');
const { clone, nowIso, boundedPush } = require('./utils');
const { finalizeCandidate, validateRoot, addPackRevision } = require('./state');
const { buildProjection } = require('./projection');

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
