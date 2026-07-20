# ADR: BrowserClaw first-install truth, bounded plugin toggles and page-level diagnostics

Date: 2026-07-20  
Status: implementation candidate prepared; CI and BrowserClaw live acceptance pending

## Context

A fresh DCF install was exercised in the `browserclaw` product build from `browseros-ai/BrowserOS`.

The first page refresh showed DCF correctly. The user installed the GitHub plugin set. The function manager displayed downloaded plugins as disabled and its enable buttons appeared ineffective. The DCF surface then disappeared. Only after the surface had already disappeared, the user opened the independent emergency/recovery surface and copied a diagnostic package.

That post-failure package still reported:

- `chrome.userScripts` available;
- all eleven plugins stored as enabled;
- current and last-known-good snapshots committed;
- all eleven dynamic scripts present in the browser registration catalogue;
- no registration deviation or recorded startup failure.

The package was therefore a reproduced diagnostic false healthy. It proved only that persisted state and the browser registration catalogue looked healthy. It did not prove that the affected ChatGPT document contained a running DCF Shell.

A second fresh installation reproduced the interactive symptom more precisely. Clicking `启用并添加` for the Appearance plugin left the panel indefinitely at `正在启用 ... 并添加到标签栏`; the badge remained `已停用`.

Source inspection identified the blocking chain:

```text
plugin manager
→ host.set_unit_enabled
→ stage a complete candidate snapshot
→ reconcileTarget
→ armCandidateEvidence
→ execute every enabled plugin in every open ChatGPT tab
→ await every chrome.userScripts.execute call
→ return the original sendMessage response
```

A simple enabled-state mutation was incorrectly treated as a complete code rollout. If any `chrome.userScripts.execute()` call in BrowserClaw never settled, the original UI message never returned. The panel could only remain in its pending text.

This design also had a semantic defect: unregistering a disabled script affects future document injection but does not destroy an already-running instance in the current document.

## Decision

### Separate code rollout from enabled-state configuration

Code version or hash changes continue to use candidate snapshots and startup evidence.

An enabled-state change is a configuration transaction:

1. clone the current or last-known-good snapshot;
2. change one `enabled` field;
3. reconcile only that unit's registration;
4. commit the new snapshot directly to current and last-known-good;
5. leave no candidate snapshot behind;
6. return the committed state to the UI before page activation can block it.

Unchanged plugins are not re-executed and do not need to re-prove startup merely because another plugin was enabled or disabled.

### Bound current-page activation

When a plugin is enabled from a ChatGPT page, the host may execute only that newly enabled unit in the source tab.

The activation has a hard timeout. Success returns `activated`. Timeout, unsupported execution or page mismatch returns `reload_required`; it never leaves the message channel pending indefinitely.

Disabling returns `reload_required`, because a page reload is the reliable generic way to remove the already-running instance without inventing plugin-specific teardown metadata.

The function manager persists the desired pinned-tab state before reloading. After reload, the normal Shell restoration path reopens the intended panel.

The page-side message call also has a UI timeout so any future host regression becomes a visible `host_message_timeout` rather than an endless progress notice.

### Separate registration truth from page truth

The manifest-declared static bridge responds to a bounded `host.page_probe` request with:

- bridge version and page instance;
- document ready state, visibility and focus;
- Shell presence and connection;
- Shell ShadowRoot presence;
- mounted panel count;
- static recovery presence.

The recovery surface probes every relevant open ChatGPT tab. Diagnostics emit:

- `page_shell_missing` when a reachable page lacks the DCF Shell;
- `page_shell_shadow_missing` when the host exists without its ShadowRoot;
- `page_probe_unreachable` when the static bridge cannot be reached.

A diagnostic is `healthy` only when registration and at least one relevant page probe are both healthy. With no page evidence it is `unknown`, never `DCF 正常`.

Historical `unit.started` events remain historical evidence and cannot establish present page liveness.

## Evidence

Every toggle records:

- `unit.toggle.requested`;
- `unit.toggle.committed`;
- `unit.toggle.page_result`.

The final event distinguishes hot activation, reload-required timeout, page mismatch and unavailable execution.

## Acceptance

Automated verification must cover:

- candidate rollout still commits through startup evidence;
- a single enabled-state mutation commits without creating a candidate;
- only the changed registration is added, updated or removed;
- a never-settling `chrome.userScripts.execute()` is bounded and returns `reload_required`;
- the current snapshot already reflects the requested enabled state after that timeout;
- disabling requests a page reload;
- the UI persists desired pin state before a fallback reload;
- a registered-but-missing page Shell produces `page_shell_missing`;
- an unreachable bridge produces `page_probe_unreachable`;
- no-page evidence produces diagnostic health `unknown`;
- the candidate artifact contains the actual installable ZIP.

Live BrowserClaw acceptance must perform one fresh install, enable-and-add Appearance, disable it, refresh the page and copy diagnostics from the independent recovery surface. No operation may remain indefinitely pending. The copied report must describe actual page state.

## Consequences

DCF no longer couples a low-frequency preference change to a complete plugin release transaction.

The exact code candidate mechanism remains strict where code changes, while ordinary enable/disable actions become bounded and immediately observable.

The static base still owns only migration, survival and minimal page truth. Product behavior remains in independent code units.
