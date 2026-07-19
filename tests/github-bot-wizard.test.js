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
function clean() { delete process.env.DCF_GITHUB_BOT_CONFIG_DIR; fs.rmSync(temp, { recursive: true, force: true }); temp = null; }
function request(port, method, route, headers = {}) { return new Promise((resolve, reject) => { const r = http.request({ hostname: '127.0.0.1', port, path: route, method, agent: false, headers: { Connection: 'close', ...headers } }, response => { let text = ''; response.on('data', b => text += b); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text })); }); r.on('error', reject); r.end(); }); }
async function close() { if (Bot.serverState.server) await new Promise(resolve => Bot.serverState.server.close(resolve)); Bot.serverState.server = null; Bot.serverState.port = null; Bot.clearSensitiveMemory(); }

(async () => {
  sandbox();
  // Manifest contract: current GitHub schema, exact minimal permissions, no events.
  const manifest = Bot.createManifest(32123, 'state');
  assert.deepStrictEqual(manifest.default_permissions, { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' });
  assert.deepStrictEqual(manifest.default_events, []); assert.strictEqual(manifest.hook_attributes.active, false);
  assert.strictEqual(manifest.hook_attributes.url, 'http://127.0.0.1:32123/webhook-disabled');
  assert.ok(!('workflows' in manifest.default_permissions) && !('administration' in manifest.default_permissions)); ok('manifest_exact_minimum_and_inactive_webhook_url');

  const p = Bot.branchProtectionPayload();
  assert.deepStrictEqual(p.required_status_checks.contexts, ['verify', 'verify-and-package']);
  assert.deepStrictEqual(p.required_pull_request_reviews.bypass_pull_request_allowances, { users: [], teams: [], apps: [] });
  assert.ok(!('bypass_pull_request_allowances' in p)); assert.strictEqual(p.allow_force_pushes, false); assert.strictEqual(p.allow_deletions, false); ok('branch_protection_exact_payload');

  // Full local routing security boundary, including GET no-side-effect rules.
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
  await close();
  clean();

  // Bound token creation to only the DCF repository; HTTPS is mocked, no network occurs.
  const originalRequest = https.request; let captured;
  https.request = (options, callback) => { captured = options; const req = new EventEmitter(); req.write = body => { captured.body = body; }; req.setTimeout = () => {}; req.end = () => { const response = new EventEmitter(); response.statusCode = 201; callback(response); response.emit('data', Buffer.from('{"token":"temporary"}')); response.emit('end'); }; return req; };
  try { await Bot.createInstallationToken('jwt', 42); assert.strictEqual(captured.path, '/app/installations/42/access_tokens'); assert.deepStrictEqual(JSON.parse(captured.body), { repositories: ['dcf-chatgpt-microcore'] }); ok('installation_token_restricted_to_target_repository'); } finally { https.request = originalRequest; }

  sandbox();
  try {
    Bot.saveCredentials({ id: 1, slug: 'bot', client_id: 'id', client_secret: 'x', webhook_secret: 'y' }, 'private');
    assert.strictEqual(fs.statSync(path.join(temp, Bot.PRIVATE_KEY_FILENAME)).mode & 0o777, 0o600); assert.strictEqual(fs.statSync(temp).mode & 0o777, 0o700);
    assert.throws(() => Bot.saveCredentials({ id: 2 }, 'private'), /不会静默覆盖/); ok('credential_transaction_permissions_and_no_overwrite');
  } finally { clean(); }
  sandbox();
  try {
    const outside = path.join(temp, 'outside'); fs.writeFileSync(outside, 'x'); fs.symlinkSync(outside, path.join(temp, Bot.PRIVATE_KEY_FILENAME));
    assert.throws(() => Bot.saveCredentials({ id: 1, slug: 'bot' }, 'private'), /符号链接|已有 Bot/); assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'x'); ok('credential_symlink_and_toctou_guard');
  } finally { clean(); }
  sandbox();
  try {
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', installation_id: 7, repository: Bot.REPOSITORY });
    assert.throws(() => Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', installation_id: 8, repository: Bot.REPOSITORY }), /不同 Installation/); ok('different_installation_cannot_replace_config');
  } finally { clean(); }

  sandbox();
  try {
    Bot.serverState.setupState = 'setup-once'; Bot.serverState.setupStateUsed = false; Bot.serverState.expiresAt = Date.now() + 1_000;
    assert.strictEqual(Bot.claimSetupCallback(9, 'setup-once'), 'claimed');
    assert.strictEqual(Bot.claimSetupCallback(9, 'setup-once'), 'rejected');
    Bot.saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', installation_id: 9, repository: Bot.REPOSITORY });
    assert.strictEqual(Bot.claimSetupCallback(9, 'anything'), 'complete'); ok('setup_callback_atomic_claim_replay_and_idempotency');
  } finally { clean(); Bot.clearSensitiveMemory(); }

  const escaped = Bot.renderCompleteHTML({ app_slug: '<script>alert(1)</script>', app_id: '<x>', installation_id: 1, repository: '<img>', permission_verification: { candidate_ref: '<script>', all_verified: true } }, { app_slug: '<script>' });
  assert.ok(!escaped.includes('<script>alert')); assert.match(escaped, /&lt;script&gt;/); assert.ok(escaped.includes('App 安装')); assert.ok(escaped.includes('权限验证')); assert.ok(escaped.includes('分支门禁')); ok('completion_html_escapes_corrupt_config');
  const a = Bot.generateCSRFState(), b = Bot.generateCSRFState(); assert.match(a, /^[0-9a-f]{64}$/); assert.notStrictEqual(a, b); ok('unpredictable_csrf_state');

  // Completion page has three distinct sections: App installation, permission verification, branch gate
  const sections = Bot.renderCompleteHTML({
    app_slug: 'dcf-bot', app_id: '1', installation_id: 1,
    repository: Bot.REPOSITORY,
    permission_verification: { all_verified: true, contents: 'write', pull_requests: 'write', candidate_ref: Bot.CANDIDATE_REF }
  }, { app_slug: 'dcf-bot' });
  assert.ok(sections.includes('<section><h2>App 安装'));
  assert.ok(sections.includes('<section><h2>权限验证'));
  assert.ok(sections.includes('<section><h2>分支门禁'));
  ok('completion_page_three_state_sections');

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
  } finally { clean(); Bot.clearSensitiveMemory(); }
  console.log(JSON.stringify({ ok: true, total: tests.length, passed: tests.length, tests }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
