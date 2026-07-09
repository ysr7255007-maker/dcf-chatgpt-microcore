# ADR: DCF ModuleRail UISugar layout 0.8.10

Date: 2026-07-10
Status: accepted

## Context

`0.8.9` added a Blender-like side rail, but it applied the side rail to the top-level `维护 / 模块` navigation. The user clarified that this was the wrong target: the top-level category tabs should remain at the top because they are only two items and do not waste meaningful space.

The actual need is for each module itself to become a side-tab choice inside the module page. That replaces the previous accordion/folded module list and uses the narrow panel more efficiently.

`0.8.9` also widened the effective UI because the new side rail was added beside the existing panel content. This conflicted with the user's requirement to avoid covering the ChatGPT text area.

## Decision

Release `0.8.10` adds a generic ModuleRail UISugar policy slot:

- `module_list_style: "accordion" | "side_tabs"`;
- `module_rail_width_css`;
- top-level `nav_style` remains independently configurable.

The corrected default and migration behavior is:

- keep `维护 / 模块` as top tabs;
- render modules as side tabs when `module_list_style` is `side_tabs`;
- show only the selected module's content, with its `功能 / 详情 / 配置` tabs inside the module pane;
- reduce default panel width to avoid covering the chat text area.

Existing `0.8.9` side-rail policy ids are migrated into the corrected model: top tabs for main navigation, module side tabs for module selection.

## Boundary

This is still a UISugar interpreter change, not a business module hardcode.

The kernel only adds a reusable declarative layout mode. Concrete preferences remain expressible through `ui_policy`, and future layout tweaks should continue to use hot-update policy packages unless a generic interpreter slot is missing.

The kernel does not grant arbitrary DOM mutation.

## Consequences

After updating to `0.8.10`, users who installed the previous `dcf.ui.siderail.blender_style.v1` policy should automatically get the corrected layout:

- top `维护 / 模块` tabs;
- module rail inside the module page;
- narrower panel width.

If more layout variants are needed later, they should be added as small declarative UISugar slots rather than direct renderer rewrites.
