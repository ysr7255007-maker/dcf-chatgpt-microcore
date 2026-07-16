'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'plugin-packs/official/pack.json');
const outputPath = path.join(root, 'dist/dcf-official-plugin-pack.json');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readManifest() {
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (value.schema !== 'dcf.plugin-pack.v1' || !value.id || !value.version) throw new Error('official_plugin_pack_manifest_invalid');
  if (!Array.isArray(value.modules) || !Array.isArray(value.plugins) || !Array.isArray(value.resources)) throw new Error('official_plugin_pack_lists_required');
  return value;
}

function listedPaths(manifest) {
  return [...manifest.modules, ...manifest.resources.map((item) => item.path)];
}

function buildOfficialPluginPack() {
  const manifest = readManifest();
  const seen = new Set();
  const files = listedPaths(manifest).map((relativePath) => {
    if (seen.has(relativePath)) throw new Error(`official_plugin_pack_duplicate_file:${relativePath}`);
    seen.add(relativePath);
    const absolute = path.join(root, relativePath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`official_plugin_pack_file_missing:${relativePath}`);
    const bytes = fs.readFileSync(absolute);
    return {
      path: relativePath.replace(/\\/g, '/'),
      encoding: 'utf-8',
      bytes: bytes.length,
      sha256: sha256(bytes),
      content: bytes.toString('utf8')
    };
  });

  const bundle = {
    schema: 'dcf.plugin-pack.bundle.v1',
    pack: manifest,
    files
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function writeOfficialPluginPack() {
  const output = buildOfficialPluginPack();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  return { ok: true, output: path.relative(root, outputPath).replace(/\\/g, '/'), bytes: Buffer.byteLength(output) };
}

if (require.main === module) console.log(JSON.stringify(writeOfficialPluginPack(), null, 2));

module.exports = { readManifest, listedPaths, buildOfficialPluginPack, writeOfficialPluginPack, sha256 };
