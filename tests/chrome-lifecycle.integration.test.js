'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'dist', 'dcf-chrome-extension');

class Event {
  constructor() { this.listeners = []; }
  addListener(listener) { this.listeners.push(listener); }
  async emit(...args) { return Promise.all(this.listeners.map((listener) => listener(...args))); }
}

const store = {};
const registered = new Map();
const createdTabs = [];
const runtimeOnMessage = new Event();
const runtimeOnUserScriptMessage = new Event();
const runtimeOnInstalled = new Event();
const runtimeOnStartup = new Event();
const alarmEvent = new Event();
const actionEvent = new Event();

const chrome = {
  storage: { local: {
    async get(key) { return { [key]: store[key] }; },
    async set(value) { Object.assign(store, JSON.parse(JSON.stringify(value))); }
  } },
  userScripts: {
    async configureWorld() {},
    async getScripts() { return Array.from(registered.values()).map((item) => JSON.parse(JSON.stringify(item))); },
    async register(items) { for (const item of items) { if (registered.has(item.id)) throw new Error(`duplicate ${item.id}`); registered.set(item.id, JSON.parse(JSON.stringify(item))); } },
    async update(items) { for (const item of items) { if (!registered.has(item.id)) throw new Error(`missing ${item.id}`); registered.set(item.id, JSON.parse(JSON.stringify(item))); } },
    async unregister({ ids }) { for (const id of ids) registered.delete(id); },
    async execute() {}
  },
  runtime: {
    id: 'dcf-test-extension',
    getURL(relative) { return `file://${path.join(extension, relative)}`; },
    onMessage: runtimeOnMessage,
    onUserScriptMessage: runtimeOnUserScriptMessage,
    onInstalled: runtimeOnInstalled,
    onStartup: runtimeOnStartup
  },
  tabs: {
    async create(options) { createdTabs.push(options); return options; },
    async query() { return []; }
  },
  alarms: { async create() {}, onAlarm: alarmEvent },
  action: { onClicked: actionEvent }
};

async function fileFetch(url) {
  if (!String(url).startsWith('file://')) throw new Error(`unexpected network fetch ${url}`);
  const filename = new URL(url).pathname;
  const text = fs.readFileSync(filename, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(text); }, async text() { return text; } };
}

const context = vm.createContext({
  console,
  chrome,
  fetch: fileFetch,
  URL,
  TextEncoder,
  setTimeout,
  clearTimeout,
  crypto: crypto.webcrypto,
  self: null,
  globalThis: null,
  importScripts: (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(extension, 'src', file), 'utf8'), context, { filename: file });
  }
});
context.self = context;
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(extension, 'src', 'background.js'), 'utf8'), context, { filename: 'background.js' });

function request(event, message, sender = { url: 'https://chatgpt.com/c/test', tab: { id: 7 } }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sendResponse = (value) => { settled = true; resolve(value); };
    try {
      const result = event.listeners[0](message, sender, sendResponse);
      if (result !== true && !settled) resolve(result);
    } catch (error) { reject(error); }
    setTimeout(() => { if (!settled) reject(new Error(`message timeout ${message.type}`)); }, 3000);
  });
}

(async () => {
  await runtimeOnInstalled.emit({ reason: 'install' });
  let status = await request(runtimeOnMessage, { type: 'host.status' });
  assert(status.ok);
  assert(status.snapshots.candidate, 'initial official candidate was not staged');
  assert.strictEqual(registered.size, 2, 'official code units were not registered');
  const candidate = status.snapshots.candidate;
  for (const entry of candidate.entries) {
    const reply = await request(runtimeOnUserScriptMessage, { type: 'unit.started', unit_id: entry.id, version: entry.version });
    assert(reply.ok);
  }
  status = await request(runtimeOnMessage, { type: 'host.status' });
  assert(!status.snapshots.candidate, 'candidate was not committed after complete startup evidence');
  assert(status.snapshots.current && status.snapshots.last_known_good, 'current/LKG snapshot missing');

  const currentId = status.snapshots.current.id;
  registered.clear();
  await runtimeOnStartup.emit();
  status = await request(runtimeOnMessage, { type: 'host.status' });
  assert.strictEqual(status.snapshots.current.id, currentId, 'browser startup changed the confirmed snapshot');
  assert.strictEqual(registered.size, 2, 'extension update/startup did not rebuild cleared user-script registrations');

  const disable = await request(runtimeOnMessage, { type: 'host.disable_unit', id: 'dcf.firstparty.diagnostics' });
  assert(disable.ok);
  status = await request(runtimeOnMessage, { type: 'host.status' });
  assert(status.snapshots.candidate, 'disable did not create a candidate snapshot');
  const failure = await request(runtimeOnUserScriptMessage, { type: 'unit.failed', unit_id: 'dcf.firstparty.ammo', version: '1.0.0-rc.1', error: 'controlled failure' });
  assert(failure.ok === true || failure.status === 'current_restored');
  status = await request(runtimeOnMessage, { type: 'host.status' });
  assert(!status.snapshots.candidate, 'failed candidate was not cleared');
  assert.strictEqual(status.snapshots.current.id, currentId, 'failed candidate overwrote the last known good snapshot');
  assert.strictEqual(registered.size, 2, 'rollback did not restore the full last known good registration set');

  const ammo = { id: 'same-id', title: 'Original', purpose: 'test', body: 'one' };
  await request(runtimeOnUserScriptMessage, { type: 'ammo.upsert', item: ammo });
  await request(runtimeOnUserScriptMessage, { type: 'ammo.upsert', item: Object.assign({}, ammo, { body: 'two' }) });
  status = await request(runtimeOnMessage, { type: 'host.status' });
  assert.strictEqual(status.product.ammo['same-id']._meta.version, 2, 'same-id ammo update did not replace in place');

  console.log(JSON.stringify({ ok: true, installed_units: 2, candidate_commit_after_evidence: true, update_restore: true, failed_candidate_rollback: true, same_id_ammo_update: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
