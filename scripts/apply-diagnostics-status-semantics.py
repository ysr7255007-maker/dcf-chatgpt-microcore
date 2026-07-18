from pathlib import Path
import re

path = Path('chrome-extension/code-units/diagnostics/main.js')
text = path.read_text()
text = text.replace("const UNIT_VERSION = '1.0.0-rc.2-diagnostics.1';", "const UNIT_VERSION = '1.0.0-rc.2-diagnostics.2';")
pattern = re.compile(r"  function hypotheses\(config, providers, agents, messages, statusResult\) \{.*?\n  \}\n\n  async function collectLocalAgentDiagnostic", re.S)
replacement = """  function statusInterpretation(statusResult, messages) {
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

  async function collectLocalAgentDiagnostic"""
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit('hypotheses block not found')
text = text.replace("const statusEvidence = { ok: results.status.ok, normalized: normalizedStatus };", "const statusEvidence = { ok: results.status.ok, normalized: normalizedStatus, interpretation: statusInterpretation({ ok: results.status.ok, normalized: normalizedStatus }, messages) };")
text = text.replace("notice = '正在只读诊断最近失败 session…';", "notice = '正在只读诊断最近本机 session…';")
path.write_text(text)
