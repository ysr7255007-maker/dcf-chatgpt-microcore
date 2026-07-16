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

function normalizeManifest(input, registry, fallback, options = {}) {
  const fallbackEntries = cloneManifest(fallback);
  const fallbackById = new Map(fallbackEntries.map((entry) => [entry.id, entry]));
  const source = Array.isArray(input) ? input : fallbackEntries;
  const seen = new Set();
  const normalized = [];

  for (const raw of source || []) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.version !== 'string' || seen.has(raw.id)) continue;
    const fallbackEntry = fallbackById.get(raw.id);
    const version = registry.get(raw.id, raw.version)
      ? raw.version
      : fallbackEntry && registry.get(fallbackEntry.id, fallbackEntry.version)
        ? fallbackEntry.version
        : null;
    if (!version) continue;
    seen.add(raw.id);
    normalized.push({ id: raw.id, version, enabled: raw.enabled !== false });
  }

  const appendMissing = options.appendMissing !== false;
  if (appendMissing) {
    for (const entry of fallbackEntries) {
      if (seen.has(entry.id) || !registry.get(entry.id, entry.version)) continue;
      seen.add(entry.id);
      normalized.push({
        id: entry.id,
        version: entry.version,
        enabled: options.missingEnabled === undefined ? entry.enabled !== false : options.missingEnabled === true
      });
    }
  }

  return normalized;
}

module.exports = { cloneManifest, sameManifest, normalizeManifest };
