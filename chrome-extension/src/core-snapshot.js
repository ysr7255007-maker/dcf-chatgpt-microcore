(function (root) {
  'use strict';
  const C = root.DCFHostCore;
  const { isObject, clone, nowIso, artifactId, sha256Text, canonicalJson, emptyDesired } = C;
  function normalizeSnapshot(value) {
    if (!isObject(value)) throw new Error('snapshot must be an object');
    const entries = (Array.isArray(value.entries) ? value.entries : []).map((entry) => {
      const hash = String(entry.hash || '').toLowerCase();
      return {
        id: String(entry.id || ''),
        version: String(entry.version || ''),
        hash,
        artifact_id: artifactId(hash),
        enabled: entry.enabled !== false,
        phase: Number(entry.phase || 100)
      };
    }).sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
    return {
      schema: 'dcf.startup.snapshot.v3',
      id: String(value.id || ''),
      created_at: String(value.created_at || nowIso()),
      reason: String(value.reason || 'unspecified'),
      entries
    };
  }

  async function snapshotIdentity(entries) {
    const identity = (Array.isArray(entries) ? entries : []).map((entry) => ({
      id: String(entry.id || ''),
      hash: String(entry.hash || '').toLowerCase(),
      enabled: entry.enabled !== false,
      phase: Number(entry.phase || 100)
    })).sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
    return artifactId(await sha256Text(canonicalJson(identity)));
  }

  async function snapshotFromEntries(entries, reason) {
    const normalized = normalizeSnapshot({ id: 'pending', reason: reason || 'unspecified', entries });
    normalized.id = await snapshotIdentity(normalized.entries);
    return normalized;
  }

  async function snapshotFromUnits(units, reason) {
    return snapshotFromEntries((units || []).map((unit) => ({
      id: unit.id,
      version: unit.version,
      hash: unit.hash,
      enabled: unit.default_enabled !== false,
      phase: unit.phase
    })), reason || 'official-default');
  }

  function normalizeDesired(value) {
    const desired = Object.assign(emptyDesired(), isObject(value) ? clone(value) : {});
    desired.schema = 'dcf.desired.snapshot.v1';
    desired.snapshot = desired.snapshot ? normalizeSnapshot(desired.snapshot) : null;
    desired.proof_refs = Array.isArray(desired.proof_refs) ? desired.proof_refs.map((ref) => ({
      id: String(ref.id || ''),
      version: String(ref.version || ''),
      hash: String(ref.hash || '').toLowerCase(),
      artifact_id: artifactId(ref.hash || ''),
      enabled: ref.enabled !== false,
      phase: Number(ref.phase || 100)
    })) : [];
    desired.observations = isObject(desired.observations) ? desired.observations : {};
    desired.canary = isObject(desired.canary) ? desired.canary : null;
    return desired;
  }

  Object.assign(C, { normalizeSnapshot, snapshotIdentity, snapshotFromEntries, snapshotFromUnits, normalizeDesired });
})(typeof globalThis !== 'undefined' ? globalThis : this);
