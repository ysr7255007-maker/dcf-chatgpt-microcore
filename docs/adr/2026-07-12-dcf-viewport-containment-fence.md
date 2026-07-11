# ADR: DCF shell uses one runtime viewport containment fence

Date: 2026-07-12
Status: accepted

## Context

After the shell geometry CSS conflict was removed, continuous width, height, anchor, and distance controls worked again. A remaining risk was that a valid registry value could place part of the shell outside the browser's currently visible area. Once controls leave the visible area, the user may be unable to recover through the UI.

A first idea was to derive separate maximums for top anchor, bottom anchor, each distance control, and each size control. That approach was rejected because it duplicates boundary logic across commands and is vulnerable to calculation errors, new positioning modes, browser resizing, zoom, visual viewport offsets, and unexpected CSS.

## Decision

The kernel owns one viewport containment fence that runs after every shell render and whenever the window or `visualViewport` changes.

The fence:

1. reads the actual visible rectangle from `window.visualViewport`, with document viewport fallback;
2. reads the shell's actual rendered rectangle with `getBoundingClientRect()`;
3. limits rendered width and height to the safe viewport rectangle;
4. computes a generic x/y correction from the two rectangles and translates the shell back inside the safe rectangle;
5. does not branch on top anchor, bottom anchor, side, or the command that caused the change;
6. preserves registry values as the user's desired geometry, so temporary viewport shrinkage does not destroy preferences;
7. caps new width and height step targets against the current safe viewport size;
8. exposes viewport, safe rectangle, correction, final rectangle, and containment status through runtime appearance evidence and diagnostics.

The fence is a safety envelope, not a second preference source. Appearance vars remain the source of desired shell geometry.

## Why this requires a userscript release

A registry package can provide static CSS, but it cannot reliably observe the browser's current visual viewport, read the final shell rectangle, react to viewport resize or scroll, and apply one generic post-render correction. These are host runtime capabilities, so this change is released in userscript `0.9.13`.

## Verification

The dedicated unit test must cover:

- a shell larger than the viewport;
- simultaneous horizontal and vertical overflow;
- non-zero visual viewport offsets;
- preservation of desired registry dimensions;
- use of the same guard regardless of anchor;
- registration of viewport resize and scroll listeners.

Normal browser verification only requires trying to enlarge or move the shell beyond the visible area. Evidence upload is needed only if the guard fails or behaves unexpectedly.

## Consequences

Future shell positioning modes and controls do not need their own boundary formulas. They render normally and then pass through the same actual-rectangle containment fence.

The rendered shell may be temporarily smaller or translated relative to the desired registry geometry when the viewport cannot accommodate it. When the viewport grows again, the desired geometry can become visible again.

## Reconsideration condition

Revisit this decision only if the browser platform provides an equivalent reliable containment primitive that works with fixed elements, visual viewport offsets, resizing, zoom, and all supported anchor modes while retaining observable diagnostics.