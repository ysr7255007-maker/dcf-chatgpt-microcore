# ADR: Run web AI adapters inside a DCF-managed agent-adapted Chromium work browser

Date: 2026-07-20  
Status: accepted direction; BrowserOS-first substrate spike and bootstrap acceptance pending

## Context

The first DCF web adapter currently runs inside a normal Chrome tab through an extension and injected scripts. This proved the product semantics, but it inherits lifecycle decisions that belong to a general-purpose browser rather than to DCF. A hidden, backgrounded, discarded, replaced or throttled page may delay timers, lose observers, defer rendering or terminate the exact script instance that DCF expected to continue a multi-turn workflow.

This failure class cannot be solved reliably by adding more polling to Tampermonkey or extension code. The page is not a durable scheduler, and neither a remote AI nor a local AI can reconstruct the exact runtime state from repository source and user descriptions after the fact.

DCF is intended to connect multiple web AI surfaces and multiple local AI surfaces. Its first web–local bootstrap pair therefore needs a browser environment that is:

- a real, visible and persistently used browser rather than a disposable automation session;
- compatible with ordinary AI websites, logins, extensions, downloads and human interaction;
- directly controllable and observable by local AI and DCF Core;
- adjustable for long-running agent operation at browser-engine, browser-service and adapter levels;
- capable of becoming part of the user's actual AI browsing life rather than living in a separate synthetic automation world.

Because this is a trusted personal project, DCF does not need to inherit the narrow permission model of a public multi-user automation product. The user may deliberately grant broad control over the dedicated DCF browser environment. Visibility, persistence and recovery are still required because models and software can be wrong, not because DCF must distrust its owner.

A survey of current projects shows that DCF does not need to begin from stock Google Chrome:

- **BrowserOS** is an open-source Chromium fork with Chromium patches, an in-browser agent extension, a local server exposing 53+ MCP tools, a CLI, an Agent SDK and CDP bindings. It supports importing Chrome data and extensions and can be controlled by Codex, Claude Code, Gemini CLI and other MCP clients.
- **Agent Browser Protocol (ABP)** is a Chromium fork with MCP and REST embedded in the browser engine. Its engine-defined settled boundary, native input path, action event log, screenshots, history database and execution control are valuable technical references, although its default frozen step-machine model is more agent-exclusive than DCF's intended human–AI coexistence.
- **OpenChrome** is not a browser fork, but it is a useful direct-CDP control and reliability harness for real Chrome with persistent profiles, structured page reading, outcome classification and MCP clients including Codex and OpenCode.
- **Vessel** demonstrates persistent sessions, checkpoints, supervisory UI, activity tracing and external MCP control, but its Electron engine makes it a product and interaction reference rather than the preferred browser substrate.
- Steel, browser-use, agent-browser and similar systems remain useful libraries or control layers, but their normal automation-session model is not itself the DCF Work Browser.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. The runtime will be a **real user-facing Chromium-family work browser**, not necessarily the newest Google Chrome Stable and not necessarily an unmodified upstream binary.
3. **BrowserOS is the lead substrate for the first spike.** DCF will first test whether its existing Chromium fork, extension compatibility, data import, local MCP server, CLI and SDK can carry the first web–local bootstrap pair without DCF maintaining its own Chromium fork.
4. Stock Chrome/Chromium with a DCF-managed profile remains the fallback baseline if BrowserOS cannot reliably run the target AI providers or cannot expose the required control and evidence surfaces.
5. DCF will not initially fork and compile Chromium merely to establish ownership. The first preference order is:
   1. use BrowserOS as an installed browser and add DCF adapters around its public/local surfaces;
   2. reuse or modify its agent/server layer while retaining its browser build;
   3. carry a small explicit patch set on its Chromium fork only when a proven DCF requirement cannot be met above the engine;
   4. fall back to managed stock Chrome/Chromium rather than owning a broad browser fork prematurely.
6. The DCF Work Browser profile is persistent and genuinely inhabited by the user. It may import the user's chosen Chrome data and becomes the normal home for AI websites, conversations, extensions and related browsing activity. It is not a temporary test profile.
7. The DCF local core remains the durable coordinator. It owns task identity, event persistence, permissions, control, retries, delivery, recovery and evidence indexing. Browser pages and browser-side agents are participants, not the durable workflow engine.
8. Every web provider is connected through a replaceable DCF adapter. An adapter maps provider-specific page events and actions into the host-neutral DCF protocol; it does not directly integrate with every local AI.
9. BrowserOS MCP/CLI, DCF provider adapters, extension APIs, CDP and the native local channel are complementary:
   - BrowserOS or another browser substrate exposes generic tabs, windows, page actions and browser services;
   - DCF provider adapters expose ChatGPT/Claude/Gemini-specific conversation semantics;
   - CDP or engine-native evidence exposes exact targets, lifecycle, console, network and process facts;
   - DCF Core unifies those facts with local-AI tasks and persistent state.
10. Human and AI operation share the same browser. The user may browse normally, publish tasks, intervene, redirect or take over. DCF must preserve control ownership and unfinished actions explicitly so that simultaneous human and AI input does not corrupt a task.
11. The host may be tuned for DCF operation, including lifecycle policy, persistent services, target discovery, extension survival, instrumentation and engine patches. The criterion is whether the change improves reliable human–AI cohabitation and observable execution.
12. ABP's deterministic settled-step protocol, native input and event bundle will be studied as potential components or design influences. DCF will not adopt its default page-freezing model wholesale because a continuously used conversational AI page must also remain alive while the user and remote model act asynchronously.
13. Electron and system WebView wrappers are deferred as primary substrates. They may still provide later control panels or packaging, but they do not block the real Chromium route.
14. The existing ordinary-browser extension remains a migration adapter and semantic prototype. Its valuable provider-specific behavior should be extracted into the future ChatGPT adapter rather than discarded.

## First substrate spike

The BrowserOS-first spike must answer with runtime evidence:

1. Can ChatGPT and at least one second AI provider complete login, streaming replies, file upload/download and long conversations in BrowserOS?
2. Can current DCF Chrome extensions or equivalent unpacked extensions run without semantic loss?
3. Can Codex and OpenCode connect to the BrowserOS MCP endpoint and identify/control the exact same visible tabs the user is using?
4. Can DCF add provider-aware events that BrowserOS's generic browser tools do not expose?
5. Are page, extension, worker, console, network and lifecycle facts available directly, or must DCF add a CDP/runtime-evidence companion?
6. Does switching applications or leaving the tab in the background stop only rendering, or does it lose adapter events and task continuity?
7. Can the BrowserOS built-in agent loop be disabled, bypassed or subordinated so DCF Core remains the single durable coordinator?
8. Can one persistent profile survive browser restart and browser upgrade without losing DCF task identity or adapter registration?
9. What exact BrowserOS patches or services are indispensable, and which parts would DCF need to replace?
10. Does its AGPL-3.0 licensing fit the repository and any future distribution path, or should DCF consume it as an external runtime rather than derive its own browser build?

## Acceptance boundary for the first DCF Work Browser

The first implementation is accepted only when:

1. one real web AI and one real local AI participate in the same persisted DCF task;
2. the user genuinely uses the same persistent browser profile before, during and after DCF actions;
3. the user can focus another window for a meaningful interval without the task silently disappearing;
4. the host distinguishes page hidden, throttled, disconnected, crashed, reloaded, adapter-lost and provider-side waiting states;
5. closing and reopening the browser can recover the task without reusing stale page-instance assumptions;
6. adapter version, exact page target, last consumed event, last performed action and last delivery state are queryable by the maintenance AI;
7. a page, extension, browser service or provider-adapter failure does not erase the local task and permission history;
8. human takeover and AI operation can alternate without racing on the same composer or losing queued actions;
9. the user is not required to carry logs, target IDs, session IDs or intermediate results between the web AI and local AI;
10. the same DCF Core can attach a second web adapter without changing the first local adapter contract.

## Consequences

- DCF can reuse an existing agent-adapted Chromium project instead of reproducing browser maintenance and agent-control infrastructure from scratch.
- BrowserOS becomes a concrete substrate candidate, not a new architectural centre; DCF Core and the adapter protocol remain host-neutral.
- The user's normal AI browsing history and DCF operation can grow in the same browser environment.
- DCF may eventually need a small browser patch set, but only after higher-level integration proves the missing capability.
- Runtime compatibility, browser updates and upstream project changes become explicit dependencies that the substrate spike must measure.
- BrowserOS's broad built-in agent product may overlap with DCF; integration must separate reusable browser infrastructure from DCF's own cognition, task and plugin semantics.

## Reconsideration conditions

Reconsider BrowserOS as the lead substrate if real AI providers fail materially, its built-in architecture cannot be subordinated to DCF Core, its release cadence or Chromium base becomes too stale, required runtime facts cannot be exposed, or maintaining a downstream patch set becomes harder than supervising stock Chrome. These conditions change the browser substrate, not the decision to keep durable coordination outside page JavaScript.