(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.local-agent-dialogue';
  const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.8';
  const LOCAL_AGENT_ID = 'dcf.firstparty.local-agent';
  const LOCAL_AGENT_PANEL_ID = 'dcf-panel-local-agent';
  const SHELL_HOST_ID = 'dcf-chrome-shell-host';
  const MOUNT_ID = 'dcf-local-agent-dialogue-mount';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__';
  const REQUEST_START = '<<<DCF_LOCAL_AGENT_REQUEST>>>';
  const REQUEST_END = '<<<END_DCF_LOCAL_AGENT_REQUEST>>>';
  const RESULT_START = '<<<DCF_LOCAL_AGENT_RESULT>>>';
  const RESULT_END = '<<<END_DCF_LOCAL_AGENT_RESULT>>>';
  const ACCEPTANCE_START = '<<<DCF_LOCAL_AGENT_DIALOGUE_ACCEPTANCE>>>';
  const ACCEPTANCE_END = '<<<END_DCF_LOCAL_AGENT_DIALOGUE_ACCEPTANCE>>>';
  const DEFAULTS = Object.freeze({
    enabled: true,
    auto_send_results: true,
    poll_interval_ms: 1200,
    timeout_ms: 20 * 60 * 1000,
    message_limit: 120
  });

  const previous = globalThis[GLOBAL_KEY];
  if (previous?.destroy) previous.destroy();

  const bootPerformanceMs = performance.now();
  const sendHost = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
    return result;
  });

  let destroyed = false;
  let conversationObserver = null;
  let documentObserver = null;
  let panelObserver = null;
  let shellObserver = null;
  let currentConversationRoot = null;
  let currentCandidate = null;
  let currentPanelShadow = null;
  let currentShellShadow = null;
  let mountHost = null;
  let mountRoot = null;
  let boundMountRoot = null;
  let mountTimer = null;
  let rootTimer = null;
  let elapsedTimer = null;
  let shellReadyListener = null;
  let panelReadyListener = null;
  let queueBusy = false;
  let activeJob = null;
  let pendingArtifact = '';
  let pendingForceSend = false;
  let startupMountConfirmed = false;
  const queue = [];
  const baselineNodes = new WeakSet();
  const nodeState = new WeakMap();
  const counters = {
    baseline_messages: 0,
    new_assistant_events: 0,
    manual_latest_checks: 0,
    auto_requests_enqueued: 0,
    manual_requests_enqueued: 0,
    tasks_started: 0,
    clear_actions: 0,
    acceptance_reports: 0,
    mount_bindings: 0
  };

  const state = {
    settings: { ...DEFAULTS },
    processed_ids: [],
    stage: 'idle',
    status: '等待新的助手回复',
    error: '',
    last_action: '尚未操作',
    last_action_at: '',
    last_request_id: '',
    last_session_id: '',
    started_at: 0,
    progress: {
      status_type: '', messages: 0, todo: 0, diff: 0,
      permissions: 0, questions: 0, preview: '', last_poll_at: ''
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const list = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  const json = (value) => { try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); } };
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const hash = (value) => {
    let result = 2166136261;
    for (const char of String(value || '')) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  };

  function markAction(text) {
    state.last_action = String(text || '');
    state.last_action_at = new Date().toLocaleTimeString();
  }

  function normalizeSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: value.enabled !== false,
      auto_send_results: value.auto_send_results !== false,
      poll_interval_ms: Math.max(500, Math.min(5000, Number(value.poll_interval_ms) || DEFAULTS.poll_interval_ms)),
      timeout_ms: Math.max(30000, Math.min(60 * 60 * 1000, Number(value.timeout_ms) || DEFAULTS.timeout_ms)),
      message_limit: Math.max(20, Math.min(200, Number(value.message_limit) || DEFAULTS.message_limit))
    };
  }

  async function loadState() {
    const result = await sendHost({ type: 'plugin.data.get', plugin_id: UNIT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    state.settings = normalizeSettings(data.settings);
    state.processed_ids = Array.isArray(data.processed_ids) ? data.processed_ids.map(String).slice(-80) : [];
    state.last_request_id = String(data.last_request_id || '');
    state.last_session_id = String(data.last_session_id || '');
  }

  async function persist() {
    await sendHost({
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

  function shellShadow() { return document.getElementById(SHELL_HOST_ID)?.shadowRoot || null; }
  function localPanelHost() {
    return document.getElementById(LOCAL_AGENT_PANEL_ID)
      || shellShadow()?.querySelector(`#${LOCAL_AGENT_PANEL_ID}`)
      || null;
  }
  function localPanelShadow() { return localPanelHost()?.shadowRoot || null; }

  async function connectionConfig() {
    const saved = await sendHost({ type: 'plugin.data.get', plugin_id: LOCAL_AGENT_ID });
    const data = saved.data && typeof saved.data === 'object' ? saved.data : {};
    const config = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = localPanelShadow();
    const modelValue = String(shadow?.querySelector('[data-field="model"]')?.value || '');
    const modelParts = modelValue ? modelValue.split('\u0000') : [];
    const visibleModel = modelParts.length === 2 ? { providerID: modelParts[0], modelID: modelParts[1] } : null;
    return {
      base_url: String(shadow?.querySelector('[data-field="base-url"]')?.value || config.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(shadow?.querySelector('[data-field="username"]')?.value || config.username || 'opencode').trim() || 'opencode',
      password: String(shadow?.querySelector('[data-field="password"]')?.value || ''),
      agent: String(shadow?.querySelector('[data-field="agent"]')?.value || config.agent || ''),
      model: visibleModel || (config.model && typeof config.model === 'object' ? config.model : null)
    };
  }

  function baseUrl(raw) {
    let url;
    try { url = new URL(String(raw || 'http://127.0.0.1:4096').trim().replace(/\/$/, '')); }
    catch (_) { throw new Error('OpenCode 地址无效'); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('对话闭环只允许连接本机 loopback 地址');
    }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) {
      throw new Error('OpenCode 地址只能包含协议、主机与端口');
    }
    const host = url.hostname === '[::1]' ? '[::1]' : url.hostname;
    return `${url.protocol}//${host}:${url.port || '4096'}`;
  }

  function auth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  function classify(error, path) {
    const raw = String(error?.message || error);
    if (error?.name === 'AbortError') return { code: 'timeout', message: `OpenCode 请求超时：${path}`, raw };
    if (/401|403|Unauthorized|Forbidden/i.test(raw)) {
      return { code: 'auth', message: 'OpenCode 服务已响应，但认证未通过。请检查用户名和本页密码，或确认当前服务为无认证模式。', raw };
    }
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(raw)) {
      return { code: 'network_or_cors', message: `浏览器无法读取 OpenCode 响应。服务可能未启动，也可能缺少 ${location.origin} 的 CORS 允许。`, raw };
    }
    return { code: 'request_failed', message: raw, raw };
  }

  async function request(path, options = {}) {
    const config = options.config || await connectionConfig();
    const controller = new AbortController();
    const timeout = Math.max(1000, Math.min(60 * 60 * 1000, Number(options.timeout) || 15000));
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = { Accept: 'application/json' };
      if (config.password) headers.Authorization = auth(config.username, config.password);
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${baseUrl(config.base_url)}${path}`, {
        method: options.method || 'GET', headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store', credentials: 'omit', mode: 'cors', redirect: 'error', signal: controller.signal
      });
      const text = response.status === 204 ? '' : await response.text();
      let payload = null;
      if (text) { try { payload = JSON.parse(text); } catch (_) { payload = text; } }
      if (!response.ok) {
        const detail = typeof payload === 'string' ? payload : payload?.error || payload?.message || '';
        const failed = new Error(`OpenCode HTTP ${response.status}${detail ? `：${detail}` : ''}`);
        failed.status = response.status;
        throw failed;
      }
      return payload;
    } catch (error) {
      const detail = classify(error, path);
      const wrapped = new Error(detail.message);
      wrapped.code = detail.code; wrapped.raw = detail.raw; wrapped.path = path;
      throw wrapped;
    } finally { clearTimeout(timer); }
  }

  async function optional(path, config) {
    try { return { ok: true, data: await request(path, { config }) }; }
    catch (error) { return { ok: false, error: String(error?.message || error) }; }
  }

  async function optionalFallback(paths, config) {
    let last;
    for (const path of paths) {
      const result = await optional(path, config);
      if (result.ok || !/404|405/.test(result.error || '')) return result;
      last = result;
    }
    return last || { ok: false, error: 'endpoint unavailable' };
  }

  const sessionId = (session) => String(session?.id || session?.sessionID || session?.session_id || '');
  const statusType = (value, fallback = 'unknown') => String(typeof value === 'string' ? value : value?.type || value?.status || value?.state || fallback).toLowerCase();
  function statusCollection(value) {
    if (!value || typeof value !== 'object') return {};
    if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) return value.sessions;
    if (value.data?.sessions && typeof value.data.sessions === 'object' && !Array.isArray(value.data.sessions)) return value.data.sessions;
    if (value.data && typeof value.data === 'object' && !Array.isArray(value.data)) return value.data;
    return value;
  }
  function sessionStatusFrom(value, id) {
    const collection = statusCollection(value);
    return collection?.[id]
      || list(collection).find((item) => String(item?.sessionID || item?.session_id || item?.sessionId || item?.id || '') === id)
      || null;
  }
  const messageRole = (record) => String(record?.info?.role || record?.info?.type || '').toLowerCase();

  function partText(part) {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text' || part.type === 'reasoning') return String(part.text || '');
    if (part.type === 'tool') {
      const title = part.state?.title || part.state?.error || '';
      return `[${part.tool || part.name || 'tool'} · ${statusType(part.state)}${title ? ` · ${title}` : ''}]`;
    }
    if (part.type === 'step-finish' && part.reason) return `[步骤结束 · ${part.reason}]`;
    if (part.type === 'patch' && part.hash) return `[补丁 · ${part.hash}]`;
    return '';
  }

  const messageText = (record) => list(record?.parts).map(partText).filter(Boolean).join('\n').trim();
  function latestAssistant(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messageRole(messages[index]).includes('assistant')) {
        const text = messageText(messages[index]);
        if (text) return text;
      }
    }
    return '';
  }

  function normalizeArtifactText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
  }

  function extractRequestBody(text) {
    const value = normalizeArtifactText(text);
    const start = value.indexOf(REQUEST_START);
    if (start < 0) return null;
    const end = value.indexOf(REQUEST_END, start + REQUEST_START.length);
    if (end < 0) return { pending: true, body: '' };
    let body = value.slice(start + REQUEST_START.length, end).trim();
    body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const firstBrace = body.indexOf('{');
    const lastBrace = body.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) body = body.slice(firstBrace, lastBrace + 1);
    return { pending: false, body };
  }

  function escapeJsonStringControls(source) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (const char of String(source || '')) {
      if (!inString) { output += char; if (char === '"') inString = true; continue; }
      if (escaped) { output += char; escaped = false; continue; }
      if (char === '\\') { output += char; escaped = true; continue; }
      if (char === '"') { output += char; inString = false; continue; }
      if (char === '\n') { output += '\\n'; continue; }
      if (char === '\r') { output += '\\r'; continue; }
      if (char === '\t') { output += '\\t'; continue; }
      if (char.charCodeAt(0) < 0x20) {
        output += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
      output += char;
    }
    return output;
  }

  function parseRequest(text) {
    const extracted = extractRequestBody(text);
    if (!extracted) return null;
    if (extracted.pending) return { pending: true };
    let payload;
    try { payload = JSON.parse(extracted.body); }
    catch (firstError) {
      try { payload = JSON.parse(escapeJsonStringControls(extracted.body)); }
      catch (secondError) {
        const compact = extracted.body.slice(0, 180).replace(/\s+/g, ' ');
        throw new Error(`DCF_LOCAL_AGENT_REQUEST JSON 解析失败：${secondError?.message || firstError?.message || secondError}；开头：${compact}`);
      }
    }
    if (payload?.schema !== 'dcf.local-agent.request.v1') throw new Error('DCF_LOCAL_AGENT_REQUEST schema 无效');
    const id = String(payload.id || '').trim();
    const task = String(payload.task || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('DCF_LOCAL_AGENT_REQUEST id 无效');
    if (!task || task.length > 30000) throw new Error('DCF_LOCAL_AGENT_REQUEST task 无效');
    if (String(payload.mode || 'new') !== 'new') throw new Error('闭环 v1 只允许新建独立 OpenCode 会话');
    return {
      id, task,
      title: String(payload.title || `DCF · ${task.slice(0, 56)}`).slice(0, 240),
      return_mode: payload.return_mode === 'full' ? 'full' : 'summary',
      timeout_ms: Math.max(30000, Math.min(60 * 60 * 1000, Number(payload.timeout_ms) || state.settings.timeout_ms))
    };
  }

  function conversationRoot() { return document.querySelector('main') || document.querySelector('[role="main"]'); }
  function assistantMessages(root = currentConversationRoot) {
    return root ? Array.from(root.querySelectorAll('[data-message-author-role="assistant"]')) : [];
  }
  function latestAssistantNode(root = currentConversationRoot) {
    const messages = assistantMessages(root);
    return messages[messages.length - 1] || null;
  }
  function assistantNode(value) {
    if (!(value instanceof Node)) return null;
    const element = value.nodeType === Node.ELEMENT_NODE ? value : value.parentElement;
    return element?.closest?.('[data-message-author-role="assistant"]') || null;
  }

  function scheduleInspect(node, force = false) {
    if (!(node instanceof Element)) return;
    const prior = nodeState.get(node) || {};
    clearTimeout(prior.timer);
    const timer = setTimeout(() => inspectNode(node, force).catch(reportFatal), force ? 0 : 260);
    nodeState.set(node, { ...prior, timer });
  }

  async function inspectNode(node, force = false) {
    if (!state.settings.enabled || !(node instanceof Element) || !node.isConnected) return;
    if (!force && (node !== currentCandidate || baselineNodes.has(node))) return;
    const text = String(node.innerText || node.textContent || '').trim();
    const prior = nodeState.get(node) || {};
    if (!force && prior.text === text) return;
    nodeState.set(node, { text, timer: null });
    if (!text.includes(REQUEST_START)) return;
    try {
      const parsed = parseRequest(text);
      if (!parsed) return;
      if (parsed.pending) {
        state.stage = 'detecting'; state.status = '检测到新委派工件，等待回复生成完成'; state.error = '';
        render(); return;
      }
      if (state.processed_ids.includes(parsed.id)) {
        state.stage = 'idle'; state.status = `最新回复中的工件已经处理：${parsed.id}`; state.error = '';
        markAction('最新助手回复中的工件已经处理'); render(); return;
      }
      enqueue(parsed, force ? 'manual-latest' : 'new-assistant-event');
    } catch (error) {
      state.stage = 'invalid'; state.status = '最新助手回复包含无效委派工件';
      state.error = String(error?.message || error); markAction('最新助手回复工件解析失败'); render();
    }
  }

  function considerNewAssistant(node) {
    if (!(node instanceof Element) || baselineNodes.has(node)) return;
    counters.new_assistant_events += 1;
    if (node !== latestAssistantNode()) { baselineNodes.add(node); return; }
    currentCandidate = node;
    scheduleInspect(node, false);
  }

  function baselineConversation(root) {
    currentCandidate = null;
    const messages = assistantMessages(root);
    counters.baseline_messages = messages.length;
    for (const node of messages) baselineNodes.add(node);
    const latest = messages[messages.length - 1] || null;
    if (latest && streaming()) {
      const text = String(latest.innerText || latest.textContent || '');
      if (text.includes(REQUEST_START) && !text.includes(REQUEST_END)) {
        baselineNodes.delete(latest); currentCandidate = latest; scheduleInspect(latest, false);
      }
    }
    markAction(`已建立历史基线：${messages.length} 条助手消息不会自动执行`);
    state.status = '等待新的助手回复'; state.error = ''; render();
  }

  function attachConversationRoot() {
    const root = conversationRoot();
    if (!root || root === currentConversationRoot) return false;
    conversationObserver?.disconnect();
    currentConversationRoot = root;
    baselineConversation(root);
    conversationObserver = new MutationObserver((records) => {
      for (const record of records) {
        const direct = assistantNode(record.target);
        if (direct && direct === currentCandidate) scheduleInspect(direct, false);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const candidates = [];
          if (node.matches?.('[data-message-author-role="assistant"]')) candidates.push(node);
          candidates.push(...(node.querySelectorAll?.('[data-message-author-role="assistant"]') || []));
          for (const candidate of candidates) considerNewAssistant(candidate);
          const parent = assistantNode(node);
          if (parent && parent === currentCandidate) scheduleInspect(parent, false);
        }
      }
    });
    conversationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function inspectLatestAssistant() {
    counters.manual_latest_checks += 1;
    attachConversationRoot();
    const latest = latestAssistantNode();
    if (!latest) {
      state.stage = 'idle'; state.status = '当前页面没有助手回复'; state.error = '';
      markAction('检查最新助手回复：没有可检查内容'); render(); return;
    }
    currentCandidate = latest;
    state.stage = 'scanning'; state.status = '正在检查最新一条助手回复'; state.error = '';
    markAction('已触发检查最新助手回复'); render(); scheduleInspect(latest, true);
    setTimeout(() => {
      if (state.stage === 'scanning') {
        state.stage = 'idle'; state.status = '最新助手回复中没有新的完整工件'; render();
      }
    }, 900);
  }

  function enqueue(requestData, source = 'new-assistant-event') {
    if (!requestData || state.processed_ids.includes(requestData.id) || queue.some((item) => item.id === requestData.id) || activeJob?.request.id === requestData.id) return;
    if (source === 'manual-latest') counters.manual_requests_enqueued += 1;
    else counters.auto_requests_enqueued += 1;
    queue.push(requestData);
    state.stage = 'received'; state.status = '已识别新的完整工件，等待委派'; state.error = '';
    state.last_request_id = requestData.id; markAction(`已接收请求 ${requestData.id}`); render();
    processQueue().catch(reportFatal);
  }

  async function createSession(config, title) {
    const session = await request('/session', { config, method: 'POST', body: { title } });
    const id = sessionId(session);
    if (!id) throw new Error('OpenCode 未返回 session ID');
    return id;
  }

  async function snapshot(job) {
    const encoded = encodeURIComponent(job.session_id);
    const [statuses, messages, todo, diff, permissions, questions] = await Promise.all([
      optional('/session/status', job.config),
      optional(`/session/${encoded}/message?limit=${state.settings.message_limit}`, job.config),
      optional(`/session/${encoded}/todo`, job.config),
      optional(`/session/${encoded}/diff`, job.config),
      optionalFallback(['/permission/', '/permission'], job.config),
      optionalFallback(['/question/', '/question'], job.config)
    ]);
    const sessionStatus = statuses.ok ? sessionStatusFrom(statuses.data, job.session_id) : null;
    const normalizedStatus = sessionStatus
      ? statusType(sessionStatus)
      : statuses.ok
        ? (job.response_state === 'fulfilled' ? 'idle' : 'message-pending')
        : 'status-unavailable';
    const belongs = (item) => {
      const id = String(item?.sessionID || item?.session_id || item?.sessionId || '');
      return !id || id === job.session_id;
    };
    const messageList = messages.ok ? list(messages.data) : [];
    if (job.response_state === 'fulfilled' && job.response && !messageList.some((item) => item?.info?.id && item.info.id === job.response?.info?.id)) messageList.push(job.response);
    return {
      status: sessionStatus, status_type: normalizedStatus, messages: messageList,
      todo: todo.ok ? list(todo.data) : [], diff: diff.ok ? list(diff.data) : [],
      permissions: permissions.ok ? list(permissions.data).filter(belongs) : [],
      questions: questions.ok ? list(questions.data).filter(belongs) : [],
      endpoint_errors: {
        status: statuses.ok ? null : statuses.error, messages: messages.ok ? null : messages.error,
        todo: todo.ok ? null : todo.error, diff: diff.ok ? null : diff.error,
        permissions: permissions.ok ? null : permissions.error, questions: questions.ok ? null : questions.error,
        message_request: job.response_state === 'rejected' ? String(job.response_error?.message || job.response_error) : null
      }
    };
  }

  function updateProgress(snap) {
    const preview = latestAssistant(snap.messages);
    state.progress = {
      status_type: snap.status_type, messages: snap.messages.length, todo: snap.todo.length, diff: snap.diff.length,
      permissions: snap.permissions.length, questions: snap.questions.length, preview: preview.slice(-900),
      last_poll_at: new Date().toLocaleTimeString()
    };
  }

  function payload(job, status, snap, elapsed) {
    return {
      schema: 'dcf.local-agent.result.v1', request_id: job.request.id, status,
      session_id: job.session_id, assistant_result: latestAssistant(snap.messages),
      todo: snap.todo, diff: snap.diff, permissions: snap.permissions, questions: snap.questions,
      messages: job.request.return_mode === 'full' ? snap.messages : undefined,
      execution: {
        elapsed_ms: elapsed,
        status_type: snap.status_type,
        base_url: baseUrl(job.config.base_url), endpoint_errors: snap.endpoint_errors
      }
    };
  }

  const artifact = (value) => `${RESULT_START}\n${json(value)}\n${RESULT_END}`;
  const acceptanceArtifact = (value) => `${ACCEPTANCE_START}\n${json(value)}\n${ACCEPTANCE_END}`;
  const composer = () => document.querySelector('#prompt-textarea') || document.querySelector('[data-testid="composer-text-input"]') || document.querySelector('form textarea') || document.querySelector('main [contenteditable="true"]');
  const composerValue = (target) => target ? String('value' in target ? target.value || '' : target.innerText || target.textContent || '') : '';
  const streaming = () => Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]'));

  function dispatchInput(target, text) {
    try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
    catch (_) { target.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function fillComposer(text) {
    const target = composer();
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    if (composerValue(target).trim()) throw new Error('输入框中已有未发送内容');
    target.focus();
    if ('value' in target) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
      if (setter) setter.call(target, text); else target.value = text;
      target.setSelectionRange?.(text.length, text.length);
    } else {
      const selection = getSelection();
      if (selection) {
        const range = document.createRange(); range.selectNodeContents(target);
        selection.removeAllRanges(); selection.addRange(range);
      }
      if (!document.execCommand?.('insertText', false, text)) target.textContent = text;
    }
    dispatchInput(target, text);
  }

  const sendButton = () => document.querySelector('[data-testid="send-button"]') || document.querySelector('button[aria-label*="Send"]') || document.querySelector('button[aria-label*="发送"]');
  async function clickSend() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const button = sendButton();
      if (!streaming() && button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') { button.click(); return; }
      await sleep(50);
    }
    throw new Error('闭环结果已写入输入框，但发送按钮暂不可用');
  }

  async function returnArtifactText(text, {
    forceSend = false,
    sentStatus = '结果已自动回传',
    filledStatus = '结果已填入输入框',
    finalStage = null
  } = {}) {
    pendingArtifact = text;
    pendingForceSend = forceSend;
    const started = Date.now();
    while (!destroyed && pendingArtifact === text && Date.now() - started < 120000) {
      const target = composer();
      if (target && !composerValue(target).trim() && !streaming()) {
        fillComposer(text);
        const shouldSend = forceSend || state.settings.auto_send_results;
        if (shouldSend) await clickSend();
        pendingArtifact = '';
        pendingForceSend = false;
        state.status = shouldSend ? sentStatus : filledStatus;
        if (finalStage) state.stage = finalStage;
        state.error = ''; markAction(state.status); render(); return true;
      }
      await sleep(500);
    }
    state.stage = 'return_wait'; state.status = '结果等待回传';
    state.error = '当前对话尚未空闲，未覆盖输入框'; render(); return false;
  }

  async function returnPayload(value) {
    return returnArtifactText(artifact(value));
  }

  async function focusSession(id) {
    if (!id) { markAction('查看执行会话：尚无 session'); state.status = '尚无可查看的执行会话'; render(); return; }
    try {
      localPanelShadow()?.querySelector('[data-action="refresh-all"]')?.click();
      await sleep(1200);
      const select = localPanelShadow()?.querySelector('[data-field="session"]');
      if (select && Array.from(select.options || []).some((option) => option.value === id)) {
        select.value = id; select.dispatchEvent(new Event('change', { bubbles: true }));
        markAction(`已切换到 session ${id}`); state.status = '已打开执行会话';
      } else {
        markAction(`未在列表找到 session ${id}`); state.status = '执行会话尚未出现在本机列表';
      }
    } catch (error) { state.error = String(error?.message || error); }
    render();
  }

  async function clearProcessedState(label = 'manual') {
    if (activeJob || queueBusy || queue.length) throw new Error('本机任务正在执行，暂不能清除交接记录');
    const before = {
      processed_count: state.processed_ids.length,
      recent_request_present: Boolean(state.last_request_id),
      recent_session_present: Boolean(state.last_session_id)
    };
    state.processed_ids = [];
    state.last_request_id = '';
    state.last_session_id = '';
    state.stage = label === 'acceptance' ? 'acceptance' : 'idle';
    state.progress = { status_type: '', messages: 0, todo: 0, diff: 0, permissions: 0, questions: 0, preview: '', last_poll_at: '' };
    state.status = label === 'acceptance' ? '正在执行一键验收' : '已清除工件去重记录与最近交接；历史消息仍不会自动执行';
    state.error = '';
    counters.clear_actions += 1;
    markAction(label === 'acceptance' ? '一键验收已清除去重记录与最近交接' : '已清除工件去重记录与最近交接');
    await persist();
    render();
    return before;
  }

  function workspaceEvidence() {
    const shadow = shellShadow();
    const tabs = Array.from(shadow?.querySelectorAll('.tabs button[data-panel-id]') || []);
    const active = tabs.find((button) => button.classList.contains('active')) || null;
    return {
      pinned_panel_ids: tabs.map((button) => String(button.dataset.panelId || '')).filter(Boolean),
      active_panel_id: String(active?.dataset.panelId || ''),
      local_agent_pinned: tabs.some((button) => button.dataset.panelId === 'local-agent'),
      local_agent_active: active?.dataset.panelId === 'local-agent'
    };
  }

  async function hostVersionEvidence() {
    try {
      const host = await sendHost({ type: 'host.status' });
      const snapshot = host.snapshots?.current || host.snapshots?.last_known_good || null;
      const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
      const wanted = new Set([UNIT_ID, LOCAL_AGENT_ID, 'dcf.firstparty.shell', 'dcf.firstparty.plugin-manager']);
      return Object.fromEntries(entries.filter((entry) => wanted.has(entry.id)).map((entry) => [
        entry.id,
        { version: String(entry.version || ''), hash_prefix: String(entry.hash || '').slice(0, 12), enabled: entry.enabled !== false }
      ]));
    } catch (error) {
      return { error: String(error?.message || error) };
    }
  }

  async function buildAcceptanceReport(clearBefore) {
    await sleep(900);
    const persisted = await sendHost({ type: 'plugin.data.get', plugin_id: UNIT_ID });
    const saved = persisted.data && typeof persisted.data === 'object' ? persisted.data : {};
    const workspace = workspaceEvidence();
    const shell = shellShadow();
    const panelHost = localPanelHost();
    const panelShadow = localPanelShadow();
    const buttonText = String(mountRoot?.querySelector('[data-action="latest"]')?.textContent || '').trim();
    const cardText = String(mountRoot?.textContent || '');
    const versions = await hostVersionEvidence();
    const checks = {
      dialogue_card_mounted: Boolean(mountHost?.isConnected && mountRoot),
      click_events_bound: boundMountRoot === mountRoot,
      startup_mount_confirmed: startupMountConfirmed,
      latest_only_control: buttonText === '检查最新助手回复',
      clear_persisted: Array.isArray(saved.processed_ids) && saved.processed_ids.length === 0
        && !String(saved.last_request_id || '') && !String(saved.last_session_id || ''),
      no_queue_after_clear: !activeJob && !queueBusy && queue.length === 0,
      history_not_replayed_after_clear: counters.tasks_started === 0 || counters.auto_requests_enqueued <= counters.new_assistant_events,
      local_agent_tab_preserved: workspace.local_agent_pinned,
      idle_status_not_unknown: state.progress.status_type !== 'unknown',
      recent_handoff_not_labeled_current: !cardText.includes('当前请求：') && !cardText.includes('当前会话：')
    };
    return {
      schema: 'dcf.local-agent-dialogue.acceptance.v1',
      generated_at: new Date().toISOString(),
      plugin: {
        id: UNIT_ID,
        version: UNIT_VERSION,
        intake_model: 'new-assistant-event-stream'
      },
      page_runtime: {
        route_kind: /^\/c\//.test(location.pathname) ? '/c/:conversation' : location.pathname === '/' ? '/' : 'other',
        page_uptime_ms: Math.round(performance.now()),
        plugin_uptime_ms: Math.round(performance.now() - bootPerformanceMs),
        page_predates_plugin_ms: Math.round(bootPerformanceMs)
      },
      mount: {
        shell_host_connected: Boolean(document.getElementById(SHELL_HOST_ID)?.isConnected),
        shell_shadow_open: Boolean(shell),
        local_agent_panel_connected: Boolean(panelHost?.isConnected),
        panel_inside_shell_shadow: Boolean(shell && panelHost && shell.contains(panelHost)),
        local_agent_shadow_open: Boolean(panelShadow),
        dialogue_mount_connected: Boolean(mountHost?.isConnected),
        event_root_bound: boundMountRoot === mountRoot,
        mount_bindings: counters.mount_bindings
      },
      workspace,
      intake: {
        assistant_message_count: assistantMessages().length,
        baseline_message_count: counters.baseline_messages,
        new_assistant_events: counters.new_assistant_events,
        manual_latest_checks: counters.manual_latest_checks,
        auto_requests_enqueued: counters.auto_requests_enqueued,
        manual_requests_enqueued: counters.manual_requests_enqueued,
        tasks_started: counters.tasks_started
      },
      clear_test: {
        performed: true,
        before: clearBefore,
        after: {
          processed_count: state.processed_ids.length,
          recent_request_present: Boolean(state.last_request_id),
          recent_session_present: Boolean(state.last_session_id),
          persisted_processed_count: Array.isArray(saved.processed_ids) ? saved.processed_ids.length : null,
          queue_length: queue.length
        }
      },
      versions,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  async function runAcceptance() {
    if (activeJob || queueBusy || queue.length) throw new Error('本机任务正在执行，完成后再生成验收报告');
    state.stage = 'acceptance';
    state.status = '正在执行一键验收并生成报告';
    state.error = '';
    counters.acceptance_reports += 1;
    markAction('开始一键验收');
    render();
    const clearBefore = await clearProcessedState('acceptance');
    const report = await buildAcceptanceReport(clearBefore);
    state.status = report.passed ? '验收检查完成，正在自动回传' : '验收发现偏差，正在自动回传';
    render();
    await returnArtifactText(acceptanceArtifact(report), {
      forceSend: true,
      sentStatus: report.passed ? '验收报告已自动回传' : '偏差报告已自动回传',
      filledStatus: '验收报告已写入输入框',
      finalStage: 'idle'
    });
  }

  async function poll(job) {
    const started = Date.now();
    let interventionKey = '';
    let terminalSeenAt = 0;
    while (!destroyed && activeJob === job) {
      const snap = await snapshot(job);
      updateProgress(snap);
      if (job.response_state === 'rejected') throw job.response_error;
      const currentIntervention = snap.permissions.length || snap.questions.length ? hash(json({ permissions: snap.permissions, questions: snap.questions })) : '';
      if (currentIntervention && currentIntervention !== interventionKey) {
        interventionKey = currentIntervention; state.stage = 'needs_user'; state.status = '等待本机权限或回答';
        render(); await focusSession(job.session_id); await returnPayload(payload(job, 'needs_user', snap, Date.now() - started));
      } else if (!currentIntervention && interventionKey) {
        interventionKey = ''; state.stage = 'running'; state.status = '用户处理完成，继续执行'; render();
      } else {
        state.stage = 'running';
        state.status = job.response_state === 'fulfilled' ? 'OpenCode 已返回结果，正在收集证据' : `本机执行中 · ${state.progress.status_type}`;
        render();
      }
      if (!currentIntervention && job.response_state === 'fulfilled') {
        if (!terminalSeenAt) terminalSeenAt = Date.now();
        if (Date.now() - terminalSeenAt >= 500) {
          const finalSnap = await snapshot(job); updateProgress(finalSnap);
          return payload(job, 'completed', finalSnap, Date.now() - started);
        }
      }
      if (Date.now() - started >= job.request.timeout_ms) return payload(job, 'timeout', snap, Date.now() - started);
      await sleep(state.settings.poll_interval_ms);
    }
    throw new Error('对话闭环已停止');
  }

  async function run(requestData) {
    counters.tasks_started += 1;
    state.started_at = Date.now(); state.stage = 'checking'; state.status = '正在检查 OpenCode 服务'; render();
    const config = await connectionConfig();
    await request('/global/health', { config, timeout: 8000 });
    state.stage = 'creating'; state.status = '服务已连接，正在创建会话'; render();
    const session_id = await createSession(config, requestData.title);
    const body = { parts: [{ type: 'text', text: requestData.task }] };
    if (config.agent) body.agent = config.agent;
    if (config.model) body.model = config.model;
    const job = { request: requestData, config, session_id, response_state: 'pending', response: null, response_error: null };
    activeJob = job;
    state.last_request_id = requestData.id; state.last_session_id = session_id;
    state.processed_ids = [...state.processed_ids.filter((id) => id !== requestData.id), requestData.id].slice(-80);
    state.stage = 'submitting'; state.status = '会话已创建，正在提交同步消息请求'; state.error = '';
    await persist(); render(); await focusSession(session_id);
    job.response_promise = request(`/session/${encodeURIComponent(session_id)}/message`, {
      config, method: 'POST', body, timeout: requestData.timeout_ms
    }).then((response) => {
      job.response_state = 'fulfilled'; job.response = response; return response;
    }).catch((error) => {
      job.response_state = 'rejected'; job.response_error = error; return null;
    });
    state.stage = 'running'; state.status = '消息请求已提交，正在等待 OpenCode 返回';
    markAction(`已委派 ${requestData.id}`); render();
    const finalPayload = await poll(job);
    state.stage = finalPayload.status === 'completed' ? 'completed' : finalPayload.status;
    state.status = finalPayload.status === 'completed' ? '本机任务完成，正在回传' : `本机任务结束 · ${finalPayload.status}`;
    render(); await returnPayload(finalPayload);
  }

  async function returnFailure(error, requestData) {
    const job = activeJob;
    const failure = {
      schema: 'dcf.local-agent.result.v1', request_id: requestData?.id || job?.request.id || 'unknown',
      status: 'bridge_error', session_id: job?.session_id || '', assistant_result: '',
      todo: [], diff: [], permissions: [], questions: [],
      execution: {
        elapsed_ms: state.started_at ? Date.now() - state.started_at : 0,
        status_type: 'bridge_error', base_url: job ? baseUrl(job.config.base_url) : '',
        endpoint_errors: { bridge: String(error?.message || error), code: error?.code || '', raw: error?.raw || '' }
      }
    };
    state.stage = 'failed'; state.status = '委派失败，正在回传'; state.error = String(error?.message || error);
    render(); await returnPayload(failure).catch(() => {});
  }

  async function processQueue() {
    if (queueBusy || activeJob || !state.settings.enabled || !queue.length) return;
    queueBusy = true;
    const requestData = queue.shift();
    state.last_request_id = requestData.id;
    await persist();
    try { await run(requestData); }
    catch (error) { await returnFailure(error, requestData); }
    finally {
      activeJob = null; queueBusy = false; persist().catch(() => {}); render();
      if (queue.length) processQueue().catch(reportFatal);
    }
  }

  function reportFatal(error) {
    state.stage = 'failed'; state.status = '闭环异常'; state.error = String(error?.message || error); render();
  }

  function elapsedText() {
    if (!state.started_at || !['checking', 'creating', 'submitting', 'running', 'needs_user'].includes(state.stage)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - state.started_at) / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
  }

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit;min-width:0}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:9px;min-width:0}.title-row,.row{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}.title-row b,.grow{flex:1;min-width:0}.muted,.notice{color:#666;font-size:12px;overflow-wrap:anywhere}.notice.error{color:#b42318}.status{display:inline-flex;align-items:center;gap:5px;border:1px solid #ccc;border-radius:999px;padding:2px 7px;font-size:11px}.status::before{content:'';width:7px;height:7px;border-radius:50%;background:#999}.status.ready::before{background:#188038}.status.busy::before{background:#d97706}.progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.metric{border:1px solid #ddd;border-radius:8px;padding:6px;display:grid;gap:2px;min-width:0}.metric b{font-size:14px}.stage{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.preview{max-height:150px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f6f6;border-radius:7px;padding:8px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.buttons .primary{grid-column:1/-1;background:#202124;color:#fff;border-color:#202124}button,input{box-sizing:border-box;max-width:100%;min-width:0;font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 8px}button{cursor:pointer}button:hover{border-color:#777}button:active{transform:translateY(1px)}button:focus-visible{outline:2px solid #4c8bf5;outline-offset:1px}.last-action{border-top:1px solid #ddd;padding-top:7px}@media(max-width:340px){.progress{grid-template-columns:repeat(2,minmax(0,1fr))}.buttons{grid-template-columns:1fr}.buttons .primary{grid-column:1}}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}.muted,.notice{color:#aaa}button,input{background:#292929;color:#f3f3f3;border-color:#555}.buttons .primary{background:#f3f3f3;color:#181818}.metric{border-color:#444}.preview{background:#181818}.status{border-color:#555}.last-action{border-color:#444}}`;
  }

  function cardHtml() {
    const active = Boolean(activeJob) || queueBusy || ['received', 'checking', 'creating', 'submitting', 'running', 'needs_user', 'acceptance'].includes(state.stage);
    const progress = state.progress;
    const activeRequestId = activeJob?.request?.id || (active && state.stage !== 'acceptance' ? state.last_request_id : '');
    const activeSessionId = activeJob?.session_id || (active && state.stage !== 'acceptance' ? state.last_session_id : '');
    const recent = !active && (state.last_request_id || state.last_session_id)
      ? `<div class="muted">最近交接${state.last_request_id ? ` · 请求 ${html(state.last_request_id)}` : ''}${state.last_session_id ? ` · 会话 ${html(state.last_session_id)}` : ''}</div>`
      : '';
    return `<section class="card"><div class="title-row"><b>对话闭环</b><span class="status ${active ? 'busy' : state.settings.enabled ? 'ready' : ''}">${active ? '执行中' : state.settings.enabled ? '已开启' : '已关闭'}</span></div><div class="muted">只消费插件启动后新增的助手回复。页面中已有历史消息只建立基线，不会被重新执行。</div><div class="row"><label class="row"><input type="checkbox" data-field="enabled" ${state.settings.enabled ? 'checked' : ''}>允许对话自动委派</label><label class="row"><input type="checkbox" data-field="auto-send" ${state.settings.auto_send_results ? 'checked' : ''}>结果自动发送回对话</label></div><div class="stage"><b>${html(state.status)}</b>${elapsedText() ? ` · ${html(elapsedText())}` : ''}<br>阶段：${html(state.stage)}${activeRequestId ? `<br>当前请求：${html(activeRequestId)}` : ''}${activeSessionId ? `<br>当前会话：${html(activeSessionId)}` : ''}</div>${recent}<div class="progress"><div class="metric"><span class="muted">状态</span><b>${html(progress.status_type || '—')}</b></div><div class="metric"><span class="muted">消息</span><b>${progress.messages}</b></div><div class="metric"><span class="muted">Todo</span><b>${progress.todo}</b></div><div class="metric"><span class="muted">Diff</span><b>${progress.diff}</b></div><div class="metric"><span class="muted">权限</span><b>${progress.permissions}</b></div><div class="metric"><span class="muted">提问</span><b>${progress.questions}</b></div></div>${progress.preview ? `<div><div class="muted">最近本机输出 · ${html(progress.last_poll_at)}</div><div class="preview">${html(progress.preview)}</div></div>` : ''}<div class="buttons"><button class="primary" data-action="acceptance">一键验收并回传</button><button data-action="latest">检查最新助手回复</button><button data-action="focus">查看最近执行会话</button><button data-action="return">回传待发送结果</button><button data-action="clear">清除已处理记录</button></div><div class="last-action muted">上次操作：${html(state.last_action)}${state.last_action_at ? ` · ${html(state.last_action_at)}` : ''}</div>${state.error ? `<div class="notice error">${html(state.error)}</div>` : ''}</section>`;
  }

  function render() {
    if (!mountRoot) return;
    mountRoot.innerHTML = `<style>${style()}</style>${cardHtml()}`;
  }

  async function handleAction(action) {
    if (action === 'acceptance') { await runAcceptance(); return; }
    if (action === 'latest') { inspectLatestAssistant(); return; }
    if (action === 'focus') { await focusSession(state.last_session_id); return; }
    if (action === 'return') {
      if (!pendingArtifact) { state.status = '当前没有待回传结果'; markAction('回传队列为空'); render(); return; }
      try {
        if (composerValue(composer()).trim() || streaming()) throw new Error('当前对话或输入框尚未空闲');
        const text = pendingArtifact; fillComposer(text);
        const shouldSend = pendingForceSend || state.settings.auto_send_results;
        if (shouldSend) await clickSend();
        pendingArtifact = '';
        pendingForceSend = false;
        state.status = shouldSend ? '结果已自动回传' : '结果已填入输入框';
        state.error = ''; markAction(state.status);
      } catch (error) { state.error = String(error?.message || error); markAction('手动回传失败'); }
      render(); return;
    }
    if (action === 'clear') {
      await clearProcessedState('manual');
    }
  }

  function bindMountEvents() {
    if (!mountRoot || boundMountRoot === mountRoot) return;
    boundMountRoot = mountRoot;
    counters.mount_bindings += 1;
    mountRoot.addEventListener('click', (event) => {
      const button = event.target.closest?.('button[data-action]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation(); handleAction(button.dataset.action).catch(reportFatal);
    });
    mountRoot.addEventListener('change', (event) => {
      const field = event.target?.dataset?.field;
      if (field === 'enabled') {
        state.settings.enabled = event.target.checked;
        state.stage = state.settings.enabled ? 'idle' : 'disabled';
        state.status = state.settings.enabled ? '等待新的助手回复' : '闭环已关闭';
        markAction(state.settings.enabled ? '已开启自动委派；从下一条助手回复开始' : '已关闭自动委派');
        persist().then(render).catch(reportFatal);
      } else if (field === 'auto-send') {
        state.settings.auto_send_results = event.target.checked;
        markAction(state.settings.auto_send_results ? '已开启自动回传' : '已关闭自动回传');
        persist().then(render).catch(reportFatal);
      }
    });
  }

  function ensurePanelMount() {
    const shadow = localPanelShadow();
    if (!shadow) return false;
    if (shadow !== currentPanelShadow) {
      panelObserver?.disconnect(); currentPanelShadow = shadow;
      panelObserver = new MutationObserver(() => {
        if (!shadow.querySelector(`#${MOUNT_ID}`)) queueMicrotask(ensurePanelMount);
      });
      panelObserver.observe(shadow, { childList: true, subtree: true });
      mountHost = null; mountRoot = null; boundMountRoot = null;
    }
    let host = shadow.querySelector(`#${MOUNT_ID}`);
    if (!host) {
      host = document.createElement('div'); host.id = MOUNT_ID; shadow.append(host);
    }
    if (host !== mountHost) {
      mountHost = host; mountRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });
      bindMountEvents(); render();
    }
    return Boolean(mountHost?.isConnected && mountRoot && boundMountRoot === mountRoot);
  }

  function schedulePanelMount() {
    queueMicrotask(() => { if (!ensurePanelMount()) setTimeout(ensurePanelMount, 80); });
  }

  function attachShellObserver() {
    const shadow = shellShadow();
    if (shadow === currentShellShadow) return Boolean(shadow);
    shellObserver?.disconnect();
    currentShellShadow = shadow;
    if (!shadow) return false;
    shellObserver = new MutationObserver(schedulePanelMount);
    shellObserver.observe(shadow, { childList: true, subtree: true });
    schedulePanelMount();
    return true;
  }

  function attachHotRefreshWatchers() {
    documentObserver = new MutationObserver((records) => {
      let panelChanged = false;
      let rootChanged = false;
      for (const record of records) {
        if (record.addedNodes.length || record.removedNodes.length) rootChanged = true;
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (!(node instanceof Element)) continue;
          if (node.id === LOCAL_AGENT_PANEL_ID || node.querySelector?.(`#${LOCAL_AGENT_PANEL_ID}`)) panelChanged = true;
          if (node.id === SHELL_HOST_ID || node.querySelector?.(`#${SHELL_HOST_ID}`)) panelChanged = true;
        }
      }
      if (panelChanged || rootChanged) attachShellObserver();
      if (panelChanged) schedulePanelMount();
      if (rootChanged) attachConversationRoot();
    });
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
    shellReadyListener = () => { attachShellObserver(); schedulePanelMount(); };
    panelReadyListener = (event) => {
      if (!event?.detail || String(event.detail) === 'local-agent') schedulePanelMount();
    };
    document.addEventListener('dcf:shell-ready', shellReadyListener, true);
    document.addEventListener('dcf:panel-ready', panelReadyListener, true);
    attachShellObserver();
    schedulePanelMount();
  }

  async function waitForPanelMount(timeoutMs = 5000) {
    const started = Date.now();
    while (!destroyed && Date.now() - started < timeoutMs) {
      if (ensurePanelMount()) return true;
      await sleep(80);
    }
    return false;
  }

  function destroy() {
    destroyed = true;
    conversationObserver?.disconnect(); documentObserver?.disconnect(); panelObserver?.disconnect(); shellObserver?.disconnect();
    if (shellReadyListener) document.removeEventListener('dcf:shell-ready', shellReadyListener, true);
    if (panelReadyListener) document.removeEventListener('dcf:panel-ready', panelReadyListener, true);
    clearInterval(mountTimer); clearInterval(rootTimer); clearInterval(elapsedTimer);
    mountHost?.remove();
    boundMountRoot = null;
    for (const node of assistantMessages(currentConversationRoot)) {
      const info = nodeState.get(node); if (info?.timer) clearTimeout(info.timer);
    }
    queue.length = 0; activeJob = null;
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION, destroy, intake_model: 'new-assistant-event-stream',
    request_markers: { start: REQUEST_START, end: REQUEST_END },
    result_markers: { start: RESULT_START, end: RESULT_END },
    acceptance_markers: { start: ACCEPTANCE_START, end: ACCEPTANCE_END }
  };

  try {
    attachHotRefreshWatchers();
    mountTimer = setInterval(ensurePanelMount, 1200);
    rootTimer = setInterval(attachConversationRoot, 1200);
    elapsedTimer = setInterval(() => {
      if (state.started_at && ['checking', 'creating', 'submitting', 'running', 'needs_user'].includes(state.stage)) render();
    }, 1000);
    loadState().then(async () => {
      attachConversationRoot();
      if (!await waitForPanelMount(5000)) throw new Error('对话闭环未能挂载到本机 Agent 面板');
      startupMountConfirmed = true;
      render();
      await sendHost({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => sendHost({
      type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error)
    }).catch(() => {}));
  } catch (error) {
    destroy();
    sendHost({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
  }
})();