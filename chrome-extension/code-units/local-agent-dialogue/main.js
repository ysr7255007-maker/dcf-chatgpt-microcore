(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.local-agent-dialogue';
  const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.4';
  const LOCAL_AGENT_ID = 'dcf.firstparty.local-agent';
  const LOCAL_AGENT_PANEL_ID = 'dcf-panel-local-agent';
  const MOUNT_ID = 'dcf-local-agent-dialogue-mount';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__';
  const REQUEST_START = '<<<DCF_LOCAL_AGENT_REQUEST>>>';
  const REQUEST_END = '<<<END_DCF_LOCAL_AGENT_REQUEST>>>';
  const RESULT_START = '<<<DCF_LOCAL_AGENT_RESULT>>>';
  const RESULT_END = '<<<END_DCF_LOCAL_AGENT_RESULT>>>';
  const DEFAULTS = Object.freeze({
    enabled: true,
    auto_send_results: true,
    poll_interval_ms: 1200,
    timeout_ms: 20 * 60 * 1000,
    message_limit: 120
  });

  const previous = globalThis[GLOBAL_KEY];
  if (previous?.destroy) previous.destroy();

  const sendHost = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
    return result;
  });

  let destroyed = false;
  let mainObserver = null;
  let panelObserver = null;
  let currentPanelHost = null;
  let currentPanelShadow = null;
  let mountHost = null;
  let mountRoot = null;
  let scanTimer = null;
  let mountTimer = null;
  let elapsedTimer = null;
  let queueBusy = false;
  let activeJob = null;
  let pendingArtifact = '';
  const queue = [];
  const nodeState = new WeakMap();

  const state = {
    settings: { ...DEFAULTS },
    processed_ids: [],
    stage: 'idle',
    status: '等待请求',
    error: '',
    last_action: '尚未操作',
    last_action_at: '',
    last_request_id: '',
    last_session_id: '',
    started_at: 0,
    progress: {
      status_type: '',
      messages: 0,
      todo: 0,
      diff: 0,
      permissions: 0,
      questions: 0,
      preview: '',
      last_poll_at: ''
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

  function localPanelHost() {
    return document.getElementById(LOCAL_AGENT_PANEL_ID);
  }

  function localPanelShadow() {
    return localPanelHost()?.shadowRoot || null;
  }

  async function connectionConfig() {
    const saved = await sendHost({ type: 'plugin.data.get', plugin_id: LOCAL_AGENT_ID });
    const data = saved.data && typeof saved.data === 'object' ? saved.data : {};
    const config = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = localPanelShadow();
    return {
      base_url: String(shadow?.querySelector('[data-field="base-url"]')?.value || config.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(shadow?.querySelector('[data-field="username"]')?.value || config.username || 'opencode').trim() || 'opencode',
      password: String(shadow?.querySelector('[data-field="password"]')?.value || ''),
      agent: String(config.agent || ''),
      model: config.model && typeof config.model === 'object' ? config.model : null
    };
  }

  function baseUrl(raw) {
    let url;
    try {
      url = new URL(String(raw || 'http://127.0.0.1:4096').trim().replace(/\/$/, ''));
    } catch (_) {
      throw new Error('OpenCode 地址无效');
    }
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
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, Number(options.timeout) || 15000)));
    try {
      const headers = { Accept: 'application/json' };
      if (config.password) headers.Authorization = auth(config.username, config.password);
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${baseUrl(config.base_url)}${path}`, {
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
        try { payload = JSON.parse(text); } catch (_) { payload = text; }
      }
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
      wrapped.code = detail.code;
      wrapped.raw = detail.raw;
      wrapped.path = path;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
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
  const statusType = (value) => String(typeof value === 'string' ? value : value?.type || value?.status || value?.state || 'unknown').toLowerCase();
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

  function parseRequest(text) {
    const value = String(text || '').trim();
    if (!value.startsWith(REQUEST_START) || !value.endsWith(REQUEST_END)) return null;
    let payload;
    try {
      payload = JSON.parse(value.slice(REQUEST_START.length, value.length - REQUEST_END.length).trim());
    } catch (_) {
      throw new Error('DCF_LOCAL_AGENT_REQUEST 不是有效 JSON');
    }
    if (payload?.schema !== 'dcf.local-agent.request.v1') throw new Error('DCF_LOCAL_AGENT_REQUEST schema 无效');
    const id = String(payload.id || '').trim();
    const task = String(payload.task || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('DCF_LOCAL_AGENT_REQUEST id 无效');
    if (!task || task.length > 30000) throw new Error('DCF_LOCAL_AGENT_REQUEST task 无效');
    if (String(payload.mode || 'new') !== 'new') throw new Error('闭环 v1 只允许新建独立 OpenCode 会话');
    return {
      id,
      task,
      title: String(payload.title || `DCF · ${task.slice(0, 56)}`).slice(0, 240),
      return_mode: payload.return_mode === 'full' ? 'full' : 'summary',
      timeout_ms: Math.max(30000, Math.min(60 * 60 * 1000, Number(payload.timeout_ms) || state.settings.timeout_ms))
    };
  }

  function assistantNode(value) {
    if (!(value instanceof Node)) return null;
    const element = value.nodeType === Node.ELEMENT_NODE ? value : value.parentElement;
    return element?.closest?.('[data-message-author-role="assistant"]') || null;
  }

  function scheduleInspect(node, force = false) {
    if (!(node instanceof Element)) return;
    const previousState = nodeState.get(node) || {};
    clearTimeout(previousState.timer);
    const timer = setTimeout(() => inspectNode(node, force).catch(() => {}), force ? 0 : 260);
    nodeState.set(node, { ...previousState, timer });
  }

  async function inspectNode(node, force = false) {
    if (!state.settings.enabled || !(node instanceof Element) || !node.isConnected) return;
    const text = String(node.innerText || node.textContent || '').trim();
    const previousState = nodeState.get(node) || {};
    if (!force && previousState.text === text) return;
    nodeState.set(node, { text, timer: null });
    if (!text.includes(REQUEST_START)) return;
    if (!text.endsWith(REQUEST_END)) {
      state.stage = 'detecting';
      state.status = '检测到委派工件，等待回复生成完成';
      state.error = '';
      render();
      return;
    }
    try {
      const parsed = parseRequest(text);
      if (!parsed) return;
      if (state.processed_ids.includes(parsed.id)) {
        state.stage = 'idle';
        state.status = `扫描到已处理工件：${parsed.id}`;
        markAction('扫描完成：工件已经处理');
        render();
        return;
      }
      enqueue(parsed);
    } catch (error) {
      state.stage = 'invalid';
      state.status = '发现无效的委派工件';
      state.error = String(error?.message || error);
      render();
    }
  }

  function scan(root = document, force = false) {
    const nodes = Array.from(root.querySelectorAll?.('[data-message-author-role="assistant"]') || []).slice(-30);
    for (const node of nodes) scheduleInspect(node, force);
    return nodes.length;
  }

  function enqueue(requestData) {
    if (!requestData || queue.some((item) => item.id === requestData.id) || activeJob?.request.id === requestData.id) return;
    queue.push(requestData);
    state.stage = 'received';
    state.status = '已识别完整工件，等待委派';
    state.error = '';
    state.last_request_id = requestData.id;
    markAction(`已接收请求 ${requestData.id}`);
    render();
    processQueue().catch(reportFatal);
  }

  function attachMain() {
    mainObserver?.disconnect();
    mainObserver = new MutationObserver((records) => {
      for (const record of records) {
        const direct = assistantNode(record.target);
        if (direct) scheduleInspect(direct);
        for (const node of record.addedNodes) {
          const parent = assistantNode(node);
          if (parent) scheduleInspect(parent);
          if (node instanceof Element) {
            if (node.matches?.('[data-message-author-role="assistant"]')) scheduleInspect(node);
            for (const child of node.querySelectorAll?.('[data-message-author-role="assistant"]') || []) scheduleInspect(child);
          }
        }
      }
    });
    mainObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scan(document, true);
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
    const statusesData = statuses.ok ? statuses.data : null;
    const sessionStatus = statusesData?.[job.session_id]
      || list(statusesData).find((item) => String(item?.sessionID || item?.session_id || item?.id || '') === job.session_id)
      || null;
    const belongs = (item) => {
      const id = String(item?.sessionID || item?.session_id || item?.sessionId || '');
      return !id || id === job.session_id;
    };
    return {
      status: sessionStatus,
      status_type: statusType(sessionStatus),
      messages: messages.ok ? list(messages.data) : [],
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
        questions: questions.ok ? null : questions.error
      }
    };
  }

  function updateProgress(snap) {
    const preview = latestAssistant(snap.messages);
    state.progress = {
      status_type: snap.status_type,
      messages: snap.messages.length,
      todo: snap.todo.length,
      diff: snap.diff.length,
      permissions: snap.permissions.length,
      questions: snap.questions.length,
      preview: preview.slice(-900),
      last_poll_at: new Date().toLocaleTimeString()
    };
  }

  function resultPayload(job, status, snap, elapsed) {
    return {
      schema: 'dcf.local-agent.result.v1',
      request_id: job.request.id,
      status,
      session_id: job.session_id,
      assistant_result: latestAssistant(snap.messages),
      todo: snap.todo,
      diff: snap.diff,
      permissions: snap.permissions,
      questions: snap.questions,
      messages: job.request.return_mode === 'full' ? snap.messages : undefined,
      execution: {
        elapsed_ms: elapsed,
        status_type: snap.status_type,
        base_url: baseUrl(job.config.base_url),
        endpoint_errors: snap.endpoint_errors
      }
    };
  }

  const artifact = (value) => `${RESULT_START}\n${json(value)}\n${RESULT_END}`;
  const composer = () => document.querySelector('#prompt-textarea')
    || document.querySelector('[data-testid="composer-text-input"]')
    || document.querySelector('form textarea')
    || document.querySelector('main [contenteditable="true"]');
  const composerValue = (target) => target
    ? String('value' in target ? target.value || '' : target.innerText || target.textContent || '')
    : '';
  const streaming = () => Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]'));

  function dispatchInput(target, text) {
    try {
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (_) {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function fillComposer(text) {
    const target = composer();
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    if (composerValue(target).trim()) throw new Error('输入框中已有未发送内容');
    target.focus();
    if ('value' in target) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
      if (setter) setter.call(target, text);
      else target.value = text;
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
    dispatchInput(target, text);
  }

  const sendButton = () => document.querySelector('[data-testid="send-button"]')
    || document.querySelector('button[aria-label*="Send"]')
    || document.querySelector('button[aria-label*="发送"]');

  async function clickSend() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const button = sendButton();
      if (!streaming() && button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
        return;
      }
      await sleep(50);
    }
    throw new Error('闭环结果已写入输入框，但发送按钮暂不可用');
  }

  async function returnPayload(value) {
    const text = artifact(value);
    pendingArtifact = text;
    const started = Date.now();
    render();
    while (!destroyed && pendingArtifact === text && Date.now() - started < 120000) {
      const target = composer();
      if (target && !composerValue(target).trim() && !streaming()) {
        fillComposer(text);
        if (state.settings.auto_send_results) await clickSend();
        pendingArtifact = '';
        state.status = state.settings.auto_send_results ? '结果已自动回传' : '结果已填入输入框';
        state.error = '';
        markAction(state.status);
        render();
        return true;
      }
      await sleep(500);
    }
    state.stage = 'return_wait';
    state.status = '结果等待回传';
    state.error = '当前对话尚未空闲，未覆盖输入框';
    render();
    return false;
  }

  async function focusSession(id) {
    if (!id) throw new Error('当前没有可查看的执行会话');
    const shadow = localPanelShadow();
    shadow?.querySelector('[data-action="refresh-all"]')?.click();
    await sleep(1200);
    const select = shadow?.querySelector('[data-field="session"]');
    if (!select || !Array.from(select.options || []).some((option) => option.value === id)) {
      throw new Error('会话列表中尚未出现该执行会话，请稍后再试');
    }
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function poll(job) {
    const started = Date.now();
    let lastText = '';
    let stableSince = 0;
    let observedRunning = false;
    let interventionKey = '';
    while (!destroyed && activeJob === job) {
      const snap = await snapshot(job);
      updateProgress(snap);
      const text = latestAssistant(snap.messages);
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      }
      if (!['idle', 'completed', 'failed', 'error', 'unknown'].includes(snap.status_type)) observedRunning = true;
      const currentIntervention = snap.permissions.length || snap.questions.length
        ? hash(json({ permissions: snap.permissions, questions: snap.questions }))
        : '';

      if (currentIntervention && currentIntervention !== interventionKey) {
        interventionKey = currentIntervention;
        state.stage = 'needs_user';
        state.status = '等待本机权限或回答';
        render();
        try { await focusSession(job.session_id); } catch (_) {}
        await returnPayload(resultPayload(job, 'needs_user', snap, Date.now() - started));
      } else if (!currentIntervention && interventionKey) {
        interventionKey = '';
        state.stage = 'running';
        state.status = '用户处理完成，继续执行';
        render();
      } else {
        state.stage = 'running';
        state.status = `本机执行中 · ${snap.status_type}`;
        render();
      }

      const terminal = ['idle', 'completed', 'failed', 'error', 'cancelled', 'canceled'].includes(snap.status_type);
      const stable = Boolean(lastText) && stableSince && Date.now() - stableSince >= 1600;
      if (!currentIntervention && terminal && stable && (observedRunning || Date.now() - started >= 2500)) {
        const result = ['failed', 'error', 'cancelled', 'canceled'].includes(snap.status_type) ? 'failed' : 'completed';
        return resultPayload(job, result, snap, Date.now() - started);
      }
      if (Date.now() - started >= job.request.timeout_ms) {
        return resultPayload(job, 'timeout', snap, Date.now() - started);
      }
      await sleep(state.settings.poll_interval_ms);
    }
    throw new Error('对话闭环已停止');
  }

  async function run(requestData) {
    state.started_at = Date.now();
    state.stage = 'checking';
    state.status = '正在检查 OpenCode 服务';
    render();

    const config = await connectionConfig();
    await request('/global/health', { config, timeout: 8000 });

    state.stage = 'creating';
    state.status = '服务已连接，正在创建会话';
    render();

    const session_id = await createSession(config, requestData.title);
    state.stage = 'submitting';
    state.status = '会话已创建，正在提交任务';
    state.last_session_id = session_id;
    render();

    const body = { parts: [{ type: 'text', text: requestData.task }] };
    if (config.agent) body.agent = config.agent;
    if (config.model) body.model = config.model;
    await request(`/session/${encodeURIComponent(session_id)}/prompt_async`, {
      config,
      method: 'POST',
      body,
      timeout: 30000
    });

    const job = { request: requestData, config, session_id };
    activeJob = job;
    state.last_request_id = requestData.id;
    state.last_session_id = session_id;
    state.processed_ids = [...state.processed_ids.filter((id) => id !== requestData.id), requestData.id].slice(-80);
    state.stage = 'running';
    state.status = '任务已提交，等待本机输出';
    state.error = '';
    markAction(`已提交到会话 ${session_id}`);
    await persist();
    render();
    try { await focusSession(session_id); } catch (_) {}

    const finalPayload = await poll(job);
    state.stage = finalPayload.status === 'completed' ? 'completed' : finalPayload.status;
    state.status = finalPayload.status === 'completed' ? '本机任务完成，正在回传' : `本机任务结束 · ${finalPayload.status}`;
    render();
    await returnPayload(finalPayload);
  }

  async function returnFailure(error, requestData) {
    const job = activeJob;
    const failure = {
      schema: 'dcf.local-agent.result.v1',
      request_id: requestData?.id || job?.request.id || 'unknown',
      status: 'bridge_error',
      session_id: job?.session_id || '',
      assistant_result: '',
      todo: [],
      diff: [],
      permissions: [],
      questions: [],
      execution: {
        elapsed_ms: state.started_at ? Date.now() - state.started_at : 0,
        status_type: 'bridge_error',
        base_url: job ? baseUrl(job.config.base_url) : '',
        endpoint_errors: {
          bridge: String(error?.message || error),
          code: error?.code || '',
          raw: error?.raw || ''
        }
      }
    };
    state.stage = 'failed';
    state.status = '委派失败，正在回传';
    state.error = String(error?.message || error);
    markAction('委派失败');
    render();
    await returnPayload(failure).catch(() => {});
  }

  async function processQueue() {
    if (queueBusy || activeJob || !state.settings.enabled || !queue.length) return;
    queueBusy = true;
    const requestData = queue.shift();
    state.last_request_id = requestData.id;
    await persist();
    try {
      await run(requestData);
    } catch (error) {
      await returnFailure(error, requestData);
    } finally {
      activeJob = null;
      queueBusy = false;
      persist().catch(() => {});
      render();
      if (queue.length) processQueue().catch(reportFatal);
    }
  }

  function reportFatal(error) {
    state.stage = 'failed';
    state.status = '闭环异常';
    state.error = String(error?.message || error);
    markAction('闭环异常');
    render();
  }

  function elapsedText() {
    if (!state.started_at || !['checking', 'creating', 'submitting', 'running', 'needs_user'].includes(state.stage)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - state.started_at) / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
  }

  function uiStyle() {
    return `
      :host{all:initial;display:block;position:relative;z-index:2;pointer-events:auto;font:13px/1.5 system-ui;color:#202124;margin:0 0 10px}
      *{box-sizing:border-box}
      .card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:9px;min-width:0;pointer-events:auto}
      .title-row,.row{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}
      .title-row b,.grow{flex:1;min-width:0}
      .muted,.notice{color:#666;font-size:12px;overflow-wrap:anywhere}
      .notice.error{color:#b42318}
      .status{display:inline-flex;align-items:center;gap:5px;border:1px solid #ccc;border-radius:999px;padding:2px 7px;font-size:11px}
      .status::before{content:'';width:7px;height:7px;border-radius:50%;background:#999}
      .status.ready::before{background:#188038}.status.busy::before{background:#d97706}
      label{cursor:pointer}
      input{accent-color:#202124}
      .stage{font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
      .progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
      .metric{border:1px solid #ddd;border-radius:8px;padding:6px;display:grid;gap:2px;min-width:0}
      .metric b{font-size:14px}
      .preview{max-height:150px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f6f6;border-radius:7px;padding:8px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
      .actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
      button{font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:7px 9px;min-width:0;cursor:pointer;pointer-events:auto;transition:transform .05s ease,background .12s ease,border-color .12s ease}
      button:hover{background:#f4f4f4;border-color:#888}
      button:active{transform:translateY(1px);background:#e9e9e9}
      button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      .action-log{border-top:1px dashed #ddd;padding-top:7px}
      @media(max-width:340px){.progress{grid-template-columns:repeat(2,minmax(0,1fr))}.actions{grid-template-columns:1fr}}
      @media(prefers-color-scheme:dark){
        :host{color:#f3f3f3}.card{background:#222;border-color:#444}.muted,.notice{color:#aaa}.metric{border-color:#444}.preview{background:#181818}
        button{background:#292929;color:#f3f3f3;border-color:#555}button:hover{background:#333;border-color:#777}button:active{background:#3a3a3a}
        .status{border-color:#555}.action-log{border-color:#444}input{accent-color:#f3f3f3}
      }`;
  }

  function cardHtml() {
    const active = Boolean(activeJob) || ['checking', 'creating', 'submitting'].includes(state.stage);
    const progress = state.progress;
    return `
      <section class="card" data-dcf-local-agent-dialogue-card="true">
        <div class="title-row">
          <b>对话闭环</b>
          <span class="status ${active ? 'busy' : state.settings.enabled ? 'ready' : ''}">${active ? '执行中' : state.settings.enabled ? '已开启' : '已关闭'}</span>
        </div>
        <div class="muted">完整委派工件会自动交给本机 OpenCode。所有按钮都会在“上次操作”中留下反馈。</div>
        <div class="row">
          <label class="row"><input type="checkbox" data-field="enabled" ${state.settings.enabled ? 'checked' : ''}>允许对话自动委派</label>
          <label class="row"><input type="checkbox" data-field="auto-send" ${state.settings.auto_send_results ? 'checked' : ''}>结果自动发送回对话</label>
        </div>
        <div class="stage">
          <b>${html(state.status)}</b>${elapsedText() ? ` · ${html(elapsedText())}` : ''}
          <br>阶段：${html(state.stage)}
          ${state.last_request_id ? `<br>请求：${html(state.last_request_id)}` : ''}
          ${state.last_session_id ? `<br>会话：${html(state.last_session_id)}` : ''}
        </div>
        <div class="progress">
          <div class="metric"><span class="muted">状态</span><b>${html(progress.status_type || '—')}</b></div>
          <div class="metric"><span class="muted">消息</span><b>${progress.messages}</b></div>
          <div class="metric"><span class="muted">Todo</span><b>${progress.todo}</b></div>
          <div class="metric"><span class="muted">Diff</span><b>${progress.diff}</b></div>
          <div class="metric"><span class="muted">权限</span><b>${progress.permissions}</b></div>
          <div class="metric"><span class="muted">提问</span><b>${progress.questions}</b></div>
        </div>
        ${progress.preview ? `<div><div class="muted">最近本机输出 · ${html(progress.last_poll_at)}</div><div class="preview">${html(progress.preview)}</div></div>` : ''}
        <div class="actions">
          <button type="button" data-action="scan">重新扫描当前对话</button>
          <button type="button" data-action="focus">查看执行会话</button>
          <button type="button" data-action="return">回传待发送结果</button>
          <button type="button" data-action="clear">清除已处理记录</button>
        </div>
        <div class="muted action-log">上次操作：${html(state.last_action)}${state.last_action_at ? ` · ${html(state.last_action_at)}` : ''}</div>
        ${state.error ? `<div class="notice error">${html(state.error)}</div>` : ''}
      </section>`;
  }

  function render() {
    const app = mountRoot?.getElementById('app');
    if (app) app.innerHTML = cardHtml();
  }

  async function handleAction(action) {
    markAction(`已接收点击：${action}`);
    state.error = '';
    render();

    if (action === 'scan') {
      state.stage = 'scanning';
      state.status = '正在重新扫描最近助手消息';
      const count = scan(document, true);
      markAction(`已触发重新扫描，共检查 ${count} 条助手消息`);
      render();
      setTimeout(() => {
        if (state.stage === 'scanning') {
          state.stage = 'idle';
          state.status = '扫描完成，未发现新的完整工件';
          markAction('重新扫描完成');
          render();
        }
      }, 1100);
      return;
    }

    if (action === 'focus') {
      if (!state.last_session_id) {
        state.status = '当前没有执行会话';
        markAction('查看会话：尚无 session');
        render();
        return;
      }
      state.status = '正在切换到执行会话';
      render();
      await focusSession(state.last_session_id);
      state.status = '已切换到执行会话';
      markAction(`已打开会话 ${state.last_session_id}`);
      render();
      return;
    }

    if (action === 'return') {
      if (!pendingArtifact) {
        state.status = '当前没有待回传结果';
        markAction('回传检查：队列为空');
        render();
        return;
      }
      if (composerValue(composer()).trim() || streaming()) throw new Error('当前对话或输入框尚未空闲');
      const text = pendingArtifact;
      fillComposer(text);
      if (state.settings.auto_send_results) await clickSend();
      pendingArtifact = '';
      state.status = state.settings.auto_send_results ? '结果已自动回传' : '结果已填入输入框';
      markAction(state.status);
      render();
      return;
    }

    if (action === 'clear') {
      state.processed_ids = [];
      state.last_request_id = '';
      state.stage = 'idle';
      state.status = '已清除处理记录';
      markAction('已清除去重记录；会话记录保留');
      await persist();
      render();
    }
  }

  function bindMountEvents() {
    if (!mountRoot || mountRoot.__dcfDialogueBound) return;
    mountRoot.__dcfDialogueBound = true;

    mountRoot.addEventListener('click', (event) => {
      const button = event.composedPath().find((node) => node instanceof Element && node.matches?.('button[data-action]'));
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      handleAction(button.dataset.action).catch((error) => {
        state.error = String(error?.message || error);
        state.status = '操作失败';
        markAction(`操作失败：${button.dataset.action}`);
        render();
      });
    });

    mountRoot.addEventListener('change', (event) => {
      const target = event.composedPath().find((node) => node instanceof HTMLInputElement && node.matches?.('input[data-field]'));
      if (!target) return;
      const field = target.dataset.field;
      if (field === 'enabled') {
        state.settings.enabled = target.checked;
        state.stage = target.checked ? 'idle' : 'disabled';
        state.status = target.checked ? '等待请求' : '闭环已关闭';
        markAction(target.checked ? '已开启自动委派' : '已关闭自动委派');
      } else if (field === 'auto-send') {
        state.settings.auto_send_results = target.checked;
        markAction(target.checked ? '已开启自动回传' : '已关闭自动回传');
      }
      persist().then(() => {
        render();
        if (field === 'enabled' && state.settings.enabled) scan(document, true);
      }).catch((error) => {
        state.error = String(error?.message || error);
        render();
      });
    });
  }

  function createMount(shadow) {
    const old = shadow.getElementById?.(MOUNT_ID) || shadow.querySelector(`#${MOUNT_ID}`);
    old?.remove();

    mountHost = document.createElement('div');
    mountHost.id = MOUNT_ID;
    mountHost.style.cssText = 'display:block;position:relative;z-index:2;pointer-events:auto;margin:0 0 10px;';
    mountRoot = mountHost.attachShadow({ mode: 'open' });
    mountRoot.innerHTML = `<style>${uiStyle()}</style><div id="app"></div>`;
    bindMountEvents();

    const content = shadow.querySelector('.content');
    if (content) shadow.insertBefore(mountHost, content);
    else shadow.append(mountHost);
    render();
  }

  function ensurePanelMount() {
    const host = localPanelHost();
    const shadow = host?.shadowRoot || null;
    if (!host || !shadow) return;

    if (host !== currentPanelHost || shadow !== currentPanelShadow) {
      panelObserver?.disconnect();
      currentPanelHost = host;
      currentPanelShadow = shadow;
      mountHost = null;
      mountRoot = null;
      panelObserver = new MutationObserver(() => {
        if (!shadow.getElementById?.(MOUNT_ID) && !shadow.querySelector(`#${MOUNT_ID}`)) queueMicrotask(() => createMount(shadow));
      });
      panelObserver.observe(shadow, { childList: true });
    }

    const existing = shadow.getElementById?.(MOUNT_ID) || shadow.querySelector(`#${MOUNT_ID}`);
    if (!existing || !existing.shadowRoot) createMount(shadow);
    else {
      mountHost = existing;
      mountRoot = existing.shadowRoot;
      bindMountEvents();
      render();
    }
  }

  function destroy() {
    destroyed = true;
    mainObserver?.disconnect();
    panelObserver?.disconnect();
    clearInterval(scanTimer);
    clearInterval(mountTimer);
    clearInterval(elapsedTimer);
    mountHost?.remove();
    for (const node of document.querySelectorAll('[data-message-author-role="assistant"]')) {
      const info = nodeState.get(node);
      if (info?.timer) clearTimeout(info.timer);
    }
    queue.length = 0;
    activeJob = null;
  }

  function diagnostics() {
    return {
      version: UNIT_VERSION,
      mounted: Boolean(mountHost?.isConnected && mountRoot),
      stage: state.stage,
      status: state.status,
      last_action: state.last_action,
      request_id: state.last_request_id,
      session_id: state.last_session_id,
      queued: queue.length,
      active: Boolean(activeJob),
      pending_return: Boolean(pendingArtifact)
    };
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    diagnostics,
    request_markers: { start: REQUEST_START, end: REQUEST_END },
    result_markers: { start: RESULT_START, end: RESULT_END }
  };

  try {
    loadState().then(async () => {
      attachMain();
      ensurePanelMount();
      mountTimer = setInterval(ensurePanelMount, 700);
      scanTimer = setInterval(() => {
        if (state.settings.enabled && !activeJob) scan(document, false);
      }, 1600);
      elapsedTimer = setInterval(() => {
        if (state.started_at && ['checking', 'creating', 'submitting', 'running', 'needs_user'].includes(state.stage)) render();
      }, 1000);
      await sendHost({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => {
      sendHost({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
    });
  } catch (error) {
    destroy();
    sendHost({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
  }
})();