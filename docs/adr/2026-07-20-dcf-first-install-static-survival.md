# ADR: First-install truth, page truth and static survival in Chromium variants

Date: 2026-07-20  
Status: implementation candidate incomplete; page-level diagnostic truth and BrowserClaw live acceptance pending

## Context

A fresh DCF install was exercised in the `browserclaw` product build from `browseros-ai/BrowserOS`.

The first page refresh showed DCF correctly. The user then installed the GitHub plugin set. The function manager displayed the downloaded plugins as disabled and its enable buttons appeared ineffective. After the DCF surface had disappeared, the user opened the independent emergency/recovery surface and copied a diagnostic package.

The post-failure diagnostic reported:

- `chrome.userScripts` available;
- all eleven plugins stored as enabled;
- candidate startup evidence committed to current and last-known-good;
- all eleven dynamic scripts present in the browser registration table;
- no registration deviation or recorded startup failure.

Those facts do not establish a healthy current page. They establish only that the persisted snapshot and browser registration catalogue looked healthy. The diagnostic did not ask the affected ChatGPT document whether the static bridge was alive, whether the dynamic scripts had executed in that document, whether `dcf-chrome-shell-host` existed, whether its ShadowRoot was attached, or whether any DCF panels were mounted.

The package was therefore a reproduced diagnostic false healthy: the user-visible product had already failed while the diagnostic still declared zero deviations.

Source inspection found three DCF defects.

First, the function manager rendered only current or last-known-good. During initial candidate validation both are intentionally absent, so every candidate plugin was falsely shown as disabled. Its buttons then called `host.set_unit_enabled`, whose edit base also excludes candidate and returned `no_snapshot_to_edit`; the manager did not surface that error.

Second, the only manifest-declared page script was a migration bridge. Dynamic plugins could be repaired from installation, browser-startup or recovery-page actions, but the page itself had no static survival path when a Chromium variant refreshed without executing the registered user scripts.

Third, host diagnostics treated registration as execution. Historical `unit.started` evidence and current `chrome.userScripts.getScripts()` membership were promoted to present-tense health even though neither proves that the affected document currently contains a running DCF surface.

## Decision

1. Candidate is a real startup state, not an empty or disabled state.
2. The function manager reads candidate before current and last-known-good while validation is active.
3. Candidate entries display `验证中` with their actual enabled value.
4. Mutation and update controls remain disabled until candidate startup evidence commits or rolls back.
5. Function-manager actions catch and display host errors instead of leaving an apparently inert button.
6. The manifest-declared migration bridge also becomes the minimal page survival bridge.
7. When the static bridge cannot see the DCF shell, it asks the host to reconcile the persisted target snapshot.
8. Because newly registered dynamic scripts do not run retroactively in an already-loaded document, the bridge performs at most one guarded page reload.
9. If the second load still has no DCF shell, a static `DCF 恢复` control remains visible and opens the recovery page.
10. Dynamic registration loss is covered by a lifecycle test that removes all registrations and proves exact reconciliation restores eleven scripts.
11. Registration health and page health are separate truth planes.
12. A copied diagnostic must probe each relevant open ChatGPT page through the manifest-declared static bridge and report at least: probe reachability, page instance, ready state, visibility, shell presence, shell ShadowRoot presence, mounted panel count and static recovery presence.
13. When an enabled snapshot exists and a relevant page is reachable but lacks the DCF shell, diagnostics must emit an explicit `page_shell_missing` deviation even if all dynamic scripts remain registered.
14. A page that cannot be probed must be reported as `page_probe_unreachable`, not silently omitted.
15. Historical startup evidence remains historical. It cannot by itself establish current page liveness.
16. The first-install display and static survival work may remain in the candidate, but the candidate is not complete until page-level diagnostic truth is implemented and verified.
17. BrowserClaw remains a substrate candidate. This incident is not treated as proof of a BrowserClaw engine defect until page-level runtime evidence identifies the exact transition.

## Acceptance

CI must confirm:

- candidate state is rendered as validation rather than disabled;
- candidate mutation controls are unavailable;
- action failures are user-visible;
- the static bridge contains host activation, one-reload guarding and a recovery fallback;
- exact registration reconciliation restores a fully cleared dynamic script set;
- a synthetic page with registrations present but no Shell produces `page_shell_missing`;
- a page probe timeout produces `page_probe_unreachable`;
- diagnostics never display `DCF 正常` solely because expected and registered script IDs match.

Live BrowserClaw acceptance must reproduce both healthy and failed surfaces. After each refresh either the full DCF shell appears or the static recovery control appears. When the full shell is absent, a diagnostic copied from the independent recovery surface must describe that absence directly; silent disappearance and false healthy are both unacceptable.

## Consequences

The pure-base boundary is preserved. Product behavior remains in dynamic plugins, while the static bridge owns migration, bounded survival and a minimal page-health probe. DCF health becomes a conjunction of persisted snapshot truth, browser registration truth and current-page execution truth rather than a comparison of two catalogues.