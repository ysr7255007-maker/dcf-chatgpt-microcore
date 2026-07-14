# dcf-chatgpt-microcore

DCF is a personally maintained ChatGPT Tampermonkey system whose value goal is a low-friction language-ammunition loop. The repository is public for update delivery, not operated as a community plugin platform.

## Current architecture

DCF `0.14.0` keeps a generic modular kernel under the first-party language-ammunition product goal. Source is modular, while Tampermonkey still installs one complete userscript.

One authoritative state root changes only through the unified transaction path:

```text
intent or artifact
→ candidate state
→ invariant validation
→ atomic root commit
→ derived runtime projection
→ receipt / host effect
```

ChatGPT replies can carry complete `DCF_MODULE_PACK` values or `DCF_PACKAGE_UPDATE` references. Manual JSON and the fixed GitHub catalog are additional transports. All inputs resolve to one typed artifact and one capability-reconciliation transaction path. Reply intake observes only newly added/current assistant replies.

The UI distinguishes:

- installed packages in **包管理**;
- runtime modules in the registry;
- daily functions in **功能**;
- probes, diagnostics, layout, authoring, acceptance, and recovery tools in **维护**.

`hidden` is not a product role. All non-ammo runtime modules remain discoverable in either daily or maintenance. Module cards use expand/collapse to control density; fold state lives only in disposable `dcf.ui.session.v1` and never rewrites package or authoritative user state.

**一键 Runtime 体检并复制** observes the actual browser instance rather than dumping internal state. It compares persisted storage, in-memory Runtime, real Shadow DOM entries, host count and geometry, ChatGPT observer/composer connection, and recent failed operations. A healthy report contains `deviations: []`; abnormal reports include only the minimum evidence for each Runtime mismatch.

See `docs/architecture-current.md` for the current structure and `docs/adr/status-index.md` for canonical decision status.

## Build and verification

```bash
npm run verify
```

This builds the complete `.user.js`, generates the catalog, and verifies ammo invocation/update semantics, transactions, resource conflicts, migration, legacy commands, role/fold separation, Runtime health privacy and deviation detection, bounded reply intake, catalog updates, viewport containment, release integrity, and deterministic output.

## Unified capability reconciliation

`root.packages` is the authoritative desired capability set. A complete package is a by-value input; `DCF_PACKAGE_UPDATE` is a by-reference input resolved through the trusted catalog. Both enter the same resolver, immutable revision validation, atomic commit, Runtime reprojection and receipt path. The first package-owned declarative view is `dcf.ui.package-management`, so package-management text, control order and style can update as a package revision without changing the userscript bootstrap.

## Conversation environment architecture

DCF `0.13.0` treats the authoritative root as one desired conversation environment. A read-only Environment Snapshot exposes capabilities, user resources, policies, presentation, profiles and provenance. Persistent changes compile to typed environment intents and pass through one candidate/validate/commit/reproject path. Content, actions, views, styles and policies are finite resource families. Ammo, functions, composition and maintenance are package-owned views of the same environment. Profiles save package selection, policies and presentation without copying user ammo bodies.

## Contextual language-ammunition protocol

DCF `0.14.0` distinguishes invocation from raw text reuse. Firing an ammo item sends `〔DCF·语言弹药〕` plus the body so the receiving conversation reinterprets the condensed long-term intent against the current context before acting. Clear adaptations can proceed directly; only material conflict or unresolved ambiguity requires confirmation.

Updating an ammo item sends `〔DCF·弹药更新〕`, the complete current item and a substantive revision contract. The response must preserve the same `id` and return one complete `DCF_AMMO` artifact. Marker text and update rules are owned by `dcf.standard.ammo@1.2.0` as `ammo_protocol` policy; copying still exports the raw body.


## Canonical module supersession

DCF `0.15.0` lets an active module declare exact predecessor module IDs through `supersedes`. A predecessor leaves normal Runtime views only while its replacement is active; similarly named modules are never inferred as duplicates. Packages whose only runtime module is superseded move from the primary package list into a folded historical section instead of being destructively deleted. `dcf.standard.ammo@1.3.0` uses this mechanism to replace the three migrated ammo workbenches with one complete language-ammunition workbench.
