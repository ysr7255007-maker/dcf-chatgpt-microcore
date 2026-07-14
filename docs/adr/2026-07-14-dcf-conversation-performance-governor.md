# ADR: Conversation performance governor

Date: 2026-07-14  
Status: accepted

## Context

Long ChatGPT conversations can become browser-bound: many rich message turns remain mounted, increasing layout, paint and interaction work. Community scripts converge on two mitigations: `content-visibility` for off-screen rendering and stronger virtualization that replaces old message nodes with placeholders and restores them in batches. Users also commonly split work into new chats, which helps context and total-chat limits but sacrifices local continuity and does not directly repair the current page.

## Decision

- Add required package `dcf.standard.conversation-performance@1.0.0` and a trusted Host controller.
- Default to `safe` mode after 24 top-level message turns, using `content-visibility:auto` and intrinsic-size reservation.
- Offer explicit window presets retaining the newest 40 or 20 turns. Older turns remain in their original DOM positions and React ownership; DCF changes only reversible inline style properties.
- Never use `replaceWith`, `remove`, `removeChild`, `innerHTML`, cloned messages or stored message bodies.
- Pause window reconciliation while ChatGPT is streaming.
- Reveal history in batches manually or when the user scrolls near the top; preserve viewport position.
- Persist only policy preferences through Environment Reconciler. Runtime counters and revealed-batch state are disposable.
- Expose a privacy-safe performance report and include its summary in Runtime health.

## Rejected

- Removing/replacing ChatGPT message nodes with placeholders: stronger DOM reduction but violates Host ownership and risks React reconciliation failure.
- Automatically hiding old turns by default: performance benefit is plausible, but find-in-page and history visibility change; therefore window mode remains explicit.
- Claiming to solve model context or backend latency: these are outside the browser rendering boundary.

## Reconsideration

More aggressive virtualization may be reconsidered only if ChatGPT exposes a stable supported turn API, or controlled browser evidence proves a safe detach/restore contract across navigation, streaming, editing, retry, branching and attachment cases.
