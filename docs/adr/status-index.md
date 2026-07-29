# DCF ADR canonical status index

Updated: 2026-07-30

## Current

- `2026-07-30-dcf-web-capture-target-adapter.md` — **accepted; 采集能力从 spec 过渡形态归位至 G1 Target Adapter 终态**；web-capture 移入 `seed/adapters/chrome/web-capture/`，消息类型统一为 `dcf.observation`，manifest 扩展 8 站，`build-g1-adapter.js` 生成零依赖 bundle；8 站 BrowserClaw 真实验收（Wave 1.6）pending
- `../vision/2026-07-26-dcf-from-zero-vision-adr.md` — **current evolving vision**; defines the authorized-life-material boundary, user ownership, DCF-owned visible Surface, cross-AI continuity and long-term value direction without inheriting old implementation structure
- `2026-07-26-dcf-minimal-live-loop-growth-blueprint.md` — **accepted and executable**; P0 preserves and normalizes the old world, then `seed/` grows strictly from G1 “authorize—recover—save—review” through G7, with Companion as the only persistent core, DCF Surface owned by DCF, and target adapters kept silent and non-authoritative
- `2026-07-21-dcf-control-plane-desired-observed-committed-reconcile.md` — **accepted for the retained rc.3 old-world control plane; fact-ownership method retained, universal business state machine rejected for seed**; CodeUnit identity is content-addressed inside that old implementation, Current/LKG commit after Canary loaded proof, Stable requires explicit behavior acceptance, and page migration cannot roll back Current
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

- `2026-07-26-dcf-vision-reweaving.md` — **historical exploration superseded by the from-zero vision ADR and executable growth blueprint**; retained as lineage, not implementation authority
- the v2 `snapshots.candidate → all open pages unit.started → current/LKG` activation flow — **superseded by Desired/Observed/Committed/Reconcile**
- `2026-07-17-dcf-chrome-native-dynamic-host.md` — **superseded product boundary; content-addressed storage and exact snapshot evidence retained**
- DCF Next before Core Review — **product semantic baseline**, not current runtime architecture
- Next Core, Core Review and compiled minimal/standard/complete snapshots — **rejected Tampermonkey routes**
- `0.18.2` implementation ADRs — **historical only**
- earlier bootloader/chunk/local-engine/CSP mitigations — **historical rejected routes**
