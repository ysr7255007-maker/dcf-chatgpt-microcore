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

当前候选版本：`0.11.3`

用户提交的 0.11.1 体检报告证明旧包与旧运行模块均已迁移，缺失清单为空。上一轮错误地把体检中的 `hidden` 直接解释成“模块没有显示”，但用户已在原“模块”页看到十几个条目。真正问题是同一个名称混用了安装包、运行模块和功能入口三个层次。

## 0.11.3 修正

- 原“模块”页改名为“包管理”，只表达包与版本状态；
- `功能` 只展示日常和主力能力；
- `维护` 集中展示探针、诊断、验收、作者、布局调节和恢复工具；
- 运行模块可由用户分类为日常、维护或隐藏；
- 分类覆盖写入用户 `moduleDisplay`，不改写不可变包；
- UI 与体检共用 `src/modules/module-roles.js`；
- 已知第一方旧模块使用显式产品分类，避免旧 `area: work` 或 `hidden` 默认值扭曲当前布局；
- 体检升级为 `dcf.health.report.v2`，分别报告安装包、运行模块、日常功能、维护工具、隐藏运行模块和弹药专用模块。

默认日常功能包括弹药工作台、统一弹药工作区和旧语言弹药模块。探针、检查、验收、维护回馈、模块作者、状态存储、壳体调节及布局控制默认进入维护页。标准语言弹药继续使用独立“弹药”页。

## Phase one baseline

- modular source and deterministic complete-userscript release;
- one authoritative `dcf.state.root.v1` in one authoritative backend;
- one candidate/validate/commit transaction for all authoritative changes;
- immutable package revisions and stable resource claims;
- user state separated from package defaults;
- registry and UI as projections;
- typed reply/manual/catalog artifacts entering one transaction path;
- bounded current-reply Host Adapter with no body observer or full-history scan;
- automatic ammo loading, module installation, catalog update, and low-friction firing;
- generic command interpreter, state/effect separation, privacy-filtered receipts, health report, snapshots/rollback, and viewport fence.

## Verification target

- `npm run verify`;
- `node --check dcf-chatgpt-microcore.user.js`;
- package/runtime/placement separation tests;
- daily/maintenance legacy classification tests;
- user placement override without package mutation;
- `dcf.health.report.v2` inventory and privacy tests;
- dual-backend bridge, bounded Host Adapter, and deterministic release tests.

## User checkpoint after release

1. update Tampermonkey to `0.11.3` and refresh ChatGPT;
2. confirm tabs为 `弹药 / 功能 / 包管理 / 维护`；
3. confirm `功能` only contains daily tools；
4. confirm probes, inspectors, shell adjustment and authoring tools appear under `维护`；
5. copy a new health report only if the page and report still disagree.

## Deferred to phase two

ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT's own long-thread rendering cost.
