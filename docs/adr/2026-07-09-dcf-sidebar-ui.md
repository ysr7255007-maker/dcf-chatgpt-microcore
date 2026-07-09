# ADR: DCF embedded sidebar main view

Date: 2026-07-09
Status: accepted

## Context

The previous `0.8.1` recovery release used a small floating DCF button that opened a dialog panel. That shape proved the native single-file userscript path was viable, but it did not match the intended DCF interaction model.

DCF is meant to reduce friction and help the user stay in flow. A small launcher that must be clicked before every use adds an avoidable step. ChatGPT web pages commonly leave long vertical blank space on the left or right side, which is a better place for a persistent tool surface.

The first-class product object is language ammunition. The main view should therefore expose usable ammunition and capabilities directly instead of hiding them behind a generic maintenance panel.

## Decision

DCF should move from a floating launcher button to an embedded side toolbar / side panel.

The main view should be organized as functional blocks:

- the language ammunition block is expanded by default;
- other blocks are collapsed by default;
- clicking a block makes it the primary expanded block;
- the interface should usually keep only one main block expanded at a time;
- each block should contain directly usable actions rather than only diagnostic text.

Module management should be a prominent button in the side panel header. It opens a lightweight operation surface for installing, updating, loading, or resetting modules. This is a supply-chain and plugin-management surface, not the primary user workflow.

Maintenance should be separated from the main view through a tab. Maintenance is for module-level and system-level operations such as scanning, diagnostics, cache cleanup, version checks, and future module maintenance. It should not crowd the main ammunition firing view.

## Consequences

The default DCF experience becomes persistent and immediately usable. The user can stay in the ChatGPT page and fire language ammunition without first opening a modal launcher.

The visible product model becomes closer to the real project intent: DCF is a low-friction language ammunition firing system, not a generic script status window.

This decision does not change the release architecture. The published runtime remains a complete native Tampermonkey `.user.js`, with no remote code execution.

## Current implementation target

Release `0.8.2` should implement the first embedded sidebar UI:

- fixed side panel anchored to the page side blank area;
- main / maintenance tabs;
- language ammunition block expanded by default;
- module manager button and lightweight modal;
- action buttons for consensus prompt, maintenance prompt, summary copying, scanning, and legacy cleanup;
- no runtime remote engine loading, no eval, no chunk manifest.
