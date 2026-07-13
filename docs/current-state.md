# DCF 当前状态与新会话交接

Updated: 2026-07-13

## 读取顺序

1. `README.md`
2. `docs/architecture-current.md`
3. `docs/dcf-basic-consensus-prompt.md`
4. `docs/dcf-maintenance-skill.md`
5. `docs/adr/status-index.md`
6. 与当前事项相关的 ADR
7. 本文件

根 `.user.js` 是生成发布物，不再作为理解源码架构的首要入口。

## 当前版本

当前候选版本：`0.11.6`

`0.11.4` 保留了 0.11.3 已正确完成的包管理、日常功能和维护工具分区，移除错误的 hidden 产品语义，并把体检重建为真实浏览器 Runtime 偏差报告。`0.11.5` 修正 Runtime DOM 入口采样误报。`0.11.6` 聚焦包管理的中文可读性和紧凑总览，不改变包身份、事务、迁移或 Runtime 架构。

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
- package presentation derives stable Chinese titles and descriptions without changing package identity;
- package version, switch, enable/disable and uninstall controls remain operational in one compact band;
- legacy hidden metadata remains discoverable;
- daily/maintenance roles and fold state remain separate;
- folding never changes authoritative state;
- healthy Runtime report is diff-only;
- duplicate host, storage/memory divergence, missing real DOM entry, stale observer, missing composer and recent failures produce explicit deviations;
- Runtime report preserves privacy;
- dual-backend bridge, bounded Host Adapter, catalog, viewport and deterministic release tests.

## User checkpoint after release

1. update Tampermonkey to `0.11.6` and refresh ChatGPT;
2. open `包管理` and confirm each package uses a readable Chinese title and one-line function description;
3. confirm the English package ID remains visible only as a smaller technical identifier;
4. confirm single-version packages show a compact version label, while multi-version packages keep version selection and `切换`;
5. confirm `启用/停用`、`切换`、`卸载` stay together in the package operation band and the page can be scanned globally;
6. run `维护 -> 一键 Runtime 体检` and paste the complete `DCF_RUNTIME_HEALTH` block if deviations are present.

## Deferred to phase two

ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT's own long-thread rendering cost.
