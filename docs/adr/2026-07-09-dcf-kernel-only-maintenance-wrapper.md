# ADR: DCF kernel-only maintenance wrapper repair

Date: 2026-07-09
Status: accepted

## Context

DCF was originally intended to be a plugin carrier and low-friction maintenance wrapper. Its purpose is to allow UI, modules, language ammunition, and project-specific capabilities to be changed through the wrapper rather than by repeatedly editing the userscript core.

Release `0.8.3` violated this direction. It implemented language ammunition behavior directly inside `dcf-chatgpt-microcore.user.js`. That made a module requirement look like a kernel requirement and undermined the core promise of DCF as a replaceable, hot-maintained plugin carrier.

The most important repair is not to write another design note, but to change the artifact so that the installed userscript contains only the maintenance wrapper and a generic declarative module runtime. Business UI and plugin behavior must enter through module packages.

## Decision

Release `0.8.4` repairs the userscript back to a kernel-only maintenance wrapper.

The kernel keeps only:

- a persistent maintenance shell;
- module registry storage;
- module package JSON installation;
- generic declarative module rendering;
- generic safe actions such as insert text, insert and send, copy text, and notice;
- diagnostics, cleanup, and repair prompts;
- a hot-update self-test module package used only to prove the wrapper path.

The kernel removes the language ammunition module as hard-coded product behavior. Language ammunition, other UI blocks, and plugin-specific workflows must be installed as module packages through the wrapper.

## Non-negotiable boundary

A user request for UI, language ammunition behavior, prompt workflow, project adapter, or plugin feature must not be implemented by adding feature-specific functions to `dcf-chatgpt-microcore.user.js`.

The correct path is:

```text
module/package requirement
  -> produce dcf.module_pack.v1 JSON
  -> apply through DCF maintenance wrapper
  -> verify UI changes without userscript update or page refresh
```

The userscript core may be changed only when the wrapper, module registry, declarative renderer, safe action set, recovery mechanism, or release metadata itself is insufficient.

## Verification target

After installing `0.8.4`, the first real test is:

1. Open ChatGPT with DCF loaded.
2. Confirm the sidebar shows `DCF Kernel`, not language ammunition as a built-in module.
3. Go to `维护 -> 热更新入口`.
4. Click `热更新自检模块`.
5. Confirm the UI switches to `模块` and a `热更新探针模块` appears without page refresh and without another userscript update.
6. Click `插入探针` and confirm text is inserted into the composer.

This proves wrapper-level module hot update. It does not prove remote code execution and does not need remote code execution.

## Consequences

`0.8.3` is treated as a wrong-path prototype and superseded by `0.8.4`.

Future work on language ammunition must be delivered as a module package first. Only after the kernel demonstrably cannot express a necessary generic capability may the kernel be changed.
