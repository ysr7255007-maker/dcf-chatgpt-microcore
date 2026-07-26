'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
function buildHash() {
  childProcess.execFileSync(process.execPath, ['scripts/build-chrome-extension.js'], {
    cwd: root,
    stdio: 'ignore'
  });
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'dist/dcf-chrome-extension-1.0.0-rc.3.zip')))
    .digest('hex');
}
assert.strictEqual(buildHash(), buildHash());
console.log(JSON.stringify({ ok: true, deterministic_zip: true, version: '1.0.0-rc.3' }, null, 2));
