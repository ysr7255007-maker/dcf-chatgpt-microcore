# ADR: DCF adjustable shell geometry has one source of truth

Date: 2026-07-12
Status: accepted

## Context

The `0.9.12` correlated evidence chain was used against the browser's actual registry after `dcf.shell_adjuster` version `2.1` appeared to execute without changing the shell.

The evidence proved that command resolution, capability execution, registry mutation, persistence, and recovery snapshots were all working. For example, `appearance.adjust` changed width from `300px` to `320px` and height from `1000px` to `1040px`, with persisted state matching memory. The rendered shell nevertheless remained `340px × 540px`, and bottom remained `112px`.

CSS provenance identified the cause. The installed appearance CSS contained a `.sh` rule with `width:340px!important`, fixed min/max width, `height:var(--dcf-h)!important` where `--dcf-h` was fixed at `540px`, fixed min/max height, and `bottom:var(--b,112px)!important`. That rule overrode the kernel's `--w`, `--h`, and `--bottom` variables and used a separate undefined `--b` variable.

## Decision

Adjustable shell geometry has one authoritative source: `registry.appearance.vars`, interpreted by the kernel.

The authoritative geometry fields are:

- `w`;
- `h`;
- `top`;
- `bottom`;
- `anchor`;
- `side` where applicable.

Appearance CSS may style the shell and its internal layout, but it must not hardcode or override `.sh` width, height, min/max width, min/max height, top, bottom, left, or right in a way that competes with those registry variables. It must not introduce parallel geometry variables such as `--dcf-h` or `--b` as a second source of truth.

The current repair is a registry hot update that removes the conflicting `.sh` geometry rule while preserving the internal layout CSS. No userscript release is required. The installed `dcf.shell_adjuster` version `2.1` remains valid and should not be replaced.

## Verification

After applying the repair package:

1. width and height step commands must change both registry state and rendered geometry;
2. top and bottom distance commands must affect the active anchor distance;
3. `贴顶` and `贴底` must switch the kernel data anchor and rendered position;
4. command evidence should classify successful visible changes as `state_and_render_changed` rather than `state_changed_but_render_overridden`;
5. no shell-adjuster command should emit feedback unless explicitly configured.

## Consequences

Theme and layout packages remain free to style the shell, rail, body, cards, and controls, but shell geometry must remain composable with the generic appearance capabilities.

A package that needs a geometry constraint must express it through the shared appearance variable model or a future generic constraint mechanism, not through an overriding static `.sh` rule.

## Reconsideration condition

This decision may be revisited only if a new generic geometry model replaces the current appearance variables while preserving continuous adjustment, anchoring, persistence, recovery, and evidence visibility through a single authoritative state path.
