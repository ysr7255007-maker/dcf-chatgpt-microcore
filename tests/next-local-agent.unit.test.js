'use strict';

const assert = require('assert');
const {
  extractLocalTaskEnvelopes,
  buildLocalResultEnvelope
} = require('../src-next/plugins/local-agent-envelope');
const {
  normalizeBridgeUrl,
  createRegistration,
  localAgentPlugin
} = require('../src-next/plugins/local-agent');

const decoded = extractLocalTaskEnvelopes(`before\n[DCF_LOCAL_TASK]\n{
  "schema": "dcf.local-task.v1",
  "workspace": "dcf",
  "instruction": " run tests "
}\n[/DCF_LOCAL_TASK]\nafter`);
assert.equal(decoded.errors.length, 0);
assert.equal(decoded.tasks.length, 1);
assert.equal(decoded.tasks[0].task.workspace, 'dcf');
assert.equal(decoded.tasks[0].task.instruction, 'run tests');

const invalid = extractLocalTaskEnvelopes('[DCF_LOCAL_TASK]{"schema":"wrong"}[/DCF_LOCAL_TASK]');
assert.equal(invalid.tasks.length, 0);
assert.equal(invalid.errors[0].code, 'local_task_schema_invalid');

const result = buildLocalResultEnvelope({ task_id: 'task-1', status: 'completed', summary: 'ok' });
assert(result.startsWith('[DCF_LOCAL_RESULT]'));
assert(result.includes('"schema": "dcf.local-result.v1"'));
assert(result.endsWith('[/DCF_LOCAL_RESULT]'));

assert.equal(normalizeBridgeUrl('http://localhost:48321/'), 'http://localhost:48321');
assert.equal(normalizeBridgeUrl('http://127.0.0.1:9000/path/'), 'http://127.0.0.1:9000');
assert.throws(() => normalizeBridgeUrl('https://example.com'), /bridge_url_must_be_loopback_http/);

const registration = createRegistration({
  installationId: 'install-1',
  pageSessionId: 'page-1',
  version: 'test',
  win: {
    location: { pathname: '/c/abc', href: 'https://chatgpt.com/c/abc' },
    innerWidth: 1200,
    innerHeight: 800
  }
});
assert.equal(registration.conversation_key, '/c/abc');
assert.deepEqual(registration.viewport, { width: 1200, height: 800 });

(async () => {
  let panel = null;
  let replyHandler = null;
  const values = new Map();
  const shell = {
    registerPanel(definition) { panel = definition; },
    refresh() {},
    notify() {}
  };
  const chatgpt = {
    onReplyCompleted(handler) { replyHandler = handler; },
    onNavigation() {},
    insert: async () => ({ inserted: true })
  };
  const api = await localAgentPlugin({ gmRequest: null }).start({
    plugin: { id: 'dcf.next.local-agent', version: '1.0.0' },
    platform: { window: { location: { pathname: '/', href: 'https://chatgpt.com/' }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerWidth: 1, innerHeight: 1 }, document: {} },
    storage: { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) },
    plugins: { get: (id) => id === 'dcf.next.shell' ? shell : id === 'dcf.next.chatgpt' ? chatgpt : null },
    survival: { version: 'test' }
  });
  assert(panel);
  assert(replyHandler);
  assert.equal(api.status().connection, 'disconnected');
  assert.doesNotThrow(() => replyHandler({ text: '[DCF_LOCAL_TASK]{"schema":"dcf.local-task.v1","instruction":"hello"}[/DCF_LOCAL_TASK]' }));
  assert.equal(api.status().pending_task.instruction, 'hello');
  console.log('next local agent tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
