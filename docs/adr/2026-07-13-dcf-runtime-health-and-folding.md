# ADR: Runtime health observes browser facts; UI density uses folding

Date: 2026-07-13  
Status: accepted

## Context

The first health report exposed `hidden` metadata and was then treated as if it directly described what the user could see. Because the report reused internal projection semantics and emitted a broad state dump, an ambiguous field acquired product and architecture authority. The UI was repeatedly changed to fit the report instead of first checking the real browser Runtime.

The useful part of 0.11.3 is the separation of installed packages, runtime modules, daily functions, and maintenance tools. Rolling back the whole release would discard that correction.

## Decision

Use an incremental correction on top of 0.11.3.

A runtime module has only a product role: `ammo`, `daily`, or `maintenance`. `hidden` is not a product role and no longer removes a module from discovery. Legacy `hidden` fields are inert compatibility residue.

Daily and maintenance module cards always retain a visible header. Their bodies use native expand/collapse. Fold state is stored only in disposable `dcf.ui.session.v1`; it does not enter the authoritative root, moduleDisplay, package revisions, or transaction history.

One-click health is a Runtime observer, not a code verifier or state encyclopedia. Code logic remains covered by source review, tests, CI, and browser automation. Runtime health observes the actual installed browser instance and compares independently visible layers:

- published runtime object and visible version;
- authoritative browser storage and in-memory root;
- in-memory registry and actual Shadow DOM entries;
- real host count, connection, geometry, and viewport intersection;
- current ChatGPT root, reply observer, composer, and recent failed operations.

A healthy report contains an empty deviation list. An abnormal report includes only the minimum evidence needed for each unexplained Runtime difference. Module-entry coverage compares all non-ammo runtime IDs with actual daily-plus-maintenance DOM IDs; it does not reuse the UI role resolver.

## Consequences

The interface remains dense only when the user expands it, while every installed runtime capability stays discoverable. Old `hidden:true` values cannot silently erase entry points. The health report becomes smaller and is less able to impose an incorrect internal interpretation on product structure.

## Supersedes

- the hidden-runtime-module part of `2026-07-13-dcf-package-module-function-role-separation.md`;
- the remaining hidden-state product semantics in `2026-07-13-dcf-module-visibility-observability.md`;
- the full-state-dump interpretation of the health report introduced by `2026-07-12-dcf-storage-backend-bridge-and-health-report.md`.
