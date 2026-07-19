'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const OWNER = 'ysr7255007-maker';
const REPO = 'dcf-chatgpt-microcore';
const REPOSITORY = `${OWNER}/${REPO}`;
const HOMEPAGE = `https://github.com/${REPOSITORY}`;
const APP_SUGGESTED_NAME = 'DCF Local Agent Bot';
const LOOPBACK = '127.0.0.1';
const CREDENTIAL_FILENAME = 'credentials.json';
const PRIVATE_KEY_FILENAME = 'private-key.pem';
const CONFIG_FILENAME = 'bot-config.json';
const PENDING_INSTALL_FILENAME = 'pending-install.json';
const CANDIDATE_REF = 'refs/heads/rebuild/chrome-native-host-v2';
const REQUIRED_CHECKS = ['verify', 'verify-and-package'];
const EXPECTED_PERMISSIONS = { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' };
const DANGEROUS_PERMISSIONS = ['workflows', 'administration'];
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function configDir() {
  if (process.env.DCF_GITHUB_BOT_CONFIG_DIR) return process.env.DCF_GITHUB_BOT_CONFIG_DIR;
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'DCF', 'github-bot');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || home, 'DCF', 'github-bot');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dcf', 'github-bot');
}
function generateCSRFState() { return crypto.randomBytes(32).toString('hex'); }
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function assertNoSymlink(target, includeTarget) {
  if (includeTarget && fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('拒绝符号链接路径');
}
function secureDirectory(dir) {
  assertNoSymlink(dir, false);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('拒绝符号链接凭据目录');
  fs.chmodSync(dir, 0o700); return dir;
}
function atomicWriteSecure(filePath, content) {
  const dir = secureDirectory(path.dirname(filePath));
  assertNoSymlink(filePath, true);
  const temporary = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(16).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    fs.chmodSync(temporary, 0o600);
    if (fs.lstatSync(temporary).isSymbolicLink()) throw new Error('拒绝符号链接临时文件');
    fs.linkSync(temporary, filePath);
    fs.unlinkSync(temporary);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}
function writeSecureFile(filePath, content) { return atomicWriteSecure(filePath, content); }
function readSecureFile(filePath) { assertNoSymlink(filePath, true); return fs.readFileSync(filePath, 'utf8'); }
function existingCredentialsPath() { return path.join(configDir(), CREDENTIAL_FILENAME); }
function existingPrivateKeyPath() { return path.join(configDir(), PRIVATE_KEY_FILENAME); }
function existingConfigPath() { return path.join(configDir(), CONFIG_FILENAME); }
function pendingInstallPath() { return path.join(configDir(), PENDING_INSTALL_FILENAME); }
function loadJson(file) { try { return fs.existsSync(file) ? JSON.parse(readSecureFile(file)) : null; } catch { return null; } }
function loadCredentials() { return loadJson(existingCredentialsPath()); }
function loadBotConfig() { return loadJson(existingConfigPath()); }
function loadPendingInstall() { return loadJson(pendingInstallPath()); }
function clearPendingInstall() { try { if (fs.existsSync(pendingInstallPath())) fs.unlinkSync(pendingInstallPath()); } catch (_) {} }
function verifyPermissions(p) {
  p = p || {};
  const missing = []; const dangerous = [];
  for (const [key, val] of Object.entries(EXPECTED_PERMISSIONS)) {
    if (p[key] !== val) missing.push({ key, expected: val, actual: p[key] || undefined });
  }
  for (const key of DANGEROUS_PERMISSIONS) {
    if (key in p && p[key] !== 'none' && p[key] !== undefined) dangerous.push({ key, actual: p[key] });
  }
  return { all_verified: missing.length === 0 && dangerous.length === 0, missing, dangerous };
}
function savePendingInstall(installationId) {
  const existing = loadPendingInstall();
  if (existing && Number(existing.installation_id) === Number(installationId)) return existing;
  const creds = loadCredentials();
  if (!creds) throw new Error('没有凭据');
  const pending = { schema: 'dcf.github-app-bot.pending-install.v1', app_id: creds.app_id, app_slug: creds.app_slug, installation_id: installationId, recovery_state: crypto.randomBytes(32).toString('hex'), created_at: new Date().toISOString() };
  const dir = secureDirectory(configDir());
  const file = pendingInstallPath();
  assertNoSymlink(file, true);
  const temp = path.join(dir, `.pending-${crypto.randomBytes(16).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, JSON.stringify(pending, null, 2), 'utf8');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    fs.chmodSync(temp, 0o600);
    if (fs.lstatSync(temp).isSymbolicLink()) throw new Error('拒绝符号链接临时文件');
    fs.linkSync(temp, file);
    fs.unlinkSync(temp);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
  return pending;
}
function saveCredentials(appData, privateKeyPem) {
  const dir = secureDirectory(configDir()); const key = path.join(dir, PRIVATE_KEY_FILENAME); const credentials = path.join(dir, CREDENTIAL_FILENAME);
  if (fs.existsSync(key) || fs.existsSync(credentials)) throw new Error('已有 Bot 凭据；绝不会静默覆盖。');
  const record = { app_id: appData.id, app_slug: appData.slug, client_id: appData.client_id, client_secret: appData.client_secret, webhook_secret: appData.webhook_secret, private_key_path: key, created_at: new Date().toISOString() };
  try { atomicWriteSecure(key, privateKeyPem); atomicWriteSecure(credentials, JSON.stringify(record, null, 2)); return record; }
  catch (error) { try { if (fs.existsSync(key) && !fs.existsSync(credentials)) fs.unlinkSync(key); } catch (_) {} throw error; }
}
function saveBotConfig(config) {
  const prior = loadBotConfig();
  if (prior && Number(prior.installation_id) !== Number(config.installation_id)) throw new Error('已有不同 Installation 配置，拒绝替换；请先明确移除旧凭据。');
  const record = { ...config, verified_at: new Date().toISOString() };
  const file = existingConfigPath();
  if (prior) {
    const backup = `${file}.replace-${crypto.randomBytes(8).toString('hex')}`;
    fs.renameSync(file, backup); try { atomicWriteSecure(file, JSON.stringify(record, null, 2)); fs.unlinkSync(backup); } catch (e) { try { fs.renameSync(backup, file); } catch (_) {} throw e; }
  } else atomicWriteSecure(file, JSON.stringify(record, null, 2));
  return record;
}

function createManifest(port, setupState) {
  return { name: APP_SUGGESTED_NAME, url: HOMEPAGE, description: '为 DCF 本地 Agent 创建分支、提交和 PR；用户负责审查、Approve 和 Merge。', public: false,
    redirect_url: `http://${LOOPBACK}:${port}/callback`, setup_url: `http://${LOOPBACK}:${port}/setup?state=${encodeURIComponent(setupState)}`, setup_on_update: false,
    hook_attributes: { url: `http://${LOOPBACK}:${port}/webhook-disabled`, active: false }, default_permissions: { contents: 'write', pull_requests: 'write', actions: 'read', checks: 'read', statuses: 'read' }, default_events: [] };
}
function generateJWT(appId, pem) { const key = crypto.createPrivateKey(pem); const now = Math.floor(Date.now() / 1000); const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'); const text = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 600, iss: String(appId) })}`; return `${text}.${crypto.sign('sha256', Buffer.from(text), key).toString('base64url')}`; }
function httpsRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const data = body == null ? null : JSON.stringify(body); let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dcf-github-app-bootstrap', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, res => {
      let received = 0; const chunks = [];
      res.on('data', chunk => { received += chunk.length; if (received > MAX_RESPONSE_BYTES) { req.destroy(new Error('GitHub 响应过大')); return; } chunks.push(chunk); });
      res.on('end', () => { if (settled) return; settled = true; const text = Buffer.concat(chunks).toString('utf8'); let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; } if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: parsed }); else { const error = new Error(`GitHub API ${res.statusCode} for ${method} ${u.pathname}`); error.status = res.statusCode; error.body = parsed; reject(error); } });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('GitHub 请求超时'))); req.on('error', fail); if (data) req.write(data); req.end();
  });
}
const auth = token => ({ Authorization: `Bearer ${token}` });
const exchangeCode = code => httpsRequest('POST', `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`).then(r => r.body);
const createInstallationToken = (jwt, id) => httpsRequest('POST', `https://api.github.com/app/installations/${id}/access_tokens`, { repositories: [REPO] }, auth(jwt)).then(r => r.body);
const getRepositoryInfo = token => httpsRequest('GET', `https://api.github.com/repos/${OWNER}/${REPO}`, null, auth(token)).then(r => r.body);
const listInstallationRepositories = token => httpsRequest('GET', 'https://api.github.com/installation/repositories', null, auth(token)).then(r => r.body);
const getAppWithJwt = jwt => httpsRequest('GET', 'https://api.github.com/app', null, auth(jwt)).then(r => r.body);
const getInstallations = jwt => httpsRequest('GET', 'https://api.github.com/app/installations', null, auth(jwt)).then(r => r.body);
const getInstallation = (jwt, id) => httpsRequest('GET', `https://api.github.com/app/installations/${id}`, null, auth(jwt)).then(r => r.body);
const getCandidateRef = token => httpsRequest('GET', `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, null, auth(token)).then(r => r.body);
function branchProtectionPayload() { return { required_status_checks: { strict: true, contexts: REQUIRED_CHECKS }, required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_last_push_approval: true, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } }, enforce_admins: true, required_conversation_resolution: true, restrictions: null, allow_force_pushes: false, allow_deletions: false }; }
const setBranchProtection = (token, rules) => httpsRequest('PUT', `https://api.github.com/repos/${OWNER}/${REPO}/branches/rebuild%2Fchrome-native-host-v2/protection`, rules, auth(token)).then(r => r.body);

const serverState = { manifestState: null, manifestStateUsed: false, setupState: null, setupStateUsed: false, pageCsrf: null, expiresAt: null, server: null, port: null, currentStep: 'intro', error: null, branchGate: 'not-configured', branchGateError: null };
function clearSensitiveMemory() { serverState.manifestState = null; serverState.setupState = null; serverState.expiresAt = null; }
function isExpired() { return !!serverState.expiresAt && Date.now() > serverState.expiresAt; }
function resetState() { const pageCsrf = serverState.pageCsrf; clearSensitiveMemory(); serverState.pageCsrf = pageCsrf; serverState.manifestStateUsed = false; serverState.setupStateUsed = false; serverState.currentStep = 'intro'; serverState.error = null; }
function claimSetupCallback(installationId, state) {
  const prior = loadBotConfig();
  if (prior && Number(prior.installation_id) === Number(installationId)) return 'complete';
  if (!Number.isSafeInteger(installationId) || installationId <= 0 || isExpired() || !sameSecret(state, serverState.setupState) || serverState.setupStateUsed) return 'rejected';
  serverState.setupStateUsed = true;
  return 'claimed';
}
function html(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function securityHeaders(type) { return { 'Content-Type': type, 'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action https://github.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'", 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }; }
function serveJSON(res, code, value) { res.writeHead(code, securityHeaders('application/json; charset=utf-8')); res.end(JSON.stringify(value)); }
function serveHTML(res, code, value) { res.writeHead(code, securityHeaders('text/html; charset=utf-8')); res.end(value); }
function reject(res, code, error) { serveJSON(res, code, { error }); }
function expectedOrigin() { return `http://${LOOPBACK}:${serverState.port}`; }
function localAddress(req) { return req.socket && (req.socket.remoteAddress === LOOPBACK || req.socket.remoteAddress === '::ffff:127.0.0.1' || req.socket.remoteAddress === '::1'); }
function validateRequest(req, res, allowed, mutation) {
  const host = req.headers.host; if (host !== `${LOOPBACK}:${serverState.port}`) { reject(res, 400, '无效 Host'); return false; }
  if (!allowed.includes(req.method)) { res.setHeader('Allow', allowed.join(', ')); reject(res, 405, '不允许的 HTTP method'); return false; }
  if (!mutation) return true;
  const origin = req.headers.origin; if (origin ? origin !== expectedOrigin() : !localAddress(req)) { reject(res, 403, '无效 Origin'); return false; }
  if (!sameSecret(req.headers['x-dcf-wizard-csrf'], serverState.pageCsrf)) { reject(res, 403, '无效向导 CSRF'); return false; }
  return true;
}
function startServer(port = 0) { return new Promise((resolve, reject) => { const server = http.createServer(handleRequest); server.on('error', error => reject(error.code === 'EADDRINUSE' ? new Error(`端口被占用 (${LOOPBACK}:${port || '自动选择的端口'})`) : error)); server.listen(port, LOOPBACK, () => { serverState.server = server; serverState.port = server.address().port; serverState.pageCsrf = generateCSRFState(); resolve(serverState.port); }); }); }
function handleRequest(req, res) {
  const url = new URL(req.url, expectedOrigin()); const route = url.pathname;
  const table = { '/': [['GET'], false, () => serveHTML(res, 200, mainPageHTML())], '/callback': [['GET'], false, () => handleCallback(res, url)], '/setup': [['GET'], false, () => handleSetup(res, url)], '/api/status': [['GET'], false, () => handleStatus(res)], '/api/complete': [['GET'], false, () => handleComplete(res)], '/api/start': [['POST'], true, () => handleStart(res)], '/api/cancel': [['POST'], true, () => handleCancel(res)], '/api/retry-verification': [['POST'], true, () => handleRetryVerification(res)], '/api/branch-protection-status': [['GET'], false, () => handleBranchProtectionStatus(res)], '/api/branch-protection': [['POST'], true, () => handleBranchProtection(res)], '/api/done': [['POST'], true, () => handleDone(res)] };
  const item = table[route]; if (!item) return reject(res, 404, 'not found'); if (!validateRequest(req, res, item[0], item[1])) return; return item[2]();
}
function handleDone(res) {
  serveJSON(res, 200, { status: 'done' });
  if (serverState.server) setImmediate(() => serverState.server.close());
}
function handleStart(res) {
  const creds = loadCredentials(); const config = loadBotConfig();
  if (creds && config) return reject(res, 409, '向导已完成。访问首页查看状态。');
  if (creds && !config) {
    serverState.pageCsrf = serverState.pageCsrf || generateCSRFState();
    serverState.expiresAt = Date.now() + 3600000;
    serverState.currentStep = 'pending-install';
    const pending = loadPendingInstall();
    const install_url = `https://github.com/apps/${encodeURIComponent(creds.app_slug)}/installations/new`;
    return serveJSON(res, 200, { pending_install: true, app_slug: creds.app_slug, app_id: creds.app_id, install_url, has_pending: !!pending, message: 'App 已创建，需要完成安装验证。如安装回调因重启丢失，请重新安装。' });
  }
  resetState(); serverState.manifestState = generateCSRFState(); serverState.setupState = generateCSRFState(); serverState.pageCsrf = serverState.pageCsrf || generateCSRFState(); serverState.expiresAt = Date.now() + 3600000; serverState.currentStep = 'started';
  return serveJSON(res, 200, { github_url: `https://github.com/settings/apps/new?state=${serverState.manifestState}`, manifest: JSON.stringify(createManifest(serverState.port, serverState.setupState)) });
}
function handleCancel(res) {
  clearSensitiveMemory(); serverState.currentStep = 'cancelled';
  serveJSON(res, 200, { status: 'cancelled' });
  if (serverState.server) setImmediate(() => serverState.server.close());
}
function handleStatus(res) {
  const creds = loadCredentials(); const config = loadBotConfig();
  if (config && creds) {
    const p = config.permission_verification || {}; const step = p.all_verified ? 'complete' : 'complete-warn';
    return serveJSON(res, 200, { step, html: renderCompleteHTML(config, creds), branch_gate: serverState.branchGate, permission_verified: !!p.all_verified });
  }
  if (serverState.currentStep === 'error') return serveJSON(res, 200, { step: 'error', message: serverState.error });
  if (creds) return serveJSON(res, 200, { step: 'creds-exist', app_slug: creds.app_slug, app_id: creds.app_id });
  serveJSON(res, 200, { step: serverState.currentStep });
}
function handleComplete(res) { const c = loadCredentials(), b = loadBotConfig(); if (!c || !b) return reject(res, 400, '凭据或配置不完整'); serveJSON(res, 200, { html: renderCompleteHTML(b, c) }); }
async function _defaultGetUserGitHubToken() { const status = await new Promise(resolve => { const c = spawn('gh', ['auth', 'status'], { stdio: 'ignore' }); c.on('close', code => resolve(code === 0)); c.on('error', () => resolve(false)); }); if (!status) return null; return new Promise(resolve => { const c = spawn('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }); let out = ''; c.stdout.on('data', d => out += d); c.on('close', code => resolve(code === 0 ? out.trim() : null)); c.on('error', () => resolve(null)); }); }
let getUserGitHubToken = _defaultGetUserGitHubToken;
async function handleBranchProtectionStatus(res) { serveJSON(res, 200, { available: !!await getUserGitHubToken(), branch: CANDIDATE_REF, required_checks: REQUIRED_CHECKS }); }
async function handleBranchProtection(res) { try { const token = await getUserGitHubToken(); if (!token) { serverState.branchGate = 'unavailable'; serverState.branchGateError = 'gh auth not available'; return reject(res, 400, 'GitHub 管理身份不可用；请运行 gh auth login。Bot 安装不受影响。'); } await setBranchProtection(token, branchProtectionPayload()); serverState.branchGate = 'configured'; serverState.branchGateError = null; serveJSON(res, 200, { status: 'applied', required_checks: REQUIRED_CHECKS }); } catch (e) { serverState.branchGate = 'unavailable'; serverState.branchGateError = e.message; serveJSON(res, 422, { error: `无法配置分支门禁（可能是套餐、权限或 API 限制）：${e.message}` }); } }
async function handleCallback(res, url) { const code = url.searchParams.get('code'), state = url.searchParams.get('state'); if (!code || isExpired() || !sameSecret(state, serverState.manifestState) || serverState.manifestStateUsed) { serverState.currentStep = 'error'; serverState.error = '创建回调无效、过期或已使用；请重新开始。'; return serveHTML(res, 403, redirectHome()); } serverState.manifestStateUsed = true; try { const data = await exchangeCode(code); const pem = data.pem; if (!pem || !data.id || !data.slug) throw new Error('GitHub 返回的 App 凭据不完整'); delete data.pem; saveCredentials(data, pem); data.client_secret = data.webhook_secret = undefined; serverState.currentStep = 'creds-done'; serveHTML(res, 200, redirectInstall(loadCredentials().app_slug)); } catch (e) { serverState.currentStep = 'error'; serverState.error = `凭据兑换失败：${e.message}。如已创建 App，请删除该 App 后重新开始。`; serveHTML(res, 500, redirectHome()); } }
async function handleSetup(res, url) {
  const id = Number(url.searchParams.get('installation_id')); const claim = claimSetupCallback(id, url.searchParams.get('state'));
  if (claim === 'complete') return serveHTML(res, 200, mainPageHTML());
  if (claim !== 'claimed') { serverState.currentStep = 'error'; serverState.error = '安装回调无效、过期或已使用；请重新运行向导检查状态。'; return serveHTML(res, 403, redirectHome()); }
  try { const creds = loadCredentials(); if (!creds) throw new Error('凭据不存在');
    savePendingInstall(id);
    const jwt = generateJWT(creds.app_id, readSecureFile(creds.private_key_path));
    const [app, installation] = await Promise.all([getAppWithJwt(jwt), getInstallation(jwt, id)]);
    if (Number(app.id) !== Number(creds.app_id)) throw new Error('App 身份不匹配');
    if (Number(installation.id) !== id) throw new Error('Installation ID 不匹配');
    if (!installation.account || installation.account.login !== OWNER) throw new Error('Installation 不属于目标账号');
    if (installation.repository_selection !== 'selected') throw new Error('Installation 应为手动选择仓库');
    const tokenData = await createInstallationToken(jwt, id); const token = tokenData.token; if (!token) throw new Error('GitHub 未返回 installation token');
    const [repo, scope, ref] = await Promise.all([getRepositoryInfo(token), listInstallationRepositories(token), getCandidateRef(token)]);
    if (repo.full_name !== REPOSITORY || repo.owner?.login !== OWNER) throw new Error('目标仓库或账号不匹配');
    const accessible = scope.repositories || []; if (accessible.length !== 1 || accessible[0].full_name !== REPOSITORY) throw new Error('installation token 范围不是唯一目标仓库');
    if (ref.ref !== CANDIDATE_REF || !ref.object?.sha) throw new Error('候选分支 ref 不匹配');
    const p = installation.permissions || {}; const v = verifyPermissions(p);
    saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: creds.app_id, app_slug: creds.app_slug, installation_id: id, repository: REPOSITORY, private_key_path: creds.private_key_path, created_at: creds.created_at, permission_verification: { contents: p.contents, pull_requests: p.pull_requests, actions: p.actions, checks: p.checks, statuses: p.statuses, all_verified: v.all_verified, missing: v.missing, dangerous: v.dangerous, token_repository_scope: REPOSITORY, app_installation_range_note: 'Installation may include more repositories; this verification token is restricted to DCF only.', candidate_ref: CANDIDATE_REF, candidate_sha: ref.object.sha } });
    clearPendingInstall(); clearSensitiveMemory(); serverState.currentStep = v.all_verified ? 'complete' : 'complete-warn';
    const html = renderCompleteHTML(loadBotConfig(), creds);
    serveHTML(res, 200, html);
  } catch (e) { serverState.currentStep = 'error'; serverState.error = `安装验证失败：${e.message}。可在浏览器重试验证，或重新运行向导。pending-install 状态已保存。`; serveHTML(res, 500, redirectHome()); }
}
async function discoverAndVerify(creds, installationId) {
  const jwt = generateJWT(creds.app_id, readSecureFile(creds.private_key_path));
  const [app, installation] = await Promise.all([getAppWithJwt(jwt), getInstallation(jwt, installationId)]);
  if (Number(app.id) !== Number(creds.app_id)) throw new Error('App 身份不匹配');
  if (Number(installation.id) !== installationId) throw new Error('Installation ID 不匹配');
  if (!installation.account || installation.account.login !== OWNER) throw new Error('Installation 不属于目标账号');
  if (installation.repository_selection !== 'selected') throw new Error('Installation 应为手动选择仓库');
  const tokenData = await createInstallationToken(jwt, installationId); const token = tokenData.token; if (!token) throw new Error('GitHub 未返回 installation token');
  const [repo, scope, ref] = await Promise.all([getRepositoryInfo(token), listInstallationRepositories(token), getCandidateRef(token)]);
  if (repo.full_name !== REPOSITORY || repo.owner?.login !== OWNER) throw new Error('目标仓库或账号不匹配');
  const accessible = scope.repositories || []; if (accessible.length !== 1 || accessible[0].full_name !== REPOSITORY) throw new Error('installation token 范围不是唯一目标仓库');
  if (ref.ref !== CANDIDATE_REF || !ref.object?.sha) throw new Error('候选分支 ref 不匹配');
  savePendingInstall(installationId);
  return { creds, installation, token, sha: ref.object.sha, permissions: installation.permissions || {} };
}
async function handleRetryVerification(res) {
  let creds = loadCredentials(); if (!creds) return reject(res, 400, '凭据不存在');
  let pending = loadPendingInstall();
  try {
    if (!pending) {
      const jwt = generateJWT(creds.app_id, readSecureFile(creds.private_key_path));
      const allInstalls = await getInstallations(jwt);
      const installs = Array.isArray(allInstalls) ? allInstalls : (allInstalls && allInstalls.installations ? allInstalls.installations : []);
      const match = installs.find(i => i.account && i.account.login === OWNER && i.repository_selection === 'selected');
      if (!match) return reject(res, 400, '没有待恢复的安装，且在目标账号上未发现匹配的 Installation。请重新运行向导。');
      pending = savePendingInstall(match.id);
    }
    if (Number(creds.app_id) !== Number(pending.app_id)) return reject(res, 400, '凭据与待恢复的安装不匹配');
    const config = loadBotConfig();
    if (config && Number(config.installation_id) !== Number(pending.installation_id)) return reject(res, 400, '当前配置的 installation 与待恢复的不一致');
    const { permissions, sha } = await discoverAndVerify(creds, pending.installation_id);
    const v = verifyPermissions(permissions);
    saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: creds.app_id, app_slug: creds.app_slug, installation_id: pending.installation_id, repository: REPOSITORY, private_key_path: creds.private_key_path, created_at: creds.created_at, permission_verification: { contents: permissions.contents, pull_requests: permissions.pull_requests, actions: permissions.actions, checks: permissions.checks, statuses: permissions.statuses, all_verified: v.all_verified, missing: v.missing, dangerous: v.dangerous, token_repository_scope: REPOSITORY, app_installation_range_note: 'Installation may include more repositories; this verification token is restricted to DCF only.', candidate_ref: CANDIDATE_REF, candidate_sha: sha } });
    clearPendingInstall(); clearSensitiveMemory(); serverState.currentStep = v.all_verified ? 'complete' : 'complete-warn';
    const html = renderCompleteHTML(loadBotConfig(), creds);
    serveJSON(res, 200, { status: 'ok', html });
  } catch (e) { serverState.currentStep = 'error'; serverState.error = `重试验证失败：${e.message}`; serveJSON(res, 500, { error: e.message }); }
}
function redirectHome() { return '<!doctype html><meta http-equiv="refresh" content="0;url=/">'; }
function redirectInstall(slug) { const target = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`; return `<!doctype html><p>请选择 Only select repositories → ${html(REPOSITORY)}。</p><script>location.replace(${JSON.stringify(target)})</script>`; }
function badge(state, label) { const color = state === 'success' ? '#2da44e' : state === 'warn' ? '#d4920c' : '#ccc'; return `<span style="display:inline-block;background:${color};color:#fff;border-radius:4px;font-size:12px;padding:1px 8px;margin:0 4px">${html(label)}</span>`; }
function renderPermissionRows(p) {
  let html2 = '';
  for (const [key, val] of Object.entries(EXPECTED_PERMISSIONS)) {
    const actual = p[key] || '<span style="color:#d00">missing</span>';
    const ok = p[key] === val;
    html2 += `<li><code>${html(key)}</code>: ${ok ? html(actual) : '<span style="color:#d00">' + html(actual || 'missing') + '</span>'} <small>期望: ${html(val)}</small></li>`;
  }
  for (const key of DANGEROUS_PERMISSIONS) {
    if (key in p && p[key] !== 'none' && p[key] !== undefined) {
      html2 += `<li><code>${html(key)}</code>: <span style="color:#d00">${html(p[key])}</span> <small>危险权限</small></li>`;
    }
  }
  if (p.missing && p.missing.length > 0) {
    for (const m of p.missing) {
      html2 += `<li><code>${html(m.key)}</code>: <span style="color:#d00">缺失 (期望 ${html(m.expected)}, 实际 ${html(m.actual || 'none')})</span></li>`;
    }
  }
  if (p.dangerous && p.dangerous.length > 0) {
    for (const d of p.dangerous) {
      html2 += `<li><code>${html(d.key)}</code>: <span style="color:#d00">危险权限: ${html(d.actual)}</span></li>`;
    }
  }
  return html2;
}
function renderCompleteHTML(config, creds) { const p = config.permission_verification || {}; const appBadge = badge('success', '已安装'); const permBadge = badge(p.all_verified ? 'success' : 'warn', p.all_verified ? '已验证' : '需检查'); const gateStatus = serverState.branchGate === 'configured' ? badge('success', '已配置') : serverState.branchGate === 'unavailable' ? badge('warn', '不可用') : badge('', '未配置'); const configureDisabled = serverState.branchGate === 'configured' ? 'disabled' : ''; const skipDisabled = serverState.branchGate === 'configured' ? 'disabled' : ''; const gateErrorHtml = serverState.branchGateError ? '<p style="color:#d00">配置失败：' + html(serverState.branchGateError) + '。可重试或跳过。</p>' : ''; return `<section><h2>App 安装${appBadge}</h2><p><strong>Bot：</strong>${html(config.app_slug || creds.app_slug)}</p><p>App ID：${html(config.app_id)}；Installation ID：${html(config.installation_id)}</p><p>仓库：<code>${html(config.repository)}</code></p><p>本地凭据目录：<code>${html(configDir())}</code></p></section><section><h2>权限验证${permBadge}</h2><ul>${renderPermissionRows(p)}</ul></section><section><h2>分支门禁${gateStatus}</h2><p>候选分支 <code>${html(CANDIDATE_REF)}</code> 保护规则将要求：</p><ul><li>严格状态检查：<code>${REQUIRED_CHECKS.map(c => html(c)).join('</code>, <code>')}</code></li><li>必需 <strong>1</strong> 个审查 + 过期 dismiss + 最后推送审查</li><li>管理员同样受保护、对话必须解决</li><li>禁止 force-push、禁止删除</li></ul><p>此操作使用本机 <code>gh</code> 用户的管理身份，Bot 本人不会获得 administration 权限。</p>${gateErrorHtml}<p><button id="btn-configure-gate" ${configureDisabled}>配置门禁</button> <button id="btn-skip-gate" ${skipDisabled}>跳过</button></p></section><p>后续 Local Agent 可创建分支、提交和 PR；用户账号负责审查、Approve 和 Merge。</p>`; }
function mainPageHTML() { return `<!doctype html><meta charset="utf-8"><title>DCF GitHub App Bot 初始化</title><style>body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 16px}button{padding:9px 14px;margin:4px;cursor:pointer}.card{border:1px solid #ccc;padding:16px;border-radius:8px}</style><div class="card" id="view"><p>加载中...</p></div><script>
const csrf=${JSON.stringify(html(serverState.pageCsrf))};
function txt(id, s){var e=document.getElementById(id);if(e)e.textContent=s;}
function setViewHTML(html){document.getElementById('view').innerHTML=html;}
function showError(msg){setViewHTML('<h2>错误</h2><p id="err-msg"></p><button onclick="location.reload()">刷新</button>');txt('err-msg',msg);}
function showPending(appSlug,installUrl,hasPending){
  var v=document.getElementById('view');if(!v)return;
  var c=document.createElement('div');
  var t=document.createElement('h2');t.textContent='等待安装验证';c.appendChild(t);
  var p=document.createElement('p');p.innerHTML='App <strong id="pslug"></strong> 已创建。';c.appendChild(p);txt('pslug',appSlug||'');
  if(installUrl){
    try{
      var u=new URL(installUrl);var ep='/apps/'+encodeURIComponent(appSlug||'')+'/installations/new';
      if(u.protocol==='https:'&&u.hostname==='github.com'&&u.pathname===ep){
        var a=document.createElement('a');a.id='install-link';a.href=u.href;a.textContent='打开 GitHub 安装页面';c.appendChild(a);
      }else{var w=document.createElement('p');w.style.color='#d00';w.textContent='安装链接无效';c.appendChild(w);}
    }catch(e){var w2=document.createElement('p');w2.style.color='#d00';w2.textContent='安装链接无效';c.appendChild(w2);}
  }
  var p2=document.createElement('p');p2.innerHTML='请完成安装后<button onclick="retry()">重新验证</button>或<button onclick="cancel()">取消</button>';c.appendChild(p2);
  if(!hasPending){var p3=document.createElement('p');p3.textContent='如已安装但重试验证未发现，可点击上方链接重新安装。';c.appendChild(p3);}
  v.innerHTML='';v.appendChild(c);
}
async function poll(){try{var s=await(await fetch('/api/status')).json();var v=document.getElementById('view');if(s.html){v.innerHTML=s.html;attachGateHandlers();return}
if(s.step==='error'){showError(s.message||'');return}
if(s.step==='creds-exist'||s.step==='pending-install'||s.step==='creds-done'){showPending(s.app_slug,s.install_url,false);return}
if(s.step==='cancelled'){setViewHTML('<p>向导已取消。<button onclick="location.reload()">重新开始</button></p>');return}
setViewHTML('<p>此向导只绑定 127.0.0.1。若名称冲突，请在 GitHub 创建页改为唯一名称。</p><button id="start">创建 DCF Local Agent Bot</button><button onclick="cancel()">取消</button>');document.getElementById('start').onclick=start
}catch(e){showError('状态查询失败。')}}
async function start(){try{var r=await(await fetch('/api/start',{method:'POST',headers:{'X-DCF-Wizard-CSRF':csrf}})).json();if(r.error)throw Error(r.error);if(r.pending_install){showPending(r.app_slug,r.install_url,r.has_pending);return}
var f=document.createElement('form');f.method='POST';f.action=r.github_url;var i=document.createElement('input');i.name='manifest';i.value=r.manifest;f.appendChild(i);document.body.appendChild(f);f.submit()
}catch(e){showError(e.message||'启动失败')}}
function attachGateHandlers(){
  var bc=document.getElementById('btn-configure-gate');if(bc)bc.onclick=configureGate;
  var bs=document.getElementById('btn-skip-gate');if(bs)bs.onclick=skipGate;
}
async function configureGate(){try{var r=await(await fetch('/api/branch-protection',{method:'POST',headers:{'X-DCF-Wizard-CSRF':csrf}})).json();if(r.error)throw Error(r.error);}catch(e){}location.reload()}
async function skipGate(){setViewHTML('<p>已跳过门禁配置。<button onclick="done()">完成</button></p>')}
async function done(){await fetch('/api/done',{method:'POST',headers:{'X-DCF-Wizard-CSRF':csrf}})}
async function retry(){setViewHTML('<p>验证中...</p>');try{var r=await(await fetch('/api/retry-verification',{method:'POST',headers:{'X-DCF-Wizard-CSRF':csrf}})).json();if(r.html){setViewHTML(r.html);attachGateHandlers();return}
showError(r.error||'验证失败')
}catch(e){showError('重试验证失败')}}
async function cancel(){await fetch('/api/cancel',{method:'POST',headers:{'X-DCF-Wizard-CSRF':csrf}});location.reload()}
poll();</script>`; }
function openBrowser(url) { try { const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; return spawn(command, [url], { shell: command === 'start', stdio: 'ignore' }); } catch (_) { return null; } }
async function main() { try { await startServer(); const child = openBrowser(expectedOrigin()); if (!child) throw new Error('无法打开浏览器'); child.once('error', () => { if (serverState.server) serverState.server.close(); }); await new Promise(resolve => serverState.server.once('close', resolve)); } finally { clearSensitiveMemory(); if (serverState.server) serverState.server.close(); } }
function shutdown() { clearSensitiveMemory(); if (serverState.server) serverState.server.close(() => process.exit(0)); else process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
function setGetUserGitHubToken(fn) { getUserGitHubToken = fn; }
module.exports = { OWNER, REPO, REPOSITORY, APP_SUGGESTED_NAME, LOOPBACK, CANDIDATE_REF, REQUIRED_CHECKS, EXPECTED_PERMISSIONS, DANGEROUS_PERMISSIONS, CREDENTIAL_FILENAME, PRIVATE_KEY_FILENAME, CONFIG_FILENAME, PENDING_INSTALL_FILENAME, configDir, secureDirectory, writeSecureFile, atomicWriteSecure, readSecureFile, generateCSRFState, createManifest, generateJWT, httpsRequest, exchangeCode, createInstallationToken, getRepositoryInfo, listInstallationRepositories, getAppWithJwt, getInstallations, getInstallation, getCandidateRef, branchProtectionPayload, saveCredentials, loadCredentials, saveBotConfig, loadBotConfig, savePendingInstall, loadPendingInstall, clearPendingInstall, serverState, startServer, handleRequest, handleStatus, handleCancel, handleSetup, handleRetryVerification, clearSensitiveMemory, isExpired, claimSetupCallback, html, renderCompleteHTML, mainPageHTML, verifyPermissions, main, getUserGitHubToken, setGetUserGitHubToken };
if (require.main === module) main().catch(error => { console.error(`初始化失败：${error.message}`); shutdown(); });
