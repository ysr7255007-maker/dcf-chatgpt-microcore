# ADR: Installed modules must remain observable when hidden

Date: 2026-07-13  
Status: accepted

## Context

After the `0.11.1` storage bridge, a full health report proved that all legacy packages and modules had migrated into the authoritative GM-backed root. The user still reasonably perceived the modules as missing because fourteen recovered modules carried `hidden: true` display metadata and the UI silently omitted them.

The runtime was correct, but the product representation was misleading. Installed state, enabled state, projected state, and displayed state are different facts. Treating `hidden` as absence makes successful migration indistinguishable from data loss and forces diagnosis back into guesswork.

## Decision

1. Package installation and module display are separate state dimensions.
2. A hidden module remains installed, enabled, projected, versioned, diagnosable, and recoverable.
3. The Functions view must explicitly report when installed modules are hidden.
4. Maintenance must expose a complete module visibility inventory.
5. Per-module and show-all visibility changes are user-owned `moduleDisplay` overrides and use the unified transaction engine.
6. Visibility controls may not rewrite package definitions, uninstall packages, or erase package-provided display defaults.
7. The health report must include visible/hidden counts and hidden module IDs. Hidden state is informational unless another invariant fails.

## Consequences

- A user can distinguish missing, disabled, installed-hidden, and visible modules without inspecting storage manually.
- Legacy display intent is preserved during migration, but it no longer makes modules disappear without explanation.
- Restoring visibility does not mutate immutable package revisions.
- Future UI projections must not use omission as the sole representation of a meaningful runtime state.

## Verification

Tests must prove that a package-provided hidden module remains in the runtime projection, appears in the health inventory, can be made visible through a user override, and remains installed after that override.

## Reconsideration

Reconsider only if a later UI supplies an equally explicit module inventory and visibility control through a different projection. The semantic distinction between installed and displayed state remains required.
