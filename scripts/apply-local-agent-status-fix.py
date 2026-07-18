from pathlib import Path

# Update the retained static gates before the source migration guard exits.
p = Path('tests/chrome-local-agent-dialogue.test.js')
t = p.read_text()
if 'local-agent-dialogue.7' not in t:
    t = t.replace('local-agent-dialogue.6', 'local-agent-dialogue.7')
    marker = "  'function attachHotRefreshWatchers()',\n"
    tokens = [
        "const SHELL_HOST_ID = 'dcf-chrome-shell-host'",
        'function shellShadow()',
        'function attachShellObserver()',
        "document.addEventListener('dcf:shell-ready'",
        "document.addEventListener('dcf:panel-ready'",
        'function statusCollection(value)',
        'function sessionStatusFrom(value, id)',
        "'status-unavailable'",
        '最近交接',
        '当前请求：',
        '查看最近执行会话'
    ]
    if t.count(marker) != 1:
        raise RuntimeError('dialogue test marker missing')
    t = t.replace(marker, marker + ''.join(f'  {token!r},\n' for token in tokens), 1)
    t = t.replace("  'await waitForPanelMount(5000)',", "  \"if (!await waitForPanelMount(5000)) throw new Error('对话闭环未能挂载到本机 Agent 面板')\",")
    t = t.replace('  hot_update_remount_watchers: true,', '  hot_update_remount_watchers: true,\n  shell_shadow_mount_discovery: true,\n  normalized_status_semantics: true,\n  active_and_recent_handoff_separated: true,')
    p.write_text(t)

p = Path('tests/chrome-build.integration.test.js')
t = p.read_text().replace('local-agent.1', 'local-agent.2').replace('local-agent-dialogue.6', 'local-agent-dialogue.7')
if 'shell_shadow_dialogue_mount' not in t:
    t = t.replace('  dialogue_hot_remount: true,', '  dialogue_hot_remount: true,\n  shell_shadow_dialogue_mount: true,\n  normalized_opencode_status: true,')
p.write_text(t)

p = Path('package.json')
t = p.read_text()
old = 'node tests/chrome-local-agent-dialogue.test.js && node tests/chrome-lifecycle.integration.test.js'
new = 'node tests/chrome-local-agent-dialogue.test.js && node tests/chrome-local-agent-status.test.js && node tests/chrome-lifecycle.integration.test.js'
if new not in t:
    if t.count(old) != 1:
        raise RuntimeError('package test marker missing')
    p.write_text(t.replace(old, new, 1))

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
