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

需要把新维护窗口直接接入当前仓库与用户浏览器现场时，使用 `docs/prompts/dcf-current-loaded-system-handoff.md`。

根 `.user.js` 是生成发布物，不再作为理解源码架构的首要入口。

## 当前版本

当前正式版本：`0.13.0`

`0.11.4` 保留包管理、日常功能和维护工具分区，移除错误的 hidden 产品语义，并把体检重建为真实浏览器 Runtime 偏差报告。`0.11.5` 修正 Runtime DOM 入口采样误报。`0.11.6` 聚焦包管理中文可读性和紧凑总览。`0.12.0` 统一按值/按引用能力包更新。`0.13.0` 将系统整体收拢为期望对话环境、typed intent、有限资源族、环境投影和 Profile/恢复架构。

## 当前浏览器 Runtime 检查点

用户已确认完成 `0.13.0` 迁移。最近一次真实浏览器体检生成于 `2026-07-13T14:01:49.777Z`：

```text
schema: dcf.runtime.health.diff.v1
version: 0.13.0
route_kind: /c/:conversation
primary_backend: gm
current_tab: maintenance
status: healthy
deviations: []
```

体检隐私边界确认未包含对话正文、弹药正文、包 payload、命令参数或认证数据。该结果关闭 0.13.0 的 Runtime 迁移检查点，但不单独证明 Environment Profile、具体模块命令和用户内容隔离等业务行为；这些继续由对应功能验收负责。

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
- Environment Snapshot derives from the single root and current registry;
- persistent production controls route through Environment Reconciler;
- content/action/view/style/policy resource graph has stable ownership and observation contracts;
- all four main views are package-owned while Core retains safe fallback rendering;
- Profiles do not copy user ammo bodies and activation/restore remain atomic environment transitions;
- package presentation remains readable without changing immutable package identity;
- legacy hidden metadata remains discoverable and fold state remains disposable UI session;
- healthy Runtime report remains diff-only and privacy filtered;
- dual-backend bridge, bounded Host Adapter, catalog, viewport and deterministic release tests remain green.

## User checkpoint after release

1. Tampermonkey 已加载 `0.13.0`，迁移与基础 Runtime 体检通过；
2. 四个标签及包提供的标签/顺序已进入当前 Runtime；
3. Environment Profile 的保存、修改后激活恢复和弹药正文隔离仍属于可按需要执行的专项行为验收；
4. 模块命令产生的 appearance、setting、content 持久变化必须继续经 Environment Reconciler；
5. 包管理名称、紧凑控制和已有不可变 revision 必须保持兼容；
6. 后续只有出现用户现场异常或相关功能变化时，才重新运行并提交完整 `DCF_RUNTIME_HEALTH`。

## Deferred to phase two

ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT's own long-thread rendering cost.

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