# ADR: Separate package presence, runtime modules, and function placement

Date: 2026-07-13  
Status: accepted

## Context

The 0.11.1 health report and UI used the word “module” for several different facts: an installed package shown in package management, a runtime module contributed by that package, and a function card placed in daily or maintenance UI. A `hidden` display declaration was then incorrectly interpreted as evidence that migrated modules were absent from the user interface, even though the installed packages were visibly present.

The same ambiguity also mixed daily product functions with probes, diagnostics, layout controls, authoring tools, and acceptance utilities, increasing the cost of finding ordinary functions.

## Decision

DCF distinguishes five states:

1. installed package;
2. runtime module;
3. daily function;
4. maintenance tool;
5. hidden runtime module.

The package-management tab is labelled `包管理` and always represents package/version state. The `功能` tab contains only daily functions. The `维护` tab contains diagnostics, configuration, probes, authoring, acceptance, and layout tools. Hidden means excluded from both function entry points, not absent from package management or runtime projection.

A shared module-role resolver is consumed by both UI and health reporting. Known first-party legacy modules receive an explicit product classification so old generic `area: work` or `hidden` defaults do not place maintenance probes into the daily workflow. User-owned `moduleDisplay` overrides may move a runtime module between daily, maintenance, and hidden without rewriting its immutable package.

The health schema advances to `dcf.health.report.v2` and reports installed-package count, runtime-module count, daily-function count, maintenance-tool count, hidden-runtime-module count, and each runtime module’s placement source.

## Consequences

- Package presence can no longer be mistaken for function placement.
- The health report and rendered UI use the same classification function.
- Daily use remains compact while all maintenance capabilities remain accessible.
- The 0.11.2 “restore all hidden modules” interpretation is superseded; placement is managed explicitly instead.
