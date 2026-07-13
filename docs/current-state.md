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

当前候选版本：`0.11.5`

此次采用增量修正，而不是回滚 0.11.3。0.11.3 已经正确分离安装包、运行模块、日常功能和维护工具；回滚会连同这部分正确结构一起撤销。0.11.5 只移除错误的 hidden 产品语义，并重建 Runtime 体检。

## 0.11.5 修正

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
- legacy hidden metadata remains discoverable;
- daily/maintenance roles and fold state remain separate;
- folding never changes authoritative state;
- healthy Runtime report is diff-only;
- duplicate host, storage/memory divergence, missing real DOM entry, stale observer, missing composer and recent failures produce explicit deviations;
- Runtime report preserves privacy;
- dual-backend bridge, bounded Host Adapter, catalog, viewport and deterministic release tests.

## User checkpoint after release

1. update Tampermonkey to `0.11.5` and refresh ChatGPT;
2. confirm tabs are `弹药 / 功能 / 包管理 / 维护`;
3. confirm every module title remains discoverable under either `功能` or `维护`;
4. expand and collapse several daily and maintenance cards, then refresh and confirm fold state persists without moving modules;
5. run `维护 -> 一键 Runtime 体检` and paste the complete `DCF_RUNTIME_HEALTH` block if deviations are present.

## Deferred to phase two

ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT's own long-thread rendering cost.

## 0.11.5 Runtime entry sampling fix

- Runtime DOM sampling counts only top-level `details.module-card` entries.
- Command buttons carrying `data-module-id` are excluded from duplicate-entry detection.
- This fixes the 0.11.4 false `runtime_duplicate_entries` warning without changing module roles or Runtime state.
