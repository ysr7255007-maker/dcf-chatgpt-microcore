# ADR: DCF UISugar and content hot-update repair 0.8.8

Date: 2026-07-09
Status: accepted

## Context

The previous kernel repairs made module commands hot-updatable, but they still left a core mismatch with the original DCF direction: UI behavior was still mostly hardcoded in the userscript renderer.

The user clarified that DCF's hot-update surface must include both functionality and UI. Display concerns such as module folding, sidebar width, hiding permissions from the primary view, detail/config pages, module grouping, and ammunition-library presentation are not business logic to be hardcoded into the kernel. They are UI Sugar capabilities.

The same review exposed another missing asset layer: `DCF_AMMO` blocks were generated as conversation text but were not ingested as first-class assets.

## Decision

Release `0.8.8` treats UISugar as a real permission/capability namespace rather than a fixed kernel style.

The kernel now adds a small declarative UISugar surface:

- `ui.sugar.policy.get/set/reset`;
- `ui.sugar.module.setDisplay/setVisibility`;
- `ui.sugar.group.set`;
- `ui.sugar.view.install/remove/list`.

Module packages may now carry UI/data payloads in addition to functional modules:

- `ui_policy` for sidebar width, default folding, permission display level, badges, and hidden module visibility;
- `module_display` for per-module hidden/collapsed/title display state;
- `ui_views` for declarative views such as an ammunition library;
- `content.ammo` for installing ammunition assets.

Pure UI/content packages are allowed as valid `dcf.module_pack.v1` payloads even when `modules` is empty.

The kernel also adds `DCF_AMMO` scanning and a small `content.ammo.*` capability surface:

- `content.ammo.ingest`;
- `content.ammo.list`;
- `content.ammo.fire`;
- `content.ammo.remove`.

## Boundary

This is still a personal Tampermonkey script, not an enterprise UI platform.

The kernel does not grant arbitrary DOM mutation to modules. It only interprets a small declarative UISugar schema.

The default UI is compact and folded, but concrete workspace organization should be installed through hot-update packages rather than hardcoded as one permanent kernel layout.

## Consequences

DCF's hot-update surface now covers:

- functional commands;
- UI sugar and display policy;
- content assets such as language ammunition;
- lightweight diagnostics.

Future changes such as narrowing the sidebar, hiding module permissions from the first-level view, grouping old modules, or installing an ammunition library should be delivered as module packs unless a genuinely new generic capability is missing.

## Reconsider when

Reconsider the design only if declarative UISugar cannot express a repeated UI need without adding unsafe arbitrary DOM execution, or if the single-file kernel becomes too large to inspect as a personal userscript.
