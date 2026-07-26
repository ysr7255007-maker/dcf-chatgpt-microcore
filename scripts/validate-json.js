'use strict';
const fs = require('fs');

// Smallest owned schema shape: required top-level keys per schema id.
const SCHEMA_SHAPES = {
  'dcf.chrome.config.v2': ['plugin_index_url', 'schema', 'trusted_origin', 'version'],
  'dcf.plugin_index.v2': ['default_snapshot', 'defaults', 'schema', 'units'],
  'dcf.chrome.release.manifest.v1': ['default_snapshot_id', 'plugin_artifacts', 'schema', 'version'],
  'dcf.code_unit.version_ledger.v1': ['schema', 'units'],
  'dcf.chrome.build.summary.v3': ['default_snapshot_id', 'extension_files', 'schema', 'version'],
  'dcf.catalog.v1': ['packages', 'schema'],
};

const errors = [];
for (const filename of process.argv.slice(2)) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (e) {
    errors.push(`${filename}: invalid JSON — ${e.message}`);
    continue;
  }
  const schema = data && typeof data === 'object' ? data.schema : undefined;
  if (schema && SCHEMA_SHAPES[schema]) {
    const missing = SCHEMA_SHAPES[schema].filter(k => !(k in data));
    if (missing.length) {
      errors.push(`${filename}: schema "${schema}" missing required keys: ${missing.join(', ')}`);
    }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, files: process.argv.slice(2) }));
