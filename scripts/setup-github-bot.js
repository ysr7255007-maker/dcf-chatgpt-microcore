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
const CANDIDATE_REF = 'refs/heads/rebuild/chrome-native-host-v2';
const REQUIRED_CHECKS = ['verify', 'verify-and-package'];
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
  // Existing system ancestors (for example macOS /var -> /private/var) are
  // allowed; the credential directory and every credential target are not.
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
  if (fs.existsSync(filePath)) throw new Error('正式凭据已存在，拒绝覆盖');
  const temporary = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(16).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    fs.chmodSync(temporary, 0o600);
    if (fs.lstatSync(temporary).isSymbolicLink()) throw new Error('拒绝符号链接临时文件');
    fs.renameSync(temporary, filePath);
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
function loadJson(file) { try { return fs.existsSync(file) ? JSON.parse(readSecureFile(file)) : null; } catch { return null; } }
function loadCredentials() { return loadJson(existingCredentialsPath()); }
function loadBotConfig() { return loadJson(existingConfigPath()); }
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
  if (prior) { // idempotent same-installation update: replace only after a private temp transaction.
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
const getAuthenticatedApp = token => httpsRequest('GET', 'https://api.github.com/app', null, auth(token)).then(r => r.body);
const getCandidateRef = token => httpsRequest('GET', `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/rebuild/chrome-native-host-v2`, null, auth(token)).then(r => r.body);
function branchProtectionPayload() { return { required_status_checks: { strict: true, contexts: REQUIRED_CHECKS }, required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_last_push_approval: true, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } }, enforce_admins: true, required_conversation_resolution: true, restrictions: null, allow_force_pushes: false, allow_deletions: false }; }
const setBranchProtection = (token, rules) => httpsRequest('PUT', `https://api.github.com/repos/${OWNER}/${REPO}/branches/rebuild%2Fchrome-native-host-v2/protection`, rules, auth(token)).then(r => r.body);

const serverState = { manifestState: null, manifestStateUsed: false, setupState: null, setupStateUsed: false, pageCsrf: null, expiresAt: null, server: null, port: null, currentStep: 'intro', error: null, branchGate: 'not-configured' };
function clearSensitiveMemory() { serverState.manifestState = null; serverState.setupState = null; serverState.pageCsrf = null; serverState.expiresAt = null; }
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
  const table = { '/': [['GET'], false, () => serveHTML(res, 200, mainPageHTML())], '/callback': [['GET'], false, () => handleCallback(res, url)], '/setup': [['GET'], false, () => handleSetup(res, url)], '/api/status': [['GET'], false, () => handleStatus(res)], '/api/complete': [['GET'], false, () => handleComplete(res)], '/api/start': [['POST'], true, () => handleStart(res)], '/api/cancel': [['POST'], true, () => handleCancel(res)], '/api/branch-protection-status': [['GET'], false, () => handleBranchProtectionStatus(res)], '/api/branch-protection': [['POST'], true, () => handleBranchProtection(res)] };
  const item = table[route]; if (!item) return reject(res, 404, 'not found'); if (!validateRequest(req, res, item[0], item[1])) return; return item[2]();
}
function handleStart(res) { if (loadCredentials()) return reject(res, 409, '检测到已有 Bot 凭据；请选择继续、重新创建或取消。'); resetState(); serverState.manifestState = generateCSRFState(); serverState.setupState = generateCSRFState(); serverState.pageCsrf = serverState.pageCsrf || generateCSRFState(); serverState.expiresAt = Date.now() + 3600000; serverState.currentStep = 'started'; return serveJSON(res, 200, { github_url: `https://github.com/settings/apps/new?state=${serverState.manifestState}`, manifest: JSON.stringify(createManifest(serverState.port, serverState.setupState)) }); }
function handleCancel(res) { clearSensitiveMemory(); serverState.currentStep = 'cancelled'; serveJSON(res, 200, { status: 'cancelled' }); }
function handleStatus(res) { const creds = loadCredentials(); const config = loadBotConfig(); if (config && creds) return serveJSON(res, 200, { step: 'complete', html: renderCompleteHTML(config, creds), branch_gate: serverState.branchGate }); if (serverState.currentStep === 'error') return serveJSON(res, 200, { step: 'error', message: serverState.error }); if (creds) return serveJSON(res, 200, { step: 'creds-exist', app_slug: creds.app_slug, app_id: creds.app_id }); serveJSON(res, 200, { step: serverState.currentStep }); }
function handleComplete(res) { const c = loadCredentials(), b = loadBotConfig(); if (!c || !b) return reject(res, 400, '凭据或配置不完整'); serveJSON(res, 200, { html: renderCompleteHTML(b, c) }); }
async function getUserGitHubToken() { const status = await new Promise(resolve => { const c = spawn('gh', ['auth', 'status'], { stdio: 'ignore' }); c.on('close', code => resolve(code === 0)); c.on('error', () => resolve(false)); }); if (!status) return null; return new Promise(resolve => { const c = spawn('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }); let out = ''; c.stdout.on('data', d => out += d); c.on('close', code => resolve(code === 0 ? out.trim() : null)); c.on('error', () => resolve(null)); }); }
async function handleBranchProtectionStatus(res) { serveJSON(res, 200, { available: !!await getUserGitHubToken(), branch: CANDIDATE_REF, required_checks: REQUIRED_CHECKS }); }
async function handleBranchProtection(res) { try { const token = await getUserGitHubToken(); if (!token) return reject(res, 400, 'GitHub 管理身份不可用；请运行 gh auth login。Bot 安装不受影响。'); await setBranchProtection(token, branchProtectionPayload()); serverState.branchGate = 'configured'; serveJSON(res, 200, { status: 'applied', required_checks: REQUIRED_CHECKS }); } catch (e) { serverState.branchGate = 'unavailable'; serveJSON(res, 422, { error: `无法配置分支门禁（可能是套餐、权限或 API 限制）：${e.message}` }); } }
async function handleCallback(res, url) { const code = url.searchParams.get('code'), state = url.searchParams.get('state'); if (!code || isExpired() || !sameSecret(state, serverState.manifestState) || serverState.manifestStateUsed) { serverState.currentStep = 'error'; serverState.error = '创建回调无效、过期或已使用；请重新开始。'; return serveHTML(res, 403, redirectHome()); } serverState.manifestStateUsed = true; try { const data = await exchangeCode(code); const pem = data.pem; if (!pem || !data.id || !data.slug) throw new Error('GitHub 返回的 App 凭据不完整'); delete data.pem; saveCredentials(data, pem); data.client_secret = data.webhook_secret = undefined; serverState.currentStep = 'creds-done'; serveHTML(res, 200, redirectInstall(loadCredentials().app_slug)); } catch (e) { serverState.currentStep = 'error'; serverState.error = `凭据兑换失败：${e.message}。如已创建 App，请删除该 App 后重新开始。`; serveHTML(res, 500, redirectHome()); } }
async function handleSetup(res, url) {
  const id = Number(url.searchParams.get('installation_id')); const claim = claimSetupCallback(id, url.searchParams.get('state'));
  if (claim === 'complete') return serveHTML(res, 200, redirectHome());
  if (claim !== 'claimed') { serverState.currentStep = 'error'; serverState.error = '安装回调无效、过期或已使用；请重新运行向导检查状态。'; return serveHTML(res, 403, redirectHome()); }
  try { const creds = loadCredentials(); if (!creds) throw new Error('凭据不存在'); const jwt = generateJWT(creds.app_id, readSecureFile(creds.private_key_path)); const tokenData = await createInstallationToken(jwt, id); const token = tokenData.token; if (!token) throw new Error('GitHub 未返回 installation token'); const [repo, scope, app, ref] = await Promise.all([getRepositoryInfo(token), listInstallationRepositories(token), getAuthenticatedApp(token), getCandidateRef(token)]); if (repo.full_name !== REPOSITORY || repo.owner?.login !== OWNER) throw new Error('目标仓库或账号不匹配'); const accessible = scope.repositories || []; if (accessible.length !== 1 || accessible[0].full_name !== REPOSITORY) throw new Error('installation token 范围不是唯一目标仓库'); if (Number(app.id) !== Number(creds.app_id)) throw new Error('installation 不属于当前 App'); if (ref.ref !== CANDIDATE_REF || !ref.object?.sha) throw new Error('候选分支 ref 不匹配'); const p = tokenData.permissions || {}; const ok = p.contents === 'write' && p.pull_requests === 'write'; saveBotConfig({ schema: 'dcf.github-app-bot.config.v1', app_id: creds.app_id, app_slug: creds.app_slug, installation_id: id, repository: REPOSITORY, private_key_path: creds.private_key_path, created_at: creds.created_at, permission_verification: { contents: p.contents, pull_requests: p.pull_requests, actions: p.actions, checks: p.checks, statuses: p.statuses, all_verified: ok, token_repository_scope: REPOSITORY, app_installation_range_note: 'Installation may include more repositories; this verification token is restricted to DCF only.', candidate_ref: CANDIDATE_REF, candidate_sha: ref.object.sha } }); tokenData.token = undefined; clearSensitiveMemory(); serverState.currentStep = ok ? 'complete' : 'complete-warn'; serveHTML(res, 200, redirectHome()); } catch (e) { serverState.currentStep = 'error'; serverState.error = `安装验证失败：${e.message}。凭据未被替换；修正安装范围后重新运行向导。`; serveHTML(res, 500, redirectHome()); }
}
function redirectHome() { return '<!doctype html><meta http-equiv="refresh" content="0;url=/">'; }
function redirectInstall(slug) { const target = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`; return `<!doctype html><p>请选择 Only select repositories → ${html(REPOSITORY)}。</p><script>location.replace(${JSON.stringify(target)})</script>`; }
function renderCompleteHTML(config, creds) { const p = config.permission_verification || {}; const row = (k, v) => `<li><code>${html(k)}</code>: ${html(v || 'missing')}</li>`; return `<p><strong>Bot：</strong>${html(config.app_slug || creds.app_slug)}</p><p>App ID：${html(config.app_id)}；Installation ID：${html(config.installation_id)}</p><p>仓库：<code>${html(config.repository)}</code></p><p>本地凭据目录：<code>${html(configDir())}</code></p><p><strong>App 安装：</strong>成功；<strong>权限验证：</strong>${p.all_verified ? '成功' : '需检查'}；<strong>分支门禁：</strong>${html(serverState.branchGate)}</p><ul>${row('contents', p.contents)}${row('pull_requests', p.pull_requests)}${row('candidate ref', p.candidate_ref)}</ul><p>后续 Local Agent 可创建分支、提交和 PR；用户账号负责审查、Approve 和 Merge。</p>`; }
function mainPageHTML() { const csrf = html(serverState.pageCsrf); return `<!doctype html><meta charset="utf-8"><title>DCF GitHub App Bot 初始化</title><style>body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 16px}button{padding:9px 14px;margin:4px}.card{border:1px solid #ccc;padding:16px;border-radius:8px}</style><h1>DCF GitHub App Bot 初始化</h1><div class="card" id="view"><p>此向导只绑定 127.0.0.1。若名称冲突，请在 GitHub 创建页改为唯一名称。</p><button id="start">创建 DCF Local Agent Bot</button><button id="cancel">取消</button></div><form id="form" method="POST" style="display:none"><input name="manifest" id="manifest"></form><script>const csrf=${JSON.stringify(csrf)};const api=(p,m='GET')=>fetch(p,{method:m,headers:m==='POST'?{'X-DCF-Wizard-CSRF':csrf}:{}}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error);return b});document.querySelector('#start').onclick=async()=>{try{let r=await api('/api/start','POST');document.querySelector('#form').action=r.github_url;document.querySelector('#manifest').value=r.manifest;document.querySelector('#form').submit()}catch(e){document.querySelector('#view').textContent=e.message}};document.querySelector('#cancel').onclick=()=>api('/api/cancel','POST').then(()=>location.reload());</script>`; }
function openBrowser(url) { try { const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; return spawn(command, [url], { shell: command === 'start', stdio: 'ignore' }); } catch (_) { return null; } }
async function main() { try { await startServer(); const child = openBrowser(expectedOrigin()); if (!child) throw new Error('无法打开浏览器'); child.once('error', () => { if (serverState.server) serverState.server.close(); }); await new Promise(resolve => serverState.server.once('close', resolve)); } finally { clearSensitiveMemory(); if (serverState.server) serverState.server.close(); } }
function shutdown() { clearSensitiveMemory(); if (serverState.server) serverState.server.close(() => process.exit(0)); else process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
module.exports = { OWNER, REPO, REPOSITORY, APP_SUGGESTED_NAME, LOOPBACK, CANDIDATE_REF, REQUIRED_CHECKS, CREDENTIAL_FILENAME, PRIVATE_KEY_FILENAME, CONFIG_FILENAME, configDir, secureDirectory, writeSecureFile, atomicWriteSecure, readSecureFile, generateCSRFState, createManifest, generateJWT, httpsRequest, exchangeCode, createInstallationToken, getRepositoryInfo, listInstallationRepositories, getAuthenticatedApp, getCandidateRef, branchProtectionPayload, saveCredentials, loadCredentials, saveBotConfig, loadBotConfig, serverState, startServer, handleRequest, clearSensitiveMemory, isExpired, claimSetupCallback, html, renderCompleteHTML, main };
if (require.main === module) main().catch(error => { console.error(`初始化失败：${error.message}`); shutdown(); });
