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

当前发布版本：`0.11.0`

一期全项目架构重建已经完成并发布。源码位于 `src/`，根 userscript、metadata 和 catalog 由构建脚本确定性生成。

## Phase one completed

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
- package manager, maintenance summary, snapshots/rollback, and viewport fence;
- one-time migration from `0.10.0` package/user/ops stores and older registries without carrying page-scan ledgers into the new authority.

## Verification

Local and GitHub branch verification passed:

- `npm run verify`;
- `node --check dcf-chatgpt-microcore.user.js`;
- deterministic userscript, metadata, and catalog generation;
- one-root/transaction/resource/migration/legacy-command/catalog/viewport/release tests;
- bounded host-intake static contract;
- real headless Chromium smoke: new assistant `DCF_AMMO` reply → automatic root commit → ammo UI → 发射 → composer receives body.

The permanent GitHub workflow runs `npm run verify` for pull requests and pushes. It never edits or commits generated files.

## Next real-browser checkpoint

The remaining checkpoint is the user's existing Tampermonkey environment:

1. update to `0.11.0` and refresh ChatGPT;
2. confirm existing ammo, appearance values, module display, Surfaces, and legacy modules migrated;
3. confirm a new `DCF_AMMO` reply automatically loads;
4. fire one ammo item and run one legacy module command;
5. confirm maintenance shows one authoritative root and local receipts;
6. normal success stays silent; only migration or runtime failure needs copied evidence.

## Deferred to phase two

ChatGPT historical-message virtualization, turn-window rendering, DOM/memory dashboard, and other attempts to reduce ChatGPT's own long-thread rendering cost. Phase one only guarantees that DCF's own reply-intake work does not grow with total conversation rounds.
