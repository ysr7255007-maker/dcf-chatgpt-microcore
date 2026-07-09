# ADR: DCF language ammunition daily use and module hot update

Date: 2026-07-09
Status: accepted

## Context

After the embedded sidebar UI decision, the next requirement belongs to the language ammunition module itself rather than to the shell layout.

The user's daily use of DCF should revolve around language ammunition. The high-frequency path should not be a maintenance dashboard; it should let the user generate, update, and fire ammunition with minimal interruption.

The user also wants module-level hot update through the DCF wrapper. This must be interpreted as hot update of module data, ammunition packs, configuration, and registry state. It must not reintroduce runtime remote JavaScript execution, localStorage-as-code, bootloaders, or eval-like behavior.

## Decision

The language ammunition module should provide three first-class daily actions:

1. Generate ammunition: the user triggers a structured prompt that asks the current model to extract reusable language ammunition from the current conversation and output it in a `DCF_AMMO` block.
2. Update ammunition: the user selects an existing ammunition item, supplies or relies on an update requirement, and DCF sends a structured prompt containing the original ammunition, the update requirement, and the current conversation context expectation. The model, including Grok or the current chat model, fuses new material into an updated `DCF_AMMO` block.
3. Send ammunition: the user clicks a saved ammunition item to insert it into the composer, with an explicit insert-and-send path and an optional auto-send toggle.

Generated or updated ammunition should be shown back in the main ammunition view by scanning `DCF_AMMO` blocks and allowing the user to save them into the local ammunition store.

Module hot update should be supported as data hot update:

- an ammo pack JSON can be applied at runtime;
- the ammo module registry and local ammo store update immediately;
- the UI rerenders without page reload;
- a self-test hot update pack can insert a diagnostic ammunition item named `dcf.hot_update_probe.v1`;
- no remote code is executed.

## Consequences

The primary DCF daily workflow becomes shorter:

- generate ammunition from a valuable conversation;
- save the generated `DCF_AMMO` item;
- later select, update, insert, or insert-and-send it directly.

Hot update becomes a safe plugin/data mechanism rather than a code-loading mechanism. This keeps DCF aligned with the native userscript release architecture while still allowing the language ammunition module to evolve during use.

## Implementation target

Release `0.8.3` should implement:

- local ammunition store `dcf.ammo.store.v1`;
- module registry `dcf.module.registry.v1`;
- `DCF_AMMO` block scanning and saving;
- generate, update, insert, insert-and-send, copy, select, and auto-send actions;
- a module manager action for ammo pack JSON hot update;
- a hot-update self-test that adds a visible diagnostic ammunition item without refreshing the page;
- continued prohibition of remote code execution, eval, runtime chunk loading, and localStorage-as-code.
