# ADR: Bootstrap DCF through a BrowserClaw-derived managed Chromium runtime

Date: 2026-07-20  
Status: accepted direction; BrowserClaw remains a conditional substrate candidate pending background-runtime acceptance

## Context

The first DCF web adapter runs inside a normal Chromium tab through an extension and dynamically registered scripts. It proved the product semantics, but the browser remains free to throttle timers, background renderer processes, freeze or discard hidden pages, and terminate extension workers.

Changing from Google Chrome to another Chromium build has little architectural value if those policies remain unchanged. DCF requires more than a real profile and an MCP endpoint. When the user moves to another tab, window or application, the durable task must continue and the managed web surface must remain observable and recoverable. Critical progress cannot depend on a content-script timer continuing at foreground cadence.

The exact upstream project under evaluation is **`browseros-ai/BrowserOS`**, specifically its **`product_id=browserclaw` BrowserClaw build**:

- a real persistent Chromium browser compatible with Chrome extensions and ordinary logins;
- a separate Claw Server exposing MCP and JSON control surfaces to external local agents;
- agent-owned tabs, dashboards, recordings and replay;
- no bundled BrowserOS model/agent/usage product layer.

BrowserClaw is not treated as already solving background execution. Its own implementation notes that backgrounded tabs do not composite and must be brought to front for screencast output; lifecycle-state adjustment alone is insufficient. The current public repository does not show BrowserClaw injecting Chromium's background-throttling disable switches by default.

Chromium still exposes command-line switches for disabling background timer throttling, renderer backgrounding and occluded-window backgrounding. Chrome's tabs API can also mark important tabs `autoDiscardable: false`. These are candidate mechanisms, not acceptance evidence.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. The `browseros-ai/BrowserOS` **BrowserClaw product build** is the first upstream substrate to test because it supplies a real browser plus an external local control plane without a competing built-in AI product layer.
3. BrowserClaw is a **conditional candidate**, not the final host. It remains selected only if DCF can control or replace the policies that affect background continuity.
4. The first DCF launcher must start BrowserClaw with a dedicated persistent profile and experimentally apply at least:
   - `--disable-background-timer-throttling`;
   - `--disable-renderer-backgrounding`;
   - `--disable-backgrounding-occluded-windows`.
5. DCF-managed AI surface tabs must be marked `autoDiscardable: false` through the extension or browser control plane. Memory Saver or equivalent discard policy must be disabled for the DCF profile where the Chromium build exposes that control.
6. These switches do not make page JavaScript a durable scheduler. DCF Core remains authoritative for task identity, deadlines, retries, permissions, control, pending delivery and recovery.
7. Provider adapters may observe and act inside pages, but critical waiting and polling move to DCF Core or the BrowserClaw/DCF local control process. The local process may reactivate or bring a page forward when a browser action requires a live renderer.
8. The remote web AI does not directly connect to BrowserClaw MCP. The MCP endpoint is a local control plane consumed by DCF Core and/or a local MCP-capable AI.
9. The first pairing is:

   ```text
   ChatGPT web surface inside managed BrowserClaw
   → DCF ChatGPT adapter
   → DCF Core task/event store
   → OpenCode or Codex
   → BrowserClaw MCP / CDP
   → BrowserClaw pages and browser actions
   ```

10. BrowserClaw provides generic browser eyes and hands. DCF provides provider semantics, durable task identity, conversation continuity, permissions, result routing, recovery and cross-adapter state.
11. The first missing protocol is **DCF Surface Registration**. A registered surface exposes at least:
    - exact substrate/product/version and launch-policy fingerprint;
    - browser instance and profile identity;
    - browser tab/page/target identity;
    - provider and durable conversation key;
    - ephemeral page-instance identity;
    - adapter ID/version and last event cursor;
    - current visibility, focus, frozen, discarded and auto-discardable facts;
    - current human/AI control owner.
12. DCF diagnostics must distinguish local-core liveness, browser-process liveness, target reachability, page lifecycle, adapter liveness and provider state. A registered script or reachable MCP server is not proof that the current page is executing.
13. If command-line switches are not accepted, are removed by updates, or fail the live acceptance, DCF will not fall back to unmodified BrowserClaw semantics. It will define a small **DCF Browser** product build in the same upstream build system, hard-wiring the required flags, preferences, extension and runtime evidence.
14. A deeper Chromium fork is justified only for policies that cannot be controlled through launch arguments, profile preferences, extension APIs, MCP or CDP.

## Background-runtime acceptance

BrowserClaw remains the lead substrate only after one automated live test proves all of the following in the same persistent profile:

1. A DCF ChatGPT page starts a bounded heartbeat, MutationObserver stream and provider-response observation.
2. The user switches to another BrowserClaw tab; timer drift, event delivery and DCF control remain within declared limits.
3. The user switches to another application and leaves the BrowserClaw window fully occluded for a meaningful interval.
4. The user minimizes the BrowserClaw window for a meaningful interval.
5. During each state, DCF Core remains active and can query the exact page lifecycle and target state.
6. A local AI can locate the registered surface and issue a harmless action without the user refocusing the browser manually.
7. If the renderer is throttled or frozen, DCF reports that state, reactivates the page when needed and resumes from persisted cursors without replaying completed work.
8. The DCF tab is not automatically discarded; if forced discard is simulated, reload and surface re-registration recover without losing the task or pending result.
9. Extension service-worker suspension does not erase task state or leave an operation indefinitely pending.
10. A completed web-AI result is observed and routed through DCF after the browser has spent the test interval behind another application.

The test must record timer drift, visibility/focus transitions, `freeze`/`resume`, `document.wasDiscarded`, tab `frozen`/`discarded`/`autoDiscardable` properties, extension-worker restarts, MCP reachability, source-page identity and final delivery.

## Installation and pairing spike

1. Install the exact BrowserClaw product build and establish persistent provider logins.
2. Install the DCF extension and prove its static recovery bridge and current-page diagnostics.
3. Start BrowserClaw through a DCF-owned launcher that records the exact executable, profile and command-line switches.
4. Mark registered DCF surfaces non-discardable.
5. Connect Codex and the exact OpenCode service used by DCF to BrowserClaw MCP.
6. Add Surface Registration and correlate BrowserClaw target identity with the provider conversation.
7. Run the automated background-runtime acceptance before investing further in BrowserClaw-specific integration.
8. If it passes, continue the web–local bootstrap.
9. If it fails because policy control is missing, create the DCF Browser product build rather than accepting ordinary Chromium background behavior.

## Consequences

- BrowserClaw is useful because it provides a real persistent browser and an external local control plane, not because its default page lifecycle is assumed superior to Chrome.
- DCF deliberately modifies the browser's resource policy for its personal managed profile instead of inheriting consumer-browser defaults.
- Page scripts become replaceable adapters rather than the only place where progress, timers and control live.
- The upstream BrowserClaw product can shorten implementation, while a small DCF-specific product descriptor or patch set remains an expected route rather than a failure.
- Browser substrate selection is now governed by measured background continuity, not MCP feature count or product marketing.

## Reconsideration conditions

Reject unmodified BrowserClaw as the DCF host if the background-runtime test cannot keep the control plane observable and recoverable when the browser is occluded or minimized. Preserve BrowserClaw as an upstream codebase only if a bounded DCF Browser product build can impose the required runtime policy without taking on disproportionate Chromium maintenance.
