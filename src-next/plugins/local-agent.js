'use strict';

const { extractLocalTaskEnvelopes, buildLocalResultEnvelope } = require('./local-agent-envelope');

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:48321';
const SESSION_TOKEN_KEY = 'dcf.next.local-agent.session-token.v1';
const TERMINAL_TASK_STATES = new Set(['completed', 'failed']);

function createId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function normalizeBridgeUrl(value) {
  const parsed = new URL(String(value || DEFAULT_BRIDGE_URL));
  const allowedHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1';
  if (parsed.protocol !== 'http:' || !allowedHost || parsed.username || parsed.password) throw new Error('bridge_url_must_be_loopback_http');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.origin;
}

function createRegistration({ installationId, pageSessionId, version, win = globalThis.window }) {
  return {
    schema: 'dcf.local-instance.v1',
    installation_id: installationId,
    page_session_id: pageSessionId,
    platform: 'chatgpt',
    conversation_key: String(win?.location?.pathname || '/'),
    dcf_version: version,
    page_url: String(win?.location?.href || ''),
    viewport: {
      width: Number(win?.visualViewport?.width || win?.innerWidth || 0),
      height: Number(win?.visualViewport?.height || win?.innerHeight || 0)
    }
  };
}

function resolveGmRequest(explicit) {
  if (typeof explicit === 'function') return explicit;
  if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
  return null;
}

function createJsonRequester(explicitRequest) {
  const gmRequest = resolveGmRequest(explicitRequest);
  return function requestJson({ method = 'GET', url, token, body, timeout = 8000 }) {
    if (!gmRequest) return Promise.reject(new Error('gm_xmlhttp_request_unavailable'));
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers['X-DCF-Session-Token'] = token;
      gmRequest({
        method,
        url,
        headers,
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout,
        onload(response) {
          let parsed = null;
          try { parsed = response.responseText ? JSON.parse(response.responseText) : null; } catch (_ignored) {}
          if (response.status >= 200 && response.status < 300) return resolve(parsed || {});
          const error = new Error(parsed?.error || `bridge_http_${response.status}`);
          error.status = response.status;
          reject(error);
        },
        ontimeout: () => reject(new Error('bridge_request_timeout')),
        onerror: () => reject(new Error('bridge_request_failed'))
      });
    });
  };
}

function localAgentPlugin(options = {}) {
  return {
    id: 'dcf.next.local-agent',
    version: '1.0.0',
    title: '本机 Agent',
    description: '把当前网页实例绑定到 loopback 本机执行端，并回收任务结果。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const chatgpt = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell) throw new Error('shell_plugin_required');
      if (!chatgpt) throw new Error('chatgpt_plugin_required');

      const win = ctx.platform.window || globalThis.window;
      const requestJson = createJsonRequester(options.gmRequest);
      const installationId = ctx.storage.get('installation_id', null) || createId('install');
      ctx.storage.set('installation_id', installationId);
      const pageSessionId = createId('page');
      let bridgeUrl;
      try { bridgeUrl = normalizeBridgeUrl(ctx.storage.get('bridge_url', DEFAULT_BRIDGE_URL)); }
      catch (_error) { bridgeUrl = DEFAULT_BRIDGE_URL; ctx.storage.set('bridge_url', bridgeUrl); }
      let sessionToken = null;
      try { sessionToken = win?.sessionStorage?.getItem(SESSION_TOKEN_KEY) || null; } catch (_ignored) {}

      const state = {
        connection: 'disconnected',
        binding_id: null,
        workspace_alias: null,
        agent: null,
        pending_task: null,
        active_task: null,
        last_result: null,
        last_error: null
      };
      let pollTimer = null;

      function saveToken(token) {
        sessionToken = token || null;
        try {
          if (sessionToken) win?.sessionStorage?.setItem(SESSION_TOKEN_KEY, sessionToken);
          else win?.sessionStorage?.removeItem(SESSION_TOKEN_KEY);
        } catch (_ignored) {}
      }

      function refresh() { shell.refresh('local-agent'); }
      function setError(error) {
        state.last_error = error?.message || String(error);
        if (error?.status === 401) { saveToken(null); state.binding_id = null; }
        state.connection = 'disconnected';
        refresh();
      }

      async function register() {
        if (!sessionToken) throw new Error('pairing_required');
        state.connection = 'connecting'; state.last_error = null; refresh();
        const response = await requestJson({
          method: 'POST',
          url: `${bridgeUrl}/v1/register`,
          token: sessionToken,
          body: createRegistration({ installationId, pageSessionId, version: ctx.survival.version, win })
        });
        state.connection = 'ready';
        state.binding_id = response.binding_id;
        state.workspace_alias = response.workspace_alias || null;
        state.agent = response.agent || null;
        refresh();
        return response;
      }

      async function pair(code) {
        state.connection = 'connecting'; state.last_error = null; refresh();
        try {
          const response = await requestJson({ method: 'POST', url: `${bridgeUrl}/v1/pair`, body: { code: String(code || '').trim() } });
          if (!response.session_token) throw new Error('pairing_response_invalid');
          saveToken(response.session_token);
          return await register();
        } catch (error) { setError(error); throw error; }
      }

      function taskResultEnvelope(taskRecord) {
        const result = taskRecord.result || {};
        return buildLocalResultEnvelope({
          ...result,
          task_id: taskRecord.task_id,
          status: taskRecord.status,
          error: taskRecord.error || result.error
        });
      }

      async function pollTask(taskId) {
        try {
          const response = await requestJson({ method: 'GET', url: `${bridgeUrl}/v1/tasks/${encodeURIComponent(taskId)}`, token: sessionToken });
          state.active_task = response;
          if (TERMINAL_TASK_STATES.has(response.status)) {
            clearInterval(pollTimer); pollTimer = null;
            state.last_result = taskResultEnvelope(response);
          }
          refresh();
          return response;
        } catch (error) { clearInterval(pollTimer); pollTimer = null; setError(error); throw error; }
      }

      async function submit(task = state.pending_task) {
        if (!task) throw new Error('local_task_missing');
        if (!state.binding_id) await register();
        const response = await requestJson({
          method: 'POST',
          url: `${bridgeUrl}/v1/tasks`,
          token: sessionToken,
          body: { binding_id: state.binding_id, task }
        });
        state.pending_task = null;
        state.active_task = response;
        clearInterval(pollTimer);
        pollTimer = setInterval(() => { pollTask(response.task_id).catch(() => {}); }, 1000);
        refresh();
        return response;
      }

      function acceptReply(text) {
        const decoded = extractLocalTaskEnvelopes(text);
        for (const item of decoded.tasks) state.pending_task = item.task;
        if (decoded.tasks.length || decoded.errors.length) {
          state.last_error = decoded.errors.length ? decoded.errors.map((item) => item.code).join(', ') : null;
          refresh();
        }
        return decoded;
      }

      function status() {
        return {
          connection: state.connection,
          bridge_url: bridgeUrl,
          installation_id: installationId,
          page_session_id: pageSessionId,
          binding_id: state.binding_id,
          workspace_alias: state.workspace_alias,
          agent: state.agent,
          pending_task: state.pending_task ? { workspace: state.pending_task.workspace || null, instruction: state.pending_task.instruction } : null,
          active_task: state.active_task ? { task_id: state.active_task.task_id, status: state.active_task.status } : null,
          has_result: Boolean(state.last_result),
          last_error: state.last_error
        };
      }

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const connectionCard = document.createElement('section'); connectionCard.className = 'dcf-card dcf-stack';
        const title = document.createElement('div'); title.className = 'dcf-title'; title.textContent = '本地协作实例';
        const summary = document.createElement('div'); summary.className = 'dcf-muted'; summary.textContent = `${state.connection} · ${state.agent || '未绑定 Agent'} · ${state.workspace_alias || '未绑定工作区'}`;
        const urlField = document.createElement('label'); urlField.className = 'dcf-field';
        const urlLabel = document.createElement('span'); urlLabel.textContent = '本地桥地址';
        const urlInput = document.createElement('input'); urlInput.value = bridgeUrl;
        urlInput.onchange = () => {
          try { bridgeUrl = normalizeBridgeUrl(urlInput.value); ctx.storage.set('bridge_url', bridgeUrl); state.last_error = null; }
          catch (error) { state.last_error = error.message; }
          refresh();
        };
        urlField.append(urlLabel, urlInput);
        const pairRow = document.createElement('div'); pairRow.className = 'dcf-row';
        const code = document.createElement('input'); code.placeholder = '本地桥配对码';
        const pairButton = document.createElement('button'); pairButton.className = 'dcf-btn primary'; pairButton.textContent = sessionToken ? '重新连接' : '配对并连接';
        pairButton.onclick = () => {
          const action = sessionToken && !code.value.trim() ? register() : pair(code.value);
          action.then(() => shell.notify('本机 Agent 已连接')).catch((error) => shell.notify(error.message, 'error'));
        };
        pairRow.append(code, pairButton);
        connectionCard.append(title, summary, urlField, pairRow);
        if (state.last_error) { const error = document.createElement('div'); error.className = 'dcf-muted'; error.textContent = `错误：${state.last_error}`; connectionCard.append(error); }
        root.append(connectionCard);

        const taskCard = document.createElement('section'); taskCard.className = 'dcf-card dcf-stack';
        const taskTitle = document.createElement('div'); taskTitle.className = 'dcf-title'; taskTitle.textContent = '当前任务'; taskCard.append(taskTitle);
        if (state.pending_task) {
          const workspace = document.createElement('div'); workspace.className = 'dcf-muted'; workspace.textContent = `工作区：${state.pending_task.workspace || state.workspace_alias || '由本地桥决定'}`;
          const instruction = document.createElement('pre'); instruction.style.whiteSpace = 'pre-wrap'; instruction.textContent = state.pending_task.instruction;
          const run = document.createElement('button'); run.className = 'dcf-btn primary'; run.textContent = '执行任务';
          run.onclick = () => submit().then(() => shell.notify('任务已交给本机 Agent')).catch((error) => shell.notify(error.message, 'error'));
          taskCard.append(workspace, instruction, run);
        } else if (state.active_task) {
          const active = document.createElement('div'); active.className = 'dcf-muted'; active.textContent = `${state.active_task.task_id} · ${state.active_task.status}`;
          taskCard.append(active);
        } else {
          const empty = document.createElement('div'); empty.className = 'dcf-empty'; empty.textContent = '当前回复中没有待执行的 DCF_LOCAL_TASK。'; taskCard.append(empty);
        }
        root.append(taskCard);

        if (state.last_result) {
          const resultCard = document.createElement('section'); resultCard.className = 'dcf-card dcf-stack';
          const resultTitle = document.createElement('div'); resultTitle.className = 'dcf-title'; resultTitle.textContent = '本机执行结果';
          const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = state.last_result;
          const fill = document.createElement('button'); fill.className = 'dcf-btn primary'; fill.textContent = '填入当前输入框';
          fill.onclick = () => chatgpt.insert(state.last_result).then(() => shell.notify('结果已填入输入框')).catch((error) => shell.notify(error.message, 'error'));
          resultCard.append(resultTitle, pre, fill); root.append(resultCard);
        }
        container.append(root);
      }

      shell.registerPanel({ id: 'local-agent', title: '本机', render });
      chatgpt.onReplyCompleted(({ text }) => acceptReply(text));
      chatgpt.onNavigation(() => { if (sessionToken) register().catch(setError); });
      if (sessionToken) register().catch(setError);

      return {
        pair,
        register,
        submit,
        pollTask,
        acceptReply,
        status,
        diagnostics: status,
        fillLastResult: () => state.last_result ? chatgpt.insert(state.last_result) : Promise.reject(new Error('local_result_missing')),
        destroy() { clearInterval(pollTimer); }
      };
    }
  };
}

module.exports = {
  DEFAULT_BRIDGE_URL,
  SESSION_TOKEN_KEY,
  createId,
  normalizeBridgeUrl,
  createRegistration,
  createJsonRequester,
  localAgentPlugin
};
