# ADR: DCF correlated command evidence chain

Date: 2026-07-11
Status: accepted

## Context

An installed `dcf.shell_adjuster` displayed the expected controls, but width, height, and bottom anchoring still appeared ineffective. The first repair changed the module definition based on symptoms. When the same behavior remained, the missing capability was initially described as merely a missing recent-event log.

Auditing the complete path showed a larger blind spot. A flat event ring cannot by itself prove what happened between a click and a visible result. The first `0.9.11` restoration also reused an old cross-tab localStorage log, had no per-click correlation identity, recorded only post-call appearance, could leak generic command text, allowed visible maintenance markers to trigger automatic export, did not prove feedback delivery, and could let trace-storage failure interfere with the real command.

## Decision

DCF command diagnosis uses a correlated command trace rather than an unstructured event stream.

Each click creates one `dcf.command_trace.v2` record with a unique `trace_id`. The trace binds together:

1. click target and page-local boot identity;
2. module id, version when present, module fingerprint, block, command, and label;
3. ordered capability steps with privacy-filtered inputs and results;
4. capability-specific observations before and after mutation;
5. registry memory state, persisted registry state, recovery snapshot, inline variables, computed style, geometry, and matching CSS rules for appearance calls;
6. an explicit effect classification such as `state_and_render_changed`, `state_changed_but_render_overridden`, `render_changed_without_registry_change`, or `no_observed_change`;
7. command outcome and duration.

The trace store is scoped to the current browser tab and current kernel boot through sessionStorage. It does not reuse the old `dcf.kernel.log.v1` localStorage stream. This prevents stale-version and cross-tab evidence from being mixed.

Tracing is observational. Trace serialization or storage failure must never block the command. When sessionStorage is unavailable or full, traces fall back to a bounded in-memory store and diagnostics expose the degraded storage state.

Trace payloads are privacy-filtered. Appearance parameters and structural identifiers remain visible; conversational text, prompts, bodies, content, tokens, secrets, authorization data, cookies, passwords, templates, and registry snapshots are redacted or summarized before storage or transmission.

Maintenance export is consent-gated. A visible `DCF_MAINT_REQUEST` may become pending, but it cannot transmit evidence until the user locally arms one maintenance response. The authorization is scoped to the current tab and current kernel boot, lasts at most five minutes, and is consumed by the first valid request. Maintenance actions are restricted to an allowlist of command traces, runtime appearance, shell-adjuster summary, diagnostics, and transport history.

Feedback transport records whether evidence was delivered, copied because a draft was present, copied because the composer was missing, or copied after send failure. A generated response is not treated as delivered evidence.

## Evidence-chain invariants

- Every command click has one unique trace identity.
- Concurrent or rapid clicks cannot merge their steps.
- Module resolution is proven before capability execution.
- Mutating capabilities record state before, memory state after, persisted state after, and observable result after rendering.
- Appearance diagnosis includes CSS rule provenance, not only computed values.
- No diagnostic write failure may change command behavior.
- No sensitive conversational payload is persisted or exported by default.
- No page-visible maintenance marker can export evidence without local user consent.
- No feedback is called delivered until the send path reports success.
- Old, other-tab, or other-boot events are not mixed into the current trace.

## Consequences

Release `0.9.12` supersedes `0.9.11` as the command-diagnosis release. `0.9.11` remains part of history as the first restoration attempt, but its flat local log is not the accepted evidence model.

Future capability families may add their own before/after observers. The current concrete observer covers appearance because that is the active failure. The correlation, isolation, privacy, consent, non-interference, and delivery invariants apply to all future observers.

## Verification

The integration harness must prove at least:

- unique correlation across multiple clicks;
- module identity and capability ordering;
- appearance before/after and persisted-state evidence;
- detection of registry change hidden by an overriding CSS rule;
- sensitive command text redaction;
- no maintenance transmission before local consent;
- rejection of maintenance actions outside the diagnostic allowlist;
- exactly one response after consent and no replay;
- delivery-state recording;
- successful real command execution when trace persistence is forced to fail.

The repeatable harness is stored at `tests/dcf-evidence-chain.integration.test.js` and runs through `npm test`. A release must not rely only on a one-time sandbox test or a prose claim that tracing works.

## Reconsideration condition

The trace may move to a different storage or rendering format if the current tab-scoped ring becomes insufficient, but only if the replacement preserves correlation, source identity, before/after observation, privacy filtering, explicit consent, non-interference, and delivery proof.
