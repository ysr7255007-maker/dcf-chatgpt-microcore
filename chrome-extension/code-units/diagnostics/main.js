(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.diagnostics';
  const UNIT_VERSION = '1.0.0-rc.2-diagnostics.2';
  const PANEL_ID = 'diagnostics';
  const HOST_ID = 'dcf-panel-diagnostics';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_DIAGNOSTICS__';
  const LOCAL_AGENT_ID = 'dcf.firstparty.local-agent';
  const DIALOGUE_ID = 'dcf.firstparty.local-agent-dialogue';
  const LOCAL_AGENT_PANEL_ID = 'dcf-panel-local-agent';
  const SHELL_HOST_ID = 'dcf-chrome-shell-host';
  const REPORT_START = '<<<DCF_LOCAL_AGENT_DIAGNOSTIC>>>';
  const REPORT_END = '<<<END_DCF_LOCAL_AGENT_DIAGNOSTIC>>>';

  const previous = globalThis[GLOBAL_KEY];
  if (previous?.destroy) previous.destroy();

  const sendHost = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
    return result;
  });

  let panel = null;
  let hostReport = null;
  let localReport = null;
  let notice = '';
  let destroyed = false;
  let pendingArtifact = '';

  const list = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  const safeJson = (value) => { try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); } };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const bounded = (value, limit = 1200) => {
    const text = typeof value === 'string' ? value : safeJson(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function shellShadow() {
    return document.getElementById(SHELL_HOST_ID)?.shadowRoot || null;
  }

  function localPanelHost() {
    return document.getElementById(LOCAL_AGENT_PANEL_ID)
      || shellShadow()?.querySelector(`#${LOCAL_AGENT_PANEL_ID}`)
      || null;
  }

  function localPanelShadow() {
    return localPanelHost()?.shadowRoot || null;
  }

  async function pluginData(pluginId) {
    const result = await sendHost({ type: 'plugin.data.get', plugin_id: pluginId });
    return result.data && typeof result.data === 'object' ? result.data : {};
  }

  async function ownData() {
    return pluginData(UNIT_ID);
  }

  async function saveOwnData(next) {
    await sendHost({ type: 'plugin.data.set', plugin_id: UNIT_ID, data: next });
  }

  async function connectionConfig() {
    const data = await pluginData(LOCAL_AGENT_ID);
    const saved = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = localPanelShadow();
    const modelValue = String(shadow?.querySelector('[data-field="model"]')?.value || '');
    const [providerID, modelID] = modelValue ? modelValue.split('\u0000') : [];
    const model = providerID && modelID
      ? { providerID, modelID }
      : saved.model && typeof saved.model === 'object'
        ? { providerID: String(saved.model.providerID || ''), modelID: String(saved.model.modelID || '') }
        : null;
    return {
      base_url: String(shadow?.querySelector('[data-field="base-url"]')?.value || saved.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(shadow?.querySelector('[data-field="username"]')?.value || saved.username || 'opencode').trim() || 'opencode',
      password: String(shadow?.querySelector('[data-field="password"]')?.value || ''),
      agent: String(shadow?.querySelector('[data-field="agent"]')?.value || saved.agent || ''),
      model: model?.providerID && model?.modelID ? model : null
    };
  }

  function normalizeBaseUrl(raw) {
    let url;
    try { url = new URL(String(raw || 'http://127.0.0.1:4096').trim().replace(/\/$/, '')); }
    catch (_) { throw new Error('OpenCode 地址无效'); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('诊断只允许连接本机 loopback 地址');
    }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) {
      throw new Error('OpenCode 地址只能包含协议、主机与端口');
    }
    const host = url.hostname === '[::1]' ? '[::1]' : url.hostname;
    return `${url.protocol}//${host}:${url.port || '4096'}`;
  }

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  async function getJson(path, config, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (config.password) headers.Authorization = basicAuth(config.username, config.password);
      const response = await fetch(`${normalizeBaseUrl(config.base_url)}${path}`, {
        method: 'GET',
        headers,
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
        const error = new Error(`OpenCode HTTP ${response.status}${text ? `：${bounded(text, 500)}` : ''}`);
        error.status = response.status;
        error.response_body = bounded(text, 1000);
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async function optionalGet(name, path, config) {
    try { return [name, { ok: true, data: await getJson(path, config) }]; }
    catch (error) {
      return [name, {
        ok: false,
        error: String(error?.message || error),
        status: Number(error?.status) || null,
        response_body: error?.response_body || ''
      }];
    }
  }

  function statusCollection(value) {
    if (!value || typeof value !== 'object') return {};
    if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) return value.sessions;
    if (value.data?.sessions && typeof value.data.sessions === 'object' && !Array.isArray(value.data.sessions)) return value.data.sessions;
    if (value.data && typeof value.data === 'object' && !Array.isArray(value.data)) return value.data;
    return value;
  }

  function sessionStatus(value, sessionId) {
    const collection = statusCollection(value);
    return collection?.[sessionId]
      || list(collection).find((item) => String(item?.sessionID || item?.session_id || item?.sessionId || item?.id || '') === sessionId)
      || null;
  }

  function providerId(value) {
    return String(value?.id || value?.providerID || value?.providerId || value?.name || '');
  }

  function modelId(value) {
    return String(value?.id || value?.modelID || value?.modelId || value?.name || '');
  }

  function summarizeProviders(configProviders, providerCatalog, selectedModel) {
    const configPayload = configProviders?.ok ? configProviders.data : null;
    const providerPayload = providerCatalog?.ok ? providerCatalog.data : null;
    const providers = list(configPayload?.providers || providerPayload?.all || providerPayload?.providers);
    const connected = list(providerPayload?.connected).map(String).filter(Boolean);
    const defaults = configPayload?.default || providerPayload?.default || {};
    const summaries = providers.slice(0, 40).map((provider) => {
      const id = providerId(provider);
      const models = list(provider?.models);
      const ids = models.map(modelId).filter(Boolean);
      return {
        id,
        name: String(provider?.name || id),
        connected: connected.includes(id),
        model_count: ids.length,
        selected_model_present: Boolean(selectedModel && selectedModel.providerID === id && ids.includes(selectedModel.modelID)),
        model_ids: ids.slice(0, 24)
      };
    }).filter((item) => item.id);
    return {
      connected,
      defaults,
      provider_count: summaries.length,
      selected: selectedModel || null,
      selected_provider_present: Boolean(selectedModel && summaries.some((item) => item.id === selectedModel.providerID)),
      selected_model_present: Boolean(selectedModel && summaries.some((item) => item.id === selectedModel.providerID && item.selected_model_present)),
      providers: summaries
    };
  }

  function summarizeAgents(result, selectedAgent) {
    const agents = result?.ok ? list(result.data) : [];
    const summaries = agents.slice(0, 40).map((agent) => ({
      id: String(agent?.name || agent?.id || ''),
      mode: String(agent?.mode || agent?.type || ''),
      model: typeof agent?.model === 'string'
        ? agent.model
        : agent?.model && typeof agent.model === 'object'
          ? `${agent.model.providerID || ''}/${agent.model.modelID || ''}`.replace(/^\/$/, '')
          : ''
    })).filter((item) => item.id);
    return {
      selected: selectedAgent || null,
      selected_present: selectedAgent ? summaries.some((item) => item.id === selectedAgent) : null,
      agents: summaries
    };
  }

  function extractMessageErrors(messages) {
    const errors = [];
    for (const record of messages) {
      const info = record?.info || {};
      if (info.error) errors.push({ source: 'message.info.error', value: bounded(info.error, 1200) });
      for (const part of list(record?.parts)) {
        if (part?.state?.error) errors.push({ source: `part.${part.type || 'unknown'}.state.error`, value: bounded(part.state.error, 1200) });
        if (part?.error) errors.push({ source: `part.${part.type || 'unknown'}.error`, value: bounded(part.error, 1200) });
      }
    }
    return errors.slice(0, 20);
  }

  function summarizeMessages(result) {
    const messages = result?.ok ? list(result.data) : [];
    return {
      count: messages.length,
      roles: messages.map((record) => String(record?.info?.role || record?.info?.type || 'unknown')).slice(0, 40),
      assistant_count: messages.filter((record) => String(record?.info?.role || record?.info?.type || '').toLowerCase().includes('assistant')).length,
      errors: extractMessageErrors(messages)
    };
  }

  function statusInterpretation(statusResult, messages) {
    if (!statusResult?.ok) return 'status-unavailable';
    if (statusResult.normalized) return 'active-status-present';
    if (messages.assistant_count > 0) return 'inactive-with-assistant-output';
    if (messages.count > 0) return 'inactive-without-assistant-output';
    return 'inactive-without-messages';
  }

  function hypotheses(config, providers, agents, messages, statusResult) {
    const items = [];
    if (config.model && !providers.selected_provider_present) items.push('显式选择的 Provider 不在当前目录中。');
    if (config.model && providers.selected_provider_present && !providers.selected_model_present) items.push('显式选择的模型不在当前 Provider 模型目录中。');
    if (config.model && providers.connected.length && !providers.connected.includes(config.model.providerID)) items.push('显式选择的 Provider 当前未列为 connected。');
    if (!config.model && (!providers.defaults || Object.keys(providers.defaults).length === 0)) items.push('未显式选择模型，服务也没有返回默认模型映射。');
    if (config.agent && agents.selected_present === false) items.push('显式选择的 Agent 不在当前 Agent 目录中。');
    if (messages.count === 0 && statusResult?.ok && !statusResult.normalized) items.push('该 session 当前没有活动状态条目，也没有落盘消息；执行可能尚未开始或尚未产生可观察输出。');
    else if (messages.count > 0 && messages.assistant_count === 0) items.push('该 session 已有消息，但尚未出现 Assistant 输出。');
    return items;
  }

  async function collectLocalAgentDiagnostic(sessionId, requestId) {
    const config = await connectionConfig();
    const encoded = encodeURIComponent(sessionId);
    const pairs = await Promise.all([
      optionalGet('health', '/global/health', config),
      optionalGet('session', `/session/${encoded}`, config),
      optionalGet('status', '/session/status', config),
      optionalGet('messages', `/session/${encoded}/message?limit=40`, config),
      optionalGet('todo', `/session/${encoded}/todo`, config),
      optionalGet('diff', `/session/${encoded}/diff`, config),
      optionalGet('config_providers', '/config/providers', config),
      optionalGet('providers', '/provider', config),
      optionalGet('agents', '/agent', config),
      optionalGet('path', '/path', config),
      optionalGet('vcs', '/vcs', config),
      optionalGet('project', '/project/current', config)
    ]);
    const results = Object.fromEntries(pairs);
    const normalizedStatus = results.status.ok ? sessionStatus(results.status.data, sessionId) : null;
    const providers = summarizeProviders(results.config_providers, results.providers, config.model);
    const agents = summarizeAgents(results.agents, config.agent);
    const messages = summarizeMessages(results.messages);
    const endpoints = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.ok
      ? { ok: true }
      : { ok: false, error: result.error, status: result.status, response_body: result.response_body }
    ]));
    const safeSession = results.session.ok ? {
      id: String(results.session.data?.id || results.session.data?.sessionID || sessionId),
      title: String(results.session.data?.title || results.session.data?.name || ''),
      project_id: String(results.session.data?.projectID || results.session.data?.project_id || ''),
      directory: String(results.session.data?.directory || results.session.data?.path || '')
    } : null;
    const pathValue = results.path.ok
      ? typeof results.path.data === 'string' ? results.path.data : results.path.data?.directory || results.path.data?.cwd || results.path.data?.root || ''
      : '';
    const vcsValue = results.vcs.ok ? results.vcs.data?.branch || results.vcs.data?.ref || results.vcs.data?.head || '' : '';
    const statusEvidence = { ok: results.status.ok, normalized: normalizedStatus, interpretation: statusInterpretation({ ok: results.status.ok, normalized: normalizedStatus }, messages) };
    return {
      schema: 'dcf.local-agent.diagnostic.v1',
      generated_at: new Date().toISOString(),
      source: 'automatic-recent-session-diagnostic',
      request_id: requestId || '',
      session_id: sessionId,
      diagnostic_plugin_version: UNIT_VERSION,
      connection: {
        base_url: normalizeBaseUrl(config.base_url),
        has_page_password: Boolean(config.password),
        agent: config.agent || null,
        model: config.model || null
      },
      workspace: { path: String(pathValue || ''), branch: String(vcsValue || '') },
      health: results.health.ok ? {
        healthy: results.health.data?.healthy !== false,
        version: String(results.health.data?.version || '')
      } : null,
      session: safeSession,
      status: statusEvidence,
      messages,
      providers,
      agents,
      todo_count: results.todo.ok ? list(results.todo.data).length : null,
      diff_count: results.diff.ok ? list(results.diff.data).length : null,
      endpoint_evidence: endpoints,
      hypotheses: hypotheses(config, providers, agents, messages, statusEvidence),
      privacy: {
        message_text_included: false,
        credentials_included: false,
        provider_options_included: false,
        raw_config_included: false
      }
    };
  }

  const artifact = (value) => `${REPORT_START}\n${safeJson(value)}\n${REPORT_END}`;
  const composer = () => document.querySelector('#prompt-textarea')
    || document.querySelector('[data-testid="composer-text-input"]')
    || document.querySelector('form textarea')
    || document.querySelector('main [contenteditable="true"]');
  const composerValue = (target) => target ? String('value' in target ? target.value || '' : target.innerText || target.textContent || '') : '';
  const streaming = () => Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]'));
  const sendButton = () => document.querySelector('[data-testid="send-button"]')
    || document.querySelector('button[aria-label*="Send"]')
    || document.querySelector('button[aria-label*="发送"]');

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
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!document.execCommand?.('insertText', false, text)) target.textContent = text;
    }
    dispatchInput(target, text);
  }

  async function clickSend() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const button = sendButton();
      if (!streaming() && button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
        return;
      }
      await sleep(50);
    }
    throw new Error('诊断已写入输入框，但发送按钮暂不可用');
  }

  async function returnArtifact(text) {
    pendingArtifact = text;
    const started = Date.now();
    while (!destroyed && pendingArtifact === text && Date.now() - started < 120000) {
      const target = composer();
      if (target && !composerValue(target).trim() && !streaming()) {
        fillComposer(text);
        await clickSend();
        pendingArtifact = '';
        notice = '本机 Agent 诊断已自动回传';
        render();
        return true;
      }
      await sleep(500);
    }
    notice = '诊断报告等待回传，当前对话或输入框尚未空闲';
    render();
    return false;
  }

  async function refreshHost() {
    hostReport = (await sendHost({ type: 'host.diagnostics' })).report;
    render();
  }

  async function diagnoseRecent({ force = false } = {}) {
    const dialogue = await pluginData(DIALOGUE_ID);
    const sessionId = String(dialogue.last_session_id || '');
    const requestId = String(dialogue.last_request_id || '');
    if (!sessionId) {
      notice = '没有可诊断的最近本机 session';
      render();
      return null;
    }
    const own = await ownData();
    if (!force && String(own.last_auto_session_id || '') === sessionId) return null;
    notice = '正在只读诊断最近本机 session…';
    render();
    localReport = await collectLocalAgentDiagnostic(sessionId, requestId);
    await saveOwnData({ ...own, last_auto_session_id: sessionId, last_diagnostic_at: localReport.generated_at });
    notice = '诊断完成，正在自动回传';
    render();
    await returnArtifact(artifact(localReport));
    return localReport;
  }

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:9px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.good{color:#15803d}.warn{color:#b45309}.error{color:#b42318}button{font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 9px;cursor:pointer}pre{white-space:pre-wrap;max-height:320px;overflow:auto;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f4f4;padding:8px;border-radius:8px}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}button{background:#292929;color:#f3f3f3;border-color:#555}pre{background:#171717}.good{color:#5ee28a}.warn{color:#f6b94c}.error{color:#ff8b82}}`;
  }

  function render() {
    if (!panel || !hostReport) return;
    const ok = hostReport.user_scripts_available && hostReport.deviations.length === 0;
    const root = panel.shadowRoot;
    const localSummary = localReport ? {
      session_id: localReport.session_id,
      health: localReport.health,
      status: localReport.status,
      messages: localReport.messages,
      selected_model: localReport.connection.model,
      selected_agent: localReport.connection.agent,
      providers: {
        connected: localReport.providers.connected,
        defaults: localReport.providers.defaults,
        selected_provider_present: localReport.providers.selected_provider_present,
        selected_model_present: localReport.providers.selected_model_present
      },
      hypotheses: localReport.hypotheses,
      endpoint_evidence: localReport.endpoint_evidence
    } : null;
    root.querySelector('.content').innerHTML = `
      <section class="card">
        <b class="${ok ? 'good' : 'warn'}">${ok ? 'DCF 正常' : `发现 ${hostReport.deviations.length} 项偏差`}</b>
        <div class="row">
          <button data-action="copy-host">复制底座诊断包</button>
          <button data-action="diagnose-agent">诊断最近本机 Agent</button>
          <button data-action="return-agent" ${pendingArtifact ? '' : 'disabled'}>回传待发送诊断</button>
          <button data-action="recovery">打开最低恢复面</button>
          <button data-action="refresh">刷新</button>
        </div>
        <div class="${/失败|错误/.test(notice) ? 'error' : ''}">${escapeHtml(notice)}</div>
        <pre>${escapeHtml(safeJson({
          host_version: hostReport.host_version,
          current: hostReport.current_snapshot?.id || null,
          candidate: hostReport.candidate_snapshot?.id || null,
          registered: hostReport.actual_registered_scripts.length,
          deviations: hostReport.deviations,
          update: hostReport.update,
          migration: hostReport.migration,
          local_agent: localSummary
        }))}</pre>
      </section>`;
    root.querySelector('[data-action="copy-host"]').onclick = async () => {
      await navigator.clipboard.writeText(safeJson(hostReport));
      notice = '底座诊断包已复制';
      render();
    };
    root.querySelector('[data-action="diagnose-agent"]').onclick = () => diagnoseRecent({ force: true }).catch((error) => {
      notice = `本机 Agent 诊断失败：${String(error?.message || error)}`;
      render();
    });
    root.querySelector('[data-action="return-agent"]').onclick = () => {
      if (pendingArtifact) returnArtifact(pendingArtifact).catch((error) => {
        notice = `诊断回传失败：${String(error?.message || error)}`;
        render();
      });
    };
    root.querySelector('[data-action="recovery"]').onclick = () => sendHost({ type: 'host.open_recovery' });
    root.querySelector('[data-action="refresh"]').onclick = refreshHost;
  }

  function create() {
    panel = document.createElement('section');
    panel.id = HOST_ID;
    panel.dataset.dcfPanelRoot = 'true';
    panel.dataset.dcfPanelId = PANEL_ID;
    panel.dataset.dcfPanelTitle = '诊断';
    panel.style.display = 'none';
    const root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${style()}</style><div class="content"></div>`;
    document.documentElement.append(panel);
    document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID }));
  }

  function destroy() {
    destroyed = true;
    panel?.remove();
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    diagnostic_markers: { start: REPORT_START, end: REPORT_END }
  };

  try {
    document.getElementById(HOST_ID)?.remove();
    create();
    refreshHost().then(async () => {
      await sendHost({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
      diagnoseRecent().catch((error) => {
        notice = `本机 Agent 自动诊断失败：${String(error?.message || error)}`;
        render();
      });
    }).catch((error) => sendHost({
      type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error)
    }).catch(() => {}));
  } catch (error) {
    destroy();
    sendHost({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
  }
})();
