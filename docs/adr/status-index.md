# DCF ADR canonical status index

Updated: 2026-07-20

## Current

- `2026-07-20-dcf-managed-web-surface-runtime.md` — **accepted direction; BrowserOS-first substrate spike and bootstrap acceptance pending**; the first managed web runtime is a real user-facing agent-adapted Chromium work browser, with BrowserOS as the lead substrate candidate and stock Chrome/Chromium as fallback, while durable scheduling, permissions, recovery and evidence remain in DCF Core rather than page JavaScript
- `2026-07-20-dcf-dialogue-control-and-delivery-survivability.md` — **accepted architecture; implementation and live acceptance pending under Issue #54**; execution, control and delivery are separate survivability planes, normal transport waits are not failures, and the user must never become the control or evidence relay
- `2026-07-19-dcf-local-agent-model-persistence.md` — **accepted; implementation and GitHub Action verification complete; live browser acceptance pending**; one persisted provider/model selection governs workbench, continued-session and dialogue delegation paths
- `2026-07-19-dcf-dialogue-compact-result-boundary.md` — **accepted; implementation and GitHub Action verification complete; live browser acceptance pending**; final, all-session reasoning-review and bounded diagnostic profiles replace raw message-history return
- `2026-07-19-dcf-dialogue-activity-timeout-permission-delegation.md` — **accepted; real-browser acceptance passed**; observable-idle timeout replaced total wall-clock timeout, permission waits pause inactivity, and a conversation-issued `once` decision returned to the same OpenCode session which completed with one final result
- `2026-07-19-dcf-runtime-evidence-and-opencode-version-parity.md` — **accepted; live recovery and minimal dialogue acceptance passed**; runtime failures are diagnosed through selectable browser/extension/OpenCode evidence surfaces, and the future service launcher must verify the independently maintained standalone CLI before DCF uses it
- `2026-07-18-dcf-local-agent-failure-evidence.md` — **accepted; implementation present, original automatic-report acceptance not exercised**; diagnostics `.1` started successfully but no report was generated because the persisted recent-session pointer was absent; later evidence also showed that absence from `/session/status` must remain a neutral fact until combined with stronger failure evidence
- `2026-07-18-dcf-one-click-runtime-acceptance.md` — **accepted; live acceptance passed**; plugin-owned one-click runtime evidence, persisted clear verification and automatic report return replace manual maintenance checklists
- `2026-07-18-dcf-dialogue-shadow-status-semantics.md` — **accepted; live acceptance passed through `.8` aggregate report**; dialogue remount discovers the Local Agent panel inside Shell Shadow DOM and normalizes OpenCode status semantics
- `2026-07-18-dcf-dialogue-event-stream-hot-refresh.md` — **accepted; actual new-event intake and automatic return passed**; existing assistant replies are an inert baseline and only post-start assistant events are consumed
- `2026-07-18-dcf-local-agent-dialogue-loop.md` — **accepted for basic request/session/result handoff; long-task control and return-path survivability remain open under the 2026-07-20 ADR**; minimal read-only execution completed with `DCF_READ_ONLY_SMOKE_OK`
- `2026-07-18-dcf-workspace-tab-memory.md` — **accepted; live acceptance passed**; pinned and active workspace tabs survive plugin updates
- `2026-07-17-dcf-workspace-tabs-and-ammo-selection.md` — **accepted; live use established**
- `2026-07-17-dcf-chrome-local-agent-bridge-plan.md` — **accepted as pure plugin implementation; successful read-only execution passed, service shortcut pending**
- `2026-07-17-dcf-chrome-pure-base-personal-plugins.md` — **accepted for `1.0.0-rc.2`; pending final product acceptance**; pure Chrome base, independent personal plugins, GitHub plugin updates, non-public Chrome Web Store base updates, DCF Next/rc.1 continuity and low-friction default complete product
- `2026-07-14-dcf-stateful-command-feedback.md` — **retained product-semantic guidance**
- `2026-07-14-dcf-conversation-turn-attribution.md` — **implemented as an independent Chrome plugin**
- `2026-07-14-dcf-conversation-performance-governor.md` — **implemented as an independent Chrome plugin**
- `2026-07-14-dcf-ammo-invocation-update-protocol.md` — **retained in the independent ammo plugin**

## Superseded or historical

- `2026-07-17-dcf-chrome-native-dynamic-host.md` — **superseded by rc.2 product/base separation**; exact code-store and snapshot model retained
- DCF Next before Core Review — **product semantic baseline**, not current runtime architecture
- Next Core, Core Review and compiled minimal/standard/complete snapshots — **rejected failed Tampermonkey routes**
- `0.18.2` implementation ADRs — **historical only**; their valuable data was already absorbed by DCF Next and they do not define current migration
- earlier bootloader/chunk/local-engine/CSP mitigations — **historical rejected routes**