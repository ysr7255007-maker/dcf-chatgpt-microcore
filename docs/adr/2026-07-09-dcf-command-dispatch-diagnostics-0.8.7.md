# ADR: DCF command dispatch and light diagnostics repair 0.8.7

Date: 2026-07-09
Status: accepted

## Context

After module installation succeeded, the language-ammo module rendered buttons but clicking `生成弹药` did not write the prompt into the composer.

The cause was a kernel dispatch mismatch: the UI rendered top-level `module.commands` as a temporary block, but the click runner only looked up `module.blocks[index].commands[index]`. Modules with top-level commands therefore appeared clickable but failed silently.

This also exposed a maintenance problem: when the user reports a click failure, the assistant must be able to obtain a small diagnostic log instead of guessing from symptoms.

## Decision

Release `0.8.7` keeps DCF as a small personal Tampermonkey script and applies a narrow kernel repair:

- add one shared `getRenderableBlocks(module)` path and use it for both rendering and command dispatch;
- log command click, lookup, run start, run success, and run failure;
- remove silent command lookup failure;
- add a direct `DCF_MAINT_REQUEST` diagnostic inlet that does not depend on normal module commands;
- keep the log as a small local ring buffer, not an enterprise audit system;
- expose a small configurable send policy through `composer.sendPolicy.*` while keeping DOM execution inside the kernel.

## Boundary

This is not a governance expansion. It is a repair to the plugin substrate:

- no approval workflow;
- no roles;
- no remote code execution;
- no server-side audit;
- no business module hardcoding.

The maintenance inlet is limited to diagnostics such as recent log, module list, installed packs, last command error, last capability error, composer probe, send policy, and last scan.

## Verification target

After installing `0.8.7`:

1. existing modules that use top-level `commands` should execute;
2. `语言弹药 -> 生成弹药` should replace the composer text;
3. command lookup failures should produce a sidebar notice and log entry;
4. a `DCF_MAINT_REQUEST` block should return diagnostics without relying on a module button;
5. logs remain small and local.
