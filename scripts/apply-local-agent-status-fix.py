from pathlib import Path

p = Path('chrome-extension/code-units/local-agent/main.js')
s = p.read_text()
if "local-agent.2" in s:
    raise SystemExit(0)

def one(old, new):
    global s
    if s.count(old) != 1:
        raise RuntimeError(f'expected one match: {old[:80]!r}; got {s.count(old)}')
    s = s.replace(old, new, 1)

one("const UNIT_VERSION = '1.0.0-rc.2-local-agent.1';", "const UNIT_VERSION = '1.0.0-rc.2-local-agent.2';")
one("  function statusType(value) {\n    if (!value) return 'unknown';\n    if (typeof value === 'string') return value;\n    return String(value.type || value.status || value.state || 'unknown');\n  }\n\n  function sessionId(session) {\n", "  function statusType(value, fallback = 'idle') {\n    if (!value) return fallback;\n    if (typeof value === 'string') return value.toLowerCase();\n    return String(value.type || value.status || value.state || fallback).toLowerCase();\n  }\n\n  function statusCollection(value) {\n    if (!value || typeof value !== 'object') return {};\n    if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) return value.sessions;\n    if (value.data?.sessions && typeof value.data.sessions === 'object' && !Array.isArray(value.data.sessions)) return value.data.sessions;\n    if (value.data && typeof value.data === 'object' && !Array.isArray(value.data)) return value.data;\n    return value;\n  }\n\n  function sessionStatusFrom(value, id) {\n    const collection = statusCollection(value);\n    return collection?.[id]\n      || normalizeList(collection).find((item) => String(item?.sessionID || item?.session_id || item?.sessionId || item?.id || '') === id)\n      || null;\n  }\n\n  function currentStatusType() {\n    if (!state.selected_session_id) return 'none';\n    if (state.endpoint_errors.status) return 'unavailable';\n    return statusType(state.session_status, 'idle');\n  }\n\n  function statusLabel(type) {\n    return ({ none: '未选择会话', idle: '空闲', busy: '运行中', retry: '重试中', completed: '已完成', failed: '失败', error: '错误', unavailable: '状态不可用' })[type] || type;\n  }\n\n  function sessionId(session) {\n")
one("      state.questions = [];\n      return;\n", "      state.questions = [];\n      delete state.endpoint_errors.status;\n      return;\n")
one("    const [statuses, messages, todo, diff, permissions, questions] = await Promise.allSettled(requests);\n    if (statuses.status === 'fulfilled') state.session_status = statuses.value && statuses.value[id] || null;\n    if (messages.status === 'fulfilled') state.messages = normalizeList(messages.value);\n", "    const [statuses, messages, todo, diff, permissions, questions] = await Promise.allSettled(requests);\n    if (statuses.status === 'fulfilled') {\n      state.session_status = sessionStatusFrom(statuses.value, id);\n      delete state.endpoint_errors.status;\n    } else {\n      state.session_status = null;\n      state.endpoint_errors.status = String(statuses.reason?.message || statuses.reason || '状态接口不可用');\n    }\n    if (messages.status === 'fulfilled') state.messages = normalizeList(messages.value);\n")
one("    const type = statusType(state.session_status);", "    const type = currentStatusType();")
one("!['idle', 'completed', 'failed', 'error', 'unknown'].includes(type)", "!['none', 'idle', 'completed', 'failed', 'error', 'unavailable'].includes(type)")
one("    const status = statusType(state.session_status);", "    const status = currentStatusType();\n    const statusText = statusLabel(status);")
one("<div class=\"title-row\"><b>运行状态</b><span class=\"status ${status === 'idle' ? 'ready' : status === 'unknown' ? '' : 'busy'}\">${escapeHtml(status)}</span></div>", "<div class=\"title-row\"><b>运行状态</b><span class=\"status ${['none', 'idle', 'completed'].includes(status) ? 'ready' : status === 'unavailable' ? '' : 'busy'}\">${escapeHtml(statusText)}</span></div>")
p.write_text(s)
