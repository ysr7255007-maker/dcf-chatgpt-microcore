# DCF ADR canonical status index

Updated: 2026-07-17

The status here is authoritative. Older ADR status lines are historical after supersession.

## Current

- `2026-07-17-dcf-chrome-native-dynamic-host.md` — **accepted for candidate implementation; pending product acceptance**; one Chrome extension, controlled code units, exact startup snapshots, static survival core, automatic old-side-rail migration and LKG rollback
- `2026-07-14-dcf-stateful-command-feedback.md` — **retained product-semantic guidance**
- `2026-07-14-dcf-conversation-turn-attribution.md` — **retained as optional future code-unit capability**, not candidate completion scope
- `2026-07-14-dcf-conversation-performance-governor.md` — **retained as optional future code-unit capability**, not candidate completion scope
- `2026-07-14-dcf-canonical-module-supersession.md` — **retained conceptually**; exact-ID replacement is now expressed through code-unit versions and snapshots
- `2026-07-14-dcf-ammo-invocation-update-protocol.md` — **accepted and implemented in the Chrome ammo unit**

## Proposed

- `2026-07-14-dcf-compliance-as-generated-projection.md` — **proposed**; automation performs mechanical maintenance and exposes evidence, while format conformity is never proof of architectural correctness
- `2026-07-14-dcf-architecture-complexity-budget.md` — **proposed, strengthened by Chrome rebuild**; reject platform layers without marginal value
- `2026-07-14-dcf-cross-platform-memory-system.md` — **proposed**; platform-neutral canonical memory remains future work

## Superseded or partially superseded

- `2026-07-13-dcf-conversation-environment-architecture.md` — **partially superseded**; one authoritative desired state remains, but old resource/package projection is not the new browser execution model
- `2026-07-13-dcf-unified-capability-reconciliation.md` — **superseded in implementation** by code-unit store plus exact snapshots; unified lifecycle principle retained
- `2026-07-13-dcf-runtime-health-and-folding.md` — **partially superseded**; privacy-bounded actual-runtime diff retained, old Tampermonkey UI facts are historical
- `2026-07-12-dcf-phase-one-whole-project-rebuild.md` — **superseded as current host implementation**; product semantics and bounded host intake retained
- `2026-07-12-dcf-storage-backend-bridge-and-health-report.md` — **superseded for future storage**; old localStorage/GM migration evidence remains historical
- `2026-07-12-dcf-deterministic-package-source-model.md` — **superseded by controlled code-unit manifests and SHA-256**, immutable deterministic source principle retained
- `2026-07-09-dcf-release-structure.md` — **superseded**; complete userscript is fallback, Chrome extension is the candidate installation
- `2026-07-09-dcf-ammo-daily-use-and-hot-update.md` — **value requirements retained**, implementation replaced
- earlier bootloader/chunk/local-engine/CSP mitigations — **historical rejected routes**

## Historical fallback

All Tampermonkey `0.18.2` implementation ADRs remain available as evidence and rollback context but do not override the Chrome native host ADR.
