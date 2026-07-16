'use strict';
const assert = require('assert');
const { decodeAmmoArtifacts, buildInvocation, buildUpdateRequest } = require('../src-next/plugins/ammo-artifacts');
const { validateBackup } = require('../src-next/plugins/backup');
const fs = require('fs');
const path = require('path');

const decoded = decodeAmmoArtifacts('before\n<<<DCF_AMMO\n{"id":"a","title":"A","purpose":"P","body":"B"}\nDCF_AMMO>>>\nafter');
assert.equal(decoded.items.length, 1);
assert.equal(decoded.items[0].id, 'a');
assert.equal(buildInvocation(decoded.items[0]), '〔DCF·语言弹药〕\n\nB');
const update = buildUpdateRequest(decoded.items[0]);
assert(update.includes('〔DCF·弹药更新〕'));
assert(update.includes('"id": "a"'));
assert.throws(() => validateBackup({ schema: 'dcf.next.backup.v1', values: { cookie: 'x' } }), /不允许恢复/);
assert.doesNotThrow(() => validateBackup({ schema: 'dcf.next.backup.v1', values: { 'dcf.next.plugin.x.y': 1 } }));
console.log('next core tests passed');

const root = path.resolve(__dirname, '..');
const loaderSource = fs.readFileSync(path.join(root, 'src-next/survival/loader.js'), 'utf8');
const hostSource = fs.readFileSync(path.join(root, 'src-next/plugins/chatgpt.js'), 'utf8');
const performanceSource = fs.readFileSync(path.join(root, 'src-next/plugins/conversation-performance.js'), 'utf8');
assert(!loaderSource.includes('saved_combinations'));
assert(!hostSource.includes('observe(doc.documentElement'));
assert(!performanceSource.includes('observe(document.documentElement'));
assert(!fs.existsSync(path.join(root, 'src-next/core/artifacts.js')));
