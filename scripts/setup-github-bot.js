'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

// === Constants ===
const OWNER = 'ysr7255007-maker';
const REPO = 'dcf-chatgpt-microcore';
const REPOSITORY = `${OWNER}/${REPO}`;
const HOMEPAGE = `https://github.com/${REPOSITORY}`;
const APP_SUGGESTED_NAME = 'DCF Local Agent Bot';
const LOOPBACK = '127.0.0.1';
const CREDENTIAL_FILENAME = 'credentials.json';
const PRIVATE_KEY_FILENAME = 'private-key.pem';
const CONFIG_FILENAME = 'bot-config.json';

// === Platform config directory ===
function configDir() {
  // Test and managed-launch override. This is deliberately opt-in: normal runs
  // always use a per-user directory outside the repository.
  if (process.env.DCF_GITHUB_BOT_CONFIG_DIR) return process.env.DCF_GITHUB_BOT_CONFIG_DIR;
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'DCF', 'github-bot');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || home, 'DCF', 'github-bot');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dcf', 'github-bot');
}

// === Safe file operations ===
function secureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

function writeSecureFile(filePath, content, mode = 0o600) {
  // Never follow an existing permissive mode. Callers must explicitly opt in
  // to replacement; the normal bootstrap path only creates new credentials.
  const fd = fs.openSync(filePath, 'w', mode);
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filePath, mode);
}

function readSecureFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// === CSRF state ===
function generateCSRFState() {
  return crypto.randomBytes(32).toString('hex');
}

// === GitHub App Manifest ===
function createManifest(port, setupState) {
  return {
    name: APP_SUGGESTED_NAME,
    url: HOMEPAGE,
    description: '为 DCF 本地 Agent 创建分支、提交和 PR。不参与代码审查、Approve 或 Merge。代理身份与用户审查身份严格分离。',
    public: false,
    redirect_url: `http://${LOOPBACK}:${port}/callback`,
    setup_url: `http://${LOOPBACK}:${port}/setup?state=${encodeURIComponent(setupState)}`,
    setup_on_update: false,
    hook_attributes: { active: false },
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      actions: 'read',
      checks: 'read',
      statuses: 'read'
    },
    default_events: []
  };
}

// === JWT generation (RS256) ===
function generateJWT(appId, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 600, iss: String(appId) };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const message = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(message), privateKey);
  return `${message}.${sig.toString('base64url')}`;
}

// === HTTPS helpers ===
function httpsRequest(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dcf-github-app-bootstrap',
        ...headers
      }
    };
    if (body != null) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = (() => { try { return JSON.parse(data); } catch { return data; } })();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          const err = new Error(`GitHub API ${res.statusCode} for ${method} ${u.pathname}`);
          err.status = res.statusCode;
          err.body = parsed;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function httpsGet(url, headers) {
  return httpsRequest('GET', url, null, headers);
}
function httpsPost(url, body, headers) {
  return httpsRequest('POST', url, body, headers);
}
function httpsPut(url, body, headers) {
  return httpsRequest('PUT', url, body, headers);
}

// === GitHub API operations ===
async function exchangeCode(code) {
  return (await httpsPost(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`)).body;
}

async function createInstallationToken(jwt, installationId) {
  return (await httpsPost(`https://api.github.com/app/installations/${installationId}/access_tokens`, null, { Authorization: `Bearer ${jwt}` })).body;
}

async function getRepositoryInfo(token, owner, repo) {
  return (await httpsGet(`https://api.github.com/repos/${owner}/${repo}`, { Authorization: `Bearer ${token}` })).body;
}

async function listRefs(token, owner, repo) {
  return (await httpsGet(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads`, { Authorization: `Bearer ${token}` })).body;
}

async function getBranchProtection(token, owner, repo, branch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;
  try {
    return (await httpsGet(url, { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' })).body;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function setBranchProtection(token, owner, repo, branch, rules) {
  const url = `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;
  return (await httpsPut(url, rules, { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' })).body;
}

// === Credential operations ===
function existingCredentialsPath() {
  return path.join(configDir(), CREDENTIAL_FILENAME);
}

function existingPrivateKeyPath() {
  return path.join(configDir(), PRIVATE_KEY_FILENAME);
}

function loadCredentials() {
  const p = existingCredentialsPath();
  if (fs.existsSync(p)) return JSON.parse(readSecureFile(p));
  return null;
}

function saveCredentials(appData, privateKeyPem) {
  const dir = secureDirectory(configDir());
  const pkPath = existingPrivateKeyPath();
  const credentialsPath = path.join(dir, CREDENTIAL_FILENAME);
  if (fs.existsSync(pkPath) || fs.existsSync(credentialsPath)) {
    throw new Error('已有 Bot 凭据；请在向导中明确选择继续或重新创建，绝不会静默覆盖。');
  }
  writeSecureFile(pkPath, privateKeyPem);
  const creds = {
    app_id: appData.id,
    app_slug: appData.slug,
    client_id: appData.client_id,
    client_secret: appData.client_secret,
    webhook_secret: appData.webhook_secret,
    private_key_path: pkPath,
    created_at: new Date().toISOString()
  };
  writeSecureFile(credentialsPath, JSON.stringify(creds, null, 2));
  return creds;
}

function saveBotConfig(config) {
  secureDirectory(configDir());
  const filePath = path.join(configDir(), CONFIG_FILENAME);
  config.verified_at = new Date().toISOString();
  writeSecureFile(filePath, JSON.stringify(config, null, 2));
  return config;
}

function loadBotConfig() {
  const p = path.join(configDir(), CONFIG_FILENAME);
  if (fs.existsSync(p)) return JSON.parse(readSecureFile(p));
  return null;
}

// === State ===
const serverState = {
  csrf: null,
  csrfUsed: false,
  setupState: null,
  expiresAt: null,
  server: null,
  port: null,
  currentStep: 'intro'
};

function resetState() {
  serverState.csrf = null;
  serverState.csrfUsed = false;
  serverState.setupState = null;
  serverState.expiresAt = null;
  serverState.currentStep = 'intro';
}

function clearSensitiveMemory() {
  serverState.csrf = null;
  serverState.setupState = null;
  serverState.expiresAt = null;
}

function isExpired() {
  return !!serverState.expiresAt && Date.now() > serverState.expiresAt;
}

// === Browser open ===
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  if (cmd === 'start') {
    spawn(cmd, [url], { shell: true, stdio: 'ignore' });
  } else {
    spawn(cmd, [url], { stdio: 'ignore' });
  }
}

// === Sanitize for logging ===
function sanitizeForLog(obj, depth) {
  if (depth == null) depth = 0;
  if (depth > 5) return '[MAX_DEPTH]';
  if (obj == null || typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(v => sanitizeForLog(v, depth + 1));
  const sensitive = new Set(['pem', 'client_secret', 'webhook_secret', 'token', 'access_tokens', 'private_key', 'secret', 'password']);
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = sensitive.has(k) ? '[REDACTED]' : sanitizeForLog(v, depth + 1);
  }
  return result;
}

// === Server ===
function startServer(requestedPort = 0) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => handleRequest(req, res));
    s.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口被占用 (${LOOPBACK}:${requestedPort || '自动选择的端口'})。请释放端口后重试。`));
      } else {
        reject(err);
      }
    });
    s.listen(requestedPort, LOOPBACK, () => {
      serverState.server = s;
      serverState.port = s.address().port;
      resolve(serverState.port);
    });
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${LOOPBACK}:${serverState.port}`);
  const p = url.pathname;

  if (p === '/') return serveHTML(res, 200, mainPageHTML());
  if (p === '/api/start') return handleStart(req, res, url);
  if (p === '/api/status') return handleStatus(req, res);
  if (p === '/callback') return handleCallback(req, res, url);
  if (p === '/setup') return handleSetup(req, res, url);
  if (p === '/api/complete') return handleComplete(req, res);
  if (p === '/api/cancel') return handleCancel(req, res);
  if (p === '/api/branch-protection-status') return handleBranchProtectionStatus(req, res);
  if (p === '/api/branch-protection') return handleBranchProtection(req, res);

  serveJSON(res, 404, { error: 'not found' });
}

function serveHTML(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// === API handlers ===
function handleStart(req, res, url) {
  try {
    const replacing = url.searchParams.get('replace') === '1';
    if (loadCredentials() && !replacing) {
      return serveJSON(res, 409, { error: '检测到已有 Bot 凭据；请选择继续、重新创建或取消。' });
    }
    if (replacing) {
      // The old credential set is never overwritten. A new App requires a
      // separate config directory chosen by the operator after archival.
      return serveJSON(res, 409, { error: '为避免覆盖现有凭据，请先备份或移走现有 github-bot 目录，再重新创建。' });
    }
    resetState();
    serverState.csrf = generateCSRFState();
    serverState.setupState = generateCSRFState();
    serverState.expiresAt = Date.now() + 60 * 60 * 1000;
    const manifest = createManifest(serverState.port, serverState.setupState);
    const ghURL = `https://github.com/settings/apps/new?state=${serverState.csrf}`;
    serverState.currentStep = 'started';
    serveJSON(res, 200, {
      github_url: ghURL,
      manifest: JSON.stringify(manifest),
      // state is already in the form action; do not expose it to unrelated UI.
    });
  } catch (err) {
    serveJSON(res, 500, { error: err.message });
  }
}

function handleCancel(req, res) {
  clearSensitiveMemory();
  serverState.currentStep = 'cancelled';
  serveJSON(res, 200, { status: 'cancelled' });
}

function handleStatus(req, res) {
  const creds = loadCredentials();
  const config = loadBotConfig();
  const out = { step: serverState.currentStep };

  if (serverState.currentStep === 'error') {
    out.message = serverState.error || '未知错误';
    return serveJSON(res, 200, out);
  }

  if (config && creds) {
    out.step = 'complete';
    out.html = renderCompleteHTML(config, creds);
    return serveJSON(res, 200, out);
  }

  if (serverState.currentStep === 'intro') {
    if (creds) {
      out.step = 'creds-exist';
      out.app_slug = creds.app_slug;
      out.app_id = creds.app_id;
    }
    return serveJSON(res, 200, out);
  }

  if (serverState.currentStep === 'creds-done' && !config) {
    const c = loadCredentials();
    if (c) {
      out.step = 'waiting-install';
      out.install_url = `https://github.com/apps/${encodeURIComponent(c.app_slug)}/installations/new`;
    }
    return serveJSON(res, 200, out);
  }

  serveJSON(res, 200, out);
}

function handleComplete(req, res) {
  const creds = loadCredentials();
  const config = loadBotConfig();
  if (!creds || !config) return serveJSON(res, 400, { error: '凭据或配置不完整' });
  serveJSON(res, 200, { html: renderCompleteHTML(config, creds) });
}

async function handleBranchProtection(req, res) {
  try {
    const token = await getUserGitHubToken();
    if (!token) {
      return serveJSON(res, 400, { error: 'GitHub 身份不可用。请运行 gh auth login。' });
    }
    const branch = 'rebuild/chrome-native-host-v2';
    await setBranchProtection(token, OWNER, REPO, branch, {
      required_status_checks: { strict: true, contexts: ['DCF Verify', 'DCF Chrome candidate'] },
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
        require_last_push_approval: true
      },
      enforce_admins: true,
      required_conversation_resolution: true,
      restrictions: null,
      required_linear_history: false,
      allow_force_pushes: false,
      allow_deletions: false,
      block_creations: false,
      required_signatures: false,
      lock_branch: false,
      allow_fork_syncing: false,
      bypass_pull_request_allowances: { users: [], teams: [], apps: [] }
    });
    serveJSON(res, 200, { status: 'applied' });
  } catch (err) {
    serveJSON(res, 500, { error: err.message, detail: sanitizeForLog(err.body) });
  }
}

async function handleBranchProtectionStatus(req, res) {
  const token = await getUserGitHubToken();
  serveJSON(res, 200, { available: !!token, branch: 'rebuild/chrome-native-host-v2' });
}

// === GitHub callback: phase 1 → 2 ===
async function handleCallback(req, res, url) {
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code) {
    serverState.currentStep = 'error';
    serverState.error = 'GitHub 回调缺少 code 参数';
    return serveHTML(res, 400, `<script>location.href='/';</script>`);
  }

  if (isExpired()) {
    clearSensitiveMemory();
    serverState.currentStep = 'error';
    serverState.error = '创建回调已超时（超过 1 小时）；请重新开始。';
    return serveHTML(res, 408, `<script>location.href='/';</script>`);
  }

  if (!returnedState || returnedState !== serverState.csrf) {
    serverState.currentStep = 'error';
    serverState.error = 'CSRF state 不匹配';
    return serveHTML(res, 403, `<script>location.href='/';</script>`);
  }

  if (serverState.csrfUsed) {
    serverState.currentStep = 'error';
    serverState.error = 'CSRF state 已被使用（检测到重放攻击）';
    return serveHTML(res, 403, `<script>location.href='/';</script>`);
  }
  serverState.csrfUsed = true;

  try {
    const appData = await exchangeCode(code);
    const pk = appData.pem;
    if (!pk || !appData.id || !appData.slug) throw new Error('GitHub 返回的 App 凭据不完整');
    delete appData.pem;
    saveCredentials(appData, pk);
    // Make the best effort to shorten sensitive-string reachability before
    // returning to the browser. JS cannot guarantee immediate heap erasure.
    appData.client_secret = undefined;
    appData.webhook_secret = undefined;
    serverState.currentStep = 'creds-done';

    const creds = loadCredentials();
    const installURL = `https://github.com/apps/${encodeURIComponent(creds.app_slug)}/installations/new`;
    serveHTML(res, 200, `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>凭据已保存 — 正在跳转至安装页面</title></head><body>
<p>App 凭据已保存。正在跳转至安装页面…</p>
<p>请选择 <strong>Only select repositories</strong> → <code>${REPOSITORY}</code>。</p>
<script>window.location.href=${JSON.stringify(installURL)};</script>
</body></html>`);
  } catch (err) {
    serverState.currentStep = 'error';
    serverState.error = `凭据兑换失败: ${err.message}`;
    serveHTML(res, 500, `<script>location.href='/';</script>`);
  }
}

// === Setup callback: phase 3 ===
async function handleSetup(req, res, url) {
  const installationId = url.searchParams.get('installation_id');
  const setupAction = url.searchParams.get('setup_action');
  const setupState = url.searchParams.get('state');

  if (setupAction === 'delete') {
    serverState.currentStep = 'error';
    serverState.error = 'App 已被卸载';
    return serveHTML(res, 200, `<script>location.href='/';</script>`);
  }

  if (!installationId) {
    serverState.currentStep = 'error';
    serverState.error = '安装回调缺少 installation_id';
    return serveHTML(res, 400, `<script>location.href='/';</script>`);
  }
  if (!setupState || setupState !== serverState.setupState || isExpired()) {
    serverState.currentStep = 'error';
    serverState.error = '安装回调 state 不匹配或已超时';
    return serveHTML(res, 403, `<script>location.href='/';</script>`);
  }

  try {
    const creds = loadCredentials();
    if (!creds) throw new Error('凭据文件丢失，请重新创建 App');

    const pk = readSecureFile(creds.private_key_path);
    const jwt = generateJWT(creds.app_id, pk);
    const tokenData = await createInstallationToken(jwt, installationId);
    const token = tokenData.token;
    if (!token) throw new Error('GitHub 未返回 installation token');

    const repoInfo = await getRepositoryInfo(token, OWNER, REPO);
    if (repoInfo.full_name !== REPOSITORY) {
      throw new Error(`仓库不匹配: 期望 ${REPOSITORY}，实际 ${repoInfo.full_name}`);
    }

    await listRefs(token, OWNER, REPO);

    const perms = tokenData.permissions || {};
    const permOk = perms.contents === 'write' && perms.pull_requests === 'write';

    const config = saveBotConfig({
      schema: 'dcf.github-app-bot.config.v1',
      app_id: creds.app_id,
      app_slug: creds.app_slug,
      installation_id: Number(installationId),
      repository: REPOSITORY,
      private_key_path: creds.private_key_path,
      created_at: creds.created_at,
      permission_verification: {
        contents: perms.contents,
        pull_requests: perms.pull_requests,
        actions: perms.actions,
        checks: perms.checks,
        statuses: perms.statuses,
        all_verified: permOk
      }
    });

    // Do not persist token/JWT. Discard local references before responding.
    tokenData.token = undefined;
    clearSensitiveMemory();
    serverState.currentStep = permOk ? 'complete' : 'complete-warn';
    serveHTML(res, 200, `<script>location.href='/';</script>`);
  } catch (err) {
    serverState.currentStep = 'error';
    serverState.error = `安装验证失败: ${err.message}`;
    serveHTML(res, 500, `<script>location.href='/';</script>`);
  }
}

// === GitHub CLI helper ===
async function getUserGitHubToken() {
  return new Promise((resolve) => {
    const child = spawn('gh', ['auth', 'token'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    child.on('error', () => resolve(null));
  });
}

// === HTML page ===
function mainPageHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>DCF — GitHub App Bot 初始化向导</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1f2328}
  h1{font-size:1.6em;border-bottom:1px solid #d0d7de;padding-bottom:12px}
  .card{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:20px;margin:16px 0}
  .card.success{border-color:#1a7f37;background:#dafbe1}
  .card.warning{border-color:#9a6700;background:#fff8c5}
  .card.error{border-color:#cf222e;background:#ffeef0}
  .card.info{border-color:#0969da;background:#ddf4ff}
  button{padding:10px 24px;font-size:1em;border-radius:6px;border:1px solid #d0d7de;cursor:pointer;background:#2da44e;color:#fff;font-weight:600}
  button:hover{background:#218838}
  button:disabled{opacity:0.5;cursor:not-allowed}
  button.secondary{background:#0969da}
  button.secondary:hover{background:#0860ca}
  button.danger{background:#cf222e}
  button.danger:hover{background:#a40e26}
  pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto;font-size:0.85em}
  code{background:#f6f8fa;padding:2px 6px;border-radius:4px;font-size:0.9em}
  .step{display:flex;align-items:flex-start;gap:12px;margin:8px 0}
  .step-icon{font-size:1.3em;width:24px;text-align:center}
  .actions{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
</style></head><body>
<h1>DCF GitHub App Bot 初始化向导</h1>
<p>本向导帮助 DCF 创建一个专用的 GitHub App Bot，用于 Local Agent 自动创建分支、提交和 PR。</p>

<div id="creds-warning" style="display:none" class="card warning">
  <h3 style="margin-top:0">已存在 Bot 凭据</h3>
  <p id="creds-warning-text"></p>
  <div class="actions"><button id="btn-continue" class="secondary">继续使用已有 Bot</button><button id="btn-recreate" class="danger">重新创建</button><button id="btn-cancel" class="secondary">取消</button></div>
</div>

<div id="intro" class="card info">
  <p>向导会执行以下步骤：</p>
  <p>若 <code>DCF Local Agent Bot</code> 名称已存在，GitHub 会提示冲突；请在 GitHub 页面改为清晰的唯一名称后再创建。</p>
  <div class="step"><span class="step-icon">1.</span><span><strong>创建 GitHub App</strong> — 通过 Manifest 在 GitHub 注册专用 Bot 身份</span></div>
  <div class="step"><span class="step-icon">2.</span><span><strong>兑换并保存凭据</strong> — 凭据安全保存到本机用户配置目录</span></div>
  <div class="step"><span class="step-icon">3.</span><span><strong>安装到仓库</strong> — 安装到 <code>${REPOSITORY}</code> 并验证权限</span></div>
  <div class="step"><span class="step-icon">4.</span><span><strong>完成</strong> — 确认能力就绪</span></div>
  <div class="actions">
    <button id="btn-start">创建 DCF Local Agent Bot</button>
  </div>
</div>

<div id="phase-start" style="display:none" class="card">
  <h3 style="margin-top:0">正在准备 GitHub App…</h3>
  <p id="phase-start-msg">正在打开 GitHub 创建页面…</p>
</div>

<div id="phase-install" style="display:none" class="card info">
  <h3 style="margin-top:0">安装到仓库</h3>
  <p>请将 App 安装到 <code>${REPOSITORY}</code>。</p>
  <p>选择 <strong>Only select repositories</strong> → <code>${REPOSITORY}</code> → <strong>Install</strong>。</p>
  <p>安装完成后会自动跳转回来。</p>
</div>

<div id="phase-complete" style="display:none" class="card success">
  <h3 style="margin-top:0">初始化完成</h3>
  <div id="complete-details"></div>
</div>

<div id="branch-gate" style="display:none" class="card warning"><h3 style="margin-top:0">可选：候选分支审批规则</h3><p>将为 <code>rebuild/chrome-native-host-v2</code> 设置：PR、1 个批准、新推送清除旧批准、另一身份批准最后一次推送、会话解决、<code>DCF Verify</code> 和 <code>DCF Chrome candidate</code>；不允许 Bot 绕过。</p><button id="btn-protect" class="secondary">确认配置规则</button><p id="branch-gate-result"></p></div>

<div id="phase-error" style="display:none" class="card error">
  <h3 style="margin-top:0">发生错误</h3>
  <p id="error-message"></p>
  <button id="btn-retry" class="secondary">重试</button>
</div>

<form id="gh-form" method="POST" style="display:none">
  <input type="hidden" name="manifest" id="manifest-input">
</form>

<script>
var pollTimer = null;
function show(id) {
  document.querySelectorAll('.card[id^="phase-"], .card#intro').forEach(function(e) { e.style.display = 'none'; });
  var el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

function api(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function(r) {
    if (!r.ok) return r.text().then(function(t) { throw new Error(t || r.statusText); });
    return r.json();
  });
}

function refreshStatus() {
  api('/api/status').then(function(s) {
    if (s.step === 'complete' || s.step === 'complete-warn') {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      api('/api/complete').then(function(r) {
        document.getElementById('complete-details').innerHTML = r.html;
        show('phase-complete');
        api('/api/branch-protection-status').then(function(g) { if (g.available) document.getElementById('branch-gate').style.display = 'block'; });
      });
    } else if (s.step === 'creds-exist') {
      document.getElementById('creds-warning-text').textContent = '已有 Bot: ' + s.app_slug + ' (App ID: ' + s.app_id + ')';
      document.getElementById('creds-warning').style.display = 'block';
      show('intro');
    } else if (s.step === 'waiting-install') {
      show('phase-install');
    } else if (s.step === 'error') {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      document.getElementById('error-message').textContent = s.message || '未知错误';
      show('phase-error');
    }
  }).catch(function() {
    // 服务器可能暂不可用，继续轮询
  });
}

document.getElementById('btn-start').addEventListener('click', function() {
  show('phase-start');
  document.getElementById('phase-start-msg').textContent = '正在启动…';
  api('/api/start').then(function(result) {
    document.getElementById('gh-form').action = result.github_url;
    document.getElementById('manifest-input').value = result.manifest;
    document.getElementById('gh-form').submit();
  }).catch(function(e) {
    document.getElementById('error-message').textContent = e.message;
    show('phase-error');
  });
});

document.getElementById('btn-continue').addEventListener('click', function() { api('/api/complete').then(function(r) { document.getElementById('complete-details').innerHTML=r.html; show('phase-complete'); }).catch(function() { document.getElementById('error-message').textContent='已有凭据尚未完成安装；请在 GitHub App 设置中完成安装后再运行向导。'; show('phase-error'); }); });
document.getElementById('btn-recreate').addEventListener('click', function() { if (confirm('不会覆盖现有凭据。请先备份或移走已有凭据目录，然后重新运行向导。')) location.reload(); });
document.getElementById('btn-cancel').addEventListener('click', function() { api('/api/cancel').then(function() { document.getElementById('phase-start-msg').textContent='已取消；可关闭此页。'; show('phase-start'); }); });
document.getElementById('btn-protect').addEventListener('click', function() { if (!confirm('将使用当前 gh 用户身份修改候选分支保护规则。继续？')) return; api('/api/branch-protection').then(function() { document.getElementById('branch-gate-result').textContent='规则已配置。'; }).catch(function(e) { document.getElementById('branch-gate-result').textContent='无法配置：'+e.message+'。这不影响 Bot 安装。'; }); });

document.getElementById('btn-retry').addEventListener('click', function() { location.reload(); });

// 启动状态轮询
pollTimer = setInterval(refreshStatus, 1500);
refreshStatus();
</script></body></html>`;
}

function renderCompleteHTML(config, creds) {
  const perm = config.permission_verification || {};
  const permItems = [
    ['contents', perm.contents],
    ['pull_requests', perm.pull_requests],
    ['actions', perm.actions],
    ['checks', perm.checks],
    ['statuses', perm.statuses]
  ].map(function(p) {
    return '<span class="step"><span class="step-icon">' + (p[1] ? '✓' : '✗') + '</span><span><code>' + p[0] + '</code>: ' + (p[1] || 'missing') + '</span></span>';
  }).join('');

  return '<div class="step"><span class="step-icon">✓</span><span><strong>Bot 名称：</strong>' + (creds.app_slug || '?') + '</span></div>' +
    '<div class="step"><span class="step-icon">✓</span><span><strong>App ID：</strong>' + config.app_id + '</span></div>' +
    '<div class="step"><span class="step-icon">✓</span><span><strong>Installation ID：</strong>' + config.installation_id + '</span></div>' +
    '<div class="step"><span class="step-icon">✓</span><span><strong>已授权仓库：</strong><code>' + config.repository + '</code></span></div>' +
    '<div class="step"><span class="step-icon">✓</span><span><strong>凭据目录：</strong><code>' + configDir() + '</code></span></div>' +
    '<h3>权限验证</h3>' + permItems +
    '<h3>下一步</h3>' +
    '<p>本地 Agent 可使用此 Bot 身份创建分支、提交和 PR。</p>' +
    '<p>您的个人 GitHub 账号负责审查、Approve 和 Merge。</p>';
}

// === Main ===
async function main() {
  console.log('DCF GitHub App Bot 初始化向导');
  console.log('==============================');
  const existing = loadCredentials();
  if (existing) {
    console.log('发现已有凭据: ' + existing.app_slug + ' (App ID: ' + existing.app_id + ')');
    console.log('凭据目录: ' + configDir());
  }
  const port = await startServer();
  const url = 'http://' + LOOPBACK + ':' + port;
  console.log('向导页面: ' + url);
  openBrowser(url);
  console.log('按 Ctrl+C 终止。');
  await new Promise(function(resolve) {
    serverState.server.on('close', resolve);
  });
}

process.on('SIGINT', function() {
  console.log('\n向导已终止。');
  clearSensitiveMemory();
  if (serverState.server) serverState.server.close(function() { process.exit(0); });
});

process.on('SIGTERM', function() {
  clearSensitiveMemory();
  if (serverState.server) serverState.server.close(function() { process.exit(0); });
});

// === Exports for testing ===
module.exports = {
  configDir, secureDirectory, writeSecureFile, readSecureFile,
  generateCSRFState, createManifest, generateJWT,
  exchangeCode, createInstallationToken,
  getRepositoryInfo, listRefs,
  saveCredentials, loadCredentials, saveBotConfig, loadBotConfig,
  startServer, main, serverState, sanitizeForLog,
  OWNER, REPO, REPOSITORY, APP_SUGGESTED_NAME, LOOPBACK,
  CREDENTIAL_FILENAME, PRIVATE_KEY_FILENAME, CONFIG_FILENAME,
  getUserGitHubToken, getBranchProtection, setBranchProtection,
  clearSensitiveMemory, isExpired, handleCallback, handleSetup, handleStart
};

if (require.main === module) {
  main().catch(function(err) {
    console.error('Fatal:', err.message);
    process.exitCode = 1;
  });
}
