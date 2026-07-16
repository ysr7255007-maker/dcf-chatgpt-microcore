'use strict';

const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createBridgeServer } = require('../bridge/local-agent-bridge');

function requestJson(port, method, route, body, token) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method,
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...(token ? { 'X-DCF-Session-Token': token } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, value });
        else reject(Object.assign(new Error(value.error || `http_${res.statusCode}`), { status: res.statusCode, value }));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-local-agent-test-'));
  const bridge = createBridgeServer({
    pairingCode: '123456',
    config: {
      host: '127.0.0.1',
      port: 0,
      default_workspace: 'dcf',
      workspaces: { dcf: process.cwd() },
      agent: { mode: 'echo', name: 'Echo' },
      task_dir: taskDir
    }
  });
  const address = await bridge.listen(0);
  const port = address.port;

  const health = await requestJson(port, 'GET', '/v1/health');
  assert.equal(health.value.status, 'ready');
  await assert.rejects(() => requestJson(port, 'POST', '/v1/pair', { code: '000000' }), /pairing_code_invalid/);

  const paired = await requestJson(port, 'POST', '/v1/pair', { code: '123456' });
  const token = paired.value.session_token;
  assert(token);

  const registered = await requestJson(port, 'POST', '/v1/register', {
    schema: 'dcf.local-instance.v1',
    installation_id: 'install-1',
    page_session_id: 'page-1',
    platform: 'chatgpt'
  }, token);
  assert(registered.value.binding_id);
  assert.equal(registered.value.workspace_alias, 'dcf');

  const submitted = await requestJson(port, 'POST', '/v1/tasks', {
    binding_id: registered.value.binding_id,
    task: { schema: 'dcf.local-task.v1', workspace: 'dcf', instruction: 'test the bridge' }
  }, token);
  assert.equal(submitted.status, 202);

  let record = submitted.value;
  for (let index = 0; index < 30 && record.status !== 'completed'; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    record = (await requestJson(port, 'GET', `/v1/tasks/${encodeURIComponent(record.task_id)}`, undefined, token)).value;
  }
  assert.equal(record.status, 'completed');
  assert.equal(record.result.schema, 'dcf.local-result.v1');
  assert(record.result.summary.includes('Echo'));
  assert(fs.existsSync(path.join(taskDir, `${record.task_id}.json`)));

  await bridge.close();
  fs.rmSync(taskDir, { recursive: true, force: true });
  console.log('local agent bridge tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
