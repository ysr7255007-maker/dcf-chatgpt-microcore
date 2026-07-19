from pathlib import Path

path = Path('chrome-extension/code-units/local-agent-dialogue/main.js')
text = path.read_text()

old_version = "const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.10';"
if old_version not in text:
    raise SystemExit('unexpected dialogue version')
text = text.replace(old_version, "const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.11';", 1)

old_connection = """  async function connectionConfig() {
    const result = await host({ type: 'plugin.data.get', plugin_id: LOCAL_AGENT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const stored = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = localAgentShadow();
    const modelValue = String(shadow?.querySelector('[data-field=\"model\"]')?.value || '');
    const modelParts = modelValue ? modelValue.split('\\u0000') : [];
    return {
      base_url: String(shadow?.querySelector('[data-field=\"base-url\"]')?.value || stored.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(shadow?.querySelector('[data-field=\"username\"]')?.value || stored.username || 'opencode').trim() || 'opencode',
      password: String(shadow?.querySelector('[data-field=\"password\"]')?.value || ''),
      agent: String(shadow?.querySelector('[data-field=\"agent\"]')?.value || stored.agent || ''),
      model: modelParts.length === 2 ? { providerID: modelParts[0], modelID: modelParts[1] } : stored.model || null
    };
  }
"""
new_connection = """  function normalizeStoredModel(value) {
    if (!value || typeof value !== 'object') return null;
    const providerID = String(value.providerID || '').trim();
    const modelID = String(value.modelID || '').trim();
    return providerID && modelID ? { providerID, modelID } : null;
  }

  async function connectionConfig() {
    const result = await host({ type: 'plugin.data.get', plugin_id: LOCAL_AGENT_ID });
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const stored = data.config && typeof data.config === 'object' ? data.config : {};
    const shadow = localAgentShadow();
    return {
      base_url: String(shadow?.querySelector('[data-field=\"base-url\"]')?.value || stored.base_url || 'http://127.0.0.1:4096').trim(),
      username: String(shadow?.querySelector('[data-field=\"username\"]')?.value || stored.username || 'opencode').trim() || 'opencode',
      password: String(shadow?.querySelector('[data-field=\"password\"]')?.value || ''),
      agent: String(shadow?.querySelector('[data-field=\"agent\"]')?.value || stored.agent || ''),
      model: normalizeStoredModel(stored.model)
    };
  }
"""
if old_connection not in text:
    raise SystemExit('connectionConfig block not found')
text = text.replace(old_connection, new_connection, 1)

old_helpers = """  function assistantText(record) {
    if (!messageRole(record).includes('assistant')) return '';
    const texts = [];
    for (const part of list(record?.parts)) {
      if (part?.type !== 'text') continue;
      const text = String(part.text || '').trim();
      if (text) texts.push(text);
    }
    return texts.join('\\n').trim();
  }

  function latestAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const text = assistantText(messages[index]);
      if (text) return text;
    }
    return '';
  }
"""
new_helpers = """  function assistantText(record) {
    if (!messageRole(record).includes('assistant')) return '';
    const texts = [];
    for (const part of list(record?.parts)) {
      if (part?.type !== 'text') continue;
      const text = String(part.text || '').trim();
      if (text) texts.push(text);
    }
    return texts.join('\\n').trim();
  }

  function latestAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const text = assistantText(messages[index]);
      if (text) return text;
    }
    return '';
  }

  function assistantReasoning(record) {
    if (!messageRole(record).includes('assistant')) return '';
    return list(record?.parts)
      .filter((part) => part?.type === 'reasoning')
      .map((part) => String(part.text || '').trim())
      .filter(Boolean)
      .join('\\n')
      .trim();
  }

  function reasoningTrace(messages) {
    return messages.map((record) => {
      const reasoning = assistantReasoning(record);
      if (!reasoning) return null;
      return {
        message_id: messageId(record),
        created_at: record?.info?.time?.created ?? null,
        completed_at: record?.info?.time?.completed ?? null,
        text: reasoning
      };
    }).filter(Boolean);
  }

  function boundedEvidence(value, limit = 4000) {
    if (value === undefined) return null;
    const encoded = json(value);
    if (encoded.length <= limit) return value;
    return { truncated: true, preview: encoded.slice(0, limit), hash: hash(encoded), original_chars: encoded.length };
  }

  function assistantTurnTrace(messages) {
    return messages.filter((record) => messageRole(record).includes('assistant')).map((record) => ({
      message_id: messageId(record),
      provider_id: String(record?.info?.providerID || ''),
      model_id: String(record?.info?.modelID || ''),
      agent: String(record?.info?.agent || record?.info?.mode || ''),
      finish: String(record?.info?.finish || ''),
      time: record?.info?.time || null,
      tokens: record?.info?.tokens || null,
      part_types: list(record?.parts).map((part) => String(part?.type || '')).filter(Boolean)
    }));
  }

  function toolTrace(messages) {
    const output = [];
    for (const record of messages) {
      if (!messageRole(record).includes('assistant')) continue;
      for (const part of list(record?.parts)) {
        if (part?.type !== 'tool') continue;
        output.push({
          message_id: messageId(record),
          call_id: String(part.callID || part.callId || ''),
          tool: String(part.tool || part.name || ''),
          status: statusType(part.state, ''),
          title: String(part.state?.title || ''),
          error: String(part.state?.error || ''),
          input: boundedEvidence(part.state?.input),
          output: boundedEvidence(part.state?.output),
          metadata: boundedEvidence(part.state?.metadata, 2000)
        });
      }
    }
    return output;
  }

  function normalizeReturnMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (['reasoning', 'review', 'audit'].includes(mode)) return 'reasoning';
    if (['diagnostic', 'debug', 'full'].includes(mode)) return 'diagnostic';
    return 'final';
  }
"""
if old_helpers not in text:
    raise SystemExit('assistant helper block not found')
text = text.replace(old_helpers, new_helpers, 1)

old_mode = "return_mode: payload.return_mode === 'full' ? 'full' : 'summary',"
if old_mode not in text:
    raise SystemExit('return_mode parser not found')
text = text.replace(old_mode, 'return_mode: normalizeReturnMode(payload.return_mode),', 1)

old_result = """  function resultPayload(job, status, snap) {
    return {
      schema: 'dcf.local-agent.result.v1',
      request_id: job.request.id,
      status,
      session_id: job.session_id,
      assistant_result: latestAssistantText(snap.messages),
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
"""
new_result = """  function executionEvidence(job, snap) {
    return {
      elapsed_ms: Date.now() - job.started_at,
      status_type: snap.status_type,
      timeout_basis: 'observable-idle-time',
      idle_timeout_ms: job.request.idle_timeout_ms,
      last_activity_at: new Date(job.last_activity_at).toISOString(),
      base_url: normalizeBaseUrl(job.config.base_url),
      endpoint_errors: snap.endpoint_errors
    };
  }

  function applyReturnProfile(payload, mode, snap, execution) {
    if (mode === 'reasoning' || mode === 'diagnostic') payload.reasoning = reasoningTrace(snap.messages);
    if (mode === 'diagnostic') {
      payload.diagnostic = {
        assistant_turns: assistantTurnTrace(snap.messages),
        tool_calls: toolTrace(snap.messages),
        todo: snap.todo,
        diff: snap.diff,
        permissions: snap.permissions,
        questions: snap.questions,
        execution
      };
    }
    return payload;
  }

  function resultPayload(job, status, snap) {
    const mode = job.request.return_mode;
    const payload = {
      schema: 'dcf.local-agent.result.v1',
      request_id: job.request.id,
      status,
      session_id: job.session_id,
      return_mode: mode,
      assistant_result: latestAssistantText(snap.messages)
    };
    return applyReturnProfile(payload, mode, snap, executionEvidence(job, snap));
  }
"""
if old_result not in text:
    raise SystemExit('resultPayload block not found')
text = text.replace(old_result, new_result, 1)

old_failure = """    const failure = {
      schema: 'dcf.local-agent.result.v1',
      request_id: requestData?.id || job?.request.id || 'unknown',
      status: 'bridge_error',
      session_id: job?.session_id || '',
      assistant_result: latestAssistantText(snap.messages || []),
      todo: snap.todo || [], diff: snap.diff || [], permissions: snap.permissions || [], questions: snap.questions || [],
      execution: {
        elapsed_ms: state.started_at ? Date.now() - state.started_at : 0,
        status_type: 'bridge_error',
        base_url: job ? normalizeBaseUrl(job.config.base_url) : '',
        endpoint_errors: { bridge: String(error?.message || error), code: error?.code || '' }
      }
    };
"""
new_failure = """    const mode = requestData?.return_mode || job?.request.return_mode || 'final';
    const execution = {
      elapsed_ms: state.started_at ? Date.now() - state.started_at : 0,
      status_type: 'bridge_error',
      base_url: job ? normalizeBaseUrl(job.config.base_url) : '',
      endpoint_errors: { bridge: String(error?.message || error), code: error?.code || '' }
    };
    const failure = applyReturnProfile({
      schema: 'dcf.local-agent.result.v1',
      request_id: requestData?.id || job?.request.id || 'unknown',
      status: 'bridge_error',
      session_id: job?.session_id || '',
      return_mode: mode,
      assistant_result: latestAssistantText(snap.messages || []),
      error: String(error?.message || error)
    }, mode, snap, execution);
"""
if old_failure not in text:
    raise SystemExit('returnFailure payload block not found')
text = text.replace(old_failure, new_failure, 1)

accept_old = "plugin: { id: UNIT_ID, version: UNIT_VERSION, intake_model: 'new-assistant-event-stream' },"
accept_new = "plugin: { id: UNIT_ID, version: UNIT_VERSION, intake_model: 'new-assistant-event-stream', return_modes: ['final', 'reasoning', 'diagnostic'] },"
if accept_old not in text:
    raise SystemExit('acceptance plugin block not found')
text = text.replace(accept_old, accept_new, 1)

path.write_text(text)
