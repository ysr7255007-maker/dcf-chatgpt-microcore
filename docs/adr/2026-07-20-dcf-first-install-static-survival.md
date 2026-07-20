# ADR: First-install truth and static survival in Chromium variants

Date: 2026-07-20  
Status: implementation candidate prepared; CI and BrowserClaw live acceptance pending

## Context

A fresh DCF install was exercised in the `browserclaw` product build from `browseros-ai/BrowserOS`.

The first page refresh showed DCF correctly. The user then installed the GitHub plugin set. The function manager displayed the downloaded plugins as disabled and its enable buttons appeared ineffective. After checking the base update and copying a diagnostic package, a later page refresh showed no DCF surface at all.

The diagnostic generated immediately before the disappearance established these facts:

- `chrome.userScripts` was available;
- all eleven plugins were stored as enabled;
- candidate startup evidence completed and committed the same snapshot to current and last-known-good;
- all eleven dynamic scripts were registered;
- no startup, unit or registration failure was recorded.

The package therefore proves that the disabled display was false and that the final disappearance occurred after the captured healthy state. It cannot prove which BrowserClaw or extension lifecycle transition removed or bypassed the later injection.

Source inspection found two DCF defects independent of that unresolved host detail.

First, the function manager rendered only current or last-known-good. During initial candidate validation both are intentionally absent, so every candidate plugin was falsely shown as disabled. Its buttons then called `host.set_unit_enabled`, whose edit base also excludes candidate and correctly returned `no_snapshot_to_edit`; the manager did not surface that error.

Second, the only manifest-declared page script was a migration bridge. Dynamic plugins could be repaired from installation, browser-startup or recovery-page actions, but the page itself had no static survival path when a Chromium variant refreshed without injecting the registered user scripts.

## Decision

1. Candidate is a real startup state, not an empty or disabled state.
2. The function manager reads candidate before current and last-known-good while validation is active.
3. Candidate entries display `验证中` with their actual enabled value.
4. Mutation and update controls remain disabled until candidate startup evidence commits or rolls back.
5. Function-manager actions catch and display host errors instead of leaving an apparently inert button.
6. The manifest-declared migration bridge also becomes the minimal page survival bridge.
7. When the static bridge cannot see the DCF shell, it asks the host to reconcile the persisted target snapshot.
8. Because newly registered dynamic scripts do not run retroactively in the already-loaded document, the bridge performs at most one guarded page reload.
9. If the second load still has no DCF shell, a static `DCF 恢复` control remains visible and opens the recovery page.
10. Dynamic registration loss is covered by a lifecycle test that removes all registrations and proves exact reconciliation restores eleven scripts.
11. The base candidate becomes `1.0.0-rc.2.1`; the function manager becomes `.4`.
12. BrowserClaw remains a substrate candidate. This incident is not treated as proof of a BrowserClaw engine defect until post-failure runtime evidence identifies the exact transition.

## Acceptance

CI must pass the complete Chrome verification suite and confirm:

- candidate state is rendered as validation rather than disabled;
- candidate mutation controls are unavailable;
- action failures are user-visible;
- the static bridge contains host activation, one-reload guarding and a recovery fallback;
- exact registration reconciliation restores a fully cleared dynamic script set.

Live BrowserClaw acceptance must then perform one fresh install and one base reload/update path. After each refresh either the full DCF shell appears or the static recovery control appears; silent disappearance is not acceptable.

## Consequences

The pure-base boundary is preserved. Product behavior remains in dynamic plugins, while the static bridge owns only migration and survival. DCF no longer depends on a particular Chromium variant reproducing every Chrome extension lifecycle event before it can recover its own persisted plugin snapshot.
