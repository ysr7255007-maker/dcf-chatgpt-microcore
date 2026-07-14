'use strict';

function cloneManifest(manifest) {
  return (manifest || []).map((entry) => ({ id: entry.id, version: entry.version, enabled: entry.enabled !== false }));
}

function sameManifest(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return Boolean(other) && entry.id === other.id && entry.version === other.version && (entry.enabled !== false) === (other.enabled !== false);
  });
}

function normalizeManifest(input, registry, fallback) {
  const source = Array.isArray(input) ? input : fallback;
  const seen = new Set();
  const normalized = [];
  for (const raw of source || []) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.version !== 'string' || seen.has(raw.id)) continue;
    if (!registry.get(raw.id, raw.version)) continue;
    seen.add(raw.id);
    normalized.push({ id: raw.id, version: raw.version, enabled: raw.enabled !== false });
  }
  return normalized;
}

module.exports = { cloneManifest, sameManifest, normalizeManifest };
