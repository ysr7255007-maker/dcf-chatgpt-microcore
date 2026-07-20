'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
let stored = {};
let registrations = [];
const alarms = [];
const worlds = [];
const listeners = () => ({ addListener() {} });
global.self = global;
global.chrome = {
  storage: { local: { async get(key) { return { [key]: stored[key] }; }, async set(value) { Object.assign(stored, JSON.parse(JSON.stringify(value))); } } },
  userScripts: {
    async getScripts() { return JSON.parse(JSON.stringify(registrations)); },
    async configureWorld(value) { worlds.push(value); },
    async register(items) { registrations.push(...JSON.parse(JSON.stringify(items))); },
    async update(items) { for (const item of items) { const i = registrations.findIndex((x) => x.id === item.id); if (i >= 0) registrations[i] = JSON.parse(JSON.stringify(item)); } },
    async unregister({ ids }) { registrations = registrations.filter((item) => !ids.includes(item.id)); },
    async execute() {}
  },
  tabs: { async query() { return []; }, async create() { return {}; } },
  alarms: { async create(name, options) { alarms.push({ name, options }); }, onAlarm: listeners() },
  runtime: { getURL(name) { return `chrome-extension://${name}`; }, async requestUpdateCheck() { return { status: 'no_update' }; }, onMessage: listeners(), onUserScriptMessage: listeners(), onInstalled: listeners(), onStartup: listeners(), onUpdateAvailable: listeners() },
  action: { onClicked: listeners() }
};
global.fetch = async (url) => {
  const text = String(url);
  if (text.startsWith('chrome-extension://config.json')) return { ok: true, async json() { return { plugin_index_url: 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rebuild/chrome-native-host-v2/releases/chrome/official-index.json' }; } };
  if (text.endsWith('/releases/chrome/official-index.json')) return { ok: true, async json() { return JSON.parse(JSON.stringify(index)); } };
  const match = index.units.find((unit) => unit.code_url === text);
  if (match) {
    const relative = new URL(match.code_url).pathname.split('/chrome-extension/')[1];
    const code = fs.readFileSync(path.join(root, 'chrome-extension', relative), 'utf8');
    return { ok: true, async text() { return code; } };
  }
  throw new Error(`unexpected fetch ${text}`);
};

global.DCFHostCore = require('../chrome-extension/src/core');
require('../chrome-extension/src/host-state');
require('../chrome-extension/src/host-runtime');
require('../chrome-extension/src/host-product');
const H = global.DCFHost;

(async () => {
  const install = await H.checkRemoteUpdates('test-install');
  assert.strictEqual(install.ok, true);
  assert.strictEqual(install.downloaded, 11);
  let state = await H.storageGet();
  assert(state.snapshots.candidate);
  assert.strictEqual(registrations.length, 11);
  assert.strictEqual(worlds.length, 11);
  const candidateId = state.snapshots.candidate.id;
  for (const entry of state.snapshots.candidate.entries) await H.recordUnitStarted({ unit_id: entry.id, version: entry.version }, { tab: { id: 1 }, url: 'https://chatgpt.com/c/test' });
  state = await H.storageGet();
  assert.strictEqual(state.snapshots.candidate, null);
  assert.strictEqual(state.snapshots.current.id, candidateId);
  assert.strictEqual(state.snapshots.last_known_good.id, candidateId);

  registrations = [];
  const repaired = await H.reconcileTarget('page-survival-bridge');
  assert.strictEqual(repaired.ok, true);
  assert.strictEqual(repaired.result.added, 11);
  assert.strictEqual(registrations.length, 11);

  const previousRefs = Object.fromEntries(state.snapshots.current.entries.map((entry) => [entry.id, { ...entry }]));
  const shellRef = index.units.find((unit) => unit.id === 'dcf.firstparty.shell');
  const nextCode = `${fs.readFileSync(path.join(root, 'chrome-extension/code-units/shell/main.js'), 'utf8')}\n/* shell update test */\n`;
  const nextHash = crypto.createHash('sha256').update(nextCode).digest('hex');
  const updatedIndex = JSON.parse(JSON.stringify(index));
  Object.assign(updatedIndex.units.find((unit) => unit.id === shellRef.id), { version: '1.0.0-rc.2-shell.2-test', hash: nextHash, code_url: 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/test/shell.js' });
  H.fetchPluginIndex = async () => ({ index: updatedIndex, url: 'https://raw.githubusercontent.com/test/index.json' });
  H.downloadIndexUnits = async (value) => Promise.all(value.units.map(async (ref) => {
    const code = ref.id === shellRef.id ? nextCode : fs.readFileSync(path.join(root, 'chrome-extension', new URL(ref.code_url).pathname.split('/chrome-extension/')[1]), 'utf8');
    return H.C.verifyUnit({ ...ref, code, source: { kind: 'test' } });
  }));
  const update = await H.checkRemoteUpdates('test-shell-update');
  assert.strictEqual(update.downloaded, 1);
  state = await H.storageGet();
  assert.strictEqual(state.snapshots.candidate.entries.find((entry) => entry.id === shellRef.id).version, '1.0.0-rc.2-shell.2-test');
  for (const entry of state.snapshots.candidate.entries) {
    if (entry.id !== shellRef.id) assert.deepStrictEqual({ version: entry.version, hash: entry.hash }, { version: previousRefs[entry.id].version, hash: previousRefs[entry.id].hash });
  }
  const base = await H.checkBaseUpdate();
  assert.strictEqual(base.ok, true);
  await H.pluginDataSet('dcf.firstparty.test', { value: 7 });
  assert.deepStrictEqual(await H.pluginDataGet('dcf.firstparty.test'), { value: 7 });
  console.log(JSON.stringify({ ok: true, github_default_install: 11, startup_evidence_commit: true, dynamic_registration_self_heal: 11, one_shell_plugin_update: true, unchanged_plugin_refs: 10, base_update_check: true, generic_plugin_storage: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
