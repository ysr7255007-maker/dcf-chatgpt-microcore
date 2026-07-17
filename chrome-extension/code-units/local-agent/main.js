(function () {
  'use strict';
  const UNIT_ID = 'dcf.firstparty.local-agent';
  const UNIT_VERSION = '1.0.0-rc.3-local-agent.1';
  const PANEL_ID = 'local-agent';
  const HOST_ID = 'dcf-panel-local-agent';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_LOCAL_AGENT__';
  const FIXED_ORIGIN = 'http://127.0.0.1:4096';
  const previous = globalThis[GLOBAL_KEY];
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  const send = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request');
    return result;
  });

  let panel = null;
  let pollTimer = null;
  let pollBusy = false;
  let destroyed = false;
  const state = {
    config: { base_url: FIXED_ORIGIN, username: 'opencode', agent: '', model: null, poll_interval_ms: 1200, message_limit: 100 },
    host_permission: false,
    has_password: false,
    connected: false,
    catalog: null,
    sessions: [],
    selected_session_id: '',
    session_status: null,
    messages: [],
    todo: [],
    diff: [],
    permissions: [],
    questions: [],
    task_draft: '',
    auto_poll: true,
    notice: '',
    error: '',
    busy: false,
    last_poll_at: null
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function safeJson(value) {
    try { return JSON.stringify(value, null, 2); }
    catch (_) { return String(value); }
  }

  function statusType(value) {
    if (!value) return 'unknown';
    if (typeof value === 'string') return value;
    return String(value.type || value.status || value.state || 'unknown');
  }

  function sessionId(session) {
    return String(session && (session.id || session.sessionID || session.session_id) || '');
  }

  function sessionTitle(session) {
    return String(session && (session.title || session.name) || sessionId(session) || '未命名会话');
  }

  function partText(part) {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text' || part.type === 'reasoning') return String(part.text || '');
    if (part.type === 'tool') {
      const tool = String(part.tool || part.name || 'tool');
      const status = statusType(part.state);
      const title = part.state && (part.state.title || part.state.error) || '';
      return `[${tool} · ${status}${title ? ` · ${title}` : ''}]`;
    }
    if (part.type === 'step-finish' && part.reason) return `[步骤结束 · ${part.reason}]`;
    return '';
  }

  function messageRole(record) {
    const info = record && record.info || {};
    return String(info.role || info.type || '').toLowerCase();
  }

  function messageText(record) {
    return (Array.isArray(record && record.parts) ? record.parts : []).map(partText).filter(Boolean).join('\n').trim();
  }

  function latestAssistantText() {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const record = state.messages[index];
      if (messageRole(record).includes('assistant')) {
        const text = messageText(record);
        if (text) return text;
      }
    }
    return '';
  }

  function latestMessageId() {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const info = state.messages[index] && state.messages[index].info || {};
      const id = info.id || info.messageID || info.message_id;
      if (id) return String(id);
    }
    return '';
  }

  function currentSession() {
    return state.sessions.find((item) => sessionId(item) === state.selected_session_id) || null;
  }

  function composer() {
    return document.querySelector('#prompt-textarea')
      || document.querySelector('[data-testid="composer-text-input"]')
      || document.querySelector('form textarea')
      || document.querySelector('main [contenteditable="true"]');
  }

  function readComposer() {
    const target = composer();
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    return String('value' in target ? target.value || '' : target.innerText || target.textContent || '');
  }

  function dispatchInput(target, text) {
    try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
    catch (_) { target.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function insertComposer(text) {
    const target = composer();
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    target.focus();
    const value = String(text || '');
    if ('value' in target) {
      const original = String(target.value || '');
      const start = Number.isInteger(target.selectionStart) ? target.selectionStart : original.length;
      const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
      const next = `${original.slice(0, start)}${value}${original.slice(end)}`;
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
      if (descriptor && descriptor.set) descriptor.set.call(target, next); else target.value = next;
      const caret = start + value.length;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(caret, caret);
      dispatchInput(target, value);
      return;
    }
    const selection = getSelection();
    let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !target.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
    }
    range.deleteContents();
    const node = document.createTextNode(value);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection && selection.removeAllRanges();
    selection && selection.addRange(range);
    dispatchInput(target, value);
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(String(text || ''));
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  function filterForSession(items) {
    return normalizeList(items).filter((item) => {
      const id = String(item && (item.sessionID || item.session_id || item.sessionId) || '');
      return !id || id === state.selected_session_id;
    });
  }

  async function persistLocal() {
    await send({
      type: 'plugin.data.set',
      plugin_id: UNIT_ID,
      data: {
        selected_session_id: state.selected_session_id,
        task_draft: state.task_draft,
        auto_poll: state.auto_poll
      }
    });
  }

  function setBusy(value, notice) {
    state.busy = value;
    if (notice !== undefined) state.notice = notice;
    if (value) state.error = '';
    render();
  }

  function setError(error) {
    state.error = String(error && error.message || error);
    state.notice = '';
    state.busy = false;
    state.connected = false;
    render();
  }

  function modelOptions() {
    const response = state.catalog && state.catalog.providers && state.catalog.providers.ok ? state.catalog.providers.data : null;
    const providers = Array.isArray(response && response.providers) ? response.providers : [];
    const options = [];
    for (const provider of providers) {
      const providerID = String(provider.id || provider.providerID || provider.name || '');
      const models = Array.isArray(provider.models) ? provider.models : Object.values(provider.models || {});
      for (const model of models) {
        const modelID = String(model.id || model.modelID || model.name || '');
        if (providerID && modelID) options.push({ providerID, modelID, label: `${provider.name || providerID} / ${model.name || modelID}` });
      }
    }
    return options;
  }

  function agentOptions() {
    const response = state.catalog && state.catalog.agents && state.catalog.agents.ok ? state.catalog.agents.data : [];
    return normalizeList(response).map((agent) => ({ id: String(agent.name || agent.id || ''), label: String(agent.description || agent.name || agent.id || '') })).filter((agent) => agent.id);
  }

  function projectSummary() {
    const catalog = state.catalog || {};
    const health = catalog.health && catalog.health.ok ? catalog.health.data : null;
    const path = catalog.path && catalog.path.ok ? catalog.path.data : null;
    const vcs = catalog.vcs && catalog.vcs.ok ? catalog.vcs.data : null;
    const project = catalog.project && catalog.project.ok ? catalog.project.data : null;
    return {
      version: health && health.version || '',
      path: typeof path === 'string' ? path : path && (path.directory || path.cwd || path.root) || project && (project.worktree || project.path) || '',
      branch: vcs && (vcs.branch || vcs.ref || vcs.head) || ''
    };
  }

  async function loadState() {
    const [host, local] = await Promise.all([
      send({ type: 'local_agent.config.get' }),
      send({ type: 'plugin.data.get', plugin_id: UNIT_ID })
    ]);
    state.config = host.config;
    state.host_permission = host.host_permission;
    state.has_password = host.has_password;
    state.selected_session_id = String(local.data && local.data.selected_session_id || '');
    state.task_draft = String(local.data && local.data.task_draft || '');
    state.auto_poll = local.data && local.data.auto_poll !== false;
    render();
    if (state.host_permission && state.has_password) await refreshAll(false);
  }

  async function saveAndConnect() {
    const root = panel.shadowRoot;
    const username = root.querySelector('[data-field="username"]').value.trim() || 'opencode';
    const password = root.querySelector('[data-field="password"]').value;
    const agent = root.querySelector('[data-field="agent"]').value;
    const modelValue = root.querySelector('[data-field="model"]').value;
    let model = null;
    if (modelValue) {
      const [providerID, modelID] = modelValue.split('\u0000');
      if (providerID && modelID) model = { providerID, modelID };
    }
    setBusy(true, '正在请求本机访问权限并连接 OpenCode…');
    const permission = await send({ type: 'local_agent.host_permission.request' });
    if (!permission.granted) throw new Error('未授予 OpenCode 本机访问权限');
    const saved = await send({
      type: 'local_agent.config.set',
      config: { ...state.config, username, agent, model },
      ...(password ? { password } : {})
    });
    state.config = saved.config;
    state.host_permission = saved.host_permission;
    state.has_password = saved.has_password;
    root.querySelector('[data-field="password"]').value = '';
    await refreshAll(true);
  }

  async function refreshCatalog() {
    state.catalog = await send({ type: 'local_agent.catalog' });
    const health = state.catalog.health;
    state.connected = Boolean(health && health.ok && health.data && health.data.healthy !== false);
    if (!state.connected && health && !health.ok) throw new Error(health.error || 'OpenCode 不可用');
  }

  async function refreshSessions() {
    const result = await send({ type: 'local_agent.sessions.list' });
    state.sessions = normalizeList(result.sessions).sort((a, b) => Number(b.time && (b.time.updated || b.time.created) || b.updated_at || 0) - Number(a.time && (a.time.updated || a.time.created) || a.updated_at || 0));
    if (state.selected_session_id && !state.sessions.some((item) => sessionId(item) === state.selected_session_id)) state.selected_session_id = '';
  }

  async function refreshSelected() {
    if (!state.selected_session_id) {
      state.session_status = null;
      state.messages = [];
      state.todo = [];
      state.diff = [];
      state.permissions = [];
      state.questions = [];
      return;
    }
    const sessionID = state.selected_session_id;
    const requests = [
      send({ type: 'local_agent.session.status', session_id: sessionID }),
      send({ type: 'local_agent.session.messages', session_id: sessionID }),
      send({ type: 'local_agent.session.todo', session_id: sessionID }),
      send({ type: 'local_agent.session.diff', session_id: sessionID }),
      send({ type: 'local_agent.permissions.list' }),
      send({ type: 'local_agent.questions.list' })
    ];
    const [status, messages, todo, diff, permissions, questions] = await Promise.allSettled(requests);
    if (status.status === 'fulfilled') state.session_status = status.value.status;
    if (messages.status === 'fulfilled') state.messages = normalizeList(messages.value.messages);
    if (todo.status === 'fulfilled') state.todo = normalizeList(todo.value.todo);
    if (diff.status === 'fulfilled') state.diff = normalizeList(diff.value.diff);
    if (permissions.status === 'fulfilled') state.permissions = filterForSession(permissions.value.permissions);
    if (questions.status === 'fulfilled') state.questions = filterForSession(questions.value.questions);
    state.last_poll_at = new Date().toISOString();
  }

  async function refreshAll(showNotice) {
    if (pollBusy) return;
    pollBusy = true;
    if (showNotice) setBusy(true, '正在刷新 OpenCode 状态…');
    try {
      await refreshCatalog();
      await refreshSessions();
      await refreshSelected();
      state.error = '';
      state.notice = state.connected ? 'OpenCode 已连接' : 'OpenCode 未连接';
      state.busy = false;
      await persistLocal();
      render();
      schedulePoll();
    } finally {
      pollBusy = false;
    }
  }

  function shouldPoll() {
    const type = statusType(state.session_status);
    return state.auto_poll && state.selected_session_id && (state.permissions.length || state.questions.length || !['idle', 'completed', 'failed', 'error', 'unknown'].includes(type));
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!destroyed && shouldPoll()) {
      pollTimer = setTimeout(async () => {
        try { await refreshSelected(); render(); schedulePoll(); }
        catch (error) { setError(error); }
      }, state.config.poll_interval_ms || 1200);
    }
  }

  async function createSession(title) {
    const result = await send({ type: 'local_agent.session.create', title: title || `DCF · ${new Date().toLocaleString()}` });
    const id = sessionId(result.session);
    if (!id) throw new Error('OpenCode 未返回 session ID');
    state.selected_session_id = id;
    await refreshSessions();
    await persistLocal();
    return id;
  }

  async function submitTask(forceNew) {
    const instruction = state.task_draft.trim();
    if (!instruction) throw new Error('请先填写任务内容');
    setBusy(true, forceNew ? '正在创建会话并提交任务…' : '正在提交任务…');
    let id = state.selected_session_id;
    if (forceNew || !id) id = await createSession(`DCF · ${instruction.slice(0, 48)}`);
    await send({
      type: 'local_agent.session.prompt',
      session_id: id,
      instruction,
      agent: state.config.agent,
      model: state.config.model
    });
    state.notice = '任务已交给 OpenCode';
    state.busy = false;
    await refreshSelected();
    await persistLocal();
    render();
    schedulePoll();
  }

  async function abortSession() {
    if (!state.selected_session_id) return;
    setBusy(true, '正在终止当前任务…');
    await send({ type: 'local_agent.session.abort', session_id: state.selected_session_id });
    await refreshSelected();
    state.notice = '已请求终止当前任务';
    state.busy = false;
    render();
  }

  async function renameSession() {
    if (!state.selected_session_id) return;
    const root = panel.shadowRoot;
    const title = root.querySelector('[data-field="session-title"]').value.trim();
    if (!title) throw new Error('请输入会话标题');
    await send({ type: 'local_agent.session.rename', session_id: state.selected_session_id, title });
    await refreshSessions();
    render();
  }

  async function deleteSession() {
    if (!state.selected_session_id) return;
    await send({ type: 'local_agent.session.delete', session_id: state.selected_session_id });
    state.selected_session_id = '';
    await refreshSessions();
    await refreshSelected();
    await persistLocal();
    render();
  }

  async function forkSession() {
    if (!state.selected_session_id) return;
    const result = await send({ type: 'local_agent.session.fork', session_id: state.selected_session_id, message_id: latestMessageId() || undefined });
    const id = sessionId(result.session);
    if (id) state.selected_session_id = id;
    await refreshSessions();
    await refreshSelected();
    await persistLocal();
    render();
  }

  async function replyPermission(requestID, reply, sessionID) {
    await send({ type: 'local_agent.permission.reply', session_id: sessionID || state.selected_session_id, request_id: requestID, reply });
    await refreshSelected();
    render();
    schedulePoll();
  }

  async function replyQuestion(requestID, answer) {
    await send({ type: 'local_agent.question.reply', request_id: requestID, answers: [answer] });
    await refreshSelected();
    render();
    schedulePoll();
  }

  async function rejectQuestion(requestID) {
    await send({ type: 'local_agent.question.reject', request_id: requestID });
    await refreshSelected();
    render();
    schedulePoll();
  }

  function permissionHtml(item) {
    const id = String(item.id || item.requestID || item.request_id || '');
    const sessionID = String(item.sessionID || item.session_id || state.selected_session_id);
    const name = String(item.permission || item.type || item.title || '权限请求');
    const patterns = normalizeList(item.patterns || item.pattern).map(String).join(', ');
    const metadata = item.metadata && Object.keys(item.metadata).length ? safeJson(item.metadata) : '';
    return `<div class="request"><b>${escapeHtml(name)}</b>${patterns ? `<div class="muted">${escapeHtml(patterns)}</div>` : ''}${metadata ? `<pre>${escapeHtml(metadata)}</pre>` : ''}<div class="button-grid"><button class="primary" data-permission="${escapeHtml(id)}" data-session="${escapeHtml(sessionID)}" data-reply="once">允许一次</button><button data-permission="${escapeHtml(id)}" data-session="${escapeHtml(sessionID)}" data-reply="always">本会话允许</button><button class="danger" data-permission="${escapeHtml(id)}" data-session="${escapeHtml(sessionID)}" data-reply="reject">拒绝</button></div></div>`;
  }

  function questionHtml(item) {
    const id = String(item.id || item.requestID || item.request_id || '');
    const questions = normalizeList(item.questions || item.question || item).map((entry) => typeof entry === 'string' ? entry : entry && (entry.question || entry.text || entry.header) || '').filter(Boolean);
    return `<div class="request"><b>OpenCode 需要补充信息</b><div class="muted">${escapeHtml(questions.join('；') || '请输入回答')}</div><textarea data-question-answer="${escapeHtml(id)}" rows="3"></textarea><div class="button-grid two"><button class="primary" data-question-send="${escapeHtml(id)}">提交回答</button><button class="danger" data-question-reject="${escapeHtml(id)}">拒绝</button></div></div>`;
  }

  function diffHtml() {
    if (!state.diff.length) return '<div class="empty">当前会话没有文件差异。</div>';
    return state.diff.map((file) => {
      const path = file.file || file.path || file.filename || '未知文件';
      const additions = file.additions ?? file.added ?? '';
      const deletions = file.deletions ?? file.removed ?? '';
      const patch = file.patch || file.diff || '';
      return `<details><summary><b>${escapeHtml(path)}</b><span class="muted">${additions !== '' ? ` +${escapeHtml(additions)}` : ''}${deletions !== '' ? ` -${escapeHtml(deletions)}` : ''}</span></summary>${patch ? `<pre>${escapeHtml(patch)}</pre>` : `<pre>${escapeHtml(safeJson(file))}</pre>`}</details>`;
    }).join('');
  }

  function todoHtml() {
    if (!state.todo.length) return '<div class="empty">暂无任务清单。</div>';
    return `<ul>${state.todo.map((item) => `<li>${escapeHtml(item.content || item.text || item.title || safeJson(item))}${item.status ? ` · ${escapeHtml(item.status)}` : ''}</li>`).join('')}</ul>`;
  }

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit;min-width:0}.content{display:grid;gap:10px;min-width:0}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:9px;min-width:0}.title-row,.row{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}.title-row b,.grow{flex:1;min-width:0}.muted,.notice,.empty{color:#666;font-size:12px;overflow-wrap:anywhere}.notice.error{color:#b42318}.status{display:inline-flex;align-items:center;gap:5px;border:1px solid #ccc;border-radius:999px;padding:2px 7px;font-size:11px}.status::before{content:'';width:7px;height:7px;border-radius:50%;background:#999}.status.ready::before{background:#188038}.status.busy::before{background:#d97706}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.field{display:grid;gap:4px;min-width:0}.field.full{grid-column:1/-1}.field span{font-size:12px;color:#666}.button-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.button-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.button-grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}.request{border:1px solid #ddd;border-radius:8px;padding:8px;display:grid;gap:7px;min-width:0}button,input,select,textarea{box-sizing:border-box;max-width:100%;min-width:0;font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 8px}textarea{width:100%;resize:vertical;overflow-wrap:anywhere}.primary{background:#202124;color:#fff;border-color:#202124}.danger{color:#b42318}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:0;max-height:300px;overflow:auto;background:#f6f6f6;border-radius:7px;padding:8px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}details{min-width:0}summary{cursor:pointer;overflow-wrap:anywhere}ul{margin:0;padding-left:20px}@media(max-width:360px){.grid,.button-grid,.button-grid.four{grid-template-columns:1fr 1fr}.field.full{grid-column:1/-1}}@media(prefers-color-scheme:dark){.card,.request{background:#222;border-color:#444}.muted,.field span,.notice,.empty{color:#aaa}button,input,select,textarea{background:#292929;color:#f3f3f3;border-color:#555}.primary{background:#f3f3f3;color:#181818}.danger{color:#ff8b82}pre{background:#181818}.status{border-color:#555}}`;
  }

  function render() {
    if (!panel) return;
    const root = panel.shadowRoot;
    const project = projectSummary();
    const agents = agentOptions();
    const models = modelOptions();
    const currentModel = state.config.model ? `${state.config.model.providerID}\u0000${state.config.model.modelID}` : '';
    const selected = currentSession();
    const result = latestAssistantText();
    const status = statusType(state.session_status);
    const connectionClass = state.busy ? 'busy' : state.connected ? 'ready' : '';
    root.querySelector('.content').innerHTML = `
      <section class="card">
        <div class="title-row"><b>本机 OpenCode</b><span class="status ${connectionClass}">${state.busy ? '处理中' : state.connected ? '已连接' : '未连接'}</span></div>
        <div class="muted">${escapeHtml(FIXED_ORIGIN)}${project.version ? ` · OpenCode ${escapeHtml(project.version)}` : ''}${project.path ? `<br>${escapeHtml(project.path)}` : ''}${project.branch ? ` · ${escapeHtml(project.branch)}` : ''}</div>
        <div class="grid">
          <label class="field"><span>用户名</span><input data-field="username" value="${escapeHtml(state.config.username || 'opencode')}"></label>
          <label class="field"><span>本次浏览器密码</span><input data-field="password" type="password" placeholder="${state.has_password ? '已保存于会话，可留空' : 'OPENCODE_SERVER_PASSWORD'}"></label>
          <label class="field"><span>Agent</span><select data-field="agent"><option value="">默认 Agent</option>${agents.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.config.agent ? 'selected' : ''}>${escapeHtml(item.id)}${item.label && item.label !== item.id ? ` · ${escapeHtml(item.label)}` : ''}</option>`).join('')}</select></label>
          <label class="field"><span>模型</span><select data-field="model"><option value="">OpenCode 默认模型</option>${models.map((item) => { const value = `${item.providerID}\u0000${item.modelID}`; return `<option value="${escapeHtml(value)}" ${value === currentModel ? 'selected' : ''}>${escapeHtml(item.label)}</option>`; }).join('')}</select></label>
        </div>
        <div class="button-grid"><button class="primary" data-action="connect">授权并连接</button><button data-action="refresh-all">刷新全部</button><button data-action="diagnostics">复制诊断</button></div>
        <div class="notice ${state.error ? 'error' : ''}">${escapeHtml(state.error || state.notice || (!state.host_permission ? '尚未授予本机访问权限' : !state.has_password ? '尚未提供 OpenCode 密码' : ''))}</div>
      </section>

      <section class="card">
        <div class="title-row"><b>会话</b><span class="muted">${state.sessions.length} 个</span></div>
        <label class="field"><span>当前会话</span><select data-field="session"><option value="">请选择会话</option>${state.sessions.map((item) => { const id = sessionId(item); return `<option value="${escapeHtml(id)}" ${id === state.selected_session_id ? 'selected' : ''}>${escapeHtml(sessionTitle(item))} · ${escapeHtml(id.slice(-8))}</option>`; }).join('')}</select></label>
        <label class="field"><span>标题</span><input data-field="session-title" value="${escapeHtml(selected ? sessionTitle(selected) : '')}" placeholder="新会话或重命名标题"></label>
        <div class="button-grid four"><button data-action="new-session">新建</button><button data-action="rename-session" ${state.selected_session_id ? '' : 'disabled'}>重命名</button><button data-action="fork-session" ${state.selected_session_id ? '' : 'disabled'}>分叉</button><button class="danger" data-action="delete-session" ${state.selected_session_id ? '' : 'disabled'}>删除</button></div>
      </section>

      <section class="card">
        <div class="title-row"><b>任务</b><label class="row"><input type="checkbox" data-field="auto-poll" ${state.auto_poll ? 'checked' : ''}>自动刷新</label></div>
        <textarea data-field="task" rows="7" placeholder="描述要让 OpenCode 在当前工作区完成的任务。">${escapeHtml(state.task_draft)}</textarea>
        <div class="button-grid"><button data-action="read-composer">读取输入框</button><button class="primary" data-action="run-new">新会话执行</button><button class="primary" data-action="run-current" ${state.selected_session_id ? '' : 'disabled'}>继续当前会话</button></div>
      </section>

      <section class="card">
        <div class="title-row"><b>运行状态</b><span class="status ${status === 'idle' ? 'ready' : status === 'unknown' ? '' : 'busy'}">${escapeHtml(status)}</span></div>
        <div class="button-grid"><button data-action="refresh-session" ${state.selected_session_id ? '' : 'disabled'}>立即刷新</button><button class="danger" data-action="abort" ${state.selected_session_id ? '' : 'disabled'}>终止任务</button><button data-action="copy-session" ${state.selected_session_id ? '' : 'disabled'}>复制会话信息</button></div>
        <div class="muted">${state.last_poll_at ? `上次刷新：${escapeHtml(new Date(state.last_poll_at).toLocaleTimeString())}` : '尚未刷新'}</div>
        <details ${state.todo.length ? 'open' : ''}><summary><b>任务清单</b> · ${state.todo.length}</summary>${todoHtml()}</details>
      </section>

      ${state.permissions.length ? `<section class="card"><div class="title-row"><b>权限请求</b><span class="status busy">等待确认</span></div>${state.permissions.map(permissionHtml).join('')}</section>` : ''}
      ${state.questions.length ? `<section class="card"><div class="title-row"><b>Agent 提问</b><span class="status busy">等待回答</span></div>${state.questions.map(questionHtml).join('')}</section>` : ''}

      <section class="card">
        <div class="title-row"><b>最新结果</b><span class="muted">${state.messages.length} 条消息</span></div>
        ${result ? `<pre>${escapeHtml(result)}</pre><div class="button-grid"><button class="primary" data-action="insert-result">填入输入框</button><button data-action="copy-result">复制结果</button><button data-action="copy-messages">复制全部消息</button></div>` : '<div class="empty">当前会话还没有可回填的 Assistant 结果。</div>'}
      </section>

      <section class="card"><div class="title-row"><b>文件差异</b><span class="muted">${state.diff.length} 个</span></div>${diffHtml()}<div class="button-grid two"><button data-action="copy-diff" ${state.diff.length ? '' : 'disabled'}>复制差异</button><button data-action="copy-todo" ${state.todo.length ? '' : 'disabled'}>复制任务清单</button></div></section>
    `;

    const task = root.querySelector('[data-field="task"]');
    task.oninput = () => { state.task_draft = task.value; };
    root.querySelector('[data-field="auto-poll"]').onchange = (event) => { state.auto_poll = event.target.checked; persistLocal().catch(() => {}); schedulePoll(); };
    root.querySelector('[data-field="session"]').onchange = async (event) => {
      state.selected_session_id = event.target.value;
      try { await refreshSelected(); await persistLocal(); render(); schedulePoll(); } catch (error) { setError(error); }
    };

    const action = (name, handler) => {
      const button = root.querySelector(`[data-action="${name}"]`);
      if (button) button.onclick = () => Promise.resolve().then(handler).catch(setError);
    };
    action('connect', saveAndConnect);
    action('refresh-all', () => refreshAll(true));
    action('diagnostics', async () => { const result = await send({ type: 'local_agent.diagnostics' }); await copyText(safeJson(result.report)); state.notice = '诊断已复制'; render(); });
    action('new-session', async () => { const title = root.querySelector('[data-field="session-title"]').value.trim(); await createSession(title); await refreshSelected(); render(); });
    action('rename-session', renameSession);
    action('fork-session', forkSession);
    action('delete-session', deleteSession);
    action('read-composer', () => { state.task_draft = readComposer(); render(); });
    action('run-new', () => { state.task_draft = root.querySelector('[data-field="task"]').value; return submitTask(true); });
    action('run-current', () => { state.task_draft = root.querySelector('[data-field="task"]').value; return submitTask(false); });
    action('refresh-session', async () => { setBusy(true, '正在刷新当前会话…'); await refreshSelected(); state.busy = false; state.notice = '当前会话已刷新'; render(); schedulePoll(); });
    action('abort', abortSession);
    action('copy-session', () => copyText(safeJson({ session: currentSession(), status: state.session_status })));
    action('insert-result', () => { insertComposer(result); state.notice = '结果已填入当前光标位置'; render(); });
    action('copy-result', () => copyText(result));
    action('copy-messages', () => copyText(safeJson(state.messages)));
    action('copy-diff', () => copyText(safeJson(state.diff)));
    action('copy-todo', () => copyText(safeJson(state.todo)));

    for (const button of root.querySelectorAll('[data-permission]')) {
      button.onclick = () => replyPermission(button.dataset.permission, button.dataset.reply, button.dataset.session).catch(setError);
    }
    for (const button of root.querySelectorAll('[data-question-send]')) {
      button.onclick = () => {
        const input = root.querySelector(`[data-question-answer="${CSS.escape(button.dataset.questionSend)}"]`);
        return replyQuestion(button.dataset.questionSend, input ? input.value : '').catch(setError);
      };
    }
    for (const button of root.querySelectorAll('[data-question-reject]')) button.onclick = () => rejectQuestion(button.dataset.questionReject).catch(setError);
  }

  function create() {
    panel = document.createElement('section');
    panel.id = HOST_ID;
    panel.dataset.dcfPanelRoot = 'true';
    panel.dataset.dcfPanelId = PANEL_ID;
    panel.dataset.dcfPanelTitle = '本机';
    panel.style.display = 'none';
    const root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${style()}</style><div class="content"></div>`;
    document.documentElement.append(panel);
    document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID }));
    render();
  }

  function destroy() {
    destroyed = true;
    clearTimeout(pollTimer);
    pollTimer = null;
    panel && panel.remove();
  }

  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy };

  try {
    document.getElementById(HOST_ID)?.remove();
    create();
    loadState()
      .then(() => send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }))
      .catch((error) => send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined));
  } catch (error) {
    destroy();
    send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
  }
})();
