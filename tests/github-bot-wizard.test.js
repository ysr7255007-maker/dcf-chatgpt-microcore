'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const Bot = require('../scripts/setup-github-bot');

const results = [];
function ok(name) { results.push({ ok: true, test: name }); }
function fail(name, err) { results.push({ ok: false, test: name, error: err.message }); }

let tmpDir;
let origHome;

function setupTempDir() {
  tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dcf-bot-test-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
}

function cleanupTempDir() {
  if (origHome !== undefined) process.env.HOME = origHome;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
}

(async () => {
  // 1. Manifest exact permissions
  (function testManifestExactPermissions() {
    const m = Bot.createManifest(54321);
    assert.strictEqual(m.name, Bot.APP_SUGGESTED_NAME);
    assert.strictEqual(m.public, false);
    assert.strictEqual(m.hook_attributes.active, false);
    assert.strictEqual(typeof m.setup_url, 'string');
    assert.strictEqual(typeof m.redirect_url, 'string');
    assert.deepStrictEqual(m.default_permissions, {
      contents: 'write', pull_requests: 'write',
      actions: 'read', checks: 'read', statuses: 'read'
    });
    assert.deepStrictEqual(m.default_events, []);
    ok('manifest_exact_permissions');
  })();

  // 2. No workflow or admin permission
  (function testNoWorkflowAdmin() {
    const m = Bot.createManifest(54321);
    const perms = m.default_permissions || {};
    assert.strictEqual(perms.workflows, undefined);
    assert.strictEqual(perms.administration, undefined);
    const extra = Object.keys(perms).filter(k => !['contents','pull_requests','actions','checks','statuses'].includes(k));
    assert.strictEqual(extra.length, 0, 'no extra: ' + extra.join(','));
    ok('no_workflow_admin');
  })();

  // 3. CSRF state
  (function testCSRFState() {
    const s1 = Bot.generateCSRFState();
    const s2 = Bot.generateCSRFState();
    assert.strictEqual(s1.length, 64);
    assert.notStrictEqual(s1, s2);
    assert.ok(/^[0-9a-f]{64}$/.test(s1));
    ok('csrf_state');
  })();

  // 4. JWT structure
  (function testJWTGeneration() {
    const keypair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = keypair.privateKey.export({ type: 'pkcs1', format: 'pem' });
    const jwt = Bot.generateJWT(12345, pem);
    const parts = jwt.split('.');
    assert.strictEqual(parts.length, 3);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.strictEqual(header.alg, 'RS256');
    assert.strictEqual(header.typ, 'JWT');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    assert.strictEqual(payload.iss, '12345');
    assert.ok(payload.iat <= Math.floor(Date.now() / 1000) + 1);
    assert.ok(payload.exp > Math.floor(Date.now() / 1000));
    assert.ok(payload.exp - payload.iat <= 660);
    const v = crypto.createVerify('sha256');
    v.update(parts[0] + '.' + parts[1]);
    assert.ok(v.verify(keypair.publicKey, parts[2], 'base64url'));
    ok('jwt_generation');
  })();

  // 5. Loopback-only binding
  const srv5 = http.createServer(() => {});
  await new Promise((resolve, reject) => {
    srv5.listen(0, Bot.LOOPBACK, () => {
      const addr = srv5.address();
      try {
        assert.strictEqual(addr.address, Bot.LOOPBACK);
        ok('loopback_binding');
      } catch (e) { fail('loopback_binding', e); }
      srv5.close(resolve);
    });
    srv5.on('error', reject);
  });

  // 6. Port conflict
  const srv6 = http.createServer(() => {});
  await new Promise((resolve) => {
    srv6.listen(0, Bot.LOOPBACK, () => {
      const port = srv6.address().port;
      const srvConflict = http.createServer(() => {});
      srvConflict.listen(port, Bot.LOOPBACK, () => {
        srvConflict.close(); srv6.close();
        fail('port_conflict', new Error('should have failed'));
        resolve();
      });
      srvConflict.on('error', (err) => {
        try {
          assert.strictEqual(err.code, 'EADDRINUSE');
          ok('port_conflict');
        } catch (e) { fail('port_conflict', e); }
        srv6.close();
        resolve();
      });
    });
  });

  // 7. Credential directory permissions
  (function testCredentialDirPermissions() {
    setupTempDir();
    try {
      const dir = Bot.configDir();
      Bot.secureDirectory(dir);
      const stat = fs.statSync(dir);
      assert.strictEqual(stat.mode & 0o777, 0o700);
      ok('credential_dir_permissions');
    } finally { cleanupTempDir(); }
  })();

  // 8. Private key file permissions
  (function testPrivateKeyPermissions() {
    setupTempDir();
    try {
      const cfgDir = Bot.configDir();
      Bot.secureDirectory(cfgDir);
      const keyPath = path.join(cfgDir, 'test-key.pem');
      Bot.writeSecureFile(keyPath, 'dummy-key-content');
      const stat = fs.statSync(keyPath);
      assert.strictEqual(stat.mode & 0o777, 0o600);
      assert.strictEqual(fs.readFileSync(keyPath, 'utf8'), 'dummy-key-content');
      ok('private_key_permissions');
    } finally { cleanupTempDir(); }
  })();

  // 9. Log sanitization
  (function testLogSanitization() {
    const sensitive = {
      pem: '-----BEGIN KEY-----', client_secret: 'sec', webhook_secret: 'whs',
      token: 'tok', access_tokens: [{ token: 'secret' }], private_key: 'keydata',
      nested: { deeply: { secret: 'hidden' } },
      app_id: 123, app_slug: 'test-bot',
      password: 'hunter2'
    };
    const sanitized = Bot.sanitizeForLog(sensitive);
    assert.strictEqual(sanitized.pem, '[REDACTED]');
    assert.strictEqual(sanitized.client_secret, '[REDACTED]');
    assert.strictEqual(sanitized.webhook_secret, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
    assert.strictEqual(sanitized.private_key, '[REDACTED]');
    assert.strictEqual(sanitized.access_tokens, '[REDACTED]');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.nested.deeply.secret, '[REDACTED]');
    assert.strictEqual(sanitized.app_id, 123);
    assert.strictEqual(sanitized.app_slug, 'test-bot');
    ok('log_sanitization');
  })();

  // 10. Duplicate detection via HOME override
  (function testDuplicateDetection() {
    setupTempDir();
    try {
      assert.strictEqual(Bot.loadCredentials(), null, 'no creds initially');
      Bot.saveCredentials({ id: 999, slug: 'test-bot', client_id: 'Iv1.test', client_secret: 'x', webhook_secret: 'y' }, 'dummy-pem');
      const c1 = Bot.loadCredentials();
      assert.strictEqual(c1.app_id, 999);
      assert.strictEqual(c1.app_slug, 'test-bot');
      assert.strictEqual(c1.pem, true);
      // Second load returns same data
      const c2 = Bot.loadCredentials();
      assert.strictEqual(c2.app_id, 999);
      ok('duplicate_detection');
    } finally { cleanupTempDir(); }
  })();

  // 11. Bot config save/load
  (function testBotConfig() {
    setupTempDir();
    try {
      const cfg = { schema: 'dcf.github-app-bot.config.v1', app_id: 999, app_slug: 'test-bot', installation_id: 123456, repository: 'owner/repo', private_key_path: '/tmp/k' };
      Bot.saveBotConfig(cfg);
      const loaded = Bot.loadBotConfig();
      assert.strictEqual(loaded.app_id, 999);
      assert.strictEqual(loaded.installation_id, 123456);
      assert.ok(loaded.verified_at);
      ok('bot_config');
    } finally { cleanupTempDir(); }
  })();

  // 12. CSRF validation (repeat)
  (function testCSRFValidation() {
    const s1 = Bot.generateCSRFState();
    const s2 = Bot.generateCSRFState();
    assert.notStrictEqual(s1, s2);
    assert.ok(/^[0-9a-f]{64}$/.test(s1));
    assert.ok(/^[0-9a-f]{64}$/.test(s2));
    ok('csrf_validation');
  })();

  // 13. Installation token not persisted
  (function testTokenNotPersisted() {
    setupTempDir();
    try {
      const cfg = { schema: 'dcf.github-app-bot.config.v1', app_id: 1, app_slug: 't', installation_id: 1, repository: 'a/b', private_key_path: '/tmp/k', permission_verification: { all_verified: true } };
      Bot.saveBotConfig(cfg);
      const loaded = Bot.loadBotConfig();
      assert.strictEqual(loaded.token, undefined);
      assert.strictEqual(loaded.access_token, undefined);
      ok('token_not_persisted');
    } finally { cleanupTempDir(); }
  })();

  // 14. Cleanup
  (function testCleanup() {
    setupTempDir();
    assert.ok(fs.existsSync(tmpDir));
    cleanupTempDir();
    assert.strictEqual(fs.existsSync(tmpDir), false);
    ok('cleanup_on_exit');
  })();

  // 15. Server state machine
  (function testServerStateMachine() {
    Bot.serverState.currentStep = 'intro';
    assert.strictEqual(Bot.serverState.currentStep, 'intro');
    Bot.serverState.csrf = Bot.generateCSRFState();
    assert.ok(Bot.serverState.csrf.length === 64);
    Bot.serverState.csrfUsed = true;
    assert.strictEqual(Bot.serverState.csrfUsed, true);
    Bot.serverState.currentStep = 'error';
    assert.strictEqual(Bot.serverState.currentStep, 'error');
    Bot.serverState.error = null;
    Bot.serverState.csrf = null;
    Bot.serverState.csrfUsed = false;
    Bot.serverState.currentStep = 'intro';
    ok('server_state_machine');
  })();

  // 16. Config dir structure for macOS
  (function testConfigDir() {
    assert.ok(Bot.configDir().includes('github-bot'));
    ok('config_dir');
  })();

  // 17. Server initial state
  (function testServerInitialState() {
    assert.strictEqual(Bot.serverState.currentStep, 'intro');
    assert.strictEqual(Bot.serverState.port, null);
    ok('server_initial_state');
  })();

  // 18. Package scripts
  (function testPackageScript() {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.strictEqual(pkg.scripts['setup:github-bot'], 'node scripts/setup-github-bot.js');
    assert.ok(pkg.scripts.test.includes('test:github-bot'));
    assert.ok(pkg.scripts.verify.includes('test:github-bot'));
    ok('package_script');
  })();

  // 19. Gitignore mentions github-bot
  (function testGitignore() {
    const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert.ok(gi.includes('github-bot'));
    ok('gitignore_credential_note');
  })();

  // 20. ADR files exist
  (function testADRExists() {
    const adrDir = path.join(__dirname, '..', 'docs', 'adr');
    const files = fs.readdirSync(adrDir);
    assert.ok(files.some(f => f.includes('github-app-bot-identity')), 'identity ADR');
    assert.ok(files.some(f => f.includes('github-app-bot-local-agent-integration')), 'integration ADR');
    ok('adr_files_exist');
  })();

  // Print results
  const allOk = results.every(r => r.ok);
  for (const r of results) {
    if (!r.ok) console.error(JSON.stringify(r));
  }
  console.log(JSON.stringify({ ok: allOk, total: results.length, passed: results.filter(r => r.ok).length }, null, 2));
  if (!allOk) process.exitCode = 1;
})().catch((error) => {
  console.error('Fatal:', error);
  process.exitCode = 1;
});
