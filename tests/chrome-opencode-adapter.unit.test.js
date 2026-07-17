'use strict';
const assert = require('assert');
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
global.self = global;
const localStore = {};
const sessionStore = {};
let granted = false;
const calls = [];
function listeners() { return { addListener() {} }; }
global.chrome = {
  storage: {
    local: {
      async get(key) { return { [key]: localStore[key] }; },
      async set(value) { Object.assign(localStore, JSON.parse(JSON.stringify(value))); }
    },
    session: {
      async get(key) { return { [key]: sessionStore[key] }; },
      async set(value) { Object.assign(sessionStore, value); },
      async remove(key) { delete sessionStore[key]; }
    }
  },
  permissions: {
    async contains({ origins }) { assert.deepStrictEqual(origins, ['http://localhost:4096/*']); return granted; },
    async request({ origins }) { assert.deepStrictEqual(origins, ['http://localhost:4096/*']); granted = true; return true; }
  },
  runtime: { getManifest() { return { version_name: '1.0.0-rc.3' }; }, onMessage: listeners(), onUserScriptMessage: listeners() }
};
function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === undefined ? '' : JSON.stringify(body); }
  };
}
global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const parsed = new URL(String(url));
  assert.strictEqual(parsed.origin, 'http://localhost:4096');
  const path = parsed.pathname;
  if (path === '/global/health') return response(200, { healthy: true, version: '1.2.3' });
  if (path === '/session' && options.method === 'POST') return response(200, { id: 'ses_test123', title: JSON.parse(options.body).title });
  if (path === '/session/ses_test123/prompt_async') return response(204);
  if (path === '/permission') return response(200, [{ id: 'perm_1', sessionID: 'ses_test123' }]);
  if (path === '/permission/perm_1/reply') return response(200, true);
  throw new Error(`unexpected fetch ${url}`);
};
global.DCFHost = { C: { nowIso: () => '2026-07-17T00:00:00.000Z', HOST_VERSION: '1.0.0-rc.2' } };
require('../chrome-extension/src/host-opencode');
const H = global.DCFHost;
const sender = { url: 'https://chatgpt.com/c/test', tab: { url: 'https://chatgpt.com/c/test' } };

(async () => {
  assert.strictEqual(H.C.HOST_VERSION, '1.0.0-rc.3');
  const initial = await H.handleLocalAgentMessage({ type: 'local_agent.config.get' }, sender);
  assert.strictEqual(initial.host_permission, false);
  assert.strictEqual(initial.has_password, false);
  await assert.rejects(() => H.handleLocalAgentMessage({ type: 'local_agent.config.set', config: { base_url: 'http://127.0.0.1:4096' } }, sender), /origin_is_fixed/);
  await assert.rejects(() => H.handleLocalAgentMessage({ type: 'local_agent.config.get' }, { url: 'https://example.com/' }), /untrusted_sender/);
  const permission = await H.handleLocalAgentMessage({ type: 'local_agent.host_permission.request' }, sender);
  assert.strictEqual(permission.granted, true);
  const saved = await H.handleLocalAgentMessage({ type: 'local_agent.config.set', config: { username: 'dcf', agent: 'build', model: { providerID: 'openai', modelID: 'gpt-test' } }, password: 'secret' }, sender);
  assert.strictEqual(saved.has_password, true);
  assert.strictEqual(saved.config.agent, 'build');
  assert.strictEqual(saved.config.model.modelID, 'gpt-test');
  assert.strictEqual(localStore['dcf.chrome.local-agent.config.v1'].password, undefined);
  const health = await H.handleLocalAgentMessage({ type: 'local_agent.health' }, sender);
  assert.strictEqual(health.health.healthy, true);
  const auth = calls.find((call) => call.url.endsWith('/global/health')).options.headers.Authorization;
  assert.strictEqual(auth, `Basic ${Buffer.from('dcf:secret').toString('base64')}`);
  const created = await H.handleLocalAgentMessage({ type: 'local_agent.session.create', title: 'DCF test' }, sender);
  assert.strictEqual(created.session.id, 'ses_test123');
  await H.handleLocalAgentMessage({ type: 'local_agent.session.prompt', session_id: 'ses_test123', instruction: 'Inspect the repo' }, sender);
  const promptCall = calls.find((call) => call.url.endsWith('/session/ses_test123/prompt_async'));
  const prompt = JSON.parse(promptCall.options.body);
  assert.strictEqual(prompt.agent, 'build');
  assert.deepStrictEqual(prompt.model, { providerID: 'openai', modelID: 'gpt-test' });
  assert.deepStrictEqual(prompt.parts, [{ type: 'text', text: 'Inspect the repo' }]);
  const permissions = await H.handleLocalAgentMessage({ type: 'local_agent.permissions.list' }, sender);
  assert.strictEqual(permissions.permissions[0].id, 'perm_1');
  await H.handleLocalAgentMessage({ type: 'local_agent.permission.reply', session_id: 'ses_test123', request_id: 'perm_1', reply: 'once' }, sender);
  assert(calls.some((call) => call.url.endsWith('/permission/perm_1/reply')));
  await H.handleLocalAgentMessage({ type: 'local_agent.password.clear' }, sender);
  await assert.rejects(() => H.handleLocalAgentMessage({ type: 'local_agent.health' }, sender), /password_required/);
  console.log(JSON.stringify({ ok: true, fixed_origin: true, trusted_sender: true, optional_host_permission: true, session_only_secret: true, basic_auth: true, session_prompt: true, permission_reply: true, runtime_version_from_manifest: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
