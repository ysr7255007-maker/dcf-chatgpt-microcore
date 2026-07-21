# DCF ADR canonical status index

Updated: 2026-07-21

## Current

- `2026-07-21-dcf-control-plane-reconciliation.md` — **accepted for rc.3; implementation candidate complete, GitHub and real-browser acceptance pending**; Desired/Observed/Committed/Reconcile, content-addressed CodeUnit, dedicated Canary, layered runtime states, explicit Stable and post-commit page migration replace the old history-dependent activation flow
- `2026-07-20-dcf-dialogue-control-and-delivery-survivability.md` — **accepted architecture; dialogue implementation remains frozen pending host-durable Artifact work**; execution, control and delivery are separate survivability planes
- `2026-07-19-dcf-local-agent-model-persistence.md` — **accepted; implementation and GitHub verification complete; final live acceptance pending**
- `2026-07-19-dcf-dialogue-compact-result-boundary.md` — **accepted; implementation and GitHub verification complete; final live acceptance pending**
- `2026-07-19-dcf-dialogue-activity-timeout-permission-delegation.md` — **accepted; real-browser acceptance passed**
- `2026-07-19-dcf-runtime-evidence-and-opencode-version-parity.md` — **accepted; live recovery and minimal dialogue acceptance passed**
- `2026-07-18-dcf-local-agent-failure-evidence.md` — **accepted; original automatic-report acceptance not exercised; terminal inference still requires neutral evidence handling**
- `2026-07-18-dcf-one-click-runtime-acceptance.md` — **accepted; live acceptance passed**
- `2026-07-18-dcf-dialogue-shadow-status-semantics.md` — **accepted; live acceptance passed**
- `2026-07-18-dcf-dialogue-event-stream-hot-refresh.md` — **accepted; live acceptance passed**
- `2026-07-18-dcf-local-agent-dialogue-loop.md` — **accepted for basic handoff; durable return path remains open under the control-plane sequence**
- `2026-07-18-dcf-workspace-tab-memory.md` — **accepted; live acceptance passed**
- `2026-07-17-dcf-workspace-tabs-and-ammo-selection.md` — **accepted; live use established**
- `2026-07-17-dcf-chrome-local-agent-bridge-plan.md` — **accepted as pure plugin implementation; WorkspaceBinding replacement pending**
- `2026-07-17-dcf-chrome-pure-base-personal-plugins.md` — **accepted product boundary; activation mechanics superseded by the 2026-07-21 control-plane ADR**
- `2026-07-14-dcf-stateful-command-feedback.md` — **retained product-semantic guidance**
- `2026-07-14-dcf-conversation-turn-attribution.md` — **implemented as an independent Chrome plugin**
- `2026-07-14-dcf-conversation-performance-governor.md` — **implemented as an independent Chrome plugin**
- `2026-07-14-dcf-ammo-invocation-update-protocol.md` — **retained in the independent ammo plugin**

## Superseded or historical

- `2026-07-17-dcf-chrome-native-dynamic-host.md` — **superseded**; content store and exact Snapshot concepts retained, old candidate/page-coupled activation replaced
- DCF Next before Core Review — **product semantic baseline**, not current runtime architecture
- Next Core, Core Review and compiled minimal/standard/complete snapshots — **rejected failed Tampermonkey routes**
- `0.18.2` implementation ADRs — **historical only**
- earlier bootloader/chunk/local-engine/CSP mitigations — **historical rejected routes**
