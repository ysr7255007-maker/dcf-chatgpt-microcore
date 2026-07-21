'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { applyReleaseLedger } = require('./code-unit-release');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'chrome-extension');
const distRoot = path.join(root, 'dist');
const extensionRoot = path.join(distRoot, 'dcf-chrome-extension');
const releaseRoot = path.join(root, 'releases', 'chrome');
const VERSION_NAME = '1.0.0-rc.3';
const DEFAULT_REF = process.env.DCF_PLUGIN_INDEX_REF || 'rebuild/chrome-native-host-v2';
const RAW_ROOT = `https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/${DEFAULT_REF}`;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(stable(value), null, 2)}\n`);
}
function copy(relative) {
  const from = path.join(sourceRoot, relative);
  const to = path.join(extensionRoot, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
function worldId(id) {
  return `dcf-${id.replace(/^dcf\./, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`.slice(0, 64);
}
function declaredUnitVersion(code, id) {
  const match = String(code).match(/\b(?:const|let|var)\s+(?:[^;]*,\s*)?UNIT_VERSION\s*=\s*(['"])([^'"]+)\1/);
  if (!match) throw new Error(`plugin ${id} does not declare UNIT_VERSION`);
  return match[2];
}
function artifactId(hash) { return `sha256:${hash}`; }
function snapshotFromUnits(units) {
  const entries = units.map((unit) => ({
    id: unit.id,
    version: unit.version,
    hash: unit.hash,
    artifact_id: artifactId(unit.hash),
    enabled: unit.default_enabled !== false,
    phase: unit.phase
  })).sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
  const identity = entries.map(({ id, hash, enabled, phase }) => ({ id, hash, enabled, phase }));
  return {
    schema: 'dcf.startup.snapshot.v3',
    id: artifactId(sha256(Buffer.from(stableJson(identity), 'utf8'))),
    created_at: '2020-01-01T00:00:00.000Z',
    reason: 'official-default',
    entries
  };
}

const indexPath = path.join(releaseRoot, 'official-index.json');
const ledgerPath = path.join(releaseRoot, 'code-unit-version-ledger.json');
let releaseLedger = { schema: 'dcf.code_unit.version_ledger.v1', units: {} };
if (fs.existsSync(ledgerPath)) {
  try { releaseLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
  catch (error) { throw new Error(`cannot parse code unit version ledger: ${error.message}`); }
}

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(extensionRoot, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.template.json'), 'utf8'));
writeJson(path.join(extensionRoot, 'manifest.json'), manifest);
for (const file of [
  'src/core.js',
  'src/core-store.js',
  'src/core-snapshot.js',
  'src/core-state.js',
  'src/core-diagnostics.js',
  'src/background.js',
  'src/host-state.js',
  'src/host-runtime.js',
  'src/host-runtime-registration.js',
  'src/host-runtime-canary.js',
  'src/host-runtime-observation.js',
  'src/host-runtime-reconcile.js',
  'src/host-product.js',
  'src/host-main.js',
  'static/migration-bridge.js',
  'pages/common.css',
  'pages/onboarding.html',
  'pages/onboarding.js',
  'pages/recovery.html',
  'pages/recovery.js'
]) copy(file);

const specs = [
  ['dcf.firstparty.shell', '基础界面', 'DCF 的统一可见入口与独立插件面板挂载。', 'shell', 10],
  ['dcf.firstparty.ammo', '语言弹药', '语言弹药工作台、自动装填、发射、更新与 GitHub 便携库。', 'ammo', 20],
  ['dcf.firstparty.conversation-performance', '长对话减负', '可逆的长对话渲染减负与历史窗口。', 'conversation-performance', 30],
  ['dcf.firstparty.attribution', '问答性能归因', '从下一次发送到回复完成的有界性能样本。', 'attribution', 40],
  ['dcf.firstparty.appearance', '外观', 'DCF 侧栏方向、尺寸与位置。', 'appearance', 50],
  ['dcf.firstparty.local-agent', '本机 Agent', '纯插件直连 OpenCode，管理会话、任务、权限、结果与文件差异。', 'local-agent', 55],
  ['dcf.firstparty.local-agent-dialogue', '本机对话闭环', '将严格的对话委派工件交给本机 OpenCode，并把结构化结果自动送回当前对话。', 'local-agent-dialogue', 57],
  ['dcf.firstparty.backup', '备份恢复', '独立插件数据的一键备份与恢复。', 'backup', 60],
  ['dcf.firstparty.plugin-manager', '功能管理', '低频功能启停与统一 DCF 更新入口。', 'plugin-manager', 70],
  ['dcf.firstparty.diagnostics', '诊断', '正常时压缩状态，异常时自动回传本机 Agent 的隐私受限证据。', 'diagnostics', 90],
  ['dcf.firstparty.page-diagnostics', '页面诊断', '默认关闭的页面生命周期与流式渲染诊断，固定环形缓冲区，不记录对话正文。', 'page-diagnostics', 95]
].map(([id, title, description, folder, phase]) => ({ id, title, description, folder, phase }));

const units = specs.map((spec) => {
  const relative = `chrome-extension/code-units/${spec.folder}/main.js`;
  const code = fs.readFileSync(path.join(root, relative), 'utf8');
  const hash = sha256(Buffer.from(code, 'utf8'));
  return {
    id: spec.id,
    version: declaredUnitVersion(code, spec.id),
    title: spec.title,
    description: spec.description,
    hash,
    artifact_id: artifactId(hash),
    code_url: `${RAW_ROOT}/${relative}`,
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    run_at: 'document_idle',
    world_id: worldId(spec.id),
    host_api: '3',
    phase: spec.phase,
    required: true,
    default_enabled: true
  };
});

releaseLedger = applyReleaseLedger(releaseLedger, units);

const defaultSnapshot = snapshotFromUnits(units);
const index = {
  schema: 'dcf.plugin_index.v2',
  version: VERSION_NAME,
  generated_from_ref: DEFAULT_REF,
  defaults: units.map((unit) => unit.id),
  default_snapshot: defaultSnapshot,
  units
};
writeJson(indexPath, index);
writeJson(ledgerPath, releaseLedger);

writeJson(path.join(extensionRoot, 'config.json'), {
  schema: 'dcf.chrome.config.v2',
  version: VERSION_NAME,
  plugin_index_url: `${RAW_ROOT}/releases/chrome/official-index.json`,
  trusted_origin: 'https://raw.githubusercontent.com'
});

const releaseManifest = {
  schema: 'dcf.chrome.release.manifest.v1',
  version: VERSION_NAME,
  plugin_index_ref: DEFAULT_REF,
  default_snapshot_id: defaultSnapshot.id,
  code_unit_version_ledger: 'releases/chrome/code-unit-version-ledger.json',
  plugin_artifacts: units.map(({ id, version, hash, artifact_id, code_url }) => ({
    id, version, hash, artifact_id, code_url
  }))
};
writeJson(path.join(releaseRoot, 'build-manifest.json'), releaseManifest);
writeJson(path.join(distRoot, 'release-manifest.json'), releaseManifest);

const summary = {
  schema: 'dcf.chrome.build.summary.v3',
  version: VERSION_NAME,
  plugin_index_ref: DEFAULT_REF,
  default_snapshot_id: defaultSnapshot.id,
  manifest_version: manifest.manifest_version,
  minimum_chrome_version: manifest.minimum_chrome_version,
  permissions: manifest.permissions,
  plugins: units.map(({ id, version, hash, artifact_id, phase, world_id, code_url }) => ({
    id, version, hash, artifact_id, phase, world_id, code_url
  })),
  extension_files: []
};
function walk(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    if (fs.statSync(absolute).isDirectory()) walk(absolute, relative);
    else summary.extension_files.push({
      path: relative,
      bytes: fs.statSync(absolute).size,
      sha256: sha256(fs.readFileSync(absolute))
    });
  }
}
walk(extensionRoot);
writeJson(path.join(distRoot, 'verification-summary.json'), summary);

const fixedTime = new Date('2020-01-01T00:00:00.000Z');
const zipFiles = [];
function normalizeTimes(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    if (fs.statSync(absolute).isDirectory()) normalizeTimes(absolute, relative);
    else {
      fs.utimesSync(absolute, fixedTime, fixedTime);
      zipFiles.push(path.posix.join('dcf-chrome-extension', relative));
    }
  }
  fs.utimesSync(directory, fixedTime, fixedTime);
}
normalizeTimes(extensionRoot);
const zipPath = path.join(distRoot, `dcf-chrome-extension-${VERSION_NAME}.zip`);
childProcess.execFileSync('zip', ['-X', '-q', zipPath, ...zipFiles], { cwd: distRoot });
console.log(JSON.stringify({
  ok: true,
  version: VERSION_NAME,
  plugin_index_ref: DEFAULT_REF,
  default_snapshot_id: defaultSnapshot.id,
  extension_dir: path.relative(root, extensionRoot),
  zip: path.relative(root, zipPath),
  plugins: units.length,
  extension_files: summary.extension_files.length
}, null, 2));
