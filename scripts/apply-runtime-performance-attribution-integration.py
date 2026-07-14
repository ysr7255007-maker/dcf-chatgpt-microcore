from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


controller = read('src/host/conversation-performance.js')
if 'timeline_start_ms:' not in controller:
    controller = replace_once(
        controller,
        "    planned_end_epoch_ms: startedEpoch + durationMs,\n    ended_at: null,",
        "    planned_end_epoch_ms: startedEpoch + durationMs,\n    timeline_start_ms: Number(context.timeline_start_ms || 0),\n    ended_at: null,",
        'session timeline start'
    )
    controller = replace_once(
        controller,
        "  function recordLongTask(entry) {",
        "  function acceptsAttributionEntry(entry) {\n    return !!(attribution && attribution.status === 'running' && Number(entry && entry.startTime || 0) >= Number(attribution.timeline_start_ms || 0));\n  }\n\n  function recordLongTask(entry) {",
        'entry boundary helper'
    )
    controller = replace_once(
        controller,
        "    if (attribution && attribution.status === 'running') boundedPush(attribution.entries.long_tasks, item, MAX_LONG_TASKS);",
        "    if (acceptsAttributionEntry(entry)) boundedPush(attribution.entries.long_tasks, item, MAX_LONG_TASKS);",
        'long task session boundary'
    )
    controller = replace_once(controller, "    if (!attribution || attribution.status !== 'running') return;\n    const start = Number(entry.startTime || 0);", "    if (!acceptsAttributionEntry(entry)) return;\n    const start = Number(entry.startTime || 0);", 'loaf session boundary')
    controller = replace_once(controller, "    if (!attribution || attribution.status !== 'running') return;\n    const start = Number(entry.startTime || 0);", "    if (!acceptsAttributionEntry(entry)) return;\n    const start = Number(entry.startTime || 0);", 'event session boundary')
    controller = replace_once(controller, "    if (!attribution || attribution.status !== 'running') return;\n    boundedPush(attribution.entries.layout_shifts, {", "    if (!acceptsAttributionEntry(entry)) return;\n    boundedPush(attribution.entries.layout_shifts, {", 'layout shift session boundary')
    controller = replace_once(
        controller,
        "    attribution = createAttributionSession({\n      duration_ms: options.duration_ms,\n      context: {",
        "    attribution = createAttributionSession({\n      duration_ms: options.duration_ms,\n      timeline_start_ms: windowObject.performance && typeof windowObject.performance.now === 'function' ? windowObject.performance.now() : 0,\n      context: {",
        'attribution timeline start capture'
    )
write('src/host/conversation-performance.js', controller)

health = read('src/modules/health.js')
if 'long_animation_frame_supported' not in health:
    health = replace_once(
        health,
        "          selector_strategy: performanceState.selector_strategy, long_tasks_60s: performanceState.long_tasks_60s, long_task_duration_ms_60s: performanceState.long_task_duration_ms_60s",
        "          selector_strategy: performanceState.selector_strategy, long_tasks_60s: performanceState.long_tasks_60s, long_task_duration_ms_60s: performanceState.long_task_duration_ms_60s,\n          long_animation_frame_supported: performanceState.long_animation_frame_supported, event_timing_supported: performanceState.event_timing_supported,\n          layout_shift_supported: performanceState.layout_shift_supported, attribution_status: performanceState.attribution && performanceState.attribution.status || 'not-started'",
        'health performance attribution summary'
    )
write('src/modules/health.js', health)

performance_test = read('tests/dcf-conversation-performance.unit.test.js')
performance_test = performance_test.replace("assert.strictEqual(pack.revision, '1.0.0');", "assert.strictEqual(pack.revision, '1.1.0');")
performance_test = performance_test.replace("for (const id of ['safe', 'window40', 'window20', 'off', 'reveal', 'report'])", "for (const id of ['safe', 'window40', 'window20', 'off', 'reveal', 'report', 'attribution60', 'attribution_copy'])")
performance_test = performance_test.replace("assert(source.includes('if (routeChanged || rootChanged) scheduleApply(0);')", "assert(source.includes(\"if (routeChanged || rootChanged) scheduleApply(0, routeChanged ? 'route' : 'root-change');\")")
if "long_animation_frame_attribution" not in performance_test:
    performance_test = performance_test.replace("  style_restoration_exercised: true", "  style_restoration_exercised: true,\n  long_animation_frame_attribution: true")
write('tests/dcf-conversation-performance.unit.test.js', performance_test)

attribution_test = r'''\'use strict\';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAttributionSession, safeScriptSource, summarizeAttributionSession } = require('../src/host/conversation-performance');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

const firstParty = safeScriptSource('https://cdn.oaistatic.com/assets/app-123.js?token=SECRET#fragment', 'https://chatgpt.com');
assert.strictEqual(firstParty.category, 'chatgpt-page');
assert(!firstParty.source.includes('SECRET'));
assert(!firstParty.source.includes('?'));
assert(!firstParty.source.includes('#'));
const thirdParty = safeScriptSource('https://example.net/vendor/tool.js?user=private', 'https://chatgpt.com');
assert.strictEqual(thirdParty.category, 'third-party');
assert(!thirdParty.source.includes('private'));

const session = createAttributionSession({ session_id: 'test-session', started_at: '2026-07-14T00:00:00.000Z', started_epoch_ms: 1000, duration_ms: 60000, timeline_start_ms: 500, context: { route_kind: '/c/:conversation', mode: 'safe', turn_count: 116 } });
session.status = 'complete';
session.ended_at = '2026-07-14T00:01:00.000Z';
session.ended_epoch_ms = 61000;
session.end_reason = 'duration';
session.entries.loafs.push({
  start_ms: 1000, duration_ms: 180, blocking_duration_ms: 90, work_duration_ms: 120, render_duration_ms: 60, style_layout_duration_ms: 35,
  streaming: false, has_ui_event: true,
  scripts: [
    { category: 'chatgpt-page', source: 'cdn.oaistatic.com/assets/app-123.js', function_name: 'renderConversation', invoker_type: 'event-listener', invoker: 'DOMWindow.onclick', duration_ms: 92, forced_style_layout_ms: 24, pause_ms: 0 },
    { category: 'third-party', source: 'example.net/vendor/tool.js', function_name: 'observerCallback', invoker_type: 'user-callback', invoker: 'MutationObserver', duration_ms: 18, forced_style_layout_ms: 2, pause_ms: 0 }
  ]
});
session.entries.loafs.push({ start_ms: 2000, duration_ms: 70, blocking_duration_ms: 10, work_duration_ms: 70, render_duration_ms: 0, style_layout_duration_ms: 0, streaming: true, has_ui_event: false, scripts: [] });
session.entries.events.push({ name: 'click', start_ms: 990, duration_ms: 160, input_delay_ms: 70, processing_ms: 55, presentation_delay_ms: 35, interaction_id: 7, streaming: false });
session.entries.layout_shifts.push({ start_ms: 1200, value: 0.08, had_recent_input: false, streaming: false });
session.entries.long_tasks.push({ start_ms: 1000, duration_ms: 170, name: 'self', streaming: false });
session.entries.dcf_applies.push({ at_epoch_ms: 2000, reason: 'mutation', duration_ms: 2, turn_count: 116, hidden_count: 0 });
session.entries.mutations = { batches: 4, added_nodes: 8, removed_nodes: 1, max_batch_nodes: 5 };

const report = summarizeAttributionSession(session, { selector_strategy: 'testid', support: { long_animation_frame: true, event_timing: true, layout_shift: true, long_task: true } });
assert.strictEqual(report.schema, 'dcf.conversation-performance.attribution.v1');
assert.strictEqual(report.long_animation_frames.count, 2);
assert.strictEqual(report.long_animation_frames.total_blocking_duration_ms, 100);
assert.strictEqual(report.long_animation_frames.total_forced_style_layout_ms, 26);
assert.strictEqual(report.top_scripts[0].source, 'cdn.oaistatic.com/assets/app-123.js');
assert.strictEqual(report.top_scripts[0].total_duration_ms, 92);
assert.strictEqual(report.interactions.by_type[0].max_input_delay_ms, 70);
assert.strictEqual(report.layout_shifts.unexpected_score, 0.08);
assert.strictEqual(report.dcf_self.total_duration_ms, 2);
assert.strictEqual(report.dcf_self.mutation_batches, 4);
assert.strictEqual(report.privacy.message_text_included, false);
assert.strictEqual(report.privacy.event_targets_included, false);
assert(!JSON.stringify(report).includes('SECRET'));
assert(!JSON.stringify(report).includes('private'));

const pack = STANDARD_PACKS.find((item) => item.pack_id === 'dcf.standard.conversation-performance');
assert.strictEqual(pack.revision, '1.1.0');
const commandIds = pack.modules[0].blocks.flatMap((block) => block.commands).map((command) => command.id);
assert(commandIds.includes('attribution60'));
assert(commandIds.includes('attribution_copy'));

const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'host', 'conversation-performance.js'), 'utf8');
for (const marker of ['long-animation-frame', 'forcedStyleAndLayoutDuration', 'durationThreshold: 16', 'layout-shift', 'timeline_start_ms', 'acceptsAttributionEntry']) assert(controllerSource.includes(marker), `missing attribution marker ${marker}`);
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'effects.js'), 'utf8');
assert(effectSource.includes('DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION'));
assert(effectSource.includes("finishAttribution('manual')"));
const commandSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'commands.js'), 'utf8');
assert(commandSource.includes('conversation.performance.attribution.start'));
assert(commandSource.includes('conversation.performance.attribution.report'));

console.log(JSON.stringify({ ok: true, loaf_script_attribution: true, interaction_breakdown: true, layout_shift_summary: true, dcf_self_timing: true, source_url_sanitization: true, start_action_excluded_by_timeline: true }, null, 2));
'''.replace("\\'use strict\\';", "'use strict';", 1)
write('tests/dcf-performance-attribution.unit.test.js', attribution_test)

readme = read('README.md')
readme = readme.replace('DCF `0.16.0` keeps a generic modular kernel', 'DCF `0.17.0` keeps a generic modular kernel', 1)
if 'Runtime performance attribution' not in readme:
    readme += '''\n\n## Runtime performance attribution\n\nDCF `0.17.0` upgrades the long-conversation controller from counting Long Tasks to bounded, user-started attribution sessions. A 60-second session observes Long Animation Frames, script entry points, forced style/layout time, Event Timing interaction delay, layout shifts, traditional Long Tasks, DOM mutation counts and DCF's own reconciliation duration. Script URLs are reduced to hostname plus the final path components with query strings and fragments removed; event targets, DOM text, message bodies and stacks are never collected. Extension isolated-world work may not appear in LoAF script attribution, so DCF self-work is measured separately and unknown/cross-origin work remains explicit.\n'''
write('README.md', readme)

architecture = read('docs/architecture-current.md')
architecture = architecture.replace('Current release: `0.16.0`', 'Current release: `0.17.0`', 1)
if '## 14. Runtime 主线程归因诊断' not in architecture:
    architecture += '''\n\n## 14. Runtime 主线程归因诊断（0.17.0）\n\n传统 Long Tasks 只能可靠证明主线程曾被占用超过 50ms，通常不能指出具体脚本。DCF 的归因会话优先使用 Long Animation Frames，把慢帧拆为脚本工作、渲染、样式与布局，并记录主世界脚本的脱敏来源、入口函数、调用类型、总执行时间和强制样式/布局时间；同时使用 Event Timing 区分输入等待、事件处理和呈现延迟，使用 Layout Instability 记录非预期布局偏移，并保留 Long Tasks 作为兼容兜底。\n\n诊断是一次性 Action，不进入权威环境。用户显式开始 60 秒会话，系统只在该时间窗内保存有界样本；结束后返回 `dcf.conversation-performance.attribution.v1`。点击开始前已启动的帧通过 Performance Timeline 起点排除，避免把启动按钮本身误当作主要来源。\n\nLoAF 不能保证归因浏览器扩展隔离世界、跨域脚本或精确热点函数。DCF 因此单独计量自身每次协调耗时与触发原因，并把未知来源、脚本入口而非内部热点、以及各阶段计时可能重叠写入报告限制。报告禁止消息正文、DOM 文本、事件 target、完整 URL/query、调用栈和认证信息。\n'''
write('docs/architecture-current.md', architecture)

maintenance = read('docs/dcf-maintenance-skill.md')
if '## 十三、Runtime 性能归因' not in maintenance:
    maintenance += '''\n\n## 十三、Runtime 性能归因\n\n主线程阻塞排查先用有界 Runtime 归因会话，不再只凭 Long Task 数量或体感猜来源。优先采集 Long Animation Frames 的脚本、渲染、样式/布局和 blockingDuration；以 Event Timing 区分 input delay、processing 与 presentation delay；以 layout-shift 判断页面跳动；传统 longtask 仅作不支持 LoAF 时的兜底。\n\n归因报告必须把事实和推断分开。LoAF 的 sourceFunctionName 是入口点，不一定是最耗时的内部函数；脚本、渲染和布局时间可能重叠，不能相加后宣称为独占 CPU；扩展 isolated world、跨域和未知任务可能无法归因。DCF 自身必须使用独立计时报告 apply 次数、原因、总时长和最大时长，不能因 LoAF 没列出 userscript 就宣称零开销。\n\n性能会话属于一次性 Action，不写 root、Profile 或 registry。只保留有界时序和聚合数据，脚本来源去掉 query/hash 并缩减为 host 与末级路径；禁止 DOM 文本、消息正文、事件 target、完整 URL、stack、附件和认证数据。\n'''
write('docs/dcf-maintenance-skill.md', maintenance)

consensus = read('docs/dcf-basic-consensus-prompt.md')
if '性能归因不能把“可观察”偷换成“已证明因果”' not in consensus:
    consensus += '''\n\n性能归因不能把“可观察”偷换成“已证明因果”。慢帧脚本入口、渲染、布局、交互延迟、未知工作与 DCF 自身计时分别呈现；不支持的隔离世界和跨域来源明确保留为未知，不用缺失归因替任何一方免责。\n'''
write('docs/dcf-basic-consensus-prompt.md', consensus)

status = read('docs/adr/status-index.md')
if '2026-07-14-dcf-runtime-performance-attribution.md' not in status:
    status = status.replace('## Current\n', '## Current\n\n- `2026-07-14-dcf-runtime-performance-attribution.md` — **accepted**\n', 1)
write('docs/adr/status-index.md', status)

adr = '''# ADR: Runtime performance attribution sessions\n\nDate: 2026-07-14  \nStatus: accepted\n\n## Context\n\nThe first real 0.16.0 safe-mode report observed 116 optimized turns and only 1ms for the last DCF reconciliation, but still recorded 10 Long Tasks totaling 4212ms in one minute. Long Tasks prove main-thread blocking but generally do not identify the responsible page script or distinguish script execution from rendering and layout.\n\n## Decision\n\n- Add a user-started, bounded 60-second Runtime attribution session.\n- Prefer `long-animation-frame` entries for frame duration, blocking duration, render/style-layout breakdown and script attribution.\n- Observe `event` entries for input, processing and presentation delay, and `layout-shift` entries without retaining source nodes.\n- Keep `longtask` as a fallback and comparison signal.\n- Measure DCF apply work separately with reason, count, total and maximum duration, plus mutation batch counts.\n- Exclude entries whose Performance Timeline start precedes the session start so the start-button interaction does not dominate the sample.\n- Sanitize script sources to category, hostname and final path components; omit query, fragment, event target, DOM/message text and stack.\n- Export one `DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION` block for analysis.\n\n## Limits\n\nLoAF script attribution covers page main-world work and can omit extension isolated worlds, cross-origin work or callbacks without source data. Reported locations are entry points rather than guaranteed hotspots. Script, render, layout and interaction durations overlap. The report is evidence for the next investigation, not an automatic causal verdict.\n'''
write('docs/adr/2026-07-14-dcf-runtime-performance-attribution.md', adr)

current = read('docs/current-state.md')
current = current.replace('当前正式版本：`0.16.0`', '当前正式版本：`0.17.0`', 1)
current = current.replace('`0.16.0` 增加长对话浏览器减负控制器、透明离屏优化、显式历史窗口和性能观察。', '`0.16.0` 增加长对话浏览器减负控制器、透明离屏优化、显式历史窗口和性能观察。`0.17.0` 增加有界 Runtime 主线程归因会话。', 1)
old_checkpoint = '''用户最近确认完成的是 `0.13.0` 迁移。最近一次真实浏览器体检生成于 `2026-07-13T14:01:49.777Z`：\n\n```text\nschema: dcf.runtime.health.diff.v1\nversion: 0.13.0\nroute_kind: /c/:conversation\nprimary_backend: gm\ncurrent_tab: maintenance\nstatus: healthy\ndeviations: []\n```\n\n体检隐私边界确认未包含对话正文、弹药正文、包 payload、命令参数或认证数据。该结果关闭 0.13.0 的 Runtime 迁移检查点，但不证明用户浏览器已经加载 0.14.0，也不单独证明 Environment Profile、具体模块命令和用户内容隔离等业务行为。'''
new_checkpoint = '''用户浏览器已加载 `0.16.0`，并于 `2026-07-14T11:18:06.006Z` 在当前长对话提交真实性能摘要：\n\n```text\nschema: dcf.conversation-performance.runtime.v1\nroute_kind: /c/:conversation\nmode: safe\nturn_count: 116\noptimized_count: 116\nhidden_count: 0\nselector_strategy: testid\ncontent_visibility_supported: true\nlong_tasks_60s: 10\nlong_task_duration_ms_60s: 4212\nlast_apply_duration_ms: 1\n```\n\n这证明透明减负已作用于 116 个真实 turn，且最近一次 DCF 协调自身只耗时 1ms；它同时暴露出一分钟累计 4212ms 的主线程阻塞仍未归因。该性能摘要不是完整 Runtime health，不能据此宣布 0.16.0 所有观察面 healthy。`0.17.0` 的当前事项就是通过 LoAF、Event Timing、layout-shift、longtask fallback 与 DCF self timing 获取下一步证据。'''
if old_checkpoint in current:
    current = current.replace(old_checkpoint, new_checkpoint, 1)
current = current.replace('ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT\'s own long-thread rendering cost.', '更激进的节点脱离式虚拟化、内存采样和需要 DevTools Protocol 的 CPU profile 仍未进入 DCF；先完成页面可用 Performance API 的真实归因。')
if '## 0.17.0 Runtime 主线程归因诊断' not in current:
    current += '''\n\n## 0.17.0 Runtime 主线程归因诊断\n\n- `dcf.standard.conversation-performance@1.1.0` 新增“开始 60 秒归因诊断”和“结束并复制归因报告”。\n- 报告聚合 Long Animation Frames、脚本入口与来源、blocking/render/style-layout/forced-layout、Event Timing、layout-shift 和 longtask fallback。\n- DCF 单独记录 apply 次数、触发原因、总时长、最大时长，以及会话期间的 DOM mutation 批次。\n- 会话开始前已启动的 Performance Timeline entry 被排除，避免启动按钮污染样本。\n- 脚本 URL 删除 query/hash，仅保留来源类别、host 和末级路径；不采集消息正文、DOM 文本、event target 或 stack。\n- 用户浏览器尚未完成 0.17.0 的 60 秒归因现场验收。\n'''
write('docs/current-state.md', current)

print('ok')
