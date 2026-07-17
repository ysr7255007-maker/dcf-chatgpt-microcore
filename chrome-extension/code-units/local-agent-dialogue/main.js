(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.local-agent-dialogue';
  const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.1';
  const LOCAL_AGENT_ID = 'dcf.firstparty.local-agent';
  const LOCAL_AGENT_PANEL_ID = 'dcf-panel-local-agent';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__';
  const REQUEST_START = '<<<DCF_LOCAL_AGENT_REQUEST>>>';
  const REQUEST_END = '<<<END_DCF_LOCAL_AGENT_REQUEST>>>';
  const RESULT_START = '<<<DCF_LOCAL_AGENT_RESULT>>>';
  const RESULT_END = '<<<END_DCF_LOCAL_AGENT_RESULT>>>';
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    auto_send_results: true,
    poll_interval_ms: 1200,
    timeout_ms: 20 * 60 * 1000,
    message_limit: 120
  });

  const previous = globalThis[GLOBAL_KEY];
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  const hostSend = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request');
    return result;
  });

  let destroyed = false;
  let rootObserver = null;
  let assistantObserver = null;
  let panelObserver = null;
  let panelRetryTimer = null;
  let scanTimer = null;
  let currentJob = null;
  let processingQueue = false;
  let pendingResult = null;
  const seenNodes = new WeakSet();
  const queue = [];

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    processed_ids: [],
    status: '等待请求',
    last_error: '',
    last_request_id: '',
    last_session_id: ''
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function safeJson(value) {
    try { return JSON.stringify(value, null, 2); }
    catch (_) { return String(value); }
  }

  function hashText(text) {
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function normalizeSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: value.enabled !== false,
      auto_send_results: value.auto_send_results !== false,
      poll_interval_ms: Math.max(500, Math.min(5000, Number(value.poll_interval_ms) || DEFAULT_SETTINGS.poll_interval_ms)),
      timeout_ms: Math.max(30000, Math.min(60 * 60 * 1000, Number(value.timeout_ms) || DEFAULT_SETTINGS.timeout_ms)),
      message_limit: Math.max(20, Math.min(200, Number(value.message_limit) || DEFAULT_SETTINGS.message_limit))
    };
  }

  async function persist() {
    await hostSend({
      type: 'plugin.data.set',
      plugin_id: UNIT_ID,
      data: {
        settings: state.settings,
        processed_ids: state.processed_ids.slice(-80),
        last_request_id: state.last_request_id,
        last_session_id: state.last_session_id
      }
    });
  }

  async function loadState() {
    const result = await hostSend({ type: 'plugin.data.get', plugin_id: UNIT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    state.settings = normalizeSettings(data.settings || {});
    state.processed_ids = Array.isArray(data.processed_ids) ? data.processed_ids.map(String).slice(-80) : [];
    state.last_request_id = String(data.last_request_id || '');
    state.last_session_id = String(data.last_session_id || '');
  }

  function localAgentPanel() {
    return document.getElementById(LOCAL_AGENT_PANEL_ID);
  }

  function panelShadow() {
    return localAgentPanel() && localAgentPanel().shadowRoot || null;
  }

  async function localAgentConfig() {
    const result = await hostSend({ type: 'plugin.data.get', plugin_id: LOCAL_AGENT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const config = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = panelShadow();
    const baseField = shadow && shadow.querySelector('[data-field="base-url"]');
    const usernameField = shadow && shadow.querySelector('[data-field="username"]');
    const passwordField = shadow && shadow.querySelector('[data-field="password"]');
    return {
      base_url: String(baseField && baseField.value || config.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(usernameField && usernameField.value || config.username || 'opencode').trim() || 'opencode',
      password: String(passwordField && passwordField.value || ''),
      agent: String(config.agent || ''),
      model: config.model && typeof config.model === 'object' ? config.model : null
    };
  }

  function normalizeBaseUrl(raw) {
    const candidate = String(raw || 'http://127.0.0.1:4096').trim().replace(/\/$/, '');
    let url;
    try { url = new URL(candidate); }
    catch (_) { throw new Error('OpenCode 地址无效'); }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!loopback || !['http:', 'https:'].includes(url.protocol)) throw new Error('对话闭环只允许连接本机 loopback 地址');
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) throw new Error('OpenCode 地址只能包含协议、主机与端口');
    const port = url.port || '4096';
    const host = url.hostname === '[::1]' ? '[::1]' : url.hostname;
    return `${url.protocol}//${host}:${port}`;
  }

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  function classifyConnectionError(error, path) {
    const raw = String(error && error.message || error);
    if (error && error.name === 'AbortError') {
      return {
        code: 'timeout',
        message: `OpenCode 请求超时：${path}`,
        raw
      };
    }
    if (/401|403|Unauthorized|Forbidden/i.test(raw)) {
      return {
        code: 'auth',
        message: 'OpenCode 服务已响应，但认证未通过。请检查用户名和本页密码，或确认 4096 服务是否为无认证模式。',
        raw
      };
    }
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(raw)) {
      return {
        code: 'network_or_cors',
        message: `浏览器无法读取 OpenCode 响应。服务可能未启动，也可能缺少 ${location.origin} 的 CORS 允许；若 4096 被旧进程占用，请先重启 serve.sh。`,
        raw
      };
    }
    return {
      code: 'request_failed',
      message: raw,
      raw
    };
  }

  async function apiRequest(path, options = {}) {
    const config = options.config || await localAgentConfig();
    const base = normalizeBaseUrl(config.base_url);
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Math.min(60000, Number(options.timeout) || 15000));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (config.password) headers.Authorization = basicAuth(config.username, config.password);
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        signal: controller.signal
      });
      const text = response.status === 204 ? '' : await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); }
        catch (_) { payload = text; }
      }
      if (!response.ok) {
        const detail = typeof payload === 'string'
          ? payload
          : payload && (payload.error || payload.message) || '';
        const error = new Error(`OpenCode HTTP ${response.status}${detail ? `：${detail}` : ''}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      const classified = classifyConnectionError(error, path);
      const wrapped = new Error(classified.message);
      wrapped.code = classified.code;
      wrapped.raw = classified.raw;
      wrapped.path = path;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  function sessionId(value) {
    return String(value && (value.id || value.sessionID || value.session_id) || '');
  }

  function statusType(value) {
    if (!value) return 'unknown';
    if (typeof value === 'string') return value.toLowerCase();
    return String(value.type || value.status || value.state || 'unknown').toLowerCase();
  }

  function messageRole(record) {
    const info = record && record.info || {};
    return String(info.role || info.type || '').toLowerCase();
  }

  function partText(part) {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text' || part.type === 'reasoning') return String(part.text || '');
    if (part.type === 'tool') {
      const name = String(part.tool || part.name || 'tool');
      const status = statusType(part.state);
      const title = part.state && (part.state.title || part.state.error) || '';
      return `[${name} · ${status}${title ? ` · ${title}` : ''}]`;
    }
    if (part.type === 'step-finish' && part.reason) return `[步骤结束 · ${part.reason}]`;
    if (part.type === 'patch' && part.hash) return `[补丁 · ${part.hash}]`;
    return '';
  }

  function messageText(record) {
    return normalizeList(record && record.parts).map(partText).filter(Boolean).join('\n').trim();
  }

  function latestAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messageRole(messages[index]).includes('assistant')) {
        const text = messageText(messages[index]);
        if (text) return text;
      }
    }
    return '';
  }

  function parseRequest(text) {
    const value = String(text || '').trim();
    if (!value.startsWith(REQUEST_START) || !value.endsWith(REQUEST_END)) return null;
    const body = value.slice(REQUEST_START.length, value.length - REQUEST_END.length).trim();
    let payload;
    try { payload = JSON.parse(body); }
    catch (_) { throw new Error('DCF_LOCAL_AGENT_REQUEST 不是有效 JSON'); }
    if (!payload || payload.schema !== 'dcf.local-agent.request.v1') throw new Error('DCF_LOCAL_AGENT_REQUEST schema 无效');
    const id = String(payload.id || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('DCF_LOCAL_AGENT_REQUEST id 无效');
    const task = String(payload.task || '').trim();
    if (!task || task.length > 30000) throw new Error('DCF_LOCAL_AGENT_REQUEST task 无效');
    const mode = String(payload.mode || 'new');
    if (mode !== 'new') throw new Error('闭环 v1 只允许新建独立 OpenCode 会话');
    return {
      schema: payload.schema,
      id,
      task,
      title: String(payload.title || `DCF · ${task.slice(0, 56)}`).slice(0, 240),
      return_mode: ['summary', 'full'].includes(payload.return_mode) ? payload.return_mode : 'summary',
      timeout_ms: Math.max(30000, Math.min(60 * 60 * 1000, Number(payload.timeout_ms) || state.settings.timeout_ms))
    };
  }

  function assistantMessages(root = document) {
    return Array.from(root.querySelectorAll?.('[data-message-author-role="assistant"]') || []);
  }

  function enqueueRequest(request) {
    if (!request || state.processed_ids.includes(request.id) || queue.some((item) => item.id === request.id) || currentJob && currentJob.request.id === request.id) return;
    queue.push(request);
    state.status = `已接收请求 ${request.id}`;
    renderBridgeCard();
    processQueue().catch((error) => failCurrentJob(error));
  }

  async function inspectAssistantNode(node) {
    if (!state.settings.enabled || !(node instanceof Element) || seenNodes.has(node)) return;
    seenNodes.add(node);
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (!node.isConnected) return;
    const text = String(node.innerText || node.textContent || '').trim();
    let request;
    try { request = parseRequest(text); }
    catch (error) {
      state.last_error = String(error && error.message || error);
      state.status = '发现无效的委派工件';
      renderBridgeCard();
      return;
    }
    if (request) enqueueRequest(request);
  }

  function scanAssistantMessages(root = document) {
    for (const node of assistantMessages(root).slice(-8)) inspectAssistantNode(node).catch(() => {});
  }

  function attachAssistantObserver() {
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!main) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(attachAssistantObserver, 900);
      return;
    }
    assistantObserver?.disconnect();
    assistantObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('[data-message-author-role="assistant"]')) inspectAssistantNode(node).catch(() => {});
          for (const child of node.querySelectorAll?.('[data-message-author-role="assistant"]') || []) inspectAssistantNode(child).catch(() => {});
        }
      }
    });
    assistantObserver.observe(main, { childList: true, subtree: true });
    scanAssistantMessages(main);
  }

  async function createSession(config, title) {
    const session = await apiRequest('/session', {
      config,
      method: 'POST',
      body: { title }
    });
    const id = sessionId(session);
    if (!id) throw new Error('OpenCode 未返回 session ID');
    return id;
  }

  async function optionalRequest(path, config) {
    try { return { ok: true, data: await apiRequest(path, { config }) }; }
    catch (error) { return { ok: false, error: String(error && error.message || error) }; }
  }

  async function pollJob(job) {
    const config = job.config;
    const id = job.session_id;
    const encoded = encodeURIComponent(id);
    const started = Date.now();
    let lastText = '';
    let stableSince = 0;
    let observedRunning = false;
    while (!destroyed && currentJob === job) {
      const [statuses, messagesResult, todoResult, diffResult, permissionsResult, questionsResult] = await Promise.all([
        optionalRequest('/session/status', config),
        optionalRequest(`/session/${encoded}/message?limit=${state.settings.message_limit}`, config),
        optionalRequest(`/session/${encoded}/todo`, config),
        optionalRequest(`/session/${encoded}/diff`, config),
        optionalRequest('/permission/', config),
        optionalRequest('/question/', config)
      ]);
      const statusesData = statuses.ok ? statuses.data : null;
      const sessionStatus = statusesData && (statusesData[id] || normalizeList(statusesData).find((item) => String(item && (item.sessionID || item.session_id || item.id) || '') === id)) || null;
      const type = statusType(sessionStatus);
      if (!['idle', 'completed', 'failed', 'error', 'unknown'].includes(type)) observedRunning = true;
      const messages = messagesResult.ok ? normalizeList(messagesResult.data) : [];
      const text = latestAssistantText(messages);
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      }
      const permissions = permissionsResult.ok ? normalizeList(permissionsResult.data).filter((item) => {
        const session = String(item && (item.sessionID || item.session_id || item.sessionId) || '');
        return !session || session === id;
      }) : [];
      const questions = questionsResult.ok ? normalizeList(questionsResult.data).filter((item) => {
        const session = String(item && (item.sessionID || item.session_id || item.sessionId) || '');
        return !session || session === id;
      }) : [];
      job.snapshot = {
        status: sessionStatus,
        status_type: type,
        messages,
        todo: todoResult.ok ? normalizeList(todoResult.data) : [],
        diff: diffResult.ok ? normalizeList(diffResult.data) : [],
        permissions,
        questions,
        endpoint_errors: {
          status: statuses.ok ? null : statuses.error,
          messages: messagesResult.ok ? null : messagesResult.error,
          todo: todoResult.ok ? null : todoResult.error,
          diff: diffResult.ok ? null : diffResult.error,
          permissions: permissionsResult.ok ? null : permissionsResult.error,
          questions: questionsResult.ok ? null : questionsResult.error
        }
      };
      state.status = `本机执行中 · ${type}`;
      renderBridgeCard();

      if (permissions.length || questions.length) {
        return {
          status: 'needs_user',
          text: lastText,
          elapsed_ms: Date.now() - started,
          ...job.snapshot
        };
      }

      const terminal = ['idle', 'completed', 'failed', 'error', 'cancelled', 'canceled'].includes(type);
      const textStable = Boolean(lastText) && stableSince && Date.now() - stableSince >= 1600;
      if (terminal && textStable && (observedRunning || Date.now() - started >= 2500)) {
        return {
          status: ['failed', 'error', 'cancelled', 'canceled'].includes(type) ? 'failed' : 'completed',
          text: lastText,
          elapsed_ms: Date.now() - started,
          ...job.snapshot
        };
      }

      if (Date.now() - started >= job.request.timeout_ms) {
        return {
          status: 'timeout',
          text: lastText,
          elapsed_ms: Date.now() - started,
          ...job.snapshot
        };
      }
      await new Promise((resolve) => setTimeout(resolve, state.settings.poll_interval_ms));
    }
    throw new Error('对话闭环已停止');
  }

  function resultPayload(job, outcome) {
    const full = job.request.return_mode === 'full';
    return {
      schema: 'dcf.local-agent.result.v1',
      request_id: job.request.id,
      status: outcome.status,
      session_id: job.session_id,
      assistant_result: outcome.text || '',
      todo: outcome.todo || [],
      diff: outcome.diff || [],
      permissions: outcome.permissions || [],
      questions: outcome.questions || [],
      messages: full ? outcome.messages || [] : undefined,
      execution: {
        elapsed_ms: outcome.elapsed_ms,
        status_type: outcome.status_type || 'unknown',
        base_url: normalizeBaseUrl(job.config.base_url),
        endpoint_errors: outcome.endpoint_errors || {}
      }
    };
  }

  function resultArtifact(payload) {
    return `${RESULT_START}\n${safeJson(payload)}\n${RESULT_END}`;
  }

  function composer() {
    return document.querySelector('#prompt-textarea')
      || document.querySelector('[data-testid="composer-text-input"]')
      || document.querySelector('form textarea')
      || document.querySelector('main [contenteditable="true"]');
  }

  function composerText(target) {
    return target && String('value' in target ? target.value || '' : target.innerText || target.textContent || '');
  }

  function dispatchInput(target, text) {
    try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
    catch (_) { target.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function setComposerExact(text) {
    const target = composer();
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    if (composerText(target).trim()) throw new Error('输入框中已有未发送内容，闭环结果暂未覆盖');
    target.focus();
    if ('value' in target) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
      if (descriptor && descriptor.set) descriptor.set.call(target, text); else target.value = text;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(text.length, text.length);
      dispatchInput(target, text);
      return;
    }
    const selection = getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!document.execCommand?.('insertText', false, text)) target.textContent = text;
    dispatchInput(target, text);
  }

  function sendButton() {
    return document.querySelector('[data-testid="send-button"]')
      || document.querySelector('button[aria-label*="Send"]')
      || document.querySelector('button[aria-label*="发送"]');
  }

  async function clickSend() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const button = sendButton();
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('闭环结果已写入输入框，但发送按钮暂不可用');
  }

  async function returnResult(payload) {
    const artifact = resultArtifact(payload);
    pendingResult = artifact;
    const started = Date.now();
    while (!destroyed && pendingResult === artifact && Date.now() - started < 60000) {
      const target = composer();
      if (target && !composerText(target).trim()) {
        setComposerExact(artifact);
        if (state.settings.auto_send_results) await clickSend();
        pendingResult = null;
        state.status = state.settings.auto_send_results ? '结果已自动回传' : '结果已填入输入框';
        state.last_error = '';
        renderBridgeCard();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    state.status = '结果等待回传';
    state.last_error = '输入框持续有未发送内容，未自动覆盖';
    renderBridgeCard();
  }

  async function runRequest(request) {
    const config = await localAgentConfig();
    await apiRequest('/global/health', { config, timeout: 8000 });
    const session_id = await createSession(config, request.title);
    const body = { parts: [{ type: 'text', text: request.task }] };
    if (config.agent) body.agent = config.agent;
    if (config.model) body.model = config.model;
    await apiRequest(`/session/${encodeURIComponent(session_id)}/prompt_async`, {
      config,
      method: 'POST',
      body,
      timeout: 30000
    });
    const job = {
      request,
      config,
      session_id,
      started_at: new Date().toISOString(),
      snapshot: null
    };
    currentJob = job;
    state.last_request_id = request.id;
    state.last_session_id = session_id;
    state.processed_ids = [...state.processed_ids.filter((id) => id !== request.id), request.id].slice(-80);
    state.status = `已委派 ${request.id}`;
    state.last_error = '';
    await persist();
    renderBridgeCard();
    const outcome = await pollJob(job);
    await focusLocalAgentSession(session_id);
    await returnResult(resultPayload(job, outcome));
  }

  async function failCurrentJob(error, request) {
    const active = currentJob;
    const targetRequest = request || active && active.request || queue[0] || null;
    const payload = {
      schema: 'dcf.local-agent.result.v1',
      request_id: targetRequest && targetRequest.id || 'unknown',
      status: 'bridge_error',
      session_id: active && active.session_id || '',
      assistant_result: '',
      todo: [],
      diff: [],
      permissions: [],
      questions: [],
      execution: {
        elapsed_ms: active ? Date.now() - Date.parse(active.started_at) : 0,
        status_type: 'bridge_error',
        base_url: active && normalizeBaseUrl(active.config.base_url) || '',
        endpoint_errors: {
          bridge: String(error && error.message || error),
          code: error && error.code || '',
          raw: error && error.raw || ''
        }
      }
    };
    state.last_error = String(error && error.message || error);
    state.status = '委派失败，正在回传';
    renderBridgeCard();
    try { await returnResult(payload); } catch (_) {}
  }

  async function processQueue() {
    if (processingQueue || currentJob || !state.settings.enabled || !queue.length) return;
    processingQueue = true;
    const request = queue.shift();
    state.processed_ids = [...state.processed_ids.filter((id) => id !== request.id), request.id].slice(-80);
    state.last_request_id = request.id;
    await persist();
    try {
      await runRequest(request);
    } catch (error) {
      await failCurrentJob(error, request);
    } finally {
      currentJob = null;
      processingQueue = false;
      persist().catch(() => {});
      renderBridgeCard();
      if (queue.length) processQueue().catch(() => {});
    }
  }

  async function focusLocalAgentSession(id) {
    try {
      const shadow = panelShadow();
      if (!shadow) return;
      const refresh = shadow.querySelector('[data-action="refresh-all"]');
      if (refresh) refresh.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const nextShadow = panelShadow();
      const session = nextShadow && nextShadow.querySelector('[data-field="session"]');
      if (session && Array.from(session.options || []).some((option) => option.value === id)) {
        session.value = id;
        session.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (_) {}
  }

  function bridgeCardHtml() {
    const enabled = state.settings.enabled;
    const busy = Boolean(currentJob);
    const statusClass = busy ? 'busy' : enabled ? 'ready' : '';
    return `
      <section class="card" data-dcf-local-agent-dialogue-card="true">
        <div class="title-row"><b>对话闭环</b><span class="status ${statusClass}">${busy ? '执行中' : enabled ? '已开启' : '已关闭'}</span></div>
        <div class="muted">只有完整的 DCF_LOCAL_AGENT_REQUEST 工件会触发；普通对话不会执行本机任务。</div>
        <div class="row">
          <label class="row"><input type="checkbox" data-bridge-field="enabled" ${enabled ? 'checked' : ''}>允许对话自动委派</label>
          <label class="row"><input type="checkbox" data-bridge-field="auto-send" ${state.settings.auto_send_results ? 'checked' : ''}>结果自动发送回对话</label>
        </div>
        <div class="button-grid">
          <button data-bridge-action="scan">检查当前对话</button>
          <button data-bridge-action="return" ${pendingResult ? '' : 'disabled'}>回传待发送结果</button>
          <button data-bridge-action="clear">清除已处理记录</button>
        </div>
        <div class="muted">${escapeHtml(state.status)}${state.last_request_id ? ` · ${escapeHtml(state.last_request_id)}` : ''}${state.last_session_id ? ` · ${escapeHtml(state.last_session_id.slice(-8))}` : ''}</div>
        ${state.last_error ? `<div class="notice error">${escapeHtml(state.last_error)}</div>` : ''}
      </section>`;
  }

  function renderBridgeCard() {
    const shadow = panelShadow();
    const content = shadow && shadow.querySelector('.content');
    if (!content) return;
    let card = content.querySelector('[data-dcf-local-agent-dialogue-card="true"]');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = bridgeCardHtml().trim();
    const next = wrapper.firstElementChild;
    if (!card) {
      const first = content.querySelector('.card');
      if (first && first.nextSibling) content.insertBefore(next, first.nextSibling);
      else content.append(next);
      card = next;
    } else {
      card.replaceWith(next);
      card = next;
    }
    const enabled = card.querySelector('[data-bridge-field="enabled"]');
    const autoSend = card.querySelector('[data-bridge-field="auto-send"]');
    enabled.onchange = async () => {
      state.settings.enabled = enabled.checked;
      state.status = state.settings.enabled ? '等待请求' : '闭环已关闭';
      await persist();
      renderBridgeCard();
      if (state.settings.enabled) {
        scanAssistantMessages();
        processQueue().catch(() => {});
      }
    };
    autoSend.onchange = async () => {
      state.settings.auto_send_results = autoSend.checked;
      await persist();
      renderBridgeCard();
    };
    card.querySelector('[data-bridge-action="scan"]').onclick = () => {
      state.status = '正在检查当前对话';
      renderBridgeCard();
      seenNodes.clear?.();
      scanAssistantMessages();
    };
    card.querySelector('[data-bridge-action="clear"]').onclick = async () => {
      state.processed_ids = [];
      state.last_request_id = '';
      state.status = '已清除处理记录';
      await persist();
      renderBridgeCard();
    };
    const returnButton = card.querySelector('[data-bridge-action="return"]');
    returnButton.onclick = async () => {
      if (!pendingResult) return;
      try {
        const artifact = pendingResult;
        if (composerText(composer()).trim()) throw new Error('输入框中已有未发送内容');
        setComposerExact(artifact);
        if (state.settings.auto_send_results) await clickSend();
        pendingResult = null;
        state.status = state.settings.auto_send_results ? '结果已自动回传' : '结果已填入输入框';
        state.last_error = '';
      } catch (error) {
        state.last_error = String(error && error.message || error);
      }
      renderBridgeCard();
    };
  }

  function attachPanelObserver() {
    const panel = localAgentPanel();
    const shadow = panel && panel.shadowRoot;
    if (!shadow) {
      clearTimeout(panelRetryTimer);
      panelRetryTimer = setTimeout(attachPanelObserver, 700);
      return;
    }
    panelObserver?.disconnect();
    panelObserver = new MutationObserver(() => {
      if (!shadow.querySelector('[data-dcf-local-agent-dialogue-card="true"]')) queueMicrotask(renderBridgeCard);
    });
    panelObserver.observe(shadow, { childList: true, subtree: true });
    renderBridgeCard();
  }

  function attachRootObserver() {
    rootObserver?.disconnect();
    rootObserver = new MutationObserver(() => {
      if (!panelShadow()) attachPanelObserver();
      if (!assistantObserver) attachAssistantObserver();
    });
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function destroy() {
    destroyed = true;
    rootObserver?.disconnect();
    assistantObserver?.disconnect();
    panelObserver?.disconnect();
    clearTimeout(panelRetryTimer);
    clearTimeout(scanTimer);
    const card = panelShadow()?.querySelector('[data-dcf-local-agent-dialogue-card="true"]');
    card?.remove();
    queue.length = 0;
    currentJob = null;
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    request_markers: { start: REQUEST_START, end: REQUEST_END },
    result_markers: { start: RESULT_START, end: RESULT_END }
  };

  try {
    loadState().then(async () => {
      attachPanelObserver();
      attachAssistantObserver();
      attachRootObserver();
      await hostSend({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => {
      hostSend({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => {});
    });
  } catch (error) {
    destroy();
    hostSend({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => {});
  }
})();
