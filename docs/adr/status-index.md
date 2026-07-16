# DCF ADR canonical status index

Updated: 2026-07-16

The status in this file is authoritative. A status line inside an older ADR records its status when written and is historical after a later ADR supersedes it.

## Current rewrite target

- `2026-07-15-dcf-direct-rewrite-survival-box.md` — **accepted**; the new implementation is built independently as a minimal survival box plus ordinary trusted plugins. It supersedes the old platform architecture as the target for `src-next/`, while 0.18.2 remains the stable legacy release until cutover.
- `2026-07-15-dcf-complete-first-pass-before-browser-acceptance.md` — **accepted**; complete the coherent first version before one unified browser acceptance pass. Browser acceptance remains required before formal cutover but is not an interim development gate.
- `2026-07-15-dcf-portable-language-ammo-library.md` — **accepted**; language ammo is a platform-neutral portable library stored at a fixed GitHub data path. DCF exports and explicitly loads it, while an authorized AI performs uploads without placing GitHub credentials in the userscript.
- `2026-07-16-dcf-action-generated-artifact-publication.md` — **accepted**; business source and tests are authored explicitly, while GitHub Action performs deterministic build, verification and publication of only the approved userscript/meta generated artifacts. Action is neither a business-code editor nor an architecture judge.

## Current legacy release facts

The following decisions remain accepted only as descriptions and maintenance constraints of the formal 0.18.2 line. They do not constrain the architecture of `src-next/` unless the rewrite explicitly retains their product or safety outcome.

- `2026-07-14-dcf-stateful-command-feedback.md` — **accepted for 0.18.2**
- `2026-07-14-dcf-bootstrap-package-auto-sync.md` — **accepted for 0.18.2**
- `2026-07-14-dcf-conversation-turn-attribution.md` — **accepted for 0.18.2**
- `2026-07-14-dcf-runtime-performance-attribution.md` — **accepted for 0.18.2**
- `2026-07-14-dcf-conversation-performance-governor.md` — **accepted for 0.18.2**
- `2026-07-14-dcf-canonical-module-supersession.md` — **accepted for 0.18.2**
- `2026-07-14-dcf-ammo-invocation-update-protocol.md` — **product protocol retained; old package/policy implementation is legacy**
- `2026-07-13-dcf-conversation-environment-architecture.md` — **superseded for the rewrite; accepted only as 0.18.2 architecture**
- `2026-07-13-dcf-unified-capability-reconciliation.md` — **superseded for the rewrite; accepted only as 0.18.2 architecture**
- `2026-07-13-dcf-runtime-health-and-folding.md` — **accepted for 0.18.2; rewrite retains only evidence/privacy outcomes where useful**
- `2026-07-12-dcf-phase-one-whole-project-rebuild.md` — **superseded as the current implementation route by the direct rewrite**
- `2026-07-12-dcf-shell-geometry-source-of-truth.md` — **accepted for 0.18.2; rewrite may reuse the viewport outcome without inheriting the old state model**
- viewport-containment-fence ADR — **accepted safety outcome**

## Proposed

- `2026-07-14-dcf-compliance-as-generated-projection.md` — **proposed**; automation performs mechanical maintenance and exposes evidence, while format conformity is never treated as proof that the implementation route or architecture is correct
- `2026-07-14-dcf-architecture-complexity-budget.md` — **absorbed by the direct rewrite decision**; its simplification diagnosis remains valid
- `2026-07-14-dcf-cross-platform-memory-system.md` — **proposed**; the broader memory system remains unaccepted. Its first narrow validation is now the accepted portable language-ammo library, without promoting the full memory architecture.

## Superseded or partially superseded

- `2026-07-13-dcf-package-module-function-role-separation.md` — **superseded for the rewrite**; package/runtime/daily/maintenance separation remains only as legacy 0.18.2 behavior
- `2026-07-13-dcf-module-visibility-observability.md` — **superseded**
- `2026-07-12-dcf-storage-backend-bridge-and-health-report.md` — **partially superseded**; old-data preservation remains, the old unified state/health structure does not
- `2026-07-09-dcf-release-structure.md` — complete userscript release retained; the rewrite has an independent build and review artifact
- `2026-07-09-dcf-sidebar-ui.md` — persistent low-friction visible surface retained as a product outcome, not as a fixed projection architecture
- `2026-07-09-dcf-ammo-daily-use-and-hot-update.md` — value requirements retained; implementation is rewritten as an ordinary plugin
- `2026-07-09-dcf-kernel-only-maintenance-wrapper.md` — superseded by the smaller survival-box boundary
- `2026-07-09-dcf-light-capability-bus-kernel.md` — superseded for the rewrite
- `2026-07-09-dcf-command-dispatch-diagnostics-0.8.7.md` — superseded for the rewrite
- `2026-07-09-dcf-uisugar-content-hot-update-0.8.8.md` — superseded for the rewrite
- `2026-07-11-dcf-command-evidence-chain.md` — privacy, non-interference and delivery truth retained; the parallel command architecture is not
- `2026-07-12-dcf-deterministic-package-source-model.md` — deterministic complete-userscript build retained; the single-root package model is legacy

## Superseded implementation decisions

- `2026-07-09-dcf-ingestion-guard-0.8.6.md` — current-reply bounded intake outcome is reused inside the ChatGPT plugin; old page-block guard/ledger remains superseded
- SideRail and ModuleRail layout ADRs — superseded
- earlier bootloader/chunk/local-engine mitigations in the release-structure history — superseded; the rewrite uses one deterministic review userscript and a minimal built-in module table