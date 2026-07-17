'use strict';
(function initHostOpenCode(root) {
  const H = root.DCFHost;
  const C = H.C;
  const CONFIG_KEY = 'dcf.chrome.local-agent.config.v1';
  const SECRET_KEY = 'dcf.chrome.local-agent.secret.v1';
  const OPENCODE_ORIGIN = 'http://127.0.0.1:4096';
  const OPENCODE_PERMISSION = `${OPENCODE_ORIGIN}/*`;
  const DEFAULT_CONFIG = Object.freeze({
    base_url: OPENCODE_ORIGIN,
    username: 'opencode',
    agent: '',
    model: null,
    poll_interval_ms: 1200,
    message_limit: 100
  });
  let memoryPassword = '';

  function trustedSender(sender) {
    const raw = String(sender && (sender.url || sender.tab && sender.tab.url) || '');
    try {
      const origin = new URL(raw).origin;
      return origin === 'https://chatgpt.com' || origin === 'https://chat.openai.com';
    } catch (_) {
      return false;
    }
  }

  function requireTrustedSender(sender) {
    if (!trustedSender(sender)) throw new Error('local_agent_untrusted_sender');
  }

  function normalizeModel(value) {
    if (!value || typeof value !== 'object') return null;
    const providerID = String(value.providerID || '').trim();
    const modelID = String(value.modelID || '').trim();
    return providerID && modelID ? { providerID, modelID } : null;
  }

  function normalizeConfig(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const base = String(value.base_url || OPENCODE_ORIGIN).replace(/\/$/, '');
    if (base !== OPENCODE_ORIGIN) throw new Error('local_agent_origin_is_fixed');
    return {
      base_url: OPENCODE_ORIGIN,
      username: String(value.username || DEFAULT_CONFIG.username).trim().slice(0, 128) || DEFAULT_CONFIG.username,
      agent: String(value.agent || '').trim().slice(0, 128),
      model: normalizeModel(value.model),
      poll_interval_ms: Math.max(500, Math.min(5000, Number(value.poll_interval_ms) || DEFAULT_CONFIG.poll_interval_ms)),
      message_limit: Math.max(20, Math.min(200, Number(value.message_limit) || DEFAULT_CONFIG.message_limit))
    };
  }

  async function configGet() {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    return normalizeConfig({ ...DEFAULT_CONFIG, ...(stored[CONFIG_KEY] || {}) });
  }

  async function configSet(raw) {
    const config = normalizeConfig(raw);
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    return config;
  }

  async function passwordGet() {
    if (chrome.storage.session && typeof chrome.storage.session.get === 'function') {
      const stored = await chrome.storage.session.get(SECRET_KEY);
      return String(stored[SECRET_KEY] || '');
    }
    return memoryPassword;
  }

  async function passwordSet(password) {
    const value = String(password || '');
    memoryPassword = value;
    if (chrome.storage.session && typeof chrome.storage.session.set === 'function') {
      if (value) await chrome.storage.session.set({ [SECRET_KEY]: value });
      else if (typeof chrome.storage.session.remove === 'function') await chrome.storage.session.remove(SECRET_KEY);
    }
  }

  async function hostPermissionGranted() {
    if (!chrome.permissions || typeof chrome.permissions.contains !== 'function') return true;
    return chrome.permissions.contains({ origins: [OPENCODE_PERMISSION] });
  }

  async function requestHostPermission() {
    if (await hostPermissionGranted()) return true;
    if (!chrome.permissions || typeof chrome.permissions.request !== 'function') throw new Error('local_agent_host_permission_api_unavailable');
    return chrome.permissions.request({ origins: [OPENCODE_PERMISSION] });
  }

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  function safeId(value, label) {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error(`${label || 'id'}_invalid`);
    return id;
  }

  async function request(path, options = {}) {
    if (!(await hostPermissionGranted())) throw new Error('local_agent_host_permission_required');
    const config = await configGet();
    const password = await passwordGet();
    if (!password) throw new Error('local_agent_password_required');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, Number(options.timeout) || 15000)));
    try {
      const headers = { Accept: 'application/json', Authorization: basicAuth(config.username, password) };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${OPENCODE_ORIGIN}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        signal: controller.signal
      });
      const text = response.status === 204 ? '' : await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); }
        catch (_) { payload = text; }
      }
      if (!response.ok) {
        const detail = typeof payload === 'string' ? payload : payload && (payload.error || payload.message) || '';
        const error = new Error(`opencode_http_${response.status}${detail ? `:${detail}` : ''}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('opencode_request_timeout');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function optional(path) {
    try { return { ok: true, data: await request(path) }; }
    catch (error) { return { ok: false, error: String(error && error.message || error) }; }
  }

  function messageBody(message, config) {
    const instruction = String(message.instruction || '').trim();
    if (!instruction) throw new Error('local_agent_instruction_required');
    if (instruction.length > 120000) throw new Error('local_agent_instruction_too_large');
    const body = { parts: [{ type: 'text', text: instruction }] };
    const agent = String(message.agent || config.agent || '').trim();
    const model = normalizeModel(message.model || config.model);
    if (agent) body.agent = agent;
    if (model) body.model = model;
    return body;
  }

  async function permissionList() {
    try { return await request('/permission'); }
    catch (error) {
      if (error && (error.status === 404 || error.status === 405)) return request('/permission/');
      throw error;
    }
  }

  async function permissionReply(message) {
    const requestID = safeId(message.request_id, 'permission_id');
    const reply = ['once', 'always', 'reject'].includes(message.reply) ? message.reply : 'reject';
    try {
      return await request(`/permission/${encodeURIComponent(requestID)}/reply`, { method: 'POST', body: { reply } });
    } catch (error) {
      if (!error || (error.status !== 404 && error.status !== 405)) throw error;
      const sessionID = safeId(message.session_id, 'session_id');
      return request(`/session/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(requestID)}`, {
        method: 'POST',
        body: { response: reply === 'reject' ? 'deny' : 'allow', remember: reply === 'always' }
      });
    }
  }

  H.handleLocalAgentMessage = async function handleLocalAgentMessage(message, sender) {
    requireTrustedSender(sender);
    const type = String(message && message.type || '');
    if (type === 'local_agent.config.get') {
      const config = await configGet();
      return { ok: true, config, has_password: Boolean(await passwordGet()), host_permission: await hostPermissionGranted() };
    }
    if (type === 'local_agent.config.set') {
      const config = await configSet(message.config || {});
      if (Object.prototype.hasOwnProperty.call(message, 'password')) await passwordSet(message.password);
      return { ok: true, config, has_password: Boolean(await passwordGet()), host_permission: await hostPermissionGranted() };
    }
    if (type === 'local_agent.password.clear') {
      await passwordSet('');
      return { ok: true };
    }
    if (type === 'local_agent.host_permission.status') return { ok: true, granted: await hostPermissionGranted() };
    if (type === 'local_agent.host_permission.request') return { ok: true, granted: await requestHostPermission() };
    if (type === 'local_agent.health') return { ok: true, health: await request('/global/health') };
    if (type === 'local_agent.catalog') {
      const [health, project, path, vcs, agents, providers] = await Promise.all([
        optional('/global/health'), optional('/project/current'), optional('/path'), optional('/vcs'), optional('/agent'), optional('/config/providers')
      ]);
      return { ok: true, health, project, path, vcs, agents, providers };
    }
    if (type === 'local_agent.sessions.list') return { ok: true, sessions: await request('/session') };
    if (type === 'local_agent.session.create') {
      const title = String(message.title || '').trim().slice(0, 240);
      return { ok: true, session: await request('/session', { method: 'POST', body: title ? { title } : {} }) };
    }
    const sessionType = type.startsWith('local_agent.session.');
    const sessionID = sessionType || type === 'local_agent.permission.reply' ? safeId(message.session_id, 'session_id') : null;
    if (type === 'local_agent.session.get') return { ok: true, session: await request(`/session/${encodeURIComponent(sessionID)}`) };
    if (type === 'local_agent.session.delete') return { ok: true, deleted: await request(`/session/${encodeURIComponent(sessionID)}`, { method: 'DELETE' }) };
    if (type === 'local_agent.session.rename') return { ok: true, session: await request(`/session/${encodeURIComponent(sessionID)}`, { method: 'PATCH', body: { title: String(message.title || '').trim().slice(0, 240) } }) };
    if (type === 'local_agent.session.fork') {
      const body = message.message_id ? { messageID: safeId(message.message_id, 'message_id') } : {};
      return { ok: true, session: await request(`/session/${encodeURIComponent(sessionID)}/fork`, { method: 'POST', body }) };
    }
    if (type === 'local_agent.session.status') {
      const statuses = await request('/session/status');
      return { ok: true, status: statuses && statuses[sessionID] || null, statuses };
    }
    if (type === 'local_agent.session.messages') {
      const config = await configGet();
      const limit = Math.max(1, Math.min(200, Number(message.limit) || config.message_limit));
      return { ok: true, messages: await request(`/session/${encodeURIComponent(sessionID)}/message?limit=${limit}`) };
    }
    if (type === 'local_agent.session.todo') return { ok: true, todo: await request(`/session/${encodeURIComponent(sessionID)}/todo`) };
    if (type === 'local_agent.session.diff') return { ok: true, diff: await request(`/session/${encodeURIComponent(sessionID)}/diff`) };
    if (type === 'local_agent.session.prompt') {
      const config = await configGet();
      await request(`/session/${encodeURIComponent(sessionID)}/prompt_async`, { method: 'POST', body: messageBody(message, config), timeout: 30000 });
      return { ok: true, accepted: true };
    }
    if (type === 'local_agent.session.abort') return { ok: true, aborted: await request(`/session/${encodeURIComponent(sessionID)}/abort`, { method: 'POST', body: {} }) };
    if (type === 'local_agent.permissions.list') return { ok: true, permissions: await permissionList() };
    if (type === 'local_agent.permission.reply') return { ok: true, result: await permissionReply(message) };
    if (type === 'local_agent.questions.list') return { ok: true, questions: await request('/question/') };
    if (type === 'local_agent.question.reply') {
      const requestID = safeId(message.request_id, 'question_id');
      const answers = Array.isArray(message.answers) ? message.answers.map((value) => String(value)) : [String(message.answer || '')];
      return { ok: true, result: await request(`/question/${encodeURIComponent(requestID)}/reply`, { method: 'POST', body: { answers } }) };
    }
    if (type === 'local_agent.question.reject') {
      const requestID = safeId(message.request_id, 'question_id');
      return { ok: true, result: await request(`/question/${encodeURIComponent(requestID)}/reject`, { method: 'POST', body: {} }) };
    }
    if (type === 'local_agent.diagnostics') {
      const config = await configGet();
      return {
        ok: true,
        report: {
          schema: 'dcf.local-agent.diagnostic.v1',
          generated_at: C.nowIso(),
          host_version: C.HOST_VERSION,
          config,
          has_password: Boolean(await passwordGet()),
          host_permission: await hostPermissionGranted(),
          health: await optional('/global/health'),
          project: await optional('/project/current'),
          path: await optional('/path'),
          vcs: await optional('/vcs')
        }
      };
    }
    throw new Error(`unsupported local agent message ${type}`);
  };

  H.localAgent = {
    CONFIG_KEY,
    SECRET_KEY,
    OPENCODE_ORIGIN,
    OPENCODE_PERMISSION,
    normalizeConfig,
    safeId,
    configGet,
    configSet,
    passwordGet,
    passwordSet,
    hostPermissionGranted,
    requestHostPermission,
    request
  };
})(self);
