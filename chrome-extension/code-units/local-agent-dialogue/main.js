(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.local-agent-dialogue';
  const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.11';
  const LOCAL_AGENT_ID = 'dcf.firstparty.local-agent';
  const PANEL_ID = 'dcf-panel-local-agent';
  const SHELL_ID = 'dcf-chrome-shell-host';
  const MOUNT_ID = 'dcf-local-agent-dialogue-mount';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__';
  const MARKERS = Object.freeze({
    request: ['<<<DCF_LOCAL_AGENT_REQUEST>>>', '<<<END_DCF_LOCAL_AGENT_REQUEST>>>'],
    result: ['<<<DCF_LOCAL_AGENT_RESULT>>>', '<<<END_DCF_LOCAL_AGENT_RESULT>>>'],
    permissionRequest: ['<<<DCF_LOCAL_AGENT_PERMISSION_REQUEST>>>', '<<<END_DCF_LOCAL_AGENT_PERMISSION_REQUEST>>>'],
    permissionDecision: ['<<<DCF_LOCAL_AGENT_PERMISSION_DECISION>>>', '<<<END_DCF_LOCAL_AGENT_PERMISSION_DECISION>>>'],
    acceptance: ['<<<DCF_LOCAL_AGENT_DIALOGUE_ACCEPTANCE>>>', '<<<END_DCF_LOCAL_AGENT_DIALOGUE_ACCEPTANCE>>>']
  });
  const DEFAULTS = Object.freeze({
    enabled: true,
    auto_send_results: true,
    poll_interval_ms: 1200,
    idle_timeout_ms: 20 * 60 * 1000,
    message_limit: 120
  });

  globalThis[GLOBAL_KEY]?.destroy?.();

  const list = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const json = (value) => { try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); } };
  const hash = (value) => {
    let output = 2166136261;
    for (const char of String(value || '')) {
      output ^= char.charCodeAt(0);
      output = Math.imul(output, 16777619);
    }
    return (output >>> 0).toString(16);
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const host = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
    return result;
  });

  let destroyed = false;
  let activeJob = null;
  let queueBusy = false;
  let pendingArtifact = '';
  let pendingForceSend = false;
  let conversationRoot = null;
  let currentCandidate = null;
  let conversationObserver = null;
  let documentObserver = null;
  let shellObserver = null;
  let panelObserver = null;
  let currentShellShadow = null;
  let currentPanelShadow = null;
  let mountHost = null;
  let mountRoot = null;
  let boundMountRoot = null;
  let shellReadyListener = null;
  let panelReadyListener = null;
  let mountTimer = null;
  let rootTimer = null;
  let elapsedTimer = null;

  const queue = [];
  const baselineNodes = new WeakSet();
  const nodeState = new WeakMap();
  const counters = { baseline: 0, new_events: 0, tasks: 0, permission_requests: 0, permission_decisions: 0 };
  const state = {
    settings: { ...DEFAULTS },
    processed_ids: [],
    stage: 'idle',
    status: '等待新的助手回复',
    error: '',
    last_request_id: '',
    last_session_id: '',
    started_at: 0,
    progress: { status_type: '', messages: 0, todo: 0, diff: 0, permissions: 0, questions: 0, preview: '', last_activity_at: '' }
  };

  function normalizeSettings(raw = {}) {
    const legacyTimeout = raw.idle_timeout_ms ?? raw.timeout_ms;
    return {
      enabled: raw.enabled !== false,
      auto_send_results: raw.auto_send_results !== false,
      poll_interval_ms: Math.max(500, Math.min(5000, Number(raw.poll_interval_ms) || DEFAULTS.poll_interval_ms)),
      idle_timeout_ms: Math.max(30000, Math.min(6 * 60 * 60 * 1000, Number(legacyTimeout) || DEFAULTS.idle_timeout_ms)),
      message_limit: Math.max(20, Math.min(200, Number(raw.message_limit) || DEFAULTS.message_limit))
    };
  }

  async function loadState() {
    const result = await host({ type: 'plugin.data.get', plugin_id: UNIT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    state.settings = normalizeSettings(data.settings);
    state.processed_ids = list(data.processed_ids).map(String).slice(-80);
    state.last_request_id = String(data.last_request_id || '');
    state.last_session_id = String(data.last_session_id || '');
  }

  function persist() {
    return host({
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

  function shellShadow() { return document.getElementById(SHELL_ID)?.shadowRoot || null; }
  function localAgentPanel() {
    return document.getElementById(PANEL_ID) || shellShadow()?.querySelector(`#${PANEL_ID}`) || null;
  }
  function localAgentShadow() { return localAgentPanel()?.shadowRoot || null; }

  function normalizeModel(value) {
    if (!value || typeof value !== 'object') return null;
    const providerID = String(value.providerID || '').trim();
    const modelID = String(value.modelID || '').trim();
    return providerID && modelID ? { providerID, modelID } : null;
  }

  function encodeModelValue(model) {
    const normalized = normalizeModel(model);
    if (!normalized) return '';
    return JSON.stringify({ providerID: normalized.providerID, modelID: normalized.modelID });
  }

  function decodeModelValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return normalizeModel(parsed && typeof parsed === 'object' ? { providerID: parsed.providerID, modelID: parsed.modelID } : null);
    } catch (_) {
      return null;
    }
  }

  async function connectionConfig() {
    const result = await host({ type: 'plugin.data.get', plugin_id: LOCAL_AGENT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const stored = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = localAgentShadow();
    const modelValue = String(shadow?.querySelector('[data-field="model"]')?.value || '');
    return {
      base_url: String(shadow?.querySelector('[data-field="base-url"]')?.value || stored.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(shadow?.querySelector('[data-field="username"]')?.value || stored.username || 'opencode').trim() || 'opencode',
      password: String(shadow?.querySelector('[data-field="password"]')?.value || ''),
      agent: String(shadow?.querySelector('[data-field="agent"]')?.value || stored.agent || ''),
      model: decodeModelValue(modelValue) || normalizeModel(stored.model) || null
    };
  }

  function normalizeBaseUrl(raw) {
    let url;
    try { url = new URL(String(raw || 'http://127.0.0.1:4096').trim().replace(/\/$/, '')); }
    catch (_) { throw new Error('OpenCode 地址无效'); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('对话闭环只允许连接本机 loopback 地址');
    }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) {
      throw new Error('OpenCode 地址只能包含协议、主机与端口');
    }
    return `${url.protocol}//${url.hostname === '[::1]' ? '[::1]' : url.hostname}:${url.port || '4096'}`;
  }

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  async function request(path, options = {}) {
    const config = options.config || await connectionConfig();
    const controller = new AbortController();
    const noTimeout = options.timeout === 0 || options.timeout === null;
    const timeout = noTimeout ? 0 : Math.max(1000, Math.min(60 * 60 * 1000, Number(options.timeout) || 15000));
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const headers = { Accept: 'application/json' };
      if (config.password) headers.Authorization = basicAuth(config.username, config.password);
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${normalizeBaseUrl(config.base_url)}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store', credentials: 'omit', mode: 'cors', redirect: 'error', signal: controller.signal
      });
      const text = response.status === 204 ? '' : await response.text();
      let payload = null;
      if (text) { try { payload = JSON.parse(text); } catch (_) { payload = text; } }
      if (!response.ok) {
        const detail = typeof payload === 'string' ? payload : payload?.error || payload?.message || '';
        const error = new Error(`OpenCode HTTP ${response.status}${detail ? `：${detail}` : ''}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      const wrapped = new Error(error?.name === 'AbortError' ? `OpenCode 单次请求超时：${path}` : String(error?.message || error));
      wrapped.code = error?.name === 'AbortError' ? 'request_timeout' : /Failed to fetch|NetworkError|Load failed|CORS/i.test(wrapped.message) ? 'network_or_cors' : 'request_failed';
      wrapped.status = error?.status || 0;
      throw wrapped;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function optional(path, config) {
    try { return { ok: true, data: await request(path, { config }) }; }
    catch (error) { return { ok: false, error: String(error?.message || error), detail: error }; }
  }

  async function optionalFallback(paths, config) {
    let last = null;
    for (const path of paths) {
      const result = await optional(path, config);
      if (result.ok || !/404|405/.test(result.error || '')) return result;
      last = result;
    }
    return last || { ok: false, error: 'endpoint unavailable' };
  }

  const sessionId = (value) => String(value?.id || value?.sessionID || value?.session_id || '');
  const permissionId = (value) => String(value?.id || value?.requestID || value?.request_id || '');
  const messageId = (value) => String(value?.info?.id || value?.id || value?.messageID || value?.message_id || '');
  const messageRole = (value) => String(value?.info?.role || value?.info?.type || '').toLowerCase();
  const statusType = (value, fallback = 'unknown') => String(typeof value === 'string' ? value : value?.type || value?.status || value?.state || fallback).toLowerCase();

  function sessionStatusFrom(value, id) {
    const collection = value?.sessions && typeof value.sessions === 'object' ? value.sessions
      : value?.data?.sessions && typeof value.data.sessions === 'object' ? value.data.sessions
        : value?.data && typeof value.data === 'object' ? value.data : value || {};
    return collection[id] || list(collection).find((item) => String(item?.sessionID || item?.session_id || item?.sessionId || item?.id || '') === id) || null;
  }

  function partText(part) {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text' || part.type === 'reasoning') return String(part.text || '');
    if (part.type === 'tool') {
      const title = part.state?.title || part.state?.error || '';
      return `[${part.tool || part.name || 'tool'} · ${statusType(part.state)}${title ? ` · ${title}` : ''}]`;
    }
    if (part.type === 'step-finish' && part.reason) return `[步骤结束 · ${part.reason}]`;
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

  function formalAssistantText(message) {
    return list(message?.parts)
      .filter((part) => part && part.type === 'text')
      .map((part) => String(part.text || ''))
      .join('\n')
      .trim();
  }

  function latestAssistantFormalText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messageRole(messages[index]).includes('assistant')) {
        const text = formalAssistantText(messages[index]);
        if (text) return text;
      }
    }
    return '';
  }

  function normalizeArtifactText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
  }

  function extractEnvelope(text, markers) {
    const value = normalizeArtifactText(text);
    const start = value.indexOf(markers[0]);
    if (start < 0) return null;
    const end = value.indexOf(markers[1], start + markers[0].length);
    if (end < 0) return { pending: true };
    let body = value.slice(start + markers[0].length, end).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const first = body.indexOf('{');
    const last = body.lastIndexOf('}');
    if (first >= 0 && last > first) body = body.slice(first, last + 1);
    return { pending: false, body };
  }

  function escapeJsonControls(source) {
    let output = '', inString = false, escaped = false;
    for (const char of String(source || '')) {
      if (!inString) { output += char; if (char === '"') inString = true; continue; }
      if (escaped) { output += char; escaped = false; continue; }
      if (char === '\\') { output += char; escaped = true; continue; }
      if (char === '"') { output += char; inString = false; continue; }
      output += char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t'
        : char.charCodeAt(0) < 0x20 ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char;
    }
    return output;
  }

  function parseJsonEnvelope(envelope, label) {
    if (!envelope || envelope.pending) return envelope;
    try { return JSON.parse(envelope.body); }
    catch (firstError) {
      try { return JSON.parse(escapeJsonControls(envelope.body)); }
      catch (secondError) { throw new Error(`${label} JSON 解析失败：${secondError?.message || firstError?.message}`); }
    }
  }

  function parseArtifact(text) {
    const decisionEnvelope = extractEnvelope(text, MARKERS.permissionDecision);
    if (decisionEnvelope) {
      const payload = parseJsonEnvelope(decisionEnvelope, 'DCF_LOCAL_AGENT_PERMISSION_DECISION');
      if (payload?.pending) return payload;
      if (payload?.schema !== 'dcf.local-agent.permission-decision.v1') throw new Error('权限决定 schema 无效');
      const decision = {
        kind: 'permission_decision',
        request_id: String(payload.request_id || ''),
        session_id: String(payload.session_id || ''),
        permission_id: String(payload.permission_id || ''),
        decision: String(payload.decision || '').toLowerCase(),
        reason: String(payload.reason || payload.message || '').slice(0, 8000)
      };
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(decision.request_id)
        || !/^ses_[A-Za-z0-9_-]+$/.test(decision.session_id)
        || !/^per_[A-Za-z0-9_-]+$/.test(decision.permission_id)
        || !['once', 'always', 'reject'].includes(decision.decision)) throw new Error('权限决定字段无效');
      return decision;
    }

    const requestEnvelope = extractEnvelope(text, MARKERS.request);
    if (!requestEnvelope) return null;
    const payload = parseJsonEnvelope(requestEnvelope, 'DCF_LOCAL_AGENT_REQUEST');
    if (payload?.pending) return payload;
    if (payload?.schema !== 'dcf.local-agent.request.v1' || String(payload.mode || 'new') !== 'new') {
      throw new Error('DCF_LOCAL_AGENT_REQUEST schema 或 mode 无效');
    }
    const id = String(payload.id || '').trim();
    const task = String(payload.task || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id) || !task || task.length > 30000) throw new Error('DCF_LOCAL_AGENT_REQUEST 字段无效');
    const requestedIdle = Number(payload.idle_timeout_ms ?? payload.timeout_ms) || state.settings.idle_timeout_ms;
    return {
      kind: 'task', id, task,
      title: String(payload.title || `DCF · ${task.slice(0, 56)}`).slice(0, 240),
      return_mode: payload.return_mode === 'full' ? 'full' : 'summary',
      idle_timeout_ms: Math.max(30000, Math.min(6 * 60 * 60 * 1000, requestedIdle))
    };
  }

  function pageConversationRoot() { return document.querySelector('main') || document.querySelector('[role="main"]'); }
  function assistantNodes(root = conversationRoot) { return root ? Array.from(root.querySelectorAll('[data-message-author-role="assistant"]')) : []; }
  function latestAssistantNode() { const nodes = assistantNodes(); return nodes[nodes.length - 1] || null; }
  function containingAssistantNode(value) {
    if (!(value instanceof Node)) return null;
    const element = value.nodeType === Node.ELEMENT_NODE ? value : value.parentElement;
    return element?.closest?.('[data-message-author-role="assistant"]') || null;
  }

  function scheduleInspect(node, force = false) {
    if (!(node instanceof Element)) return;
    const previous = nodeState.get(node) || {};
    clearTimeout(previous.timer);
    const timer = setTimeout(() => inspectNode(node, force).catch(reportFatal), force ? 0 : 260);
    nodeState.set(node, { ...previous, timer });
  }

  async function inspectNode(node, force = false) {
    if (!state.settings.enabled || !(node instanceof Element) || !node.isConnected) return;
    if (!force && (node !== currentCandidate || baselineNodes.has(node))) return;
    const text = String(node.innerText || node.textContent || '').trim();
    const previous = nodeState.get(node) || {};
    if (!force && previous.text === text) return;
    nodeState.set(node, { text, timer: null });
    if (!text.includes(MARKERS.request[0]) && !text.includes(MARKERS.permissionDecision[0])) return;
    const parsed = parseArtifact(text);
    if (!parsed) return;
    if (parsed.pending) {
      state.stage = 'detecting';
      state.status = '检测到不完整工件，等待助手回复生成完成';
      render();
      return;
    }
    if (parsed.kind === 'permission_decision') {
      await applyPermissionDecision(parsed);
      return;
    }
    if (state.processed_ids.includes(parsed.id)) {
      state.stage = activeJob ? state.stage : 'idle';
      state.status = `最新回复中的工件已经处理：${parsed.id}`;
      render();
      return;
    }
    enqueue(parsed);
  }

  function baselineCurrentConversation(root) {
    currentCandidate = null;
    const nodes = assistantNodes(root);
    counters.baseline = nodes.length;
    for (const node of nodes) baselineNodes.add(node);
    const latest = nodes[nodes.length - 1] || null;
    if (latest && isStreaming()) {
      const text = String(latest.innerText || latest.textContent || '');
      const incomplete = [MARKERS.request, MARKERS.permissionDecision].some(([start, end]) => text.includes(start) && !text.includes(end));
      if (incomplete) { baselineNodes.delete(latest); currentCandidate = latest; scheduleInspect(latest); }
    }
    state.status = activeJob ? state.status : '等待新的助手回复';
    render();
  }

  function attachConversationRoot() {
    const root = pageConversationRoot();
    if (!root || root === conversationRoot) return false;
    conversationObserver?.disconnect();
    conversationRoot = root;
    baselineCurrentConversation(root);
    conversationObserver = new MutationObserver((records) => {
      for (const record of records) {
        const direct = containingAssistantNode(record.target);
        if (direct && direct === currentCandidate) scheduleInspect(direct);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const candidates = [];
          if (node.matches?.('[data-message-author-role="assistant"]')) candidates.push(node);
          candidates.push(...(node.querySelectorAll?.('[data-message-author-role="assistant"]') || []));
          for (const item of candidates) {
            if (baselineNodes.has(item)) continue;
            counters.new_events += 1;
            if (item !== latestAssistantNode()) { baselineNodes.add(item); continue; }
            currentCandidate = item;
            scheduleInspect(item);
          }
          const parent = containingAssistantNode(node);
          if (parent && parent === currentCandidate) scheduleInspect(parent);
        }
      }
    });
    conversationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function enqueue(requestData) {
    if (activeJob?.request.id === requestData.id || queue.some((item) => item.id === requestData.id)) return;
    queue.push(requestData);
    state.last_request_id = requestData.id;
    state.stage = 'received';
    state.status = '已识别新的完整工件，等待委派';
    render();
    processQueue().catch(reportFatal);
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
    const status = statuses.ok ? sessionStatusFrom(statuses.data, job.session_id) : null;
    const belongs = (item) => {
      const id = String(item?.sessionID || item?.session_id || item?.sessionId || '');
      return !id || id === job.session_id;
    };
    const messageList = messages.ok ? list(messages.data) : [];
    if (job.response_state === 'fulfilled' && job.response && !messageList.some((item) => messageId(item) === messageId(job.response))) messageList.push(job.response);
    return {
      status,
      status_type: status ? statusType(status) : statuses.ok ? (job.response_state === 'fulfilled' ? 'idle' : 'message-pending') : 'status-unavailable',
      messages: messageList,
      todo: todo.ok ? list(todo.data) : [],
      diff: diff.ok ? list(diff.data) : [],
      permissions: permissions.ok ? list(permissions.data).filter(belongs) : [],
      questions: questions.ok ? list(questions.data).filter(belongs) : [],
      endpoint_errors: {
        status: statuses.ok ? null : statuses.error,
        messages: messages.ok ? null : messages.error,
        todo: todo.ok ? null : todo.error,
        diff: diff.ok ? null : diff.error,
        permissions: permissions.ok ? null : permissions.error,
        questions: questions.ok ? null : questions.error,
        message_request: job.response_state === 'rejected' ? String(job.response_error?.message || job.response_error) : null
      }
    };
  }

  function activityFingerprint(snap, job) {
    const messages = snap.messages.map((message) => ({
      id: messageId(message),
      role: messageRole(message),
      parts: list(message?.parts).map((part) => ({
        id: String(part?.id || part?.partID || ''),
        type: String(part?.type || ''),
        text: (part?.type === 'text' || part?.type === 'reasoning') ? String(part.text || '').slice(-2500) : '',
        tool: String(part?.tool || part?.name || ''),
        callID: String(part?.callID || part?.callId || ''),
        state: statusType(part?.state, ''),
        title: String(part?.state?.title || part?.state?.error || ''),
        input_hash: hash(json(part?.state?.input || null)),
        output_hash: hash(json(part?.state?.output || null))
      }))
    }));
    return hash(json({
      response_state: job.response_state,
      status_type: snap.status_type,
      messages,
      todo: snap.todo,
      diff: snap.diff,
      permissions: snap.permissions,
      questions: snap.questions
    }));
  }

  function noteActivity(job, fingerprint) {
    if (job.activity_fingerprint !== fingerprint) {
      job.activity_fingerprint = fingerprint;
      job.last_activity_at = Date.now();
    }
    state.progress.last_activity_at = new Date(job.last_activity_at).toLocaleTimeString();
  }

  async function confirmInactive(job, fingerprint) {
    await sleep(Math.max(500, state.settings.poll_interval_ms));
    const first = await snapshot(job);
    const firstFingerprint = activityFingerprint(first, job);
    if (firstFingerprint !== fingerprint || first.permissions.length || first.questions.length) return null;
    await sleep(Math.max(500, state.settings.poll_interval_ms));
    const second = await snapshot(job);
    return activityFingerprint(second, job) === fingerprint && !second.permissions.length && !second.questions.length ? second : null;
  }

  function updateProgress(job, snap) {
    state.progress = {
      status_type: snap.status_type,
      messages: snap.messages.length,
      todo: snap.todo.length,
      diff: snap.diff.length,
      permissions: snap.permissions.length,
      questions: snap.questions.length,
      preview: latestAssistant(snap.messages).slice(-900),
      last_activity_at: new Date(job.last_activity_at).toLocaleTimeString()
    };
  }

  function findToolEvidence(messages, permission) {
    const wantedMessage = String(permission?.tool?.messageID || permission?.tool?.messageId || '');
    const wantedCall = String(permission?.tool?.callID || permission?.tool?.callId || '');
    for (const message of messages) {
      if (wantedMessage && messageId(message) !== wantedMessage) continue;
      for (const part of list(message?.parts)) {
        if (part?.type !== 'tool') continue;
        const callID = String(part.callID || part.callId || '');
        if (wantedCall && callID !== wantedCall) continue;
        return {
          found: true,
          message_id: messageId(message),
          call_id: callID,
          name: String(part.tool || part.name || permission.permission || permission.action || ''),
          status: statusType(part.state),
          input: part.state?.input ?? null,
          title: String(part.state?.title || ''),
          error: String(part.state?.error || '')
        };
      }
    }
    return { found: false, message_id: wantedMessage, call_id: wantedCall, name: String(permission?.permission || permission?.action || ''), input: null };
  }

  function permissionRequestPayload(job, permission, snap) {
    const tool = findToolEvidence(snap.messages, permission);
    return {
      schema: 'dcf.local-agent.permission-request.v1',
      request_id: job.request.id,
      session_id: job.session_id,
      permission_id: permissionId(permission),
      raw_permission: permission,
      tool,
      task_context: {
        original_task: job.request.task,
        recent_assistant_output: latestAssistantFormalText(snap.messages).slice(-6000),
        todo: snap.todo,
        diff: snap.diff
      },
      evidence_completeness: {
        tool_input_found: tool.found,
        diff_available: snap.diff.length > 0,
        permission_metadata_available: Boolean(permission?.metadata && Object.keys(permission.metadata).length)
      },
      allowed_decisions: ['once', 'always', 'reject'],
      note: '这是 OpenCode 原生权限事件的证据投影。请返回 dcf.local-agent.permission-decision.v1；当前阶段只处理本次权限，不管理长期授权撤销。'
    };
  }

  const artifact = (markers, value) => `${markers[0]}\n${json(value)}\n${markers[1]}`;
  const composer = () => document.querySelector('#prompt-textarea') || document.querySelector('[data-testid="composer-text-input"]') || document.querySelector('form textarea') || document.querySelector('main [contenteditable="true"]');
  const composerValue = (target) => target ? String('value' in target ? target.value || '' : target.innerText || target.textContent || '') : '';
  const isStreaming = () => Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]'));

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
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (!document.execCommand?.('insertText', false, text)) target.textContent = text;
    }
    try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
    catch (_) { target.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  async function clickSend() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const button = document.querySelector('[data-testid="send-button"]') || document.querySelector('button[aria-label*="Send"],button[aria-label*="发送"]');
      if (!isStreaming() && button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') { button.click(); return; }
      await sleep(50);
    }
    throw new Error('工件已写入输入框，但发送按钮暂不可用');
  }

  async function sendArtifact(text, forceSend = false) {
    pendingArtifact = text;
    pendingForceSend = forceSend;
    const started = Date.now();
    while (!destroyed && pendingArtifact === text && Date.now() - started < 120000) {
      const target = composer();
      if (target && !composerValue(target).trim() && !isStreaming()) {
        fillComposer(text);
        if (forceSend || state.settings.auto_send_results) await clickSend();
        pendingArtifact = '';
        pendingForceSend = false;
        return true;
      }
      await sleep(500);
    }
    state.stage = 'return_wait';
    state.status = '工件等待回传';
    state.error = '当前对话尚未空闲，未覆盖输入框';
    render();
    return false;
  }

  async function returnPermissionRequest(job, permission, snap) {
    const id = permissionId(permission);
    if (!id || job.notified_permissions.has(id)) return;
    job.notified_permissions.add(id);
    job.awaiting_permission_id = id;
    counters.permission_requests += 1;
    state.stage = 'needs_user';
    state.status = '权限请求已送回当前对话，等待判断';
    render();
    await sendArtifact(artifact(MARKERS.permissionRequest, permissionRequestPayload(job, permission, snap)), true);
  }

  async function replyPermissionNative(job, decision) {
    const body = { reply: decision.decision };
    if (decision.reason) body.message = decision.reason;
    const oldPath = `/permission/${encodeURIComponent(decision.permission_id)}/reply`;
    try {
      await request(oldPath, { config: job.config, method: 'POST', body, timeout: 15000 });
      return oldPath;
    } catch (error) {
      if (!/404|405/.test(String(error?.message || error))) throw error;
    }
    const newPath = `/api/session/${encodeURIComponent(job.session_id)}/permission/${encodeURIComponent(decision.permission_id)}/reply`;
    await request(newPath, { config: job.config, method: 'POST', body, timeout: 15000 });
    return newPath;
  }

  async function applyPermissionDecision(decision) {
    const job = activeJob;
    if (!job) throw new Error('当前没有可接收权限决定的本机任务');
    if (decision.request_id !== job.request.id || decision.session_id !== job.session_id || decision.permission_id !== job.awaiting_permission_id) {
      throw new Error('权限决定与当前 request/session/permission 不匹配');
    }
    state.stage = 'permission_reply';
    state.status = `正在把权限决定 ${decision.decision} 送回原 session`;
    render();
    await replyPermissionNative(job, decision);
    counters.permission_decisions += 1;
    job.awaiting_permission_id = '';
    job.last_activity_at = Date.now();
    state.stage = job.response_state === 'rejected' ? 'detached' : 'running';
    state.status = '权限决定已送回原 session，继续执行';
    render();
  }

  function resultPayload(job, status, snap) {
    return {
      schema: 'dcf.local-agent.result.v1',
      request_id: job.request.id,
      status,
      session_id: job.session_id,
      assistant_result: latestAssistantFormalText(snap.messages),
      todo: snap.todo,
      diff: snap.diff,
      permissions: snap.permissions,
      questions: snap.questions,
      execution: {
        elapsed_ms: Date.now() - job.started_at,
        status_type: snap.status_type,
        timeout_basis: 'observable-idle-time',
        idle_timeout_ms: job.request.idle_timeout_ms,
        last_activity_at: new Date(job.last_activity_at).toISOString(),
        base_url: normalizeBaseUrl(job.config.base_url),
        endpoint_errors: snap.endpoint_errors
      }
    };
  }

  async function poll(job) {
    while (!destroyed && activeJob === job) {
      const snap = await snapshot(job);
      job.last_snapshot = snap;
      const fingerprint = activityFingerprint(snap, job);
      noteActivity(job, fingerprint);
      updateProgress(job, snap);

      const pendingPermissions = snap.permissions.filter((item) => permissionId(item));
      const hasIntervention = pendingPermissions.length > 0 || snap.questions.length > 0;
      if (pendingPermissions.length) {
        state.stage = 'needs_user';
        state.status = '检测到 OpenCode 权限请求；无活动超时已暂停';
        render();
        await returnPermissionRequest(job, pendingPermissions[0], snap);
      } else if (snap.questions.length) {
        state.stage = 'needs_user';
        state.status = 'OpenCode 正在等待回答；当前阶段仅自动转交权限请求';
        render();
      } else {
        if (job.awaiting_permission_id) job.awaiting_permission_id = '';
        const assistantResult = latestAssistantFormalText(snap.messages);
        const terminalStatus = ['idle', 'completed'].includes(snap.status_type);
        if ((job.response_state === 'fulfilled' || terminalStatus) && assistantResult) {
          const finalSnap = await snapshot(job);
          return resultPayload(job, 'completed', finalSnap);
        }
        if (['failed', 'error'].includes(snap.status_type)) return resultPayload(job, 'failed', snap);
        state.stage = job.response_state === 'rejected' ? 'detached' : 'running';
        state.status = job.response_state === 'rejected'
          ? '同步消息连接已断开，但 session 仍在观察'
          : `本机执行中 · ${snap.status_type}`;
        render();
      }

      if (!hasIntervention && Date.now() - job.last_activity_at >= job.request.idle_timeout_ms) {
        const inactiveSnapshot = await confirmInactive(job, fingerprint);
        if (inactiveSnapshot) return resultPayload(job, 'inactive_timeout', inactiveSnapshot);
      }
      await sleep(state.settings.poll_interval_ms);
    }
    throw new Error('对话闭环已停止');
  }

  async function run(requestData) {
    counters.tasks += 1;
    state.started_at = Date.now();
    state.stage = 'checking';
    state.status = '正在检查 OpenCode 服务';
    state.error = '';
    render();
    const config = await connectionConfig();
    await request('/global/health', { config, timeout: 8000 });
    state.stage = 'creating';
    state.status = '服务已连接，正在创建会话';
    render();
    const session = await request('/session', { config, method: 'POST', body: { title: requestData.title } });
    const session_id = sessionId(session);
    if (!session_id) throw new Error('OpenCode 未返回 session ID');
    const body = { parts: [{ type: 'text', text: requestData.task }] };
    if (config.agent) body.agent = config.agent;
    if (config.model) body.model = config.model;
    const job = {
      request: requestData,
      config,
      session_id,
      started_at: Date.now(),
      response_state: 'pending',
      response: null,
      response_error: null,
      activity_fingerprint: '',
      last_activity_at: Date.now(),
      last_snapshot: null,
      notified_permissions: new Set(),
      awaiting_permission_id: ''
    };
    activeJob = job;
    state.last_request_id = requestData.id;
    state.last_session_id = session_id;
    state.processed_ids = [...state.processed_ids.filter((id) => id !== requestData.id), requestData.id].slice(-80);
    state.stage = 'submitting';
    state.status = '会话已创建，正在提交同步消息请求';
    await persist();
    render();
    request(`/session/${encodeURIComponent(session_id)}/message`, {
      config, method: 'POST', body, timeout: 0
    }).then((response) => {
      job.response_state = 'fulfilled';
      job.response = response;
      job.last_activity_at = Date.now();
    }).catch((error) => {
      job.response_state = 'rejected';
      job.response_error = error;
      job.last_activity_at = Date.now();
    });
    state.stage = 'running';
    state.status = '消息请求已提交，正在根据 session 活动持续观察';
    render();
    const finalPayload = await poll(job);
    state.stage = finalPayload.status;
    state.status = finalPayload.status === 'completed' ? '本机任务完成，正在回传' : `本机任务结束 · ${finalPayload.status}`;
    render();
    await sendArtifact(artifact(MARKERS.result, finalPayload));
  }

  async function returnFailure(error, requestData) {
    const job = activeJob;
    const snap = job?.last_snapshot || { messages: [], todo: [], diff: [], permissions: [], questions: [] };
    const failure = {
      schema: 'dcf.local-agent.result.v1',
      request_id: requestData?.id || job?.request.id || 'unknown',
      status: 'bridge_error',
      session_id: job?.session_id || '',
      assistant_result: latestAssistantFormalText(snap.messages || []),
      todo: snap.todo || [], diff: snap.diff || [], permissions: snap.permissions || [], questions: snap.questions || [],
      execution: {
        elapsed_ms: state.started_at ? Date.now() - state.started_at : 0,
        status_type: 'bridge_error',
        base_url: job ? normalizeBaseUrl(job.config.base_url) : '',
        endpoint_errors: { bridge: String(error?.message || error), code: error?.code || '' }
      }
    };
    state.stage = 'failed';
    state.status = '委派失败，正在回传';
    state.error = String(error?.message || error);
    render();
    await sendArtifact(artifact(MARKERS.result, failure)).catch(() => {});
  }

  async function processQueue() {
    if (queueBusy || activeJob || !state.settings.enabled || !queue.length) return;
    queueBusy = true;
    const requestData = queue.shift();
    try { await run(requestData); }
    catch (error) { await returnFailure(error, requestData); }
    finally {
      activeJob = null;
      queueBusy = false;
      persist().catch(() => {});
      render();
      if (queue.length) processQueue().catch(reportFatal);
    }
  }

  function inspectLatestAssistant() {
    attachConversationRoot();
    const node = latestAssistantNode();
    if (!node) { state.status = '当前页面没有助手回复'; render(); return; }
    currentCandidate = node;
    scheduleInspect(node, true);
  }

  async function runAcceptance() {
    if (activeJob || queueBusy || queue.length) throw new Error('本机任务正在执行');
    const report = {
      schema: 'dcf.local-agent-dialogue.acceptance.v1',
      generated_at: new Date().toISOString(),
      plugin: { id: UNIT_ID, version: UNIT_VERSION, intake_model: 'new-assistant-event-stream' },
      lifecycle: { timeout_basis: 'observable-idle-time', permission_wait_pauses_idle_timeout: true },
      checks: {
        mounted: Boolean(mountHost?.isConnected && mountRoot),
        events_bound: boundMountRoot === mountRoot,
        history_is_baseline: true,
        permission_request_protocol: Boolean(MARKERS.permissionRequest[0]),
        permission_decision_protocol: Boolean(MARKERS.permissionDecision[0]),
        no_active_job: !activeJob
      },
      counters
    };
    report.passed = Object.values(report.checks).every(Boolean);
    await sendArtifact(artifact(MARKERS.acceptance, report), true);
  }

  function clearProcessed() {
    if (activeJob || queueBusy || queue.length) throw new Error('本机任务正在执行');
    state.processed_ids = [];
    state.last_request_id = '';
    state.last_session_id = '';
    state.stage = 'idle';
    state.status = '已清除工件去重记录；历史消息仍不会自动执行';
    persist().then(render).catch(reportFatal);
  }

  function elapsedText() {
    if (!state.started_at || !activeJob) return '';
    const seconds = Math.floor((Date.now() - state.started_at) / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
  }

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:8px}.row,.head{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.head b{flex:1}.muted{color:#666;font-size:12px;overflow-wrap:anywhere}.status{border:1px solid #ccc;border-radius:999px;padding:2px 7px;font-size:11px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.metric{border:1px solid #ddd;border-radius:7px;padding:5px}.metric b{display:block}.preview{max-height:140px;overflow:auto;white-space:pre-wrap;background:#f6f6f6;padding:7px;border-radius:7px;font:11px/1.4 monospace}.buttons{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.buttons .primary{grid-column:1/-1;background:#202124;color:#fff}button,input{font:inherit;border:1px solid #bbb;border-radius:7px;padding:6px;background:#fff;color:inherit}.error{color:#b42318}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}.muted{color:#aaa}.metric{border-color:#444}.preview{background:#181818}button,input{background:#292929;border-color:#555}.buttons .primary{background:#eee;color:#111}}`;
  }

  function render() {
    if (!mountRoot) return;
    const active = Boolean(activeJob) || queueBusy;
    const progress = state.progress;
    mountRoot.innerHTML = `<style>${style()}</style><section class="card"><div class="head"><b>对话闭环</b><span class="status">${active ? '执行中' : state.settings.enabled ? '已开启' : '已关闭'}</span></div><div class="muted">历史消息只建立基线；长任务按最近活动判断；权限请求交由当前对话裁决。</div><div class="row"><label><input type="checkbox" data-field="enabled" ${state.settings.enabled ? 'checked' : ''}>自动委派</label><label><input type="checkbox" data-field="auto-send" ${state.settings.auto_send_results ? 'checked' : ''}>结果自动发送</label></div><div><b>${escapeHtml(state.status)}</b>${elapsedText() ? ` · ${elapsedText()}` : ''}<br><span class="muted">阶段：${escapeHtml(state.stage)}${activeJob ? ` · ${escapeHtml(activeJob.request.id)} · ${escapeHtml(activeJob.session_id)}` : ''}</span></div><div class="grid"><div class="metric">状态<b>${escapeHtml(progress.status_type || '—')}</b></div><div class="metric">消息<b>${progress.messages}</b></div><div class="metric">Todo<b>${progress.todo}</b></div><div class="metric">Diff<b>${progress.diff}</b></div><div class="metric">权限<b>${progress.permissions}</b></div><div class="metric">提问<b>${progress.questions}</b></div></div>${progress.preview ? `<div class="preview">${escapeHtml(progress.preview)}</div>` : ''}<div class="buttons"><button class="primary" data-action="acceptance">一键验收并回传</button><button data-action="latest">检查最新助手回复</button><button data-action="return">回传待发送工件</button><button data-action="clear">清除已处理记录</button></div>${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}</section>`;
  }

  async function handleAction(action) {
    if (action === 'acceptance') return runAcceptance();
    if (action === 'latest') return inspectLatestAssistant();
    if (action === 'clear') return clearProcessed();
    if (action !== 'return') return;
    if (!pendingArtifact) { state.status = '当前没有待回传工件'; render(); return; }
    if (composerValue(composer()).trim() || isStreaming()) throw new Error('当前对话尚未空闲');
    const text = pendingArtifact;
    fillComposer(text);
    if (pendingForceSend || state.settings.auto_send_results) await clickSend();
    pendingArtifact = '';
    pendingForceSend = false;
    render();
  }

  function bindMountEvents() {
    if (!mountRoot || boundMountRoot === mountRoot) return;
    boundMountRoot = mountRoot;
    mountRoot.addEventListener('click', (event) => {
      const button = event.target.closest?.('button[data-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      handleAction(button.dataset.action).catch(reportFatal);
    });
    mountRoot.addEventListener('change', (event) => {
      const field = event.target?.dataset?.field;
      if (field === 'enabled') {
        state.settings.enabled = event.target.checked;
        state.stage = state.settings.enabled ? 'idle' : 'disabled';
        state.status = state.settings.enabled ? '等待新的助手回复' : '闭环已关闭';
        persist().then(render).catch(reportFatal);
      } else if (field === 'auto-send') {
        state.settings.auto_send_results = event.target.checked;
        persist().then(render).catch(reportFatal);
      }
    });
  }

  function ensurePanelMount() {
    const shadow = localAgentShadow();
    if (!shadow) return false;
    if (shadow !== currentPanelShadow) {
      panelObserver?.disconnect();
      currentPanelShadow = shadow;
      panelObserver = new MutationObserver(() => {
        if (!shadow.querySelector(`#${MOUNT_ID}`)) queueMicrotask(ensurePanelMount);
      });
      panelObserver.observe(shadow, { childList: true, subtree: true });
      mountHost = null;
      mountRoot = null;
      boundMountRoot = null;
    }
    let element = shadow.querySelector(`#${MOUNT_ID}`);
    if (!element) { element = document.createElement('div'); element.id = MOUNT_ID; shadow.append(element); }
    if (element !== mountHost) {
      mountHost = element;
      mountRoot = element.shadowRoot || element.attachShadow({ mode: 'open' });
      bindMountEvents();
      render();
    }
    return Boolean(mountHost?.isConnected && mountRoot && boundMountRoot === mountRoot);
  }

  function attachShellObserver() {
    const shadow = shellShadow();
    if (shadow === currentShellShadow) return Boolean(shadow);
    shellObserver?.disconnect();
    currentShellShadow = shadow;
    if (!shadow) return false;
    shellObserver = new MutationObserver(() => queueMicrotask(ensurePanelMount));
    shellObserver.observe(shadow, { childList: true, subtree: true });
    ensurePanelMount();
    return true;
  }

  function attachWatchers() {
    documentObserver = new MutationObserver(() => {
      attachShellObserver();
      ensurePanelMount();
      attachConversationRoot();
    });
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
    shellReadyListener = () => { attachShellObserver(); ensurePanelMount(); };
    panelReadyListener = () => ensurePanelMount();
    document.addEventListener('dcf:shell-ready', shellReadyListener, true);
    document.addEventListener('dcf:panel-ready', panelReadyListener, true);
    attachShellObserver();
    attachConversationRoot();
    ensurePanelMount();
  }

  function reportFatal(error) {
    state.stage = 'failed';
    state.status = '闭环异常';
    state.error = String(error?.message || error);
    render();
  }

  function destroy() {
    destroyed = true;
    conversationObserver?.disconnect();
    documentObserver?.disconnect();
    shellObserver?.disconnect();
    panelObserver?.disconnect();
    if (shellReadyListener) document.removeEventListener('dcf:shell-ready', shellReadyListener, true);
    if (panelReadyListener) document.removeEventListener('dcf:panel-ready', panelReadyListener, true);
    clearInterval(mountTimer);
    clearInterval(rootTimer);
    clearInterval(elapsedTimer);
    mountHost?.remove();
    queue.length = 0;
    activeJob = null;
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    intake_model: 'new-assistant-event-stream',
    request_markers: { start: MARKERS.request[0], end: MARKERS.request[1] },
    result_markers: { start: MARKERS.result[0], end: MARKERS.result[1] },
    permission_request_markers: { start: MARKERS.permissionRequest[0], end: MARKERS.permissionRequest[1] },
    permission_decision_markers: { start: MARKERS.permissionDecision[0], end: MARKERS.permissionDecision[1] },
    lifecycle: { timeout_basis: 'observable-idle-time', permission_wait_pauses_idle_timeout: true }
  };

  try {
    attachWatchers();
    mountTimer = setInterval(ensurePanelMount, 1200);
    rootTimer = setInterval(attachConversationRoot, 1200);
    elapsedTimer = setInterval(() => { if (activeJob) render(); }, 1000);
    loadState().then(async () => {
      for (let attempt = 0; attempt < 65 && !ensurePanelMount(); attempt += 1) await sleep(80);
      if (!ensurePanelMount()) throw new Error('对话闭环未能挂载到本机 Agent 面板');
      render();
      await host({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => host({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {}));
  } catch (error) {
    destroy();
    host({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
  }
})();
