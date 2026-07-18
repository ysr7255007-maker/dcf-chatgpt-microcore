# ADR: One-click runtime acceptance and automatic evidence return

Date: 2026-07-18  
Status: accepted; live acceptance pending

## Context

The dialogue adapter exposed a visible card after a hot update, but its controls did not respond. The event binder stored its binding marker on a `ShadowRoot.dataset`; `ShadowRoot` has no `dataset`, so rendering succeeded while event registration failed.

The same acceptance round also exposed a product-level problem. The user was asked to verify several observable conditions one by one: hot remount, historical-message inactivity, button wording, clear behavior and pinned workspace preservation. These facts are already available to DCF runtime code. Turning them into a manual checklist transfers internal maintenance work and cognitive load back to the user.

## Decision

1. The dialogue adapter binds controls by comparing the actual `ShadowRoot` identity with an internal `boundMountRoot` reference. It does not attach metadata to `ShadowRoot`.
2. The adapter provides one primary action, `一键验收并回传`.
3. One invocation performs the acceptance operations that the plugin can safely observe, including clearing deduplication and recent-handoff state, rereading persisted plugin data, waiting for unintended replay, checking mount and event binding, checking status semantics and reading current Shell workspace tabs.
4. It emits one privacy-bounded `dcf.local-agent-dialogue.acceptance.v1` report between exact markers and automatically returns it to the current conversation, even when ordinary task-result auto-send is disabled.
5. The report includes versions and hash prefixes, bounded counters and pass/fail checks. It excludes message text, prompts, credentials, complete URLs and complete plugin payloads.
6. Runtime acceptance automation remains inside the owning plugin. The Manifest, background, Host API and static base remain unchanged.
7. DCF maintenance should not ask the user to manually transcribe or separately confirm facts that the running product can observe and report. The user remains responsible only for irreducibly experiential judgments or external effects that DCF cannot observe reliably.

## Consequences

- a rendered-but-unbound card can no longer pass startup acceptance;
- the clear action has direct persisted-state evidence;
- historical replay, workspace preservation and status semantics arrive in one machine-readable artifact;
- browser acceptance becomes one deliberate user action rather than a maintenance checklist;
- the report itself does not prove the subsequent OpenCode task loop, which still requires a fresh request and returned result artifact.

## Acceptance

After updating the dialogue plugin, the user clicks `一键验收并回传` once. The same conversation receives one complete acceptance artifact. Any failed check must identify the observed boundary without requiring the user to reproduce the checklist manually.
