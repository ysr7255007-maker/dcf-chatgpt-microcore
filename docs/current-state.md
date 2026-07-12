# DCF 当前状态与新会话交接

Updated: 2026-07-12

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

当前发布版本：`0.11.1`

一期全项目架构重建已经完成。`0.11.1` 修复 `0.10.0 localStorage -> 0.11.0 GM storage` 之间的存储后端断层，并新增一键全量体检报告。

## 0.11.1 修复

- GM storage 继续作为可用时的唯一权威写入后端；
- boot 期间显式检查 page `localStorage` 中的旧 root、`0.10.0` package/user/ops 和更早 registry；
- 当 GM root 已经存在时，旧数据进入候选合并，而不是覆盖当前状态；
- 当前用户值优先，缺失的旧包、revision、弹药、设置、moduleDisplay 和 appearance 被补回；
- 每个缺失旧包先单独构建投影，冲突包被跳过并记录原因，不允许阻塞启动或静默丢失；
- `system.storage_bridge` 记录桥接来源、目标、恢复项和跳过项，桥接不会重复运行；
- 维护页与 Tampermonkey 菜单新增“一键体检并复制”；
- `dcf.health.report.v1` 同时检查 GM/localStorage、迁移覆盖、root/hash/projection、包、模块、Surface、命令数、宿主监听、输入框、回执和快照；
- 报告不包含对话正文、弹药正文、包 payload、命令参数、凭据或认证数据。

## Phase one baseline

- modular source and deterministic complete-userscript release;
- one authoritative `dcf.state.root.v1`;
- one candidate/validate/commit transaction for package, content, setting, appearance, migration, and rollback changes;
- immutable package revisions and stable resource claims;
- user state separated from package defaults;
- registry and UI as projections;
- typed ammo/package artifacts shared by reply, manual JSON, and GitHub catalog transports;
- bounded current-reply Host Adapter with no body observer or full-history scan;
- automatic ammo loading, automatic module installation, catalog update, and low-friction firing retained;
- generic command interpreter preserving legacy top-level and block commands;
- state/effect separation with privacy-filtered receipts;
- required first-party ammo module and optional declarative shell-adjuster module;
- package manager, maintenance summary, snapshots/rollback, and viewport fence.

## Verification

The 0.11.1 release passed:

- `npm run verify`;
- `node --check dcf-chatgpt-microcore.user.js`;
- dual-backend bridge test with an existing GM root plus legacy localStorage modules and ammo;
- bridge idempotence test;
- whole-runtime health inventory and privacy test;
- deterministic userscript, metadata, and catalog generation.

## User checkpoint after release

1. update Tampermonkey to `0.11.1` and refresh ChatGPT;
2. open `维护` and click `一键体检并复制`;
3. confirm old modules, Surfaces, appearance values and ammunition are present;
4. paste the complete `DCF_HEALTH_REPORT` block if `overall` is not `ok` or any expected module remains missing;
5. fire one ammo item and run one recovered legacy command.

## Deferred to phase two

ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT's own long-thread rendering cost. Phase one only guarantees that DCF's own reply-intake work does not grow with total conversation rounds.