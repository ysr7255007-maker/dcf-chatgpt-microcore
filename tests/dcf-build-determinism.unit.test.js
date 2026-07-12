'use strict';

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const cp = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'); }
cp.execFileSync(process.execPath, ['scripts/build-userscript.js'], { cwd: root });
const first = [digest('dcf-chatgpt-microcore.user.js'), digest('dcf-chatgpt-microcore.meta.js'), digest('catalog/index.json')];
cp.execFileSync(process.execPath, ['scripts/build-userscript.js'], { cwd: root });
const second = [digest('dcf-chatgpt-microcore.user.js'), digest('dcf-chatgpt-microcore.meta.js'), digest('catalog/index.json')];
assert.deepStrictEqual(first, second, 'same source produced different release artifacts');
console.log(JSON.stringify({ ok: true, deterministic_userscript: true, deterministic_metadata: true, deterministic_catalog: true }, null, 2));
