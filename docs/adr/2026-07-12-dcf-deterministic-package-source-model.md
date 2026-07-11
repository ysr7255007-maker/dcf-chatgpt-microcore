# ADR: DCF packages are immutable sources for a deterministic runtime build

Date: 2026-07-12  
Status: accepted

## Context

DCF originally applied every `dcf.module_pack.v1` directly to the current registry with `deepMerge`. The resulting registry preserved the final value but lost the independent sources that produced it. Precise disable, uninstall, version rollback, style removal, conflict explanation, and protection of later user changes would therefore require an expanding history of before-values, reverse patches, ownership transfers, and special cases.

A field-level contribution ledger was considered and rejected. It would preserve the same mutation model and move the complexity into increasingly elaborate undo logic.

## Decision

DCF uses three distinct layers:

1. immutable package sources;
2. user-owned state;
3. a derived runtime registry cache.

The runtime registry is rebuilt from the currently enabled package revisions and current user state. It is not an authoritative store and may be discarded and regenerated.

Package lifecycle operations are unified:

- install adds an immutable revision and selects it;
- update selects a new immutable revision;
- disable removes the package from the active build without deleting it;
- uninstall removes the package source;
- rollback selects a retained revision.

Every operation first builds and validates a complete candidate in memory. Authoritative state is committed only after the candidate succeeds. A failed candidate leaves the previous sources, user state, and running registry unchanged.

Package definitions and user results are separate. A module may provide controls that change width, settings, or content, but the values produced by those controls belong to user state. Removing the module removes its definitions and styles without reversing user actions.

Package resources use stable addresses such as `module:<id>`, `surface:<id>`, `content-type:<id>`, and `module-display:<id>`. Duplicate package claims are rejected instead of being silently deep-merged. Replacement of a core resource must be explicit. Package styles remain independent source fragments and are only concatenated into derived runtime CSS.

The authoritative local stores are:

- `dcf.package.sources.v1` for immutable package revisions and active selections;
- `dcf.user.state.v1` for user appearance, settings, content, and display overrides;
- `dcf.kernel.ops.v2` for scanning and quarantine metadata.

`dcf.kernel.registry.v1` remains only as a compatibility and diagnostic cache.

## Migration

On the first `0.10.0` boot, a legacy registry is decomposed once:

- each legacy module becomes an independent synthetic package source;
- each legacy Surface and non-core content type becomes an independent source;
- valid legacy appearance CSS becomes a migrated appearance package;
- appearance values, settings, and content assets become user state;
- invalid legacy shell-geometry CSS is quarantined instead of blocking startup.

## Consequences

Precise disable and uninstall no longer require reverse patches. User state survives package removal. Updates and revision rollback use the same rebuild path. Resource conflicts fail before commit. The future GitHub module library only needs to deliver immutable package files and change the selected input set.

The first release deliberately does not add a remote catalog interface. The source/build/lifecycle model is established first so that a later catalog remains a thin discovery and download layer.

## Verification

The package-engine test covers:

- deterministic build identity for identical inputs;
- package disable with user-state preservation;
- exact removal of package content and styles;
- duplicate resource rejection;
- explicit core replacement;
- shell geometry ownership checks;
- legacy migration and invalid legacy CSS quarantine.

The existing command evidence and viewport fence tests remain part of the full test command.

## Reconsideration condition

Reconsider only if a future requirement cannot be expressed as immutable package definitions plus user state without introducing hidden package-to-package mutation. Do not return to direct mutation merely to simplify one package format or one UI action.
