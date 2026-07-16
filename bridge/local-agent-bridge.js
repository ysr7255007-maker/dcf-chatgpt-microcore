'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 48321;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_RESULT_TEXT_CHARS = 65536;

function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function randomPairingCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function nowIso() { return new Date().toISOString(); }

function loadConfig(configPath) {
  const resolved = path.resolve(configPath || process.env.DCF_LOCAL_AGENT_CONFIG || path.join(__dirname, 'config.json'));
  if (!fs.existsSync(resolved)) {
    return {
      config_path: resolved,
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      default_workspace: null,
      workspaces: {},
      agent: { mode: 'echo' },
      task_dir: path.join(os.homedir(), '.dcf', 'local-agent', 'tasks')
    };
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return {
    config_path: resolved,
    host: parsed.host || DEFAULT_HOST,
    port: Number(parsed.port || DEFAULT_PORT),
    default_workspace: parsed.default_workspace || null,
    workspaces: parsed.workspaces || {},
    agent: parsed.agent || { mode: 'echo' },
    task_dir: parsed.task_dir ? path.resolve(parsed.task_dir) : path.join(os.homedir(), '.dcf', 'local-agent', 'tasks')
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-DCF-Session-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request_body_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (_error) { reject(Object.assign(new Error('invalid_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function validateConfig(config) {
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') throw new Error('bridge_host_must_be_loopback');
  for (const [alias, workspacePath] of Object.entries(config.workspaces || {})) {
    if (!alias || typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) throw new Error(`workspace_invalid:${alias}`);
  }
  return config;
}

function taskFile(config, taskId) { return path.join(config.task_dir, `${taskId}.json`); }
function persistTask(config, record) {
  fs.mkdirSync(config.task_dir, { recursive: true });
  fs.writeFileSync(taskFile(config, record.task_id), JSON.stringify(record, null, 2));
}

function truncateResultText(value) {
  const text = String(value || '');
  return text.length > MAX_RESULT_TEXT_CHARS ? text.slice(-MAX_RESULT_TEXT_CHARS) : text;
}

function parseAgentResult(stdout, taskId) {
  const text = truncateResultText(String(stdout || '').trim());
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.schema === 'dcf.local-result.v1') return { ...parsed, task_id: parsed.task_id || taskId };
    } catch (_ignored) {}
  }
  return {
    schema: 'dcf.local-result.v1',
    task_id: taskId,
    summary: text || '本机 Agent 已完成任务，但没有返回摘要。'
  };
}

function runCommandAgent(config, context) {
  const agent = config.agent || {};
  if (!agent.command || typeof agent.command !== 'string') return Promise.reject(new Error('agent_command_missing'));
  const args = (Array.isArray(agent.args) ? agent.args : []).map((value) => String(value)
    .replaceAll('{task_id}', context.task_id)
    .replaceAll('{workspace}', context.workspace_path)
    .replaceAll('{workspace_alias}', context.workspace_alias));
  const timeoutMs = Math.max(1000, Number(agent.timeout_ms || 30 * 60 * 1000));

  return new Promise((resolve, reject) => {
    const child = spawn(agent.command, args, {
      cwd: context.workspace_path,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        ...(agent.env || {}),
        DCF_LOCAL_TASK_ID: context.task_id,
        DCF_LOCAL_WORKSPACE_ALIAS: context.workspace_alias,
        DCF_LOCAL_WORKSPACE: context.workspace_path
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let outputTooLarge = false;
    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
        outputTooLarge = true;
        return next.slice(-MAX_OUTPUT_BYTES);
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`agent_exit_${code === null ? signal || 'unknown' : code}`);
        error.details = { stdout, stderr, output_truncated: outputTooLarge };
        reject(error);
        return;
      }
      resolve({ result: parseAgentResult(stdout, context.task_id), stdout, stderr, output_truncated: outputTooLarge });
    });
    child.stdin.end(JSON.stringify({
      schema: 'dcf.local-agent.input.v1',
      task_id: context.task_id,
      workspace_alias: context.workspace_alias,
      workspace_path: context.workspace_path,
      task: context.task
    }, null, 2));
  });
}

async function runAgent(config, context) {
  if ((config.agent?.mode || 'echo') === 'echo') {
    return {
      result: {
        schema: 'dcf.local-result.v1',
        task_id: context.task_id,
        summary: `Echo：已收到工作区 ${context.workspace_alias} 的任务。`,
        instruction: context.task.instruction
      },
      stdout: '',
      stderr: '',
      output_truncated: false
    };
  }
  return runCommandAgent(config, context);
}

function createBridgeServer(options = {}) {
  const config = validateConfig({ ...loadConfig(options.configPath), ...(options.config || {}) });
  const pairingCode = String(options.pairingCode || randomPairingCode());
  const sessions = new Map();
  const bindings = new Map();
  const tasks = new Map();

  function sessionFor(req) {
    const token = String(req.headers['x-dcf-session-token'] || '');
    return token && sessions.get(token) ? { token, ...sessions.get(token) } : null;
  }

  function publicTask(record) {
    return {
      task_id: record.task_id,
      binding_id: record.binding_id,
      status: record.status,
      workspace: record.workspace_alias,
      received_at: record.received_at,
      started_at: record.started_at || null,
      completed_at: record.completed_at || null,
      result: record.result || null,
      error: record.error || null
    };
  }

  async function execute(record) {
    record.status = 'running';
    record.started_at = nowIso();
    persistTask(config, publicTask(record));
    try {
      const output = await runAgent(config, {
        task_id: record.task_id,
        task: record.task,
        workspace_alias: record.workspace_alias,
        workspace_path: record.workspace_path
      });
      record.status = 'completed';
      record.result = {
        ...output.result,
        stderr: output.stderr ? truncateResultText(output.stderr) : undefined,
        output_truncated: output.output_truncated || undefined
      };
    } catch (error) {
      record.status = 'failed';
      record.error = error?.message || String(error);
      record.result = error?.details ? { schema: 'dcf.local-result.v1', task_id: record.task_id, ...error.details } : null;
    }
    record.completed_at = nowIso();
    persistTask(config, publicTask(record));
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return sendJson(res, 204, {});
      const url = new URL(req.url, `http://${config.host}:${config.port}`);
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return sendJson(res, 200, { schema: 'dcf.local-agent.health.v1', status: 'ready', agent: config.agent?.mode || 'echo' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/pair') {
        const body = await readJson(req);
        if (String(body.code || '') !== pairingCode) return sendJson(res, 403, { error: 'pairing_code_invalid' });
        const token = randomToken();
        sessions.set(token, { created_at: nowIso() });
        return sendJson(res, 200, { session_token: token });
      }

      const session = sessionFor(req);
      if (!session) return sendJson(res, 401, { error: 'session_token_invalid' });

      if (req.method === 'POST' && url.pathname === '/v1/register') {
        const body = await readJson(req);
        if (body.schema !== 'dcf.local-instance.v1' || !body.installation_id || !body.page_session_id) return sendJson(res, 400, { error: 'instance_registration_invalid' });
        const bindingId = `binding-${crypto.createHash('sha256').update(`${body.installation_id}:${body.page_session_id}`).digest('hex').slice(0, 20)}`;
        const binding = { ...body, binding_id: bindingId, token: session.token, registered_at: nowIso() };
        bindings.set(bindingId, binding);
        return sendJson(res, 200, {
          binding_id: bindingId,
          workspace_alias: config.default_workspace,
          agent: config.agent?.name || config.agent?.command || config.agent?.mode || 'echo',
          status: 'ready'
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        const body = await readJson(req);
        const binding = bindings.get(String(body.binding_id || ''));
        if (!binding || binding.token !== session.token) return sendJson(res, 404, { error: 'binding_not_found' });
        const task = body.task;
        if (!task || task.schema !== 'dcf.local-task.v1' || typeof task.instruction !== 'string' || !task.instruction.trim()) return sendJson(res, 400, { error: 'local_task_invalid' });
        const active = Array.from(tasks.values()).find((item) => item.binding_id === binding.binding_id && (item.status === 'received' || item.status === 'running'));
        if (active) return sendJson(res, 409, { error: 'binding_task_already_active', task_id: active.task_id });
        const workspaceAlias = String(task.workspace || config.default_workspace || '');
        const workspacePath = config.workspaces[workspaceAlias];
        if (!workspaceAlias || !workspacePath) return sendJson(res, 400, { error: 'workspace_not_configured' });
        const taskId = `task-${randomToken(12)}`;
        const record = {
          task_id: taskId,
          binding_id: binding.binding_id,
          token: session.token,
          task,
          workspace_alias: workspaceAlias,
          workspace_path: workspacePath,
          status: 'received',
          received_at: nowIso(),
          started_at: null,
          completed_at: null,
          result: null,
          error: null
        };
        tasks.set(taskId, record);
        persistTask(config, publicTask(record));
        setImmediate(() => execute(record));
        return sendJson(res, 202, publicTask(record));
      }

      const taskMatch = req.method === 'GET' && url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const record = tasks.get(decodeURIComponent(taskMatch[1]));
        if (!record || record.token !== session.token) return sendJson(res, 404, { error: 'task_not_found' });
        return sendJson(res, 200, publicTask(record));
      }

      return sendJson(res, 404, { error: 'route_not_found' });
    } catch (error) {
      return sendJson(res, Number(error?.status || 500), { error: error?.message || String(error) });
    }
  });

  return {
    config,
    pairingCode,
    server,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); });
      });
    },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
    snapshot() { return { sessions: sessions.size, bindings: bindings.size, tasks: Array.from(tasks.values()).map(publicTask) }; }
  };
}

if (require.main === module) {
  try {
    const bridge = createBridgeServer();
    bridge.listen().then((address) => {
      console.log(`[DCF Local Agent Bridge] listening on http://${address.address}:${address.port}`);
      console.log(`[DCF Local Agent Bridge] pairing code: ${bridge.pairingCode}`);
      console.log(`[DCF Local Agent Bridge] config: ${bridge.config.config_path}`);
    }).catch((error) => { console.error(error); process.exitCode = 1; });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  loadConfig,
  validateConfig,
  parseAgentResult,
  createBridgeServer
};
