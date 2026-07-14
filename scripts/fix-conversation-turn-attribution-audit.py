from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


host = read('src/host/chatgpt.js')
host = replace_once(
    host,
    "      processedNodes.add(node);       if (typeof onReplyComplete === 'function') onReplyComplete({ node, text, source, completed_at: nowIso(), at_epoch_ms: Date.now(), quiet_ms: quietMs });",
    "      processedNodes.add(node);\n      if (typeof onReplyComplete === 'function') onReplyComplete({ node, text, source, completed_at: nowIso(), at_epoch_ms: Date.now(), quiet_ms: quietMs });",
    'reply completion formatting'
)
host = replace_once(
    host,
    "      stopReplyObserver();       startReplyObserver(callback, observerOptions);",
    "      stopReplyObserver();\n      startReplyObserver(callback, observerOptions);",
    'navigation restart formatting'
)
write('src/host/chatgpt.js', host)

packs = read('src/modules/standard-packages.js')
packs = replace_once(
    packs,
    "        { id: 'attribution', title: '问答轮次归因', commands: [\n          { id: 'turn_attribution_arm', label: '记录下一轮问答', steps: [{ call: 'conversation.performance.turn.arm' }] },\n          { id: 'turn_attribution_copy', label: '结束并复制本轮报告', steps: [{ call: 'conversation.performance.turn.report', with: { finish: true } }] }\n        ] }",
    "        { id: 'attribution', title: '问答轮次归因', commands: [\n          { id: 'turn_attribution_arm', label: '记录下一轮问答', steps: [{ call: 'conversation.performance.turn.arm' }] },\n          { id: 'turn_attribution_copy', label: '复制本轮归因报告', steps: [{ call: 'conversation.performance.turn.report', with: { finish: false } }] },\n          { id: 'turn_attribution_finish', label: '手动结束并复制', steps: [{ call: 'conversation.performance.turn.report', with: { finish: true } }] }\n        ] }",
    'turn attribution product semantics'
)
write('src/modules/standard-packages.js', packs)

turn_test = read('tests/dcf-conversation-turn-attribution.unit.test.js')
turn_test = replace_once(
    turn_test,
    "assert(commands.some((command) => command.id === 'turn_attribution_copy' && command.label === '结束并复制本轮报告'));",
    "assert(commands.some((command) => command.id === 'turn_attribution_copy' && command.label === '复制本轮归因报告' && command.steps[0].with.finish === false));\nassert(commands.some((command) => command.id === 'turn_attribution_finish' && command.label === '手动结束并复制' && command.steps[0].with.finish === true));",
    'turn command semantics test'
)
turn_test = replace_once(
    turn_test,
    "automatic_reply_completion: true, manual_recovery: true, no_message_text: true",
    "automatic_reply_completion: true, normal_copy_does_not_finish: true, manual_recovery: true, no_message_text: true",
    'turn test output'
)
write('tests/dcf-conversation-turn-attribution.unit.test.js', turn_test)

performance_test = read('tests/dcf-performance-attribution.unit.test.js')
performance_test = replace_once(
    performance_test,
    "assert(commandIds.includes('turn_attribution_copy'));",
    "assert(commandIds.includes('turn_attribution_copy'));\nassert(commandIds.includes('turn_attribution_finish'));",
    'performance package command test'
)
write('tests/dcf-performance-attribution.unit.test.js', performance_test)

current = read('docs/current-state.md')
current = current.replace('“记录下一轮问答”只待命；下一次发送按钮点击或输入框 Enter 才正式启动采样。', '“记录下一轮问答”只待命；下一次发送按钮点击或输入框 Enter 才正式启动采样。正常完成后使用“复制本轮归因报告”；“手动结束并复制”只作为异常恢复。')
write('docs/current-state.md', current)

maintenance = read('docs/dcf-maintenance-skill.md')
maintenance = maintenance.replace('最长时限与手动结束只是异常恢复，不是正常统计边界。', '最长时限与“手动结束并复制”只是异常恢复，不是正常统计边界；自动完成后使用“复制本轮归因报告”，不得用按钮命名暗示正常流程需要人工截断。')
write('docs/dcf-maintenance-skill.md', maintenance)

print('ok')
