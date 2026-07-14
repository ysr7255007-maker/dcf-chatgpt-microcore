# DCF 当前状态与新会话交接

Updated: 2026-07-14

## 读取顺序

1. `README.md`
2. `docs/architecture-current.md`
3. `docs/dcf-basic-consensus-prompt.md`
4. `docs/dcf-maintenance-skill.md`
5. `docs/adr/status-index.md`
6. 与当前事项相关的 ADR
7. 本文件

普通窗口的低扰动 DCF 认知位于 `docs/prompts/dcf-awareness-prompt.md`。根 `.user.js` 是生成发布物，不再作为理解源码架构的首要入口。

## 当前版本

当前正式版本：`0.18.0`

`0.11.4` 保留包管理、日常功能和维护工具分区，移除错误的 hidden 产品语义，并把体检重建为真实浏览器 Runtime 偏差报告。`0.11.5` 修正 Runtime DOM 入口采样误报。`0.11.6` 聚焦包管理中文可读性和紧凑总览。`0.12.0` 统一按值/按引用能力包更新。`0.13.0` 将系统整体收拢为期望对话环境、typed intent、有限资源族、环境投影和 Profile/恢复架构。`0.14.0` 为语言弹药增加语境化调用标志和实质更新协议，并把协议下沉为 ammo package policy。`0.15.0` 增加显式模块替代生命周期，把三个迁移期弹药工作台收口为一个完整工作台，并将纯历史包折叠收纳。`0.16.0` 增加长对话浏览器减负控制器、透明离屏优化、显式历史窗口和性能观察。`0.17.0` 增加有界 Runtime 主线程归因会话。`0.18.0` 将主要归因边界改为发送到本轮回复完成。`0.17.0` 增加有界 Runtime 主线程归因会话。

## 当前浏览器 Runtime 检查点

用户浏览器已加载 `0.16.0`，并于 `2026-07-14T11:18:06.006Z` 在当前长对话提交真实性能摘要：

```text
schema: dcf.conversation-performance.runtime.v1
route_kind: /c/:conversation
mode: safe
turn_count: 116
optimized_count: 116
hidden_count: 0
selector_strategy: testid
content_visibility_supported: true
long_tasks_60s: 10
long_task_duration_ms_60s: 4212
last_apply_duration_ms: 1
```

这证明透明减负已作用于 116 个真实 turn，且最近一次 DCF 协调自身只耗时 1ms；它同时暴露出一分钟累计 4212ms 的主线程阻塞仍未归因。该性能摘要不是完整 Runtime health，不能据此宣布 0.16.0 所有观察面 healthy。`0.17.0` 的当前事项就是通过 LoAF、Event Timing、layout-shift、longtask fallback 与 DCF self timing 获取下一步证据。

## 0.11.4 Runtime 体检与折叠模型

- 运行模块只属于 `ammo / daily / maintenance`；
- 旧包和旧用户状态中的 `hidden:true` 不再让模块失去入口；
- 所有非弹药运行模块必须在 `功能` 或 `维护` 保留可发现标题；
- 模块卡片改为展开/折叠；日常默认展开，维护默认折叠；
- 折叠状态只存入 `dcf.ui.session.v1.collapsed_modules`，不进入权威根、不走事务、不修改包或 moduleDisplay；
- 功能分区管理只允许在日常与维护之间移动模块；
- 体检改为 `dcf.runtime.health.diff.v1`，不再倾倒完整内部状态；
- 体检从真实浏览器现场读取 Runtime 对象、GM/localStorage、内存 root/registry、Shadow DOM、host 数量与几何、ChatGPT root/observer/composer 和最近失败；
- 健康报告只包含 `deviations: []`；异常报告只附上解释偏差所需的最小证据；
- 模块入口覆盖检查不复用 UI role resolver，而是直接比较全部非弹药 Runtime module ID 与真实日常＋维护 DOM 标题 ID；
- Host diagnostics 新增 `observed_root_is_current`，用于识别仍连着但已经不是当前 ChatGPT 主节点的 observer。

## 0.11.5 Runtime 入口采样修正

- Runtime DOM 采样只统计顶层 `details.module-card`；
- 携带 `data-module-id` 的命令按钮不再被误算为独立模块入口；
- 修正 0.11.4 的 `runtime_duplicate_entries` 假警报，不改变模块角色或 Runtime 状态。

## 0.11.6 包管理可读性与紧凑布局

- 包卡片以中文名称和一句功能说明为主，英文 package ID 降为次要技术标识；
- 新包可直接声明 `title / display_name / name / label` 与 `description / summary / purpose`；
- 现有旧包从模块标题、Surface、内容类型和有限兼容展示表生成中文说明；
- 单版本包只显示紧凑版本标签，多版本包才显示版本选择与切换；
- 版本、切换、启停和卸载集中在同一操作带，版本选择器不再独占整行；
- 手动安装 JSON 折叠为低频入口，包总览成为页面主体；
- 英文 package ID 仍作为操作、Runtime 对照和技术排查使用的真实身份，不被本地化替换。

## Phase one baseline

- modular source and deterministic complete-userscript release;
- one authoritative `dcf.state.root.v1` in one authoritative backend;
- one candidate/validate/commit transaction for authoritative changes;
- immutable package revisions and stable resource claims;
- user state separated from package defaults;
- registry and UI as projections;
- typed reply/manual/catalog artifacts entering one transaction path;
- bounded current-reply Host Adapter with no body observer or full-history scan;
- automatic ammo loading, module installation, catalog update, and low-friction firing;
- generic command interpreter, state/effect separation, privacy-filtered receipts, snapshots/rollback, viewport fence, and Runtime health diff.

## Verification target

- `npm run verify`;
- `node --check dcf-chatgpt-microcore.user.js`;
- firing emits only `〔DCF·语言弹药〕` plus the body;
- update requests include `〔DCF·弹药更新〕`, the complete current item, substantive revision rules and complete `DCF_AMMO` output requirements;
- copying still exports the raw body;
- `dcf.standard.ammo@1.3.0` owns the `ammo_protocol` policy and canonical workbench supersession;
- Environment Snapshot derives from the single root and current registry;
- persistent production controls route through Environment Reconciler;
- content/action/view/style/policy resource graph has stable ownership and observation contracts;
- all four main views are package-owned while Core retains safe fallback rendering;
- Profiles do not copy user ammo bodies and activation/restore remain atomic environment transitions;
- healthy Runtime report remains diff-only and privacy filtered;
- dual-backend bridge, bounded Host Adapter, catalog, viewport and deterministic release tests remain green.

## User checkpoint after release

1. update Tampermonkey to `0.14.0` and refresh ChatGPT；
2. wait for Catalog to coordinate `dcf.standard.ammo@1.2.0`；
3. fire one ammo item and confirm the composer contains `〔DCF·语言弹药〕` followed by one blank line and the original body；
4. confirm the receiving window adapts the ammo to the current conversation instead of treating the body as a verbatim immediate command；
5. click update and confirm the sent request includes `〔DCF·弹药更新〕`, the complete current ammo and the same-id complete `DCF_AMMO` return contract；
6. confirm copy still copies only the raw ammo body；
7. run Runtime health after the behavior checks and submit the complete block only if deviations are present。

## Deferred to phase two

更激进的节点脱离式虚拟化、内存采样和需要 DevTools Protocol 的 CPU profile 仍未进入 DCF；先完成页面可用 Performance API 的真实归因。

## 0.12.0 统一能力重协调

- `root.packages` 正式作为期望能力集合；安装、更新、启停、切换和回滚统一为期望状态变化。
- 对话完整 `DCF_MODULE_PACK` 是按值输入；新增 `DCF_PACKAGE_UPDATE` 是按引用输入。
- Catalog Resolver、手动 JSON 和对话输入统一进入 `dcf.reconcile.result.v1`，成功后原子提交并立即重投影 Runtime。
- `dcf.ui.package-management` 成为必需的声明式 UI 包，拥有包管理页文案、密度、控制顺序和可覆盖样式。
- 普通 UI/功能调整以后应升级对应包，不再默认发布 Tampermonkey userscript。
- Core 继续禁止远程 JavaScript，只提供可信解析、事务、协调、Host 与恢复渲染边界。

## 0.13.0 期望对话环境

- 新增只读 `dcf.environment.snapshot.v1`，不改变单一权威根。
- 持久变化统一为 `dcf.intent.v1` Environment Intent；一次性 Host Effect 继续独立。
- Package Reconciler 提升为 Environment Reconciler；包、内容、偏好、界面组织、Profile 和恢复共享迁移链路。
- 生产入口中的包管理、弹药增删、设置、外观、模块分区、Profile 和恢复全部经 Reconciler，不保留业务旁路。
- registry 输出 content/action/view/style/policy 资源图与观察契约。
- 弹药、功能、包管理、维护成为包拥有的四种环境投影。
- Environment Profile 保存包选择、政策和产品组织，不复制用户弹药正文。
- Runtime API 的 `environment` 是动态只读 Facade，不是启动时静态快照。

## 0.14.0 语言弹药调用与更新协议

- 发射消息改为轻量 `〔DCF·语言弹药〕` 标志加原始正文，触发当前语境二次理解。
- 语境清楚时适配后直接执行；只有关键冲突或无法可靠选择的多义落地才确认。
- 更新消息包含 `〔DCF·弹药更新〕`、完整原弹药、实质修订规则和完整同 `id` `DCF_AMMO` 返回要求。
- `dcf.standard.ammo@1.2.0` 通过 `ammo_protocol` policy 拥有标志与更新规则；bootstrap 只保留安全回退。
- 复制保持原始正文，不自动附加调用标志。


## 0.15.0 模块替代与语言弹药工作台收口

- `dcf.ammo.module` 正式命名为“语言弹药工作台”，在一个页面提供提取、新建、编辑、查找、语境化发射、复制、实质更新和删除。
- 它以精确 ID 替代 `dcf.ammo_workbench`、`dcf.ammo_workspace.unified`、`dcf.language_ammo`；这三个迁移期入口不再出现在功能、维护或分区管理中。
- 旧包不会静默删除，而是折叠进包管理的“已替代历史包”，保留显式卸载和恢复出口。
- 替代只按声明的稳定 ID 生效，名称相似的其他模块不受影响；自动提取、格式化等未确认等价的独立能力继续保留。
- 用户浏览器尚未完成 0.15.0 的 Runtime 现场验收。

- 0.15.0 体检观察已同步理解模块替代关系，且折叠历史包仍计入真实包视图覆盖。


## 0.16.0 长对话浏览器减负

- 新增必需包 `dcf.standard.conversation-performance@1.0.0`，功能页提供透明减负、最近 40/20 条窗口、展开上一批、恢复全部和复制性能摘要。
- 默认安全模式只在达到 24 个顶层消息 turn 后应用 `content-visibility:auto`，不隐藏历史。
- 窗口模式只修改可恢复的 inline style；不删除、替换、克隆或改写 ChatGPT 消息节点。
- 流式输出期间不执行历史窗口重排；顶部滚动会按批恢复并补偿滚动位置。
- Runtime health 增加 mode、turn/optimized/hidden 数和 60 秒 long-task 聚合，不包含消息正文。
- 该功能不解决模型上下文、服务器延迟、服务中断或第三方扩展冲突。
- 用户浏览器尚未完成 0.16.0 的现场性能与兼容验收。

- 0.16.0 合并前审计已取消空闲状态下的固定频率全量重扫；手动展开历史也不再绕过流式保护。


## 0.17.0 Runtime 主线程归因诊断

- `dcf.standard.conversation-performance@1.1.0` 新增“开始 60 秒归因诊断”和“结束并复制归因报告”。
- 报告聚合 Long Animation Frames、脚本入口与来源、blocking/render/style-layout/forced-layout、Event Timing、layout-shift 和 longtask fallback。
- DCF 单独记录 apply 次数、触发原因、总时长、最大时长，以及会话期间的 DOM mutation 批次。
- 会话开始前已启动的 Performance Timeline entry 被排除，避免启动按钮污染样本。
- 脚本 URL 删除 query/hash，仅保留来源类别、host 和末级路径；不采集消息正文、DOM 文本、event target 或 stack。
- 用户浏览器尚未完成 0.17.0 的 60 秒归因现场验收。


## 0.18.0 问答轮次归因

- `dcf.standard.conversation-performance@1.2.0` 用“问答轮次归因”替代固定 60 秒作为主入口。
- “记录下一轮问答”只待命；下一次发送按钮点击或输入框 Enter 才正式启动采样。正常完成后使用“复制本轮归因报告”；“手动结束并复制”只作为异常恢复。
- 首个助手 DOM 活动划分等待阶段，已有 bounded reply observer 在流式结束并安静后自动封口。
- 报告给出发送到首个回复活动、首个回复活动到完成和整轮时长，并保留 completion quiet-window。
- 十分钟最长运行和手动结束仅作异常恢复；不采集用户输入或助手回复正文。
- 用户浏览器尚未完成 0.18.0 的真实问答轮次归因验收。
