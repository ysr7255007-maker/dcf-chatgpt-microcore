# ADR: DCF SideRail UISugar layout 0.8.9

Date: 2026-07-10
Status: accepted

## Context

After `0.8.8`, UI Sugar became a hot-update capability surface, but the primary navigation still only supported a horizontal category bar. The user requested a Blender-like side tab layout so the vertical panel space can be used more efficiently.

This exposed a remaining UISugar gap: the concrete UI preference should be applied by hot-updated `ui_policy`, but the kernel still needed a generic renderer slot for navigation style.

## Decision

Release `0.8.9` adds a small SideRail interpretation path to the UISugar renderer.

The UI policy now accepts:

- `nav_style: "top_tabs" | "side_tabs"`;
- `module_tabs_style: "top_tabs" | "side_tabs"`;
- `rail_width_css`.

The kernel renders the same logical tabs through either the previous top tab bar or a compact vertical side rail. Module detail tabs can also use the vertical side-tab style.

## Boundary

This is a generic UISugar interpreter extension, not a hardcoded one-off style change.

The user's preferred Blender-like layout should be activated by a hot-update package through `ui_policy`; the kernel only provides the reusable `side_tabs` rendering mode.

The kernel still does not grant modules arbitrary DOM mutation. It interprets declarative UI policy only.

## Consequences

A later package can enable side tabs without changing the userscript again:

```json
{
  "ui_policy": {
    "nav_style": "side_tabs",
    "module_tabs_style": "side_tabs",
    "rail_width_css": "34px"
  }
}
```

Future navigation/layout variants should follow the same pattern: add a minimal generic policy slot only when the current declarative UISugar schema cannot express a repeated UI need.
