# ADR: DCF light capability-bus kernel

Date: 2026-07-09
Status: accepted

## Context

DCF is intended to be a plugin carrier and low-friction personal cognitive tool. The kernel must not become a growing collection of hard-coded business features.

The previous repair release removed hard-coded language ammunition UI, but its module model was still too weak: modules could only use a small fixed action list. That meant every new module requirement risked becoming another kernel change.

The missing kernel responsibility is not a specific language ammunition feature. It is a general capability bus: the kernel must expose the real browser/userscript abilities to modules through stable calls, automatically ingest module packages from the conversation, and feed back install or call failures to the current AI session.

This must remain a small Tampermonkey script, not a heavy enterprise governance platform.

## Decision

Release `0.8.5` rebuilds the kernel as a light capability bus.

The kernel keeps these responsibilities:

- maintain a small persistent sidebar;
- expose kernel capabilities through named calls;
- accept declarative module packages with `schema: dcf.module_pack.v1`;
- automatically scan the current conversation for `DCF_MODULE_PACK` blocks;
- install valid module packages without user clicks;
- record a small install/call log and installed-pack ledger;
- send concise `DCF_FEEDBACK` blocks after installation success, installation failure, or capability-call failure;
- keep module UI and business behavior outside the kernel.

The kernel expands Tampermonkey grants to support a broad local capability surface:

- clipboard;
- GM key/value storage;
- style injection;
- menu command registration;
- notification;
- data fetching via `GM_xmlhttpRequest`.

`GM_xmlhttpRequest` is a data-fetching capability only. It must not be used to download JavaScript and execute it. Remote code execution, eval-style execution, chunk bootloaders, and localStorage-as-code remain rejected.

## Capability surface

The kernel exposes capabilities under these groups:

- `ui.*`
- `composer.*`
- `conversation.*`
- `clipboard.*`
- `store.*`
- `module.*`
- `package.*`
- `network.*`
- `log.*`
- `maintenance.*`

Modules call capabilities through command steps. Permissions declared by modules are used for visibility, diagnosis, and feedback. They are not a heavy user-approval workflow.

Missing or failed capability calls must generate a feedback event instead of silently failing or causing the assistant to immediately edit the kernel.

## Automatic module ingestion

The kernel scans page text for:

```text
<<<DCF_MODULE_PACK
{
  "schema": "dcf.module_pack.v1",
  "pack_id": "...",
  "revision": "...",
  "modules": []
}
DCF_MODULE_PACK>>>
```

For each package, it:

1. parses JSON;
2. validates schema and module structure;
3. normalizes commands and capability steps;
4. checks installed `pack_id + revision`;
5. installs valid modules;
6. records the install in a small ledger;
7. rerenders the module view;
8. emits `DCF_FEEDBACK`.

The installed-pack ledger prevents repeated installation from the same conversation text.

## Feedback

Installation and capability failures must produce concise feedback:

```text
<<<DCF_FEEDBACK
{
  "schema": "dcf.feedback.v1",
  "event": "module_install",
  "status": "ok",
  "pack_id": "...",
  "revision": "...",
  "installed_modules": []
}
DCF_FEEDBACK>>>
```

If the composer or send button cannot be used, the kernel falls back to copying feedback and showing a sidebar notice.

Feedback is not an audit platform. It is a lightweight way to let the current AI session know whether the DCF wrapper path actually worked.

## Boundary

Future language ammunition, workflow, project adapter, or UI changes must first be delivered as `DCF_MODULE_PACK`.

The kernel may be changed only for generic capability surface, ingestion, feedback, recovery, storage, diagnostics, or release metadata.

Business-specific behavior must not be added directly to `dcf-chatgpt-microcore.user.js`.

## Verification target

After installing `0.8.5`:

1. refresh ChatGPT with the new userscript loaded;
2. send or display a valid `DCF_MODULE_PACK` block in the conversation;
3. do not click anything in DCF;
4. DCF automatically installs the module;
5. DCF automatically emits `DCF_FEEDBACK`;
6. the module appears in the module tab;
7. command buttons execute through capability calls;
8. repeating the same `pack_id + revision` does not reinstall.
