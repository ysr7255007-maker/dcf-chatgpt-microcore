(function (root) {
  'use strict';
  const C = root.DCFHostCore;
  const { isObject, clone, normalizeUnitManifest } = C;
  function importLegacyCodeStore(state, input) {
    const source = isObject(input && input.code_units) ? input.code_units : {};
    const looksV3 = Object.keys(source).every((key) => /^[a-f0-9]{64}$/.test(key));
    if (looksV3) {
      for (const [hash, raw] of Object.entries(source)) {
        if (!isObject(raw)) continue;
        const unit = normalizeUnitManifest({ ...raw, hash: raw.hash || hash });
        state.code_units[unit.hash] = unit;
      }
    } else {
      for (const entry of Object.values(source)) {
        for (const raw of Object.values(isObject(entry && entry.versions) ? entry.versions : {})) {
          if (!isObject(raw) || !/^[a-f0-9]{64}$/.test(String(raw.hash || ''))) continue;
          const unit = normalizeUnitManifest(raw);
          state.code_units[unit.hash] = unit;
        }
      }
    }
    const suppliedIndex = isObject(input && input.unit_versions) ? input.unit_versions : {};
    for (const [id, raw] of Object.entries(suppliedIndex)) {
      const versions = isObject(raw && raw.versions) ? raw.versions : isObject(raw) ? raw : {};
      state.unit_versions[id] = { id, versions: clone(versions), history: isObject(raw && raw.history) ? clone(raw.history) : {} };
    }
    for (const unit of Object.values(state.code_units)) {
      const index = state.unit_versions[unit.id] || { id: unit.id, versions: {}, history: {} };
      index.versions = isObject(index.versions) ? index.versions : {};
      index.history = isObject(index.history) ? index.history : {};
      const prior = index.versions[unit.version];
      const hashes = new Set(Array.isArray(index.history[unit.version]) ? index.history[unit.version] : []);
      if (prior) hashes.add(prior);
      hashes.add(unit.hash);
      index.history[unit.version] = [...hashes];
      if (!prior) index.versions[unit.version] = unit.hash;
      state.unit_versions[unit.id] = index;
    }
  }

  Object.assign(C, { importLegacyCodeStore });
})(typeof globalThis !== 'undefined' ? globalThis : this);
