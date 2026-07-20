# ADR: Bootstrap DCF through a BrowserClaw-derived managed Chromium runtime

Date: 2026-07-20  
Status: accepted direction; BrowserClaw remains a conditional substrate candidate pending logical-foreground acceptance

## Context

The first DCF web adapter runs inside a normal Chromium tab through an extension and dynamically registered scripts. It proved the product semantics, but the browser remains free to classify the page as hidden, occluded, unfocused, backgrounded, frozen or discardable.

Changing from Google Chrome to another Chromium build has little architectural value if the selected DCF page still receives ordinary consumer-browser background semantics. DCF does not merely need background throttling to be weaker. It needs a registered web-AI surface to continue receiving the browser's foreground treatment while the user works in another tab, window or application.

Foreground treatment is not one boolean. Chromium separates at least:

- WebContents visibility: visible, hidden or occluded;
- Blink page visibility exposed to the document;
- focused and active page state;
- compositor frame production;
- renderer process foreground/background priority;
- page lifecycle state such as active or frozen;
- discard eligibility;
- actual operating-system window focus.

The DCF requirement concerns the first seven. It must not steal the user's actual keyboard or operating-system focus.

The exact upstream project under evaluation is **`browseros-ai/BrowserOS`**, specifically its **`product_id=browserclaw` BrowserClaw build**:

- a real persistent Chromium browser compatible with Chrome extensions and ordinary logins;
- a separate Claw Server exposing MCP and JSON control surfaces to external local agents;
- agent-owned tabs, dashboards, recordings and replay;
- no bundled BrowserOS model, agent or usage product layer.

BrowserClaw is not treated as already providing logical foreground. Its current product definition primarily adds the BrowserClaw extension and Claw Server. Public repository inspection has not shown a per-tab foreground override in the shipped product.

Chromium already contains mechanisms that prove the relevant layers are controllable: CDP can emulate a focused and active page and request an active lifecycle state, while the browser-side WebContents capture path can keep renderers informed that a page is user-visible and can keep compositor frames flowing even when the page is otherwise hidden. These mechanisms are useful prototypes, not yet the DCF product contract.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. The `browseros-ai/BrowserOS` **BrowserClaw product build** remains the first upstream substrate to test because it supplies a real browser plus an external local control plane without a competing built-in AI product layer.
3. BrowserClaw is a **conditional candidate**, not the final host. It remains selected only if DCF can grant and verify a durable logical-foreground state for registered web surfaces.
4. The primary browser capability is **DCF Foreground Lease**, not a collection of global background-disable flags.
5. A Foreground Lease is granted to one registered DCF surface and has an explicit `lease_id`, `surface_id`, target identity, acquisition reason, owner and release condition.
6. While the lease is held, BrowserClaw must keep the selected surface:
   - visible to Blink and page-visibility APIs;
   - focused and active at the page-semantic layer;
   - in active rather than frozen lifecycle state;
   - non-discardable;
   - at foreground renderer priority;
   - eligible to produce compositor frames;
   - observable through the BrowserClaw/DCF local control plane.
7. The lease must not bring the BrowserClaw window to the operating-system foreground, steal keyboard focus, change the user's selected application or redirect user input.
8. Only explicitly registered DCF surfaces receive this treatment. Ordinary tabs retain normal Chromium behavior.
9. BrowserClaw or the DCF-specific product build must expose at least:

   ```text
   browser.foreground.acquire(surface_id, target_id)
   browser.foreground.status(lease_id)
   browser.foreground.release(lease_id)
   ```

10. The first implementation spike may combine existing mechanisms:
    - CDP focus emulation;
    - active page lifecycle override;
    - tab non-discardability;
    - a small BrowserClaw browser-process patch modelled on WebContents' always-visible capture path;
    - explicit renderer-priority and compositor evidence.
11. Command-line switches such as disabling timer throttling, renderer backgrounding or occluded-window backgrounding remain diagnostic controls and temporary fallback experiments. They are not the final DCF contract because they apply broadly and do not prove all foreground layers agree.
12. Patching `document.hidden`, `document.visibilityState` or `document.hasFocus()` in JavaScript is insufficient. The renderer, lifecycle manager, compositor and performance manager must share the foreground decision.
13. DCF Core remains authoritative for task identity, deadlines, retries, permissions, control, pending delivery and recovery. Logical foreground keeps the web surface continuously interactive; it does not turn the page into the durable scheduler.
14. The remote web AI does not directly connect to BrowserClaw MCP. BrowserClaw MCP and the Foreground Lease API are local control surfaces consumed by DCF Core and/or a local MCP-capable AI.
15. The first pairing remains:

    ```text
    ChatGPT web surface inside managed BrowserClaw
    → DCF ChatGPT adapter
    → DCF Core task/event store
    → OpenCode or Codex
    → BrowserClaw MCP / CDP / Foreground Lease
    → BrowserClaw pages and browser actions
    ```

16. The first missing protocol remains **DCF Surface Registration**. A registered surface exposes at least:
    - exact substrate, product and version;
    - browser instance and profile identity;
    - tab, page and target identity;
    - provider and durable conversation key;
    - ephemeral page-instance identity;
    - adapter ID, version and last event cursor;
    - actual visibility, focus, lifecycle, discard and renderer-priority facts;
    - current Foreground Lease identity and state;
    - current human or AI control owner.
17. Diagnostics must distinguish the requested foreground contract from observed browser truth. A lease record, registered script or reachable MCP server is not proof that the page is actually executing under foreground semantics.
18. If BrowserClaw cannot expose or accept this bounded per-surface override, DCF will define a small **DCF Browser** product build in the same upstream build system rather than accepting ordinary Chromium background behaviour.

## Logical-foreground acceptance

BrowserClaw remains the lead substrate only after one automated live test proves all of the following in the same persistent profile:

1. A DCF ChatGPT surface acquires a Foreground Lease and records the exact target and page instance.
2. The user switches to another BrowserClaw tab.
3. The user switches to another application and leaves the BrowserClaw window fully occluded.
4. The BrowserClaw window is minimized.
5. Throughout those states, the operating-system focus remains with the user's chosen application; BrowserClaw must not steal it.
6. The leased page continues to report the agreed visible, focused and active semantics.
7. Page lifecycle remains active; the tab is not frozen or discarded.
8. Renderer priority and compositor production remain at the declared foreground level.
9. Timer drift, `requestAnimationFrame`, MutationObserver delivery and provider-response observation remain within declared limits.
10. A completed web-AI response is detected, delegated and routed back without the user manually refocusing BrowserClaw.
11. DCF Core can query lease state and independently compare it with page, renderer and browser-process evidence.
12. Revoking the lease returns the page to ordinary Chromium behaviour without closing the conversation or losing DCF task state.
13. Browser restart restores the registered surface and reacquires an authorised persistent lease without replaying completed work.

The acceptance record must include:

- `document.visibilityState`, `document.hidden` and `document.hasFocus()`;
- WebContents visibility and occlusion state;
- active/frozen/discarded facts;
- tab discardability;
- renderer foreground/background priority;
- compositor frame evidence;
- timer and animation-frame drift;
- extension-worker restarts;
- MCP and Foreground Lease reachability;
- source-page identity and final delivery.

## Installation and pairing spike

1. Install the exact BrowserClaw product build and establish persistent provider logins.
2. Install the DCF extension and prove its static recovery bridge and current-page diagnostics.
3. Connect Codex and the exact OpenCode service used by DCF to BrowserClaw MCP.
4. Add Surface Registration and correlate BrowserClaw target identity with the provider conversation.
5. Prototype Foreground Lease using existing CDP controls and a bounded browser-process patch.
6. Run the automated logical-foreground acceptance before investing further in BrowserClaw-specific integration.
7. If it passes, continue the web–local bootstrap.
8. If it fails because BrowserClaw cannot supply the required browser-process contract, create the DCF Browser product build.

## Consequences

- BrowserClaw is useful because it is an open Chromium substrate with a local control plane, not because its default lifecycle is assumed superior to Chrome.
- The decisive product feature is a per-surface logical foreground contract.
- DCF pages can continue to interact while the user works elsewhere without the browser stealing real focus.
- Global background-disable flags are reduced to experiments and diagnostics.
- Page scripts remain replaceable adapters; DCF Core still owns durable work.
- Browser substrate selection is governed by measured foreground continuity, not MCP feature count or product marketing.

## Reconsideration conditions

Reject unmodified BrowserClaw as the DCF host if a registered surface cannot hold verified logical-foreground semantics while the user works in another application. Preserve BrowserClaw as an upstream codebase only if a bounded DCF Browser product build can add the Foreground Lease without disproportionate Chromium maintenance.