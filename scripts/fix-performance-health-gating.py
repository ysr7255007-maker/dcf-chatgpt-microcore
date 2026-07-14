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


health = read('src/modules/health.js')
health = replace_once(
    health,
    "    const performanceState = typeof runtime.getPerformance === 'function' ? runtime.getPerformance() : null;\n    const deviations = [];",
    "    const performanceState = typeof runtime.getPerformance === 'function' ? runtime.getPerformance() : null;\n    const performanceEntry = root.packages && root.packages.packages && root.packages.packages['dcf.standard.conversation-performance'];\n    const performanceExpected = !!(performanceEntry && performanceEntry.enabled !== false);\n    const deviations = [];",
    'performance expectation'
)
health = replace_once(
    health,
    "    if (!performanceState) {\n      add('runtime_conversation_performance_missing', 'error', 'conversation-performance', 'the current Runtime exposes the long-conversation performance controller', 'missing', null, 'The required performance package exists without its trusted Host controller.');\n    } else if (performanceState.mode !== 'off' && performanceState.turn_count >= performanceState.activation_turns && !performanceState.content_visibility_supported) {",
    "    if (performanceExpected && !performanceState) {\n      add('runtime_conversation_performance_missing', 'error', 'conversation-performance', 'the current Runtime exposes the long-conversation performance controller', 'missing', null, 'The required performance package exists without its trusted Host controller.');\n    } else if (performanceState && performanceState.mode !== 'off' && performanceState.turn_count >= performanceState.activation_turns && !performanceState.content_visibility_supported) {",
    'performance health gating'
)
write('src/modules/health.js', health)

health_test = read('tests/dcf-health-report.unit.test.js')
health_test = replace_once(
    health_test,
    "const runtimeObject = { version: VERSION };\nconst app = { captureRuntimeViews: () => JSON.parse(JSON.stringify(uiState)) };",
    "const runtimeObject = { version: VERSION };\nconst performanceState = {\n  schema: 'dcf.conversation-performance.runtime.v1', mode: 'safe', activation_turns: 24, keep_recent: 40, reveal_batch: 20,\n  conversation_root_found: true, observed_root_connected: true, selector_strategy: 'article-testid',\n  turn_count: 48, optimized_count: 48, hidden_count: 0, revealed_older: 0, streaming: false,\n  content_visibility_supported: true, long_task_observer_supported: true, long_tasks_60s: 0, long_task_duration_ms_60s: 0\n};\nconst app = { captureRuntimeViews: () => JSON.parse(JSON.stringify(uiState)) };",
    'health test performance state'
)
health_test = replace_once(
    health_test,
    "  getApp: () => app,\n  getRuntime: () => runtimeObject\n});",
    "  getApp: () => app,\n  getRuntime: () => runtimeObject,\n  getPerformance: () => performanceState\n});",
    'health test performance source'
)
write('tests/dcf-health-report.unit.test.js', health_test)

performance_test = read('tests/dcf-conversation-performance.unit.test.js')
performance_test = replace_once(
    performance_test,
    "assert(effectSource.includes('DCF_CONVERSATION_PERFORMANCE'));",
    "assert(effectSource.includes('DCF_CONVERSATION_PERFORMANCE'));\nconst healthSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'health.js'), 'utf8');\nassert(healthSource.includes('performanceExpected && !performanceState'), 'health requires the controller even when its package is absent');",
    'performance health regression assertion'
)
write('tests/dcf-conversation-performance.unit.test.js', performance_test)

print('ok')
