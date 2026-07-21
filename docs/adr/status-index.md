# DCF ADR canonical status index

Updated: 2026-07-21

## Current

- `2026-07-21-dcf-control-plane-desired-observed-committed-reconcile.md` — **accepted architecture; Activation Controller and release identity implemented, real-browser acceptance pending**; Desired/Observed/Committed/Reconcile replaces the old all-pages candidate flow, CodeUnit identity is content-addressed, Current/LKG commit after Canary loaded proof, Stable requires explicit behavior acceptance, and page migration cannot roll back Current
- `2026-07-20-dcf-dialogue-control-and-delivery-survivability.md` — **accepted architecture; implementation line frozen pending host durable Artifact phase**; execution, control and delivery remain separate survivability planes, but S6 must no longer be solved through dialogue-only outbox patches
- `2026-07-19-dcf-local-agent-model-persistence.md` — **accepted; implementation and GitHub Action verification complete; live browser acceptance pending**
- `2026-07-19-dcf-dialogue-compact-result-boundary.md` — **accepted; implementation and GitHub Action verification complete; live browser acceptance pending**
- `2026-07-19-dcf-dialogue-activity-timeout-permission-delegation.md` — **accepted; real-browser acceptance passed**
- `2026-07-19-dcf-runtime-evidence-and-opencode-version-parity.md` — **accepted; live recovery and minimal dialogue acceptance passed**
- `2026-07-18-dcf-local-agent-failure-evidence.md` — **accepted; original diagnostics inference requires later correction**
- `2026-07-18-dcf-one-click-runtime-acceptance.md` — **accepted; live acceptance passed**
- `2026-07-18-dcf-dialogue-shadow-status-semantics.md` — **accepted; live acceptance passed**
- `2026-07-18-dcf-dialogue-event-stream-hot-refresh.md` — **accepted; actual new-event intake and automatic return passed**
- `2026-07-18-dcf-local-agent-dialogue-loop.md` — **accepted for basic handoff; durable RESULT delivery deferred to the control-plane Artifact phase**
- `2026-07-18-dcf-workspace-tab-memory.md` — **accepted; live acceptance passed**
- `2026-07-17-dcf-workspace-tabs-and-ammo-selection.md` — **accepted; live use established**
- `2026-07-17-dcf-chrome-local-agent-bridge-plan.md` — **accepted as pure plugin implementation; WorkspaceBinding remains pending**
- `2026-07-17-dcf-chrome-pure-base-personal-plugins.md` — **accepted product boundary; its candidate/current activation mechanism is superseded by the 2026-07-21 control-plane ADR**
- `2026-07-14-dcf-stateful-command-feedback.md` — **retained product-semantic guidance**
- `2026-07-14-dcf-conversation-turn-attribution.md` — **implemented as an independent Chrome plugin**
- `2026-07-14-dcf-conversation-performance-governor.md` — **implemented as an independent Chrome plugin**
- `2026-07-14-dcf-ammo-invocation-update-protocol.md` — **retained in the independent ammo plugin**

## Superseded or historical

- the v2 `snapshots.candidate → all open pages unit.started → current/LKG` activation flow — **superseded by Desired/Observed/Committed/Reconcile**
- `2026-07-17-dcf-chrome-native-dynamic-host.md` — **superseded product boundary; content-addressed storage and exact snapshot evidence retained**
- DCF Next before Core Review — **product semantic baseline**, not current runtime architecture
- Next Core, Core Review and compiled minimal/standard/complete snapshots — **rejected Tampermonkey routes**
- `0.18.2` implementation ADRs — **historical only**
- earlier bootloader/chunk/local-engine/CSP mitigations — **historical rejected routes**
