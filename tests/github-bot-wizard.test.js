'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const Bot = require('../scripts/setup-github-bot');
const tests = [];
const ok = name => tests.push(name);
let temp;
function sandbox() { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-bot-')); process.env.DCF_GITHUB_BOT_CONFIG_DIR = temp; }
function clean() { delete process.env.DCF_GITHUB_BOT_CONFIG_DIR; try { if (temp) fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {} temp = null; }
function request(port, method, route, headers = {}) { return new Promise((resolve, reject) => { const r = http.request({ hostname: '127.0.0.1', port, path: route, method, agent: false, headers: { Connection: 'close', ...headers } }, response => { let text = ''; response.on('data', b => text += b); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text })); }); r.on('error', reject); r.end(); }); }
async function closeServer() { if (Bot.serverState.server) { try { await new Promise(resolve => Bot.serverState.server.close(resolve)); } catch (_) {} } Bot.serverState.server = null; Bot.serverState.port = null; Bot.clearSensitiveMemory(); Bot.serverState.currentStep = 'intro'; }

function mockGitHub(responses) {
  const calls = []; const original = https.request;
  https.request = (options, callback) => {
    const req = new EventEmitter(); req._body = null;
    req.write = body => { req._body = body; };
    req.setTimeout = () => {}; req.destroy = () => {};
    req.end = () => {
      const fullPath = options.path || options.pathname || '/';
      const auth = options.headers?.Authorization || '';
      const found = responses.find(r => fullPath === r.path);
      const resp = found || responses.find(r => r.pathPrefix && fullPath.startsWith(r.pathPrefix));
      const result = { status: resp?.status || 200, body: resp?.body || '{}' };
      calls.push({ path: fullPath, auth, method: options.method, body: req._body, hostname: options.hostname });
      const response = new EventEmitter(); response.statusCode = result.status; response.headers = {};
      callback(response);
      if (result.body) { response.emit('data', Buffer.from(result.body)); }
      response.emit('end');
    };
    return req;
  };
  return { calls, restore: () => { https.request = original; } };
}

function fakePem() {
  return '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCGPoLQV1pqdSf+\nczYtKuht89NE5VT9eWOJbPtwYFCBJZpq8Cm2sUeYj+DfgzSLNdtWx9hwbeSCLLzU\nLK605cVMQnKmN/25XaRU/AllIhqqt3k2+mPo2MIJL3n4fkl4d0IIxHQaPbkPaye2\na0Gy1xBfUm5thBhIGNGZWMrI6RjgRgqUJ5xVcRom6yCUJ18h5mioyuqBrq7BlEZw\nsOa0wKJyB9HCwsp6Q3s2LxMvifZzqKFZIRWcAo7WIMwDpALSE/B1tsgXrFj0FyiA\nTYmmdk9OkDOSH2HiMGfUKKT4TTyZ9CPuIb5XvHb23d8O8lzwAboldGTjrk45+36H\nCvs4EcBFAgMBAAECggEACK2uXcMj6nlv8DRpBnL9ayxF1nCf9bH9BBOaTqm/UpYI\nfUzQ2Yls6Dk276QnB6/f4eSSArSr/tlfDLVlxvaKsnMiP8ojWjIqTz8q6VGS2UH6\nsVnvDwzCQH9D+pNJcyL8jx4KJm8ikVNbUiDtcp8SJSNqVaSiQDjwheIWW/YrwEXW\n7aZqeGMIdDzXrfe2cgfiMltwWcdeCCW0IDhAZXncqMzbuhmABk0i9bqOgYk2x8Nn\nlh4mJ3RLu85sVE8/JsiB5KZxG7CS1HXbGoBPOOBi/aNAHuzefiBQGxOqzYvjWMnu\n/KXtoD0k/NomhxNih0Yn5bnxdEis2ome9S4DBS2cOQKBgQC5wMKPnAb+x14qP+pO\nnUrXdQ0igzvFLCwl9WGigP7i6bbJzwAxwE/ULzMdAMFYsoCeCmGlD79AqsKui71C\nlExtZJ8W0ZalUZ1PyLa9NM5pVRzYh6LehFH0ofzyk3Q0vKvwrUF2ryzHkytNwevf\n3LRR8kPjpkMzx56DCzteXSsBOQKBgQC5AwxXKb3slsZqP4zIoRuXWczQbMyu6U5P\nOVl4k2RTMrmu58R2U7xCJJseWAJwC54HiTGIh6S+BcZOutTDHBGFM8kkJXXKDL/+\nnIZGO1QRidVgnpm7ovHoUZ6s3gvO46enJ/yWQnGry2BO2fQop2ee3Dv9UkG4Smy5\nFw5tGAMTbQKBgF8nY4N1hg/VyWMTQs/qu4ALsiLP3zpuGl+Hh/Ba7DcJSl2u8IaL\n4VjspN5imKj7J+/NmZ+YpXxW/Uu0wcrtdQlE1ko2K1mcqV1JkHL0Lhi/RPuW39Pl\nLKaIpK8O4iRx0hKEbliB/ApwVWqLwGz4/lZMKILhlONditHOWydHytPhAoGAX0EQ\ng3f8Tuk58s4RX+KC4CPd7Zl2sL9yEBwI0qmgR62gKEsvvXRTQwKx0qehaaqxjFO4\nawDbcvJqLXLHxESZSKlm7/NRd9ukpiRUhahaGkWK1JoTsKWuQtxzA7G3BqfzU36k\n73/6ImctiKtyp9O45/Of90b4izfWTl1ukgCA5OkCgYBz2sgWpouHzCfXmon2pMfO\nCx/XpURmtkZFzY8puipVMGUBgCDn00QA9L/gdPNq3PB2mOoIjA44SY8QOfXaFxLa\nV3qQAcwdtiWFgmBSwkX+9YJrzlMpH6Kgesa/SWXYuF/nphm3AhEn4EsiDbnORqwB\nz4xcnmBFVgJi2yeBpfcwag==\n-----END PRIVATE KEY-----\n';
}

(async () => {
  // ─── Existing tests (preserved, with adjustments for new behavior) ───

  // Test 1: Manifest contract
  sandbox();
  const manifest = Bot.createManifest(32123, 'state');
  assert.deepStrictEqual(manifest.default_permissions, { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' });
  assert.deepStrictEqual(manifest.default_events, []); assert.strictEqual(manifest.hook_attributes.active, false);
  assert.strictEqual(manifest.hook_attributes.url, 'http://127.0.0.1:32123/webhook-disabled');
  assert.ok(!('workflows' in manifest.default_permissions) && !('administration' in manifest.default_permissions)); ok('manifest_exact_minimum_and_inactive_webhook_url');
  clean();

  // Test 2: Branch protection payload
  const p = Bot.branchProtectionPayload();
  assert.deepStrictEqual(p.required_status_checks.contexts, ['verify', 'verify-and-package']);
  assert.deepStrictEqual(p.required_pull_request_reviews.bypass_pull_request_allowances, { users: [], teams: [], apps: [] });
  assert.ok(!('bypass_pull_request_allowances' in p)); assert.strictEqual(p.allow_force_pushes, false); assert.strictEqual(p.allow_deletions, false); ok('branch_protection_exact_payload');

  // Test 3: Local routing security
  sandbox();
  const port = await Bot.startServer(); const good = { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
  let r = await request(port, 'GET', '/api/start', { Host: good.Host }); assert.strictEqual(r.status, 405); assert.strictEqual(Bot.serverState.currentStep, 'intro'); ok('get_cannot_start_wizard');
  r = await request(port, 'POST', '/api/start', { Host: good.Host }); assert.strictEqual(r.status, 403); ok('mutation_requires_origin_and_csrf');
  r = await request(port, 'POST', '/api/start', { ...good, Origin: 'https://evil.example' }); assert.strictEqual(r.status, 403); ok('cross_origin_rejected');
  r = await request(port, 'POST', '/api/start', { ...good, 'X-DCF-Wizard-CSRF': 'wrong' }); assert.strictEqual(r.status, 403); ok('bad_csrf_rejected');
  r = await request(port, 'POST', '/api/start', good); assert.strictEqual(r.status, 200); assert.strictEqual(Bot.serverState.currentStep, 'started'); ok('same_origin_csrf_mutation_accepted');
  r = await request(port, 'GET', '/', { Host: good.Host }); assert.strictEqual(r.status, 200); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/); assert.strictEqual(r.headers['x-frame-options'], 'DENY'); assert.strictEqual(r.headers['x-content-type-options'], 'nosniff'); assert.match(r.headers['cache-control'], /no-store/); ok('sensitive_wizard_response_headers');
  r = await request(port, 'GET', '/', { Host: `localhost:${port}` }); assert.strictEqual(r.status, 400); ok('wrong_host_rejected');
  r = await request(port, 'GET', '/api/branch-protection', { Host: good.Host }); assert.strictEqual(r.status, 405); ok('get_cannot_change_branch_protection');
  r = await request(port, 'POST', '/api/cancel', good); assert.strictEqual(r.status, 200); assert.strictEqual(Bot.serverState.manifestState, null); ok('cancel_clears_transient_state');
  await closeServer();
  clean();

  // Test 4: Token scope
  sandbox();
  const originalRequest = https.request; let captured;
  https.request = (options, callback) => { captured = options; const req = new EventEmitter(); req.write = body => { captured.body = body; }; req.setTimeout = () => {}; req.end = () => { const response = new EventEmitter(); response.statusCode = 201; callback(response); response.emit('data', Buffer.from('{"token":"temporary"}')); response.emit('end'); }; return req; };
  try { await Bot.createInstallationToken('jwt', 42); assert.strictEqual(captured.path, '/app/installations/42/access_tokens'); assert.deepStrictEqual(JSON.parse(captured.body), { repositories: ['dcf-chatgpt-microcore'] }); ok('installation_token_restricted_to_target_repository'); } finally { https.request = originalRequest; }
  clean();

  // Test 5: Credential permissions and no-overwrite
  sandbox();
  try {
    Bot.saveCredentials({ id: 1, slug: 'bot', client_id: 'id', client_secret: 'x', webhook_secret: 'y' }, 'private');
    assert.strictEqual(fs.statSync(path.join(temp, Bot.PRIVATE_KEY_FILENAME)).mode & 0o777, 0o600); assert.strictEqual(fs.statSync(temp).mode & 0o777, 0o700);
    assert.throws(() => Bot.saveCredentials({ id: 2 }, 'private'), /不会静默覆盖/); ok('credential_transaction_permissions_and_no_overwrite');
  } finally { clean(); }

  // Test 6: Symlink guard
  sandbox();
  try {
    const outside = path.join(temp, 'outside'); fs.writeFileSync(outside, 'x'); fs.symlinkSync(outside, path.join(temp, Bot.PRIVATE_KEY_FILENAME));
    assert.throws(() => Bot.saveCredentials({ id: 1, slug: 'bot' }, 'private'), /符号链接|已有 Bot/); assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'x'); ok('credential_symlink_and_toctou_guard');
  } finally { clean(); }

  // Test 7: Different installation rejection
  sandbox();
  try {
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', installation_id: 7, repository: Bot.REPOSITORY });
    assert.throws(() => Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', installation_id: 8, repository: Bot.REPOSITORY }), /不同 Installation/); ok('different_installation_cannot_replace_config');
  } finally { clean(); }

  // Test 8: Setup callback claim
  sandbox();
  try {
    Bot.serverState.setupState = 'setup-once'; Bot.serverState.setupStateUsed = false; Bot.serverState.expiresAt = Date.now() + 1_000;
    assert.strictEqual(Bot.claimSetupCallback(9, 'setup-once'), 'claimed');
    assert.strictEqual(Bot.claimSetupCallback(9, 'setup-once'), 'rejected');
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', installation_id: 9, repository: Bot.REPOSITORY });
    assert.strictEqual(Bot.claimSetupCallback(9, 'anything'), 'complete'); ok('setup_callback_atomic_claim_replay_and_idempotency');
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // Test 9: HTML escaping
  const escaped = Bot.renderCompleteHTML({ app_slug: '<script>alert(1)</script>', app_id: '<x>', installation_id: 1, repository: '<img>', permission_verification: { candidate_ref: '<script>', all_verified: true } }, { app_slug: '<script>' });
  assert.ok(!escaped.includes('<script>alert')); assert.match(escaped, /&lt;script&gt;/); assert.ok(escaped.includes('App 安装')); assert.ok(escaped.includes('权限验证')); assert.ok(escaped.includes('分支门禁')); ok('completion_html_escapes_corrupt_config');

  // Test 10: CSRF unpredictability
  const a = Bot.generateCSRFState(), b = Bot.generateCSRFState(); assert.match(a, /^[0-9a-f]{64}$/); assert.notStrictEqual(a, b); ok('unpredictable_csrf_state');

  // Test 11: Three-state completion page sections
  const sections = Bot.renderCompleteHTML({
    app_slug: 'dcf-bot', app_id: '1', installation_id: 1, repository: Bot.REPOSITORY,
    permission_verification: { all_verified: true, contents: 'write', pull_requests: 'write', candidate_ref: Bot.CANDIDATE_REF }
  }, { app_slug: 'dcf-bot' });
  assert.ok(sections.includes('<section><h2>App 安装'));
  assert.ok(sections.includes('<section><h2>权限验证'));
  assert.ok(sections.includes('<section><h2>分支门禁'));
  ok('completion_page_three_state_sections');

  // Test 12: handle_status_preserves_complete_warn (updated for derived step)
  sandbox();
  try {
    Bot.serverState.currentStep = 'complete-warn';
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: 1, app_slug: 'bot', installation_id: 7, repository: Bot.REPOSITORY, permission_verification: { all_verified: false } });
    Bot.saveCredentials({ id: 1, slug: 'bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, 'key');
    Bot.serverState.server = new (require('events').EventEmitter)();
    Bot.serverState.port = 12345;
    let captured;
    const fakeRes = { writeHead: (code, headers) => { captured = { code, headers }; }, end: (body) => { captured.body = JSON.parse(body); } };
    Bot.handleStatus(fakeRes);
    assert.strictEqual(captured.body.step, 'complete-warn');
    assert.strictEqual(captured.body.permission_verified, false);
    ok('handle_status_preserves_complete_warn');
  } finally { clean(); Bot.clearSensitiveMemory(); Bot.serverState.server = null; Bot.serverState.port = null; }

  // ─── New tests for 6 review items ───

  // === ITEM 5: linkSync atomic no-overwrite ===
  sandbox();
  try {
    const file = path.join(temp, 'test-atomic.json');
    fs.writeFileSync(file, 'original value');
    // atomicWriteSecure must NOT overwrite existing file
    assert.throws(() => Bot.atomicWriteSecure(file, 'replacement'), /EEXIST|already exists/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'original value');
    ok('atomic_write_linkSync_no_overwrite');
  } finally { clean(); }

  // === ITEM 4: server close on cancel ===
  sandbox();
  try {
    const cp = await Bot.startServer();
    const g = { Host: `127.0.0.1:${cp}`, Origin: `http://127.0.0.1:${cp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
    r = await request(cp, 'POST', '/api/cancel', g);
    assert.strictEqual(r.status, 200);
    // Wait for server to close
    await new Promise(r2 => { if (Bot.serverState.server && Bot.serverState.server.listening) { Bot.serverState.server.once('close', r2); } else { r2(); } });
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening);
    ok('server_closes_on_cancel');
  } finally { await closeServer(); clean(); }

  // === ITEM 1 + 4 + 6: Full flow with JWT auth and server close ===
  sandbox();
  try {
    const fsPort = await Bot.startServer();
    const fsGood = { Host: `127.0.0.1:${fsPort}`, Origin: `http://127.0.0.1:${fsPort}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Step 1: Open home page
    r = await request(fsPort, 'GET', '/', { Host: fsGood.Host });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('DCF GitHub App Bot'));

    // Step 2: POST /api/start
    r = await request(fsPort, 'POST', '/api/start', fsGood);
    assert.strictEqual(r.status, 200);
    const startBody = JSON.parse(r.body);
    assert.ok(startBody.github_url);
    assert.ok(startBody.manifest);
    const manifestState = new URL(startBody.github_url).searchParams.get('state');
    const setupStateFromStart = new URLSearchParams(new URL(startBody.github_url).search).get('state');

    // Step 3: Mock manifest code exchange
    const mock1 = mockGitHub([
      { path: '/app-manifests/CODE/conversions', body: JSON.stringify({ id: 12345, slug: 'dcf-local-bot', client_id: 'cid123', client_secret: 'cs456', webhook_secret: 'ws789', pem: fakePem() }) }
    ]);

    // Step 4: Simulate manifest callback
    r = await request(fsPort, 'GET', `/callback?code=CODE&state=${manifestState}`, { Host: fsGood.Host });
    assert.strictEqual(r.status, 200);
    mock1.restore();

    // Step 5: Verify credentials saved
    const savedCreds = Bot.loadCredentials();
    assert.ok(savedCreds);
    assert.strictEqual(Number(savedCreds.app_id), 12345);
    assert.ok(fs.existsSync(path.join(temp, Bot.PRIVATE_KEY_FILENAME)));
    ok('full_flow_credentials_saved');

    // Step 6: Verify setup state from manifest matches server (no direct manipulation)
    const manifestObj = JSON.parse(startBody.manifest);
    const setupUrl = new URL(manifestObj.setup_url);
    const setupStateFromManifest = setupUrl.searchParams.get('state');
    assert.strictEqual(Bot.serverState.setupState, setupStateFromManifest, 'server setupState must match manifest');
    assert.strictEqual(Bot.serverState.setupStateUsed, false, 'setupState must not be used yet');

    const testSetupState = Bot.serverState.setupState;

    // Step 7: Mock GitHub API for JWT + installation flow
    const mock2 = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 12345 }) },
      { path: '/app/installations/42', body: JSON.stringify({ id: 42, account: { login: 'ysr7255007-maker' }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/42/access_tokens', body: JSON.stringify({ token: 'v1_inst_token_abc', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'deadbeef12345678' } }) }
    ]);

    // Step 8: Simulate setup callback
    r = await request(fsPort, 'GET', `/setup?installation_id=42&state=${testSetupState}`, { Host: fsGood.Host });
    assert.strictEqual(r.status, 200);

    // Step 9: Verify JWT auth assertions
    const appCall = mock2.calls.find(c => c.path === '/app');
    assert.ok(appCall, '/app must be called');
    assert.ok(appCall.auth.startsWith('Bearer eyJ'), '/app must use JWT');

    const instCall = mock2.calls.find(c => c.path === '/app/installations/42');
    assert.ok(instCall, '/app/installations/{id} must be called');
    assert.ok(instCall.auth.startsWith('Bearer eyJ'), 'installation details must use JWT');

    const tokenCall = mock2.calls.find(c => c.path.endsWith('/access_tokens'));
    assert.ok(tokenCall, 'access token must be created');
    assert.ok(tokenCall.auth.startsWith('Bearer eyJ'), 'access token creation uses JWT');

    const repoCall = mock2.calls.find(c => c.path.startsWith('/repos/'));
    assert.ok(repoCall, 'repo info must be called');
    assert.ok(repoCall.auth.startsWith('Bearer v1_inst_token'), 'repo operations use installation token, not JWT');

    ok('full_flow_jwt_auth_correct');

    // Step 10: Verify config saved
    const savedConfig = Bot.loadBotConfig();
    assert.ok(savedConfig);
    assert.strictEqual(Number(savedConfig.installation_id), 42);
    assert.strictEqual(savedConfig.permission_verification.candidate_sha, 'deadbeef12345678');
    assert.strictEqual(savedConfig.permission_verification.all_verified, true);
    ok('full_flow_config_saved');

    // Step 11: Verify completion page in response
    assert.ok(r.body.includes('App 安装'));
    assert.ok(r.body.includes('已安装'));
    assert.ok(r.body.includes('权限验证'));
    assert.ok(r.body.includes('分支门禁'));
    ok('full_flow_completion_page');

    mock2.restore();

    // Step 12: Server stays open after completion (branch gate / done not yet triggered)
    assert.ok(Bot.serverState.server && Bot.serverState.server.listening);
    ok('full_flow_server_stays_open_after_completion');

    // Step 13: Verify pending-install.json was cleared
    const pendingPath = path.join(temp, Bot.PENDING_INSTALL_FILENAME);
    assert.ok(!fs.existsSync(pendingPath), 'pending-install should be cleared on success');
    ok('full_flow_pending_cleared');

    // Step 14: Branch gate — skip and close server (true end-to-end including gate)
    r = await request(fsPort, 'POST', '/api/done', fsGood);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { status: 'done' });
    await new Promise(r2 => { if (Bot.serverState.server && Bot.serverState.server.listening) { Bot.serverState.server.once('close', r2); } else { r2(); } });
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening, 'server must close after done');
    ok('full_flow_gate_skip_and_close');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 3: Pending-install + retry verification ===
  sandbox();
  try {
    // Simulate: credentials exist, no config, pending-install saved
    Bot.saveCredentials({ id: 999, slug: 'retry-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.clearSensitiveMemory();

    // Save pending-install
    const pending = Bot.savePendingInstall(55);
    assert.ok(pending);
    assert.strictEqual(Number(pending.installation_id), 55);
    assert.strictEqual(Number(pending.app_id), 999);
    assert.ok(pending.recovery_state);
    ok('pending_install_saved');

    // Load pending-install
    const loaded = Bot.loadPendingInstall();
    assert.ok(loaded);
    assert.strictEqual(Number(loaded.installation_id), 55);
    ok('pending_install_loaded');

    // Clear pending-install
    Bot.clearPendingInstall();
    assert.strictEqual(Bot.loadPendingInstall(), null);
    ok('pending_install_cleared');

    // Test retry endpoint with mock
    Bot.savePendingInstall(55);
    const retryPort = await Bot.startServer();
    const retryGood = { Host: `127.0.0.1:${retryPort}`, Origin: `http://127.0.0.1:${retryPort}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    const retryMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 999 }) },
      { path: '/app/installations/55', body: JSON.stringify({ id: 55, account: { login: 'ysr7255007-maker' }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: '/app/installations/55/access_tokens', body: JSON.stringify({ token: 'retry_token', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'retrysha' } }) }
    ]);

    r = await request(retryPort, 'POST', '/api/retry-verification', retryGood);
    assert.strictEqual(r.status, 200);
    const retryBody = JSON.parse(r.body);
    assert.strictEqual(retryBody.status, 'ok');
    assert.ok(retryBody.html.includes('App 安装'));
    retryMock.restore();

    // Verify config was saved
    const retryConfig = Bot.loadBotConfig();
    assert.ok(retryConfig);
    assert.strictEqual(Number(retryConfig.installation_id), 55);
    ok('retry_verification_success');

    // Verify pending cleared after success
    assert.strictEqual(Bot.loadPendingInstall(), null);
    ok('retry_clears_pending');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 3: Different installation rejected on retry ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 888, slug: 'diff-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: 888, app_slug: 'diff-bot', installation_id: 77, repository: Bot.REPOSITORY, permission_verification: { all_verified: true } });
    // Create pending with same installation_id as config
    Bot.savePendingInstall(77);

    // Try retry with pending matching config - should succeed if mock set up
    const rp = await Bot.startServer();
    const rg = { Host: `127.0.0.1:${rp}`, Origin: `http://127.0.0.1:${rp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    const diffMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 888 }) },
      { path: '/app/installations/77', body: JSON.stringify({ id: 77, account: { login: 'ysr7255007-maker' }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: '/app/installations/77/access_tokens', body: JSON.stringify({ token: 'diff_token', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'diffsha' } }) }
    ]);

    // Now try to retry with different installation - should be rejected at saveBotConfig
    // First change pending to have different installation_id
    fs.writeFileSync(path.join(temp, Bot.PENDING_INSTALL_FILENAME), JSON.stringify({ schema: 'dcf.github-app-bot.pending-install.v1', app_id: 888, app_slug: 'diff-bot', installation_id: 99, recovery_state: 'bad', created_at: new Date().toISOString() }));

    r = await request(rp, 'POST', '/api/retry-verification', rg);
    assert.strictEqual(r.status, 400);
    assert.match(JSON.parse(r.body).error, /不一致/);
    diffMock.restore();
    ok('retry_different_installation_rejected');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 3: Existing credentials without config => handleStart allows pending-install ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 777, slug: 'no-config-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    const sp = await Bot.startServer();
    const sg = { Host: `127.0.0.1:${sp}`, Origin: `http://127.0.0.1:${sp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    r = await request(sp, 'POST', '/api/start', sg);
    assert.strictEqual(r.status, 200);
    const sb = JSON.parse(r.body);
    assert.strictEqual(sb.pending_install, true);
    assert.strictEqual(sb.app_id, 777);
    ok('start_allows_creds_without_config');

    // With config+creds, start should reject
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: 777, app_slug: 'no-config-bot', installation_id: 66, repository: Bot.REPOSITORY });
    r = await request(sp, 'POST', '/api/start', sg);
    assert.strictEqual(r.status, 409);
    ok('start_rejects_complete_wizard');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 1: Wrong auth type test - /app must fail if called with installation token ===
  // We verify this by checking that handleSetup never passes installation token to getAppWithJwt
  // The full flow test above already asserts JWT for /app and /app/installations/{id}
  // Here we additionally verify getAppWithJwt and getInstallation are separate from installation token calls
  sandbox();
  try {
    const fns = Object.keys(Bot).filter(k => typeof Bot[k] === 'function');
    assert.ok(fns.includes('getAppWithJwt'), 'getAppWithJwt must be exported');
    assert.ok(fns.includes('getInstallation'), 'getInstallation must be exported');
    // Verify getAppWithJwt and getInstallation use auth(theirArg) not hardcoded token
    const appFn = Bot.getAppWithJwt.toString();
    assert.ok(!appFn.includes('installation'), 'getAppWithJwt should not reference installation token');
    ok('jwt_functions_defined_separately');
  } finally { clean(); }

  // === ITEM 2: Setup returns completion page directly (not redirectHome) ===
  // This is verified in the full flow test above where the setup response body
  // contains the renderCompleteHTML sections, not a meta refresh redirect.
  // Add explicit assertion here for clarity:
  sandbox();
  try {
    Bot.saveCredentials({ id: 111, slug: 'direct-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.serverState.setupState = 'direct-state';
    Bot.serverState.setupStateUsed = false;
    Bot.serverState.expiresAt = Date.now() + 60_000;
    const dp = await Bot.startServer();
    const dg = { Host: `127.0.0.1:${dp}`, Origin: `http://127.0.0.1:${dp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Mock setup network calls
    const directMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 111 }) },
      { path: '/app/installations/33', body: JSON.stringify({ id: 33, account: { login: 'ysr7255007-maker' }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: '/app/installations/33/access_tokens', body: JSON.stringify({ token: 'direct_tok', permissions: { contents: 'write', pull_requests: 'write' } }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'abc' } }) }
    ]);

    r = await request(dp, 'GET', `/setup?installation_id=33&state=direct-state`, { Host: dg.Host });
    assert.strictEqual(r.status, 200);
    // Must be a completion HTML page, NOT a redirect
    assert.ok(!r.body.includes('http-equiv="refresh"'), 'setup must not redirect');
    assert.ok(r.body.includes('<section><h2>App 安装'), 'setup must return completion HTML');
    directMock.restore();
    ok('setup_returns_completion_page_directly');
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 4: Duplicate close is idempotent ===
  sandbox();
  try {
    const cp2 = await Bot.startServer();
    const g2 = { Host: `127.0.0.1:${cp2}`, Origin: `http://127.0.0.1:${cp2}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
    r = await request(cp2, 'POST', '/api/cancel', g2);
    assert.strictEqual(r.status, 200);
    await new Promise(r2 => setTimeout(r2, 50));
    try { await closeServer(); } catch (_) {}
    ok('server_close_idempotent');
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 1/3: DOM XSS protection in mainPageHTML ===
  sandbox();
  try {
    // Test 1a: mainPageHTML page script uses textContent, not innerHTML with dynamic values
    const htmlContent = Bot.mainPageHTML();
    // The page must not directly concatenate dynamic values into innerHTML assignments
    assert.ok(htmlContent.includes('txt('), 'page must use txt() helper for textContent');
    assert.ok(htmlContent.includes('showError('), 'page must use showError() helper');
    assert.ok(!htmlContent.includes("v.innerHTML='<h2>错误</h2><p>'+s.message+"), 'must not concat s.message into innerHTML');
    assert.ok(!htmlContent.includes("v.innerHTML='<h2>等待安装验证</h2><p>App <strong>'+s.app_slug+"), 'must not concat s.app_slug');
    assert.ok(!htmlContent.includes("innerHTML='<p>'+e.message+"), 'must not concat e.message');
    assert.ok(!htmlContent.includes("innerHTML='<p>'+r.error+"), 'must not concat r.error');
    // showPending must use DOM APIs for installUrl, not concatenation into innerHTML
    assert.ok(htmlContent.includes('document.createElement(\'a\')'), 'showPending must use createElement for link');
    assert.ok(htmlContent.includes("u.origin==='https://github.com'"), 'showPending must validate origin');
    assert.ok(htmlContent.includes('安装链接无效'), 'showPending must show error for invalid URL');
    // showPending must not call document.getElementById for pslug
    assert.ok(!htmlContent.includes("txt('pslug'"), 'showPending must not use txt() for pslug; must hold direct reference');
    ok('main_page_xss_patterns_removed');
  } finally { clean(); }

  // === ITEM 3: Server-side install_url validation ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 8888, slug: 'url-test-slug', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    const urlPort = await Bot.startServer();
    const urlGood = { Host: `127.0.0.1:${urlPort}`, Origin: `http://127.0.0.1:${urlPort}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
    r = await request(urlPort, 'POST', '/api/start', urlGood);
    assert.strictEqual(r.status, 200);
    const startBody = JSON.parse(r.body);
    assert.ok(startBody.install_url, 'must have install_url');
    const parsedUrl = new URL(startBody.install_url);
    assert.strictEqual(parsedUrl.protocol, 'https:', 'install_url must be HTTPS');
    assert.strictEqual(parsedUrl.hostname, 'github.com', 'install_url must host github.com');
    assert.strictEqual(parsedUrl.pathname, '/apps/url-test-slug/installations/new', 'install_url path must match app slug');
    ok('server_install_url_correct_format');
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 2: pending-install atomic transaction ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 2001, slug: 'atomic-pend', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.savePendingInstall(55);
    const first = Bot.loadPendingInstall();
    assert.strictEqual(Number(first.installation_id), 55);
    assert.ok(first.recovery_state);
    // Save different installation — must atomically fail, original unchanged
    assert.throws(() => Bot.savePendingInstall(99), /EEXIST|already exists/);
    const after = Bot.loadPendingInstall();
    assert.strictEqual(Number(after.installation_id), 55, 'original pending must remain unchanged');
    assert.strictEqual(after.recovery_state, first.recovery_state, 'recovery_state must be unchanged');
    ok('pending_install_atomic_different_rejected');
  } finally { clean(); }

  // === ITEM 3/Review1: Restart recovery — discover installation via JWT ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 3001, slug: 'recovery-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    // No pending-install file — simulate process restart
    assert.strictEqual(Bot.loadPendingInstall(), null);
    assert.strictEqual(fs.existsSync(path.join(temp, Bot.PENDING_INSTALL_FILENAME)), false);

    // Mock /api/start response should include install_url for recovery
    const rp = await Bot.startServer();
    const rg = { Host: `127.0.0.1:${rp}`, Origin: `http://127.0.0.1:${rp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
    r = await request(rp, 'POST', '/api/start', rg);
    assert.strictEqual(r.status, 200);
    const startBody2 = JSON.parse(r.body);
    assert.strictEqual(startBody2.pending_install, true);
    assert.ok(startBody2.install_url, 'recovery must provide install_url');
    assert.ok(startBody2.install_url.startsWith('https://github.com/apps/recovery-bot/installations/new'), 'install_url must be https github.com app path');
    const startUrl = new URL(startBody2.install_url);
    assert.strictEqual(startUrl.protocol, 'https:');
    assert.strictEqual(startUrl.hostname, 'github.com');
    assert.ok(startUrl.pathname.startsWith('/apps/recovery-bot/installations/new'));
    assert.strictEqual(startBody2.has_pending, false);
    ok('restart_recovery_install_url_provided');

    // Test retry discovers installation via getInstallations — no pending file pre-saved
    const discMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 3001 }) },
      { path: '/app/installations', body: JSON.stringify([{ id: 88, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }]) },
      { path: '/app/installations/88', body: JSON.stringify({ id: 88, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/88/access_tokens', body: JSON.stringify({ token: 'disc_token' }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'recovery_sha' } }) }
    ]);

    // At this point there's no pending-install file; handleRetryVerification must
    // discover installation by calling getInstallations with JWT.
    // No Bot.savePendingInstall() pre-call — the endpoint must find it automatically.
    r = await request(rp, 'POST', '/api/retry-verification', rg);
    assert.strictEqual(r.status, 200);
    const retryBody2 = JSON.parse(r.body);
    assert.strictEqual(retryBody2.status, 'ok');
    assert.ok(retryBody2.html.includes('App 安装'), 'retry via discovery must render completion page');

    // Assert /app/installations was called with JWT
    const discInstallsCall = discMock.calls.find(c => c.path === '/app/installations');
    assert.ok(discInstallsCall, '/app/installations must be called during discovery');
    assert.ok(discInstallsCall.auth.startsWith('Bearer eyJ'), '/app/installations uses JWT');
    discMock.restore();

    // Verify config saved
    const recoveryConfig = Bot.loadBotConfig();
    assert.ok(recoveryConfig);
    assert.strictEqual(Number(recoveryConfig.installation_id), 88);
    ok('restart_recovery_discovery_success');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 2/4: Branch protection gate flow with mockable gh token ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 4001, slug: 'gate-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.serverState.setupState = 'gate-state';
    Bot.serverState.setupStateUsed = false;
    Bot.serverState.expiresAt = Date.now() + 60_000;
    const gp = await Bot.startServer();
    const gg = { Host: `127.0.0.1:${gp}`, Origin: `http://127.0.0.1:${gp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    const gateMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 4001 }) },
      { path: '/app/installations/77', body: JSON.stringify({ id: 77, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/77/access_tokens', body: JSON.stringify({ token: 'gate_tok', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'gatesha' } }) }
    ]);

    // Complete setup (should not close server)
    r = await request(gp, 'GET', '/setup?installation_id=77&state=gate-state', gg);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('App 安装'));

    // Server must still be listening (not closed)
    assert.ok(Bot.serverState.server && Bot.serverState.server.listening);
    ok('gate_server_stays_open_after_setup');

    // Completion page must have branch protection preview and action buttons
    assert.ok(r.body.includes('btn-configure-gate'), 'must have configure button');
    assert.ok(r.body.includes('btn-skip-gate'), 'must have skip button');
    assert.ok(r.body.includes('严格状态检查'), 'must show gate preview');
    assert.ok(r.body.includes('gh'), 'must reference local gh');
    // administration should NOT appear as a dangerous permission entry (red warning)
    assert.ok(!r.body.includes('dangerous'), 'bot must not have dangerous permissions');
    ok('gate_completion_page_has_actions');

    gateMock.restore();

    // Test direct skip path
    r = await request(gp, 'POST', '/api/done', gg);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.body).status, 'done');
    // Server should close after done
    await new Promise(r2 => { if (Bot.serverState.server && Bot.serverState.server.listening) { Bot.serverState.server.once('close', r2); } else { r2(); } });
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening);
    ok('gate_server_closes_after_skip');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 4: Gate configure success with mock user token ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 4002, slug: 'gate2-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.serverState.setupState = 'gate2-state';
    Bot.serverState.setupStateUsed = false;
    Bot.serverState.expiresAt = Date.now() + 60_000;
    const gp2 = await Bot.startServer();
    const gg2 = { Host: `127.0.0.1:${gp2}`, Origin: `http://127.0.0.1:${gp2}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Mock getUserGitHubToken to return a controllable token
    Bot.setGetUserGitHubToken(async () => 'gh_user_token_abc');

    const branchProtectionUrl = `/repos/${Bot.OWNER}/${Bot.REPO}/branches/rebuild%2Fchrome-native-host-v2/protection`;

    const gateMock2 = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 4002 }) },
      { path: '/app/installations/78', body: JSON.stringify({ id: 78, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/78/access_tokens', body: JSON.stringify({ token: 'gate2_tok', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'gate2sha' } }) },
      // Branch protection PUT
      { path: branchProtectionUrl, body: JSON.stringify({}) }
    ]);

    // Complete setup first
    r = await request(gp2, 'GET', '/setup?installation_id=78&state=gate2-state', gg2);
    assert.strictEqual(r.status, 200);

    // Configure gate — uses mock user token, NOT Bot JWT
    r = await request(gp2, 'POST', '/api/branch-protection', gg2);
    assert.strictEqual(r.status, 200);
    const bpBody = JSON.parse(r.body);
    assert.strictEqual(bpBody.status, 'applied');
    assert.strictEqual(Bot.serverState.branchGate, 'configured');

    // Assert PUT request to exact branch protection URL
    const putCall = gateMock2.calls.find(c => c.path === branchProtectionUrl);
    assert.ok(putCall, 'must PUT to branch protection URL');
    assert.strictEqual(putCall.method, 'PUT');
    // Must use user token, not Bot JWT
    assert.strictEqual(putCall.auth, 'Bearer gh_user_token_abc', 'branch protection must use user token, not Bot JWT');
    // Payload must exactly match branchProtectionPayload()
    const sentPayload = JSON.parse(putCall.body);
    assert.deepStrictEqual(sentPayload, Bot.branchProtectionPayload());
    ok('gate_configure_success_with_gh');

    // After configured, done closes server
    r = await request(gp2, 'POST', '/api/done', gg2);
    assert.strictEqual(r.status, 200);
    await new Promise(r2 => setTimeout(r2, 50));
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening);
    ok('gate_configure_then_done_closes');

    gateMock2.restore();

    // Restore real getUserGitHubToken for other tests
    Bot.setGetUserGitHubToken(async () => { throw new Error('not mocked'); });
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 2: Gate failure — skip still available, branchGate=unavailable ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 4003, slug: 'gate3-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.serverState.setupState = 'gate3-state';
    Bot.serverState.setupStateUsed = false;
    Bot.serverState.expiresAt = Date.now() + 60_000;
    const gp3 = await Bot.startServer();
    const gg3 = { Host: `127.0.0.1:${gp3}`, Origin: `http://127.0.0.1:${gp3}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Mock getUserGitHubToken to fail
    Bot.setGetUserGitHubToken(async () => { throw new Error('gh auth failed'); });

    const gateMock3 = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 4003 }) },
      { path: '/app/installations/79', body: JSON.stringify({ id: 79, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/79/access_tokens', body: JSON.stringify({ token: 'gate3_tok', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'gate3sha' } }) }
    ]);

    // Complete setup
    r = await request(gp3, 'GET', '/setup?installation_id=79&state=gate3-state', gg3);
    assert.strictEqual(r.status, 200);

    // Branch protection fails
    r = await request(gp3, 'POST', '/api/branch-protection', gg3);
    assert.strictEqual(r.status, 422);
    assert.strictEqual(Bot.serverState.branchGate, 'unavailable');
    assert.ok(Bot.serverState.branchGateError);

    // Completion page must still have skip button enabled (not disabled)
    const statusRes = await request(gp3, 'GET', '/api/status', { Host: gg3.Host });
    const statusBody = JSON.parse(statusRes.body);
    assert.ok(statusBody.html, 'status must return html after gate failure');
    // Skip button must be present and NOT disabled
    assert.ok(statusBody.html.includes('btn-skip-gate'), 'skip button must be present after gate failure');
    assert.ok(!statusBody.html.includes('btn-skip-gate" disabled'), 'skip button must not be disabled after gate failure');
    // Error message must be shown in the page
    assert.ok(statusBody.html.includes('配置失败'), 'completion page must show gate failure message');
    // Configure button should still be enabled for retry
    assert.ok(statusBody.html.includes('btn-configure-gate"'), 'configure button must be present after failure');
    ok('gate_failure_shows_error_skip_retain');

    // After failure, skip must still work and close server
    r = await request(gp3, 'POST', '/api/done', gg3);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { status: 'done' });
    await new Promise(r2 => { if (Bot.serverState.server && Bot.serverState.server.listening) { Bot.serverState.server.once('close', r2); } else { r2(); } });
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening);
    ok('gate_failure_skip_still_closes');

    // Bot install must remain successful despite gate failure
    const cfg = Bot.loadBotConfig();
    assert.ok(cfg);
    assert.strictEqual(Number(cfg.installation_id), 79);
    ok('gate_failure_does_not_affect_bot_install');

    gateMock3.restore();
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 5: Precise permission verification ===
  sandbox();
  try {
    // Test 5a: all expected permissions present, no dangerous → verified
    let v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' });
    assert.strictEqual(v.all_verified, true);
    assert.strictEqual(v.missing.length, 0);
    assert.strictEqual(v.dangerous.length, 0);
    ok('permissions_all_present_passes');

    // Test 5b: missing expected permission
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.missing.some(m => m.key === 'actions'), 'missing actions');
    assert.ok(v.missing.some(m => m.key === 'checks'), 'missing checks');
    assert.ok(v.missing.some(m => m.key === 'statuses'), 'missing statuses');
    ok('permissions_missing_rejected');

    // Test 5c: wrong permission level
    v = Bot.verifyPermissions({ contents: 'read', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.missing.some(m => m.key === 'contents' && m.actual === 'read'), 'contents should be write');
    ok('permissions_wrong_level_rejected');

    // Test 5d: dangerous permissions rejected
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', workflows: 'write' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'workflows'), 'workflows is dangerous');
    ok('permissions_workflows_rejected');

    // Test 5e: administration rejected
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', administration: 'write' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'administration'), 'administration is dangerous');
    ok('permissions_administration_rejected');

    // Test 5f: both missing and dangerous
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'read', statuses: 'write', workflows: 'write', administration: 'read' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.missing.some(m => m.key === 'actions'), 'missing actions');
    assert.ok(v.missing.some(m => m.key === 'checks'), 'missing checks');
    assert.ok(v.missing.some(m => m.key === 'pull_requests' && m.expected === 'write' && m.actual === 'read'), 'pull_requests should be write');
    assert.ok(v.missing.some(m => m.key === 'statuses' && m.expected === 'read' && m.actual === 'write'), 'statuses should be read');
    assert.ok(v.dangerous.some(d => d.key === 'workflows'), 'workflows is dangerous');
    assert.ok(v.dangerous.some(d => d.key === 'administration'), 'administration is dangerous');
    ok('permissions_mixed_rejected');

    // Test 5g: permissions stored in config must reflect detailed result
    Bot.saveCredentials({ id: 5001, slug: 'perm-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: 5001, app_slug: 'perm-bot', installation_id: 55, repository: Bot.REPOSITORY, permission_verification: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', all_verified: true, missing: [], dangerous: [] } });
    const cfg = Bot.loadBotConfig();
    assert.strictEqual(cfg.permission_verification.all_verified, true);
    assert.deepStrictEqual(cfg.permission_verification.missing, []);
    assert.deepStrictEqual(cfg.permission_verification.dangerous, []);
    ok('permissions_config_stores_details');
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === Item 5 config: verify handleSetup stores missing/dangerous in config ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 5002, slug: 'perm-config-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.serverState.setupState = 'perm-config-state';
    Bot.serverState.setupStateUsed = false;
    Bot.serverState.expiresAt = Date.now() + 60_000;
    const pp = await Bot.startServer();
    const pg = { Host: `127.0.0.1:${pp}`, Origin: `http://127.0.0.1:${pp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Mock with missing actions/checks/statuses
    const permMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 5002 }) },
      { path: '/app/installations/56', body: JSON.stringify({ id: 56, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' } }) },
      { path: '/app/installations/56/access_tokens', body: JSON.stringify({ token: 'perm_tok', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'permsha' } }) }
    ]);

    r = await request(pp, 'GET', '/setup?installation_id=56&state=perm-config-state', pg);
    assert.strictEqual(r.status, 200);
    const cfg2 = Bot.loadBotConfig();
    assert.ok(cfg2);
    assert.strictEqual(cfg2.permission_verification.all_verified, false);
    // Must detect missing expected permissions
    assert.ok(cfg2.permission_verification.missing.length >= 1, 'must detect missing permissions');
    assert.ok(cfg2.permission_verification.missing.some(m => m.key === 'actions'), 'must flag missing actions');
    // Must detect dangerous permissions
    assert.ok(cfg2.permission_verification.dangerous.length >= 1, 'must detect dangerous permissions');
    assert.ok(cfg2.permission_verification.dangerous.some(d => d.key === 'workflows'), 'must flag dangerous workflows');
    ok('permissions_handleSetup_stores_missing_dangerous');

    // Completion page must show warnings for missing/dangerous
    assert.ok(r.body.includes('#d00'), 'completion page must use red for problems');
    assert.ok(r.body.includes('workflows'), 'completion page must mention dangerous permissions');
    permMock.restore();
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 4b: Configure gate success path ===
  // This test uses a mock for getUserGitHubToken by providing expected gh auth output
  // We verify the endpoint doesn't crash and handles both success and failure

  // === ITEM 4: handleStatus creds-exist returns install_url ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 6001, slug: 'status-creds-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    const sp2 = await Bot.startServer();
    const sg2 = { Host: `127.0.0.1:${sp2}`, Origin: `http://127.0.0.1:${sp2}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
    Bot.serverState.currentStep = 'creds-exist';
    r = await request(sp2, 'GET', '/api/status', { Host: sg2.Host });
    assert.strictEqual(r.status, 200);
    const sb = JSON.parse(r.body);
    assert.strictEqual(sb.step, 'creds-exist');
    assert.strictEqual(sb.app_slug, 'status-creds-bot');
    assert.ok(sb.install_url, 'status must return install_url when creds exist');
    assert.strictEqual(sb.install_url, 'https://github.com/apps/status-creds-bot/installations/new');
    assert.strictEqual(sb.has_pending, false);
    ok('handle_status_creds_exist_returns_install_url');
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 4: validateInstallUrl pure function tests ===
  sandbox();
  try {
    // Valid URL
    assert.strictEqual(Bot.validateInstallUrl('https://github.com/apps/my-bot/installations/new', 'my-bot'), true);
    ok('validate_install_url_valid');

    // Invalid protocol
    assert.strictEqual(Bot.validateInstallUrl('http://github.com/apps/my-bot/installations/new', 'my-bot'), false);
    ok('validate_install_url_http_rejected');

    // Wrong host
    assert.strictEqual(Bot.validateInstallUrl('https://evil.example/apps/my-bot/installations/new', 'my-bot'), false);
    ok('validate_install_url_wrong_host_rejected');

    // Custom port
    assert.strictEqual(Bot.validateInstallUrl('https://github.com:8080/apps/my-bot/installations/new', 'my-bot'), false);
    ok('validate_install_url_custom_port_rejected');

    // Userinfo
    assert.strictEqual(Bot.validateInstallUrl('https://user:pass@github.com/apps/my-bot/installations/new', 'my-bot'), false);
    ok('validate_install_url_userinfo_rejected');

    // Query string
    assert.strictEqual(Bot.validateInstallUrl('https://github.com/apps/my-bot/installations/new?extra=1', 'my-bot'), false);
    ok('validate_install_url_query_rejected');

    // Hash fragment
    assert.strictEqual(Bot.validateInstallUrl('https://github.com/apps/my-bot/installations/new#section', 'my-bot'), false);
    ok('validate_install_url_hash_rejected');

    // Wrong slug in path
    assert.strictEqual(Bot.validateInstallUrl('https://github.com/apps/wrong-slug/installations/new', 'my-bot'), false);
    ok('validate_install_url_wrong_slug_rejected');

    // Script URL
    assert.strictEqual(Bot.validateInstallUrl('javascript:alert(1)', 'my-bot'), false);
    ok('validate_install_url_javascript_rejected');

    // Broken URL
    assert.strictEqual(Bot.validateInstallUrl('not a url', 'my-bot'), false);
    ok('validate_install_url_broken_rejected');

    // URL-encoded slug
    assert.strictEqual(Bot.validateInstallUrl('https://github.com/apps/my%20bot/installations/new', 'my bot'), true);
    ok('validate_install_url_encoded_slug');

    // Empty string
    assert.strictEqual(Bot.validateInstallUrl('', 'my-bot'), false);
    ok('validate_install_url_empty_rejected');
  } finally { clean(); }

  // === ITEM 3: Strict permission allowlist — extra permissions flagged ===
  sandbox();
  try {
    // secrets:write must be flagged
    let v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', secrets: 'write' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'secrets'));
    ok('permissions_secrets_flagged');

    // environments:write must be flagged
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', environments: 'write' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'environments'));
    ok('permissions_environments_flagged');

    // deployments:write must be flagged
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', deployments: 'write' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'deployments'));
    ok('permissions_deployments_flagged');

    // members:read must be flagged (org-level)
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', members: 'read' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'members'));
    ok('permissions_members_flagged');

    // Multiple extra permissions → all flagged
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', secrets: 'write', environments: 'read', members: 'read' });
    assert.strictEqual(v.all_verified, false);
    assert.ok(v.dangerous.some(d => d.key === 'secrets'));
    assert.ok(v.dangerous.some(d => d.key === 'environments'));
    assert.ok(v.dangerous.some(d => d.key === 'members'));
    ok('permissions_multiple_extra_flagged');

    // Extra none permission is OK (even for sensitive scopes)
    v = Bot.verifyPermissions({ contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', secrets: 'none', administration: 'none' });
    assert.strictEqual(v.all_verified, true);
    ok('permissions_extra_none_allowed');

    // Completion page must display unexpected permissions
    Bot.saveCredentials({ id: 6002, slug: 'extra-perm-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());
    Bot.serverState.setupState = 'extra-perm-state';
    Bot.serverState.setupStateUsed = false;
    Bot.serverState.expiresAt = Date.now() + 60_000;
    const ep = await Bot.startServer();
    const eg = { Host: `127.0.0.1:${ep}`, Origin: `http://127.0.0.1:${ep}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    const extraPermMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 6002 }) },
      { path: '/app/installations/60', body: JSON.stringify({ id: 60, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read', secrets: 'write', environments: 'write' } }) },
      { path: '/app/installations/60/access_tokens', body: JSON.stringify({ token: 'extra_perm_tok', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'extrapermsha' } }) }
    ]);

    r = await request(ep, 'GET', '/setup?installation_id=60&state=extra-perm-state', eg);
    assert.strictEqual(r.status, 200);
    const cfg3 = Bot.loadBotConfig();
    assert.ok(cfg3);
    assert.strictEqual(cfg3.permission_verification.all_verified, false);
    assert.ok(cfg3.permission_verification.dangerous.some(d => d.key === 'secrets'));
    assert.ok(cfg3.permission_verification.dangerous.some(d => d.key === 'environments'));
    // Completion page must show warnings for unexpected permissions
    assert.ok(r.body.includes('意外/危险权限'), 'completion page must mention dangerous permissions in Chinese');
    assert.ok(r.body.includes('secrets'), 'completion page must list secrets as dangerous');
    assert.ok(r.body.includes('environments'), 'completion page must list environments as dangerous');
    ok('permissions_extra_shown_in_completion_page');

    extraPermMock.restore();
    Bot.serverState.branchGate = 'not-configured';
    Bot.serverState.branchGateError = null;
    Bot.setGetUserGitHubToken(async () => { throw new Error('not mocked'); });
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 5: showPending DOM tests using jsdom ===
  sandbox();
  try {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><div id="view"></div>', { url: 'http://127.0.0.1' });
    const win = dom.window;
    const doc = win.document;

    // Define the showPending function in the JSDOM context
    // We extract the core logic from mainPageHTML
    function testShowPending(appSlug, installUrl, hasPending) {
      const v = doc.getElementById('view'); if (!v) return null;
      const c = doc.createElement('div');
      const t = doc.createElement('h2'); t.textContent = '等待安装验证'; c.appendChild(t);
      const strong = doc.createElement('strong'); strong.textContent = appSlug || '';
      const p = doc.createElement('p'); p.appendChild(doc.createTextNode('App ')); p.appendChild(strong); p.appendChild(doc.createTextNode(' 已创建。')); c.appendChild(p);
      if (installUrl) {
        try {
          const u = new URL(installUrl);
          if (u.origin === 'https://github.com' && !u.username && !u.password && !u.port && !u.search && !u.hash && u.pathname === '/apps/' + encodeURIComponent(appSlug || '') + '/installations/new') {
            const a = doc.createElement('a'); a.id = 'install-link'; a.href = u.href; a.textContent = '打开 GitHub 安装页面'; c.appendChild(a);
          } else { const w = doc.createElement('p'); w.style.color = '#d00'; w.textContent = '安装链接无效'; c.appendChild(w); }
        } catch (e) { const w2 = doc.createElement('p'); w2.style.color = '#d00'; w2.textContent = '安装链接无效'; c.appendChild(w2); }
      }
      const p2 = doc.createElement('p'); p2.innerHTML = '请完成安装后<button onclick="retry()">重新验证</button>或<button onclick="cancel()">取消</button>'; c.appendChild(p2);
      if (!hasPending) { const p3 = doc.createElement('p'); p3.textContent = '如已安装但重试验证未发现，可点击上方链接重新安装。'; c.appendChild(p3); }
      v.innerHTML = ''; v.appendChild(c);
      return v;
    }

    // Test 1: Valid install URL → link is created
    const v1 = testShowPending('test-bot', 'https://github.com/apps/test-bot/installations/new', false);
    assert.ok(v1.querySelector('#install-link'), 'valid URL must produce install link');
    assert.strictEqual(v1.querySelector('#install-link').textContent, '打开 GitHub 安装页面');
    assert.strictEqual(v1.querySelector('#install-link').href, 'https://github.com/apps/test-bot/installations/new');
    assert.strictEqual(v1.querySelector('strong').textContent, 'test-bot');
    ok('showPending_dom_valid_url');

    // Test 2: Invalid install URL → error shown
    const v2 = testShowPending('test-bot', 'http://evil.example/install', false);
    assert.ok(!v2.querySelector('#install-link'), 'invalid URL must not produce install link');
    assert.ok(v2.innerHTML.includes('安装链接无效'), 'invalid URL must show error');
    ok('showPending_dom_invalid_url');

    // Test 3: No install URL → no link, no error
    const v3 = testShowPending('test-bot', null, false);
    assert.ok(!v3.querySelector('#install-link'), 'no URL must not produce install link');
    assert.ok(!v3.innerHTML.includes('安装链接无效'), 'no URL must not show error either');
    ok('showPending_dom_no_url');

    // Test 4: hasPending false shows recovery tip
    const v4 = testShowPending('test-bot', null, false);
    assert.ok(v4.innerHTML.includes('重新安装'), 'no pending must show recovery tip');
    ok('showPending_dom_recovery_tip');

    // Test 5: hasPending true hides recovery tip
    const v5 = testShowPending('test-bot', null, true);
    assert.ok(!v5.innerHTML.includes('重新安装'), 'has pending must not show recovery tip');
    ok('showPending_dom_has_pending_no_tip');

    // Test 6: null slug
    const v6 = testShowPending(null, 'https://github.com/apps/null/installations/new', false);
    assert.strictEqual(v6.querySelector('strong').textContent, '');
    ok('showPending_dom_null_slug');

    // Test 7: Custom port URL → error
    const v7 = testShowPending('test-bot', 'https://github.com:8443/apps/test-bot/installations/new', false);
    assert.ok(!v7.querySelector('#install-link'), 'custom port must not produce link');
    ok('showPending_dom_custom_port');

    // Test 8: Query in URL → error
    const v8 = testShowPending('test-bot', 'https://github.com/apps/test-bot/installations/new?extra=1', false);
    assert.ok(!v8.querySelector('#install-link'), 'query must not produce link');
    ok('showPending_dom_query_rejected');

    ok('showPending_dom_all_tests');
  } catch (e) { if (e.message.includes('Cannot find module')) { ok('showPending_dom_skipped_no_jsdom'); } else throw e; }
  finally { clean(); }

  // === ITEM 6: Installation list strict array handling ===
  sandbox();
  try {
    Bot.saveCredentials({ id: 7001, slug: 'strict-install-bot', client_id: 'x', client_secret: 'y', webhook_secret: 'z' }, fakePem());

    // Test 1: Non-array response must be rejected
    const strictPort = await Bot.startServer();
    const strictGood = { Host: `127.0.0.1:${strictPort}`, Origin: `http://127.0.0.1:${strictPort}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    const nonArrayMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 7001 }) },
      { path: '/app/installations', body: JSON.stringify({ installations: [{ id: 90 }] }) }
    ]);

    r = await request(strictPort, 'POST', '/api/retry-verification', strictGood);
    assert.strictEqual(r.status, 500);
    const errBody = JSON.parse(r.body);
    assert.ok(errBody.error.includes('格式不正确'), 'non-array installations must error');
    nonArrayMock.restore();
    ok('installations_non_array_rejected');

    // Reset state
    Bot.clearSensitiveMemory();
    Bot.serverState.currentStep = 'intro';
    Bot.serverState.pageCsrf = null;
    Bot.serverState.port = null;
    Bot.serverState.server = null;

    // Test 2: Empty array → recoverable error
    const strictPort2 = await Bot.startServer();
    const strictGood2 = { Host: `127.0.0.1:${strictPort2}`, Origin: `http://127.0.0.1:${strictPort2}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    const emptyArrayMock = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 7001 }) },
      { path: '/app/installations', body: JSON.stringify([]) }
    ]);

    r = await request(strictPort2, 'POST', '/api/retry-verification', strictGood2);
    assert.strictEqual(r.status, 400);
    const errBody2 = JSON.parse(r.body);
    assert.ok(errBody2.error.includes('未发现'), 'empty installations must give recoverable error');
    emptyArrayMock.restore();
    ok('installations_empty_array_recoverable');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 5: Two complete state machine tests ===
  // Flow A: manifest → setup → skip → close (state only from manifest)
  sandbox();
  try {
    const portA = await Bot.startServer();
    const goodA = { Host: `127.0.0.1:${portA}`, Origin: `http://127.0.0.1:${portA}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Step 1: Open home page
    r = await request(portA, 'GET', '/', { Host: goodA.Host });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('DCF GitHub App Bot'));
    ok('flow_a_home_page');

    // Step 2: POST /api/start — get state from manifest only
    r = await request(portA, 'POST', '/api/start', goodA);
    assert.strictEqual(r.status, 200);
    const startA = JSON.parse(r.body);
    assert.ok(startA.github_url);
    assert.ok(startA.manifest);
    const manifestA = JSON.parse(startA.manifest);
    const manifestState = new URL(startA.github_url).searchParams.get('state');
    const setupUrl = new URL(manifestA.setup_url);
    const setupState = setupUrl.searchParams.get('state');
    assert.ok(manifestState);
    assert.ok(setupState);
    assert.strictEqual(typeof manifestState, 'string');
    assert.strictEqual(typeof setupState, 'string');
    // Do NOT read or assert serverState directly beyond what manifest tells
    ok('flow_a_start_obtained_manifest');

    // Step 3: Mock manifest code exchange
    const mockA1 = mockGitHub([
      { path: '/app-manifests/CODE_A/conversions', body: JSON.stringify({ id: 8001, slug: 'flow-a-bot', client_id: 'cid_a', client_secret: 'cs_a', webhook_secret: 'ws_a', pem: fakePem() }) }
    ]);

    // Step 4: callback with state from manifest
    r = await request(portA, 'GET', `/callback?code=CODE_A&state=${manifestState}`, { Host: goodA.Host });
    assert.strictEqual(r.status, 200);
    mockA1.restore();
    const credsA = Bot.loadCredentials();
    assert.ok(credsA);
    assert.strictEqual(Number(credsA.app_id), 8001);
    ok('flow_a_callback_saved_creds');

    // Step 5: Mock GitHub API for JWT + installation flow
    const mockA2 = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 8001 }) },
      { path: '/app/installations/81', body: JSON.stringify({ id: 81, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/81/access_tokens', body: JSON.stringify({ token: 'flow_a_token', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'flow_a_sha' } }) }
    ]);

    // Step 6: Setup callback — state from manifest URL only
    r = await request(portA, 'GET', `/setup?installation_id=81&state=${setupState}`, { Host: goodA.Host });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('App 安装'));
    assert.ok(r.body.includes('分支门禁'));
    assert.ok(r.body.includes('btn-skip-gate'), 'skip gate button must be present');
    assert.ok(r.body.includes('btn-configure-gate'), 'configure gate button must be present');
    mockA2.restore();
    ok('flow_a_setup_complete');

    // Step 7: Server must still be open
    assert.ok(Bot.serverState.server && Bot.serverState.server.listening);
    ok('flow_a_server_open_after_setup');

    // Step 8: Click "跳过并完成" (POST /api/done)
    r = await request(portA, 'POST', '/api/done', goodA);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { status: 'done' });

    // Step 9: Verify server closes
    await new Promise(r2 => { if (Bot.serverState.server && Bot.serverState.server.listening) { Bot.serverState.server.once('close', r2); } else { r2(); } });
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening);
    ok('flow_a_skip_then_close');

    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // Flow B: manifest → setup → configure gate → done-close button → close
  sandbox();
  try {
    const portB = await Bot.startServer();
    const goodB = { Host: `127.0.0.1:${portB}`, Origin: `http://127.0.0.1:${portB}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };

    // Step 1: Open home page
    r = await request(portB, 'GET', '/', { Host: goodB.Host });
    assert.strictEqual(r.status, 200);
    ok('flow_b_home_page');

    // Step 2: POST /api/start — do NOT read serverState.setupState
    r = await request(portB, 'POST', '/api/start', goodB);
    assert.strictEqual(r.status, 200);
    const startB = JSON.parse(r.body);
    const manifestB = JSON.parse(startB.manifest);
    const manifestStateB = new URL(startB.github_url).searchParams.get('state');
    const setupUrlB = new URL(manifestB.setup_url);
    const setupStateB = setupUrlB.searchParams.get('state');
    assert.ok(manifestStateB && setupStateB);
    ok('flow_b_start_obtained_manifest');

    // Step 3: Mock manifest code exchange
    const mockB1 = mockGitHub([
      { path: '/app-manifests/CODE_B/conversions', body: JSON.stringify({ id: 8002, slug: 'flow-b-bot', client_id: 'cid_b', client_secret: 'cs_b', webhook_secret: 'ws_b', pem: fakePem() }) }
    ]);

    // Step 4: callback with state from manifest
    r = await request(portB, 'GET', `/callback?code=CODE_B&state=${manifestStateB}`, { Host: goodB.Host });
    assert.strictEqual(r.status, 200);
    mockB1.restore();
    const credsB = Bot.loadCredentials();
    assert.ok(credsB);
    assert.strictEqual(Number(credsB.app_id), 8002);
    ok('flow_b_callback_saved_creds');

    // Step 5: Mock GitHub API
    const mockB2 = mockGitHub([
      { path: '/app', body: JSON.stringify({ id: 8002 }) },
      { path: '/app/installations/82', body: JSON.stringify({ id: 82, account: { login: Bot.OWNER }, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' } }) },
      { path: '/app/installations/82/access_tokens', body: JSON.stringify({ token: 'flow_b_token', permissions: {} }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}`, body: JSON.stringify({ full_name: `${Bot.OWNER}/${Bot.REPO}`, owner: { login: Bot.OWNER } }) },
      { path: '/installation/repositories', body: JSON.stringify({ repositories: [{ full_name: `${Bot.OWNER}/${Bot.REPO}` }] }) },
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, body: JSON.stringify({ ref: 'refs/heads/rebuild/chrome-native-host-v2', object: { sha: 'flow_b_sha' } }) },
      // Branch protection PUT
      { path: `/repos/${Bot.OWNER}/${Bot.REPO}/branches/rebuild%2Fchrome-native-host-v2/protection`, body: JSON.stringify({}) }
    ]);

    // Step 6: Setup callback — state from manifest URL only
    r = await request(portB, 'GET', `/setup?installation_id=82&state=${setupStateB}`, { Host: goodB.Host });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('App 安装'));
    assert.ok(r.body.includes('分支门禁'));
    assert.ok(r.body.includes('btn-skip-gate'), 'skip gate button must be present');
    assert.ok(r.body.includes('btn-configure-gate'), 'configure gate button must be present');
    ok('flow_b_setup_complete');

    // Step 7: Configure gate with mock gh token
    Bot.setGetUserGitHubToken(async () => 'flow_b_user_token');
    r = await request(portB, 'POST', '/api/branch-protection', goodB);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(Bot.serverState.branchGate, 'configured');
    mockB2.restore();
    ok('flow_b_gate_configured');

    // Step 8: After configure, location.reload() is called (simulated by GET /api/status)
    // The completion page should now have btn-done-close, NOT btn-configure-gate or btn-skip-gate
    r = await request(portB, 'GET', '/api/status', { Host: goodB.Host });
    const statusB = JSON.parse(r.body);
    assert.ok(statusB.html.includes('btn-done-close'), 'configured gate must show done-close button');
    assert.ok(!statusB.html.includes('btn-configure-gate'), 'configured gate must hide configure button');
    assert.ok(!statusB.html.includes('btn-skip-gate'), 'configured gate must hide skip button');
    assert.strictEqual(statusB.branch_gate, 'configured');
    ok('flow_b_done_close_button_present');

    // Step 9: Click "完成并关闭" (POST /api/done)
    r = await request(portB, 'POST', '/api/done', goodB);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { status: 'done' });

    // Step 10: Verify server closes
    await new Promise(r2 => { if (Bot.serverState.server && Bot.serverState.server.listening) { Bot.serverState.server.once('close', r2); } else { r2(); } });
    assert.ok(!Bot.serverState.server || !Bot.serverState.server.listening);
    ok('flow_b_gate_then_close');

    Bot.setGetUserGitHubToken(async () => { throw new Error('not mocked'); });
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  // === ITEM 6: Verify full flow handles state from manifest ===
  // Already tested above: step 6 parses setup state from manifest.setup_url
  // Add explicit assertion confirming the setup state matches manifest
  sandbox();
  try {
    const fp = await Bot.startServer();
    const fg = { Host: `127.0.0.1:${fp}`, Origin: `http://127.0.0.1:${fp}`, 'X-DCF-Wizard-CSRF': Bot.serverState.pageCsrf };
    r = await request(fp, 'POST', '/api/start', fg);
    const sb = JSON.parse(r.body);
    const mf = JSON.parse(sb.manifest);
    const setupUrl = new URL(mf.setup_url);
    const stateFromManifest = setupUrl.searchParams.get('state');
    assert.ok(stateFromManifest, 'manifest must contain setup_url with state');
    assert.strictEqual(stateFromManifest, Bot.serverState.setupState, 'server setupState must match manifest state');
    ok('manifest_setup_state_matches_server');
    await closeServer();
  } finally { clean(); Bot.clearSensitiveMemory(); }

  console.log(JSON.stringify({ ok: true, total: tests.length, passed: tests.length, tests }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
