'use strict';

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function normalizeLedger(value) {
  const input = value && typeof value === 'object' ? clone(value) : {};
  const units = input.units && typeof input.units === 'object' ? input.units : {};
  const normalized = {};
  for (const [id, raw] of Object.entries(units)) {
    normalized[id] = {
      versions: raw && raw.versions && typeof raw.versions === 'object' ? { ...raw.versions } : {},
      legacy_collisions: Array.isArray(raw && raw.legacy_collisions) ? clone(raw.legacy_collisions) : []
    };
  }
  return { schema: 'dcf.code_unit.version_ledger.v1', units: normalized };
}
function applyReleaseLedger(value, units) {
  const ledger = normalizeLedger(value);
  for (const unit of units || []) {
    const id = String(unit.id || '');
    const version = String(unit.version || '');
    const hash = String(unit.hash || '').toLowerCase();
    if (!id || !version || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`invalid_release_unit:${id}@${version}`);
    const entry = ledger.units[id] || { versions: {}, legacy_collisions: [] };
    const published = entry.versions[version];
    if (published && published !== hash) {
      throw new Error(`semantic_version_reuse:${id}@${version}:published=${published}:candidate=${hash}`);
    }
    entry.versions[version] = hash;
    ledger.units[id] = entry;
  }
  return stable(ledger);
}
function contentId(hash) { return `sha256:${String(hash || '').toLowerCase()}`; }

module.exports = { stable, normalizeLedger, applyReleaseLedger, contentId };
