'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const user = fs.readFileSync(path.join(root, 'dcf-chatgpt-microcore.user.js'), 'utf8');
const meta = fs.readFileSync(path.join(root, 'dcf-chatgpt-microcore.meta.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog/index.json'), 'utf8'));

assert(user.includes(`// @version      ${pkg.version}`), 'userscript version mismatch');
assert(meta.includes(`// @version      ${pkg.version}`), 'metadata version mismatch');
assert(user.includes("require('src/index.js')"), 'generated userscript does not boot source entry');
assert(!user.includes('Function(source)'), 'runtime remote-code execution path present');
assert(!user.includes('eval('), 'eval path present');
assert.strictEqual(catalog.schema, 'dcf.catalog.v1');
assert(catalog.packages.length >= 2, 'standard catalog packages missing');
for (const entry of catalog.packages) {
  const localPath = path.join(root, new URL(entry.url).pathname.split('/main/')[1]);
  assert(fs.existsSync(localPath), `catalog package file missing: ${entry.package_id}`);
}

console.log(JSON.stringify({ ok: true, version: pkg.version, modular_source_single_artifact: true, no_remote_code_execution: true, catalog_consistent: true }, null, 2));
