'use strict';

const { clone, nowIso } = require('../core/utils');

function createCapabilityReconciler(engine, catalog, receiptStore, options = {}) {
  let lastResult = null;

  function desiredState() {
    const packages = engine.getRoot().packages && engine.getRoot().packages.packages || {};
    return {
      schema: 'dcf.desired.capabilities.v1',
      state_revision: engine.getRoot().revision,
      packages: Object.values(packages).map((entry) => ({
        package_id: entry.package_id,
        active_revision: entry.active_revision,
        enabled: entry.enabled !== false
      })).sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)))
    };
  }

  function activationFor(artifact, status) {
    if (status !== 'committed') return 'none';
    if (artifact.type === 'package') return 'runtime-reprojected';
    if (artifact.type === 'ammo') return 'content-projected';
    return 'none';
  }

  function applyResolved(resolved, sourceOverride) {
    const artifact = resolved && resolved.artifact || resolved;
    if (!artifact || artifact.type === 'package-reference') throw new Error('resolved artifact must contain value payload');
    const source = sourceOverride || resolved && resolved.source || { kind: 'resolved-artifact' };
    const receipt = engine.applyArtifact(artifact, source);
    const result = {
      schema: 'dcf.reconcile.result.v1',
      at: nowIso(),
      input_mode: resolved && resolved.input_mode || 'value',
      artifact_type: artifact.type,
      package_id: artifact.type === 'package' ? artifact.payload.pack_id : null,
      revision: artifact.type === 'package' ? artifact.payload.revision : null,
      status: receipt.status,
      activation: activationFor(artifact, receipt.status),
      desired_state_revision: engine.getRoot().revision,
      receipt
    };
    lastResult = clone(result);
    if (receipt.status === 'committed' && typeof options.onCommitted === 'function') options.onCommitted(result);
    return result;
  }

  function rejectReference(artifact, source, error) {
    const message = String(error && error.message || error);
    const receipt = receiptStore.append({
      schema: 'dcf.receipt.v1',
      intent: { type: 'capability.reconcile', input_mode: 'reference', package_id: artifact.payload.package_id, target: artifact.payload.target, source: clone(source || {}) },
      status: 'rejected',
      stage: 'resolve',
      error: message
    });
    const result = {
      schema: 'dcf.reconcile.result.v1',
      at: nowIso(),
      input_mode: 'reference',
      artifact_type: 'package-reference',
      package_id: artifact.payload.package_id,
      revision: null,
      status: 'rejected',
      activation: 'none',
      desired_state_revision: engine.getRoot().revision,
      receipt
    };
    lastResult = clone(result);
    return result;
  }

  function accept(artifact, source = {}) {
    if (artifact.type !== 'package-reference') return applyResolved({ artifact, input_mode: 'value', source });
    return catalog.resolve(artifact.payload).then((resolved) => applyResolved(resolved)).catch((error) => rejectReference(artifact, source, error));
  }

  return {
    accept,
    applyResolved,
    desiredState,
    lastResult: () => clone(lastResult)
  };
}

module.exports = { createCapabilityReconciler };
