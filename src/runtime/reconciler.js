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
