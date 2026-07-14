# DCF ADR canonical status index

Updated: 2026-07-14

The status in this file is authoritative. A status line inside an older ADR records its status when written and is historical after a later ADR supersedes it.

## Current

- `2026-07-14-dcf-stateful-command-feedback.md` — **accepted**

- `2026-07-14-dcf-bootstrap-package-auto-sync.md` — **accepted**
- `2026-07-14-dcf-conversation-turn-attribution.md` — **accepted**

- `2026-07-14-dcf-runtime-performance-attribution.md` — **accepted**

- `2026-07-14-dcf-conversation-performance-governor.md` — **accepted**

- `2026-07-14-dcf-canonical-module-supersession.md` — **accepted**

- `2026-07-14-dcf-ammo-invocation-update-protocol.md` — **accepted**
- `2026-07-13-dcf-conversation-environment-architecture.md` — **accepted**
- `2026-07-13-dcf-unified-capability-reconciliation.md` — **accepted**
- `2026-07-13-dcf-runtime-health-and-folding.md` — **accepted**
- `2026-07-12-dcf-phase-one-whole-project-rebuild.md` — **accepted**
- `2026-07-12-dcf-shell-geometry-source-of-truth.md` — **accepted**, retained by phase one
- viewport-containment-fence ADR — **accepted**, retained by phase one

## Proposed

- `2026-07-14-dcf-cross-platform-memory-system.md` — **proposed**; platform-neutral canonical memory store with bounded per-platform projections, pending real multi-platform validation

## Superseded or partially superseded

- `2026-07-13-dcf-package-module-function-role-separation.md` — **partially superseded**; package/runtime/daily/maintenance separation remains, hidden is no longer a role
- `2026-07-13-dcf-module-visibility-observability.md` — **superseded**; modules remain discoverable and UI density is handled by folding
- `2026-07-12-dcf-storage-backend-bridge-and-health-report.md` — **partially superseded**; storage bridge remains, full state-dump health reporting is replaced by Runtime deviation reporting
- `2026-07-09-dcf-release-structure.md` — complete userscript release retained; modular source is now implemented
- `2026-07-09-dcf-sidebar-ui.md` — persistent low-friction sidebar retained; UI is now a projection
- `2026-07-09-dcf-ammo-daily-use-and-hot-update.md` — value requirements retained; implementation replaced by package-owned contextual invocation/update protocol
- `2026-07-09-dcf-kernel-only-maintenance-wrapper.md` — generic-core boundary retained; ammo is explicitly the required first-party product module
- `2026-07-09-dcf-light-capability-bus-kernel.md` — capability bus retained; whole-page ingestion and automatic success feedback removed
- `2026-07-09-dcf-command-dispatch-diagnostics-0.8.7.md` — shared command resolution retained; unified receipts replace separate diagnostic inlets
- `2026-07-09-dcf-uisugar-content-hot-update-0.8.8.md` — declarative UI/content retained through resources and projections
- `2026-07-11-dcf-command-evidence-chain.md` — correlation, privacy, non-interference, and delivery truth retained; transaction/command/effect receipts replace the parallel trace system
- `2026-07-12-dcf-deterministic-package-source-model.md` — immutable revisions and deterministic projection retained inside the single-root transaction model

## Superseded implementation decisions

- `2026-07-09-dcf-ingestion-guard-0.8.6.md` — current-reply artifact decoding and local failure receipts replace page-block guard/seen-ledger behavior
- SideRail and ModuleRail layout ADRs — unified Surface/module-display projection replaces fixed layout implementations
- earlier bootloader/chunk/local-engine mitigations in the release-structure history — complete native userscript release remains the only accepted release architecture
