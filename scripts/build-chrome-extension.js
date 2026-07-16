'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'chrome-extension');
const distRoot = path.join(root, 'dist');
const extensionRoot = path.join(distRoot, 'dcf-chrome-extension');
const releaseRoot = path.join(root, 'releases', 'chrome');
const VERSION_NAME = '1.0.0-rc.1';

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function copy(relative) {
  const from = path.join(sourceRoot, relative);
  const to = path.join(extensionRoot, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function writeJson(filename, value) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, `${JSON.stringify(stable(value), null, 2)}\n`); }

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(extensionRoot, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.template.json'), 'utf8'));
writeJson(path.join(extensionRoot, 'manifest.json'), manifest);
for (const file of ['src/core.js', 'src/background.js', 'src/host-state.js', 'src/host-runtime.js', 'src/host-product.js', 'src/host-main.js', 'static/migration-bridge.js', 'pages/common.css', 'pages/onboarding.html', 'pages/onboarding.js', 'pages/recovery.html', 'pages/recovery.js']) copy(file);

const unitSpecs = [
  { id: 'dcf.firstparty.ammo', version: VERSION_NAME, title: '语言弹药闭环', description: 'ChatGPT 页面接入、自动装填、同 ID 更新、查看、编辑、发射、导入与导出。', file: 'code-units/ammo/main.js', phase: 20, required: true },
  { id: 'dcf.firstparty.diagnostics', version: VERSION_NAME, title: '启动诊断证据', description: '独立返回代码单元启动证据，验证普通代码单元可以单独替换与回滚。', file: 'code-units/diagnostics/main.js', phase: 90, required: true }
];
const units = unitSpecs.map((spec) => {
  const code = fs.readFileSync(path.join(sourceRoot, spec.file), 'utf8');
  const hash = sha256(code);
  return {
    schema: 'dcf.code_unit.v1', id: spec.id, version: spec.version, title: spec.title, description: spec.description,
    code, hash, source: { kind: 'bundled-official', release: VERSION_NAME },
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], run_at: 'document_idle', world: 'USER_SCRIPT', world_id: 'dcf-runtime', host_api: '1', phase: spec.phase, required: spec.required
  };
});

const bundle = { schema: 'dcf.code_unit_bundle.v1', version: VERSION_NAME, generated_at: 'deterministic-build', units };
writeJson(path.join(extensionRoot, 'official', 'code-units.json'), bundle);

const index = { schema: 'dcf.code_unit_index.v1', version: VERSION_NAME, units: [] };
for (const [position, unit] of units.entries()) {
  const spec = unitSpecs[position];
  index.units.push({
    id: unit.id, version: unit.version, title: unit.title, description: unit.description, hash: unit.hash,
    code_url: `https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/chrome-extension/${spec.file}`,
    matches: unit.matches, run_at: unit.run_at, world_id: unit.world_id, host_api: unit.host_api,
    phase: unit.phase, required: unit.required
  });
}
writeJson(path.join(releaseRoot, 'official-index.json'), index);

const summary = {
  schema: 'dcf.chrome.build.summary.v1', version: VERSION_NAME, manifest_version: manifest.manifest_version,
  minimum_chrome_version: manifest.minimum_chrome_version, permissions: manifest.permissions,
  code_units: units.map((unit) => ({ id: unit.id, version: unit.version, hash: unit.hash, bytes: Buffer.byteLength(unit.code), phase: unit.phase })),
  extension_files: []
};
function walk(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    if (fs.statSync(absolute).isDirectory()) walk(absolute, relative);
    else summary.extension_files.push({ path: relative, bytes: fs.statSync(absolute).size, sha256: sha256(fs.readFileSync(absolute)) });
  }
}
walk(extensionRoot);
writeJson(path.join(distRoot, 'verification-summary.json'), summary);

const zipName = `dcf-chrome-extension-${VERSION_NAME}.zip`;
const zipPath = path.join(distRoot, zipName);
const fixedTime = new Date('2020-01-01T00:00:00.000Z');
const zipFiles = [];
function normalizeTimes(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    if (fs.statSync(absolute).isDirectory()) normalizeTimes(absolute, relative);
    else { fs.utimesSync(absolute, fixedTime, fixedTime); zipFiles.push(path.posix.join('dcf-chrome-extension', relative)); }
  }
  fs.utimesSync(directory, fixedTime, fixedTime);
}
normalizeTimes(extensionRoot);
try {
  childProcess.execFileSync('zip', ['-X', '-q', zipPath, ...zipFiles], { cwd: distRoot });
} catch (error) {
  console.warn('zip command unavailable; extension directory remains installable');
}
console.log(JSON.stringify({ ok: true, version: VERSION_NAME, extension_dir: path.relative(root, extensionRoot), zip: fs.existsSync(zipPath) ? path.relative(root, zipPath) : null, code_units: units.length, files: summary.extension_files.length }, null, 2));
