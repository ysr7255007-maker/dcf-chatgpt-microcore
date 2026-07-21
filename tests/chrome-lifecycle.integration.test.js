'use strict';
const assert = require('assert');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const unit = (id, version, code, phase) => ({
  id,
  version,
  title: id,
  description: id,
  hash: sha(code),
  artifact_id: `sha256:${sha(code)}`,
  code_url: `https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/test/${id}/${version}.js`,
  matches: ['https://chatgpt.com/*'],
  run_at: 'document_idle',
  world_id: `dcf-${id.replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
  host_api: '3',
  phase,
  required: true,
  default_enabled: true,
  code
});

const a1 = unit('dcf.firstparty.a', '1.0.0', '(function(){globalThis.a=1;})();', 10);
const b1 = unit('dcf.firstparty.b', '1.0.0', '(function(){globalThis.b=1;})();', 20);
let remoteUnits = [a1, b1];
let stored = {};
let registrations = [];
let nextTabId = 100;
let allTabs = [
  { id: 1, url: 'https://chatgpt.com/c/test', status: 'complete', active: true },
  { id: 2, url: 'https://example.com/', status: 'complete', active: false }
];
const removedTabs = [];
const executeCalls = [];
const alarms = [];
const worlds = [];
const listeners = () => ({ addListener() {} });

global.self = global;
global.chrome = {
  storage: {
    local: {
      async get(key) { return { [key]: stored[key] }; },
      async set(value) { Object.assign(stored, JSON.parse(JSON.stringify(value))); }
    }
  },
  userScripts: {
    async getScripts() { return JSON.parse(JSON.stringify(registrations)); },
    async configureWorld(value) { worlds.push(JSON.parse(JSON.stringify(value))); },
    async register(items) { registrations.push(...JSON.parse(JSON.stringify(items))); },
    async update(items) {
      for (const item of items) {
        const index = registrations.findIndex((entry) => entry.id === item.id);
        if (index >= 0) registrations[index] = JSON.parse(JSON.stringify(item));
      }
    },
    async unregister({ ids }) {
      registrations = registrations.filter((item) => !ids.includes(item.id));
    },
    async execute(request) {
      executeCalls.push(JSON.parse(JSON.stringify(request)));
      const code = request.js && request.js[0] && request.js[0].code || '';
      if (code.includes('THROW_CANARY')) throw new Error('synthetic_canary_failure');
    }
  },
  tabs: {
    async query() {
      return allTabs.filter((tab) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url));
    },
    async create(options) {
      const tab = { id: ++nextTabId, url: options.url, status: 'complete', active: !!options.active };
      allTabs.push(tab);
      return JSON.parse(JSON.stringify(tab));
    },
    async get(id) {
      const tab = allTabs.find((item) => item.id === id);
      if (!tab) throw new Error('tab_not_found');
      return JSON.parse(JSON.stringify(tab));
    },
    async remove(id) {
      removedTabs.push(id);
      allTabs = allTabs.filter((item) => item.id !== id);
    }
  },
  alarms: {
    async create(name, options) { alarms.push({ name, options }); },
    onAlarm: listeners()
  },
  runtime: {
    getURL(name) { return `chrome-extension://${name}`; },
    async requestUpdateCheck() { return { status: 'no_update' }; },
    onMessage: listeners(),
    onUserScriptMessage: listeners(),
    onInstalled: listeners(),
    onStartup: listeners(),
    onUpdateAvailable: listeners()
  },
  action: { onClicked: listeners() },
  scripting: { async executeScript() { return [{ result: null }]; } }
};

global.fetch = async (url) => {
  const text = String(url);
  if (text === 'chrome-extension://config.json') {
    return {
      ok: true,
      async json() {
        return {
          schema: 'dcf.chrome.config.v2',
          plugin_index_url: 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/test/official-index.json'
        };
      }
    };
  }
  if (text.endsWith('/official-index.json')) {
    return {
      ok: true,
      async json() {
        return {
          schema: 'dcf.plugin_index.v2',
          version: 'test',
          units: remoteUnits.map(({ code, ...ref }) => ref)
        };
      }
    };
  }
  const found = remoteUnits.find((item) => item.code_url === text);
  if (found) return { ok: true, async text() { return found.code; } };
  throw new Error(`unexpected fetch ${text}`);
};

global.DCFHostCore = require('../chrome-extension/src/core');
require('../chrome-extension/src/host-state');
require('../chrome-extension/src/host-runtime');
require('../chrome-extension/src/host-runtime-registration');
require('../chrome-extension/src/host-runtime-canary');
require('../chrome-extension/src/host-runtime-observation');
require('../chrome-extension/src/host-runtime-reconcile');
require('../chrome-extension/src/host-product');
require('../chrome-extension/src/host-main');
const H = global.DCFHost;

(async () => {
  const install = await H.checkRemoteUpdates('test-install');
  assert.strictEqual(install.ok, true);
  assert.strictEqual(install.status, 'installed_default');
  let state = await H.storageGet();
  assert.strictEqual(state.schema, 'dcf.chrome.host.state.v3');
  assert(state.desired.snapshot);
  assert(state.committed.current);
  assert.strictEqual(state.desired.snapshot.id, state.committed.current.id);
  assert.strictEqual(state.committed.last_known_good.id, state.committed.current.id);
  assert.strictEqual(state.committed.stable, null, 'Canary commit must not impersonate behavior-passed Stable');
  await assert.rejects(
    () => H.promoteCurrentToStable({ snapshot_id: state.committed.current.id }),
    /stable_promotion_requires_acceptance_evidence/
  );
  const promoted = await H.promoteCurrentToStable({
    snapshot_id: state.committed.current.id,
    acceptance_ref: 'acceptance:test:first-install',
    claim_scope: 'synthetic control-plane lifecycle only'
  });
  assert.strictEqual(promoted.result.snapshot_id, state.committed.current.id);
  state = await H.storageGet();
  const firstStableId = state.committed.stable.id;
  assert.strictEqual(registrations.length, 2);
  assert.strictEqual(removedTabs.length, 1, 'host-created canary must be closed after commit');
  assert.strictEqual(allTabs.some((tab) => tab.id === 2), true, 'non-ChatGPT tabs must remain untouched');
  assert(executeCalls.every((call) => call.target.tabId !== 2), 'non-ChatGPT tab must not participate in proof or migration');
  assert(state.activation_records.some((record) => record.status === 'committed'));
  assert(state.evidence.some((event) => event.type === 'runtime.loaded'));
  assert(state.evidence.some((event) => event.type === 'commit.completed'));

  const firstSnapshotId = state.committed.current.id;
  const firstRevision = state.revision;
  const repeat = await H.reconcile('repeat-same-desired');
  assert.strictEqual(repeat.ok, true);
  state = await H.storageGet();
  assert.strictEqual(state.committed.current.id, firstSnapshotId);
  assert(state.revision > firstRevision);
  assert.strictEqual(state.committed.history.length, 0, 'idempotent reconcile must not duplicate commits');

  const a2 = unit('dcf.firstparty.a', '2.0.0', '(function(){globalThis.a=2;})();', 10);
  remoteUnits = [a2, b1];
  const update = await H.checkRemoteUpdates('test-update');
  assert.strictEqual(update.ok, true);
  state = await H.storageGet();
  assert.strictEqual(state.committed.current.entries.find((entry) => entry.id === a2.id).hash, a2.hash);
  assert.strictEqual(state.committed.current.entries.find((entry) => entry.id === b1.id).hash, b1.hash);
  assert.strictEqual(state.committed.history.length, 1);
  assert.strictEqual(state.committed.history[0].id, firstSnapshotId);
  assert.strictEqual(state.committed.stable.id, firstStableId, 'later Canary commits must not auto-promote Stable');
  const latestActivation = state.activation_records[state.activation_records.length - 1];
  assert.deepStrictEqual(latestActivation.proof_refs.map((ref) => ref.id), [a2.id], 'only changed enabled artifact should require new canary proof');

  const sameVersionNewContent = unit('dcf.firstparty.a', '2.0.0', '(function(){globalThis.a=3;})();', 10);
  remoteUnits = [sameVersionNewContent, b1];
  const historicalRepair = await H.checkRemoteUpdates('historical-version-reuse-repair');
  assert.strictEqual(historicalRepair.ok, true);
  state = await H.storageGet();
  assert(state.code_units[a2.hash], 'old artifact must remain addressable');
  assert(state.code_units[sameVersionNewContent.hash], 'new artifact must be stored separately');
  assert.strictEqual(
    state.committed.current.entries.find((entry) => entry.id === sameVersionNewContent.id).hash,
    sameVersionNewContent.hash
  );

  const disabled = await H.setUnitEnabled(b1.id, false, 1);
  assert.strictEqual(disabled.ok, true);
  state = await H.storageGet();
  assert.strictEqual(state.committed.current.entries.find((entry) => entry.id === b1.id).enabled, false);
  assert.strictEqual(state.observed.pages['tab:1:frame:0'].migration_status, 'reload_required');

  const beforeDedicatedCanaryFailure = state.committed.current.id;
  const originalCreate = chrome.tabs.create;
  chrome.tabs.create = async () => { throw new Error('synthetic_tab_create_failure'); };
  const aDedicatedOnly = unit('dcf.firstparty.a', '2.1.0', '(function(){globalThis.a=21;})();', 10);
  remoteUnits = [aDedicatedOnly, b1];
  const dedicatedFailure = await H.checkRemoteUpdates('dedicated-canary-required');
  assert.strictEqual(dedicatedFailure.ok, false);
  assert.match(dedicatedFailure.error || dedicatedFailure.activation?.error || '', /dedicated_canary_page_unavailable/);
  state = await H.storageGet();
  assert.strictEqual(state.committed.current.id, beforeDedicatedCanaryFailure);
  chrome.tabs.create = originalCreate;
  await H.rollbackToLastKnownGood('clear-dedicated-canary-failure');
  state = await H.storageGet();

  const beforeFailure = state.committed.current.id;
  const failing = unit('dcf.firstparty.a', '3.0.0', '(function(){/* THROW_CANARY */})();', 10);
  remoteUnits = [failing, b1];
  const failedUpdate = await H.checkRemoteUpdates('test-canary-failure');
  assert.strictEqual(failedUpdate.ok, false);
  state = await H.storageGet();
  assert.strictEqual(state.committed.current.id, beforeFailure, 'failed canary must not alter Current');
  assert.strictEqual(state.committed.last_known_good.id, beforeFailure, 'failed canary must not alter LKG');
  assert.strictEqual(state.desired.status, 'failed');
  assert(state.activation_records.some((record) => record.status === 'failed'));

  const recovered = await H.rollbackToLastKnownGood('test-recovery');
  assert.strictEqual(recovered.ok, true);
  state = await H.storageGet();
  assert.strictEqual(state.committed.current.id, beforeFailure);
  assert.strictEqual(state.desired.snapshot.id, beforeFailure);
  assert.strictEqual(state.desired.status, 'converged');

  console.log(JSON.stringify({
    ok: true,
    desired_observed_committed_reconcile: true,
    content_addressed_units: true,
    canary_isolated_from_non_chatgpt_tabs: true,
    dedicated_canary_fails_closed: true,
    current_lkg_atomic_commit: true,
    stable_requires_explicit_acceptance_evidence: true,
    stable_not_auto_promoted: true,
    repeated_reconcile_idempotent: true,
    changed_artifact_only_proof: true,
    historical_version_reuse_preserved_by_hash: true,
    canary_failure_preserves_current_lkg: true,
    disable_marks_existing_page_reload_required: true,
    recovery_uses_committed_lkg: true
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
