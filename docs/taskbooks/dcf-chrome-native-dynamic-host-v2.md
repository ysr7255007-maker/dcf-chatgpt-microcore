# DCF Chrome 原生动态宿主直接重构任务书 v2 — canonical execution record

This record binds the 2026-07-17 rebuild to the user-approved task book.

The non-negotiable outcome is one lightweight Google Chrome extension that preserves or improves the language-ammunition loop without a local runtime. The engineering substrate must provide independently stored and versioned executable code units, exact startup snapshots, candidate activation, startup evidence, last-known-good rollback, extension-update reconstruction, static recovery, old data continuity, deterministic CI and one user acceptance.

Rejected routes remain rejected: dynamic `new Function`, page/Blob/Data-URL CSP bypasses, fixed minimal/standard/complete bundles, one extension rebuild per plugin update, multiple user scripts, build-time-only plugin combinations, local daemons, browser-general platforms, custom npm registries and repeated user testing.

The implementation is governed by the full task book supplied in the initiating conversation. The canonical architectural consequences are recorded in `docs/adr/2026-07-17-dcf-chrome-native-dynamic-host.md`; current implementation truth is in `docs/current-state.md`.
