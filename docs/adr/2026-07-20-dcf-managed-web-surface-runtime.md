# ADR: Run web AI adapters inside a DCF-managed web surface runtime

Date: 2026-07-20  
Status: accepted direction; runtime vehicle and first implementation pending comparative spike

## Context

The first DCF web adapter currently runs inside a normal Chrome tab through an extension and injected scripts. This is sufficient to prove product semantics, but it inherits lifecycle decisions that belong to a general-purpose browser rather than to DCF. A hidden, occluded, backgrounded, discarded or replaced page may delay timers, stop animation frames, lose observers, defer rendering or terminate the exact script instance that DCF expected to continue a multi-turn workflow.

This failure class cannot be solved reliably by adding more polling or retry logic to Tampermonkey or extension code. The page itself is not a durable scheduler, and a remote or local AI cannot reconstruct the exact runtime state from repository source and user descriptions after the fact.

DCF is also intended to connect multiple web AI surfaces and multiple local AI surfaces. Therefore the long-term web boundary cannot remain “whatever browser tab the user happened to open.” The first web–local bootstrap pair needs a web runtime whose process, profile, lifecycle, permissions and evidence surfaces are owned deliberately by DCF.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. The managed runtime is a small application-level host around an existing browser engine. It is not a plan to fork Chromium or build a general-purpose browser.
3. The DCF local core remains the durable coordinator. It owns task identity, event persistence, permissions, control, retries, delivery, recovery and evidence indexing. A hosted web page is an interactive surface and actuator, not the durable workflow engine.
4. Every web provider is connected through a replaceable adapter. An adapter maps provider-specific page events and actions into the host-neutral DCF protocol; it does not directly integrate with every local AI.
5. The managed host owns and exposes at least:
   - an explicit browser process and persistent profile identity;
   - page, frame, worker and Service Worker target identity;
   - lifecycle state, focus, visibility, crash, discard and reload evidence;
   - adapter installation, version, activation and teardown;
   - bounded DOM, console, network and storage evidence;
   - explicit file, clipboard, download, notification and origin permissions;
   - restart and recovery hooks that preserve the DCF task independently of the page instance.
6. The first implementation must compare two concrete vehicles rather than choosing by familiarity:
   - a DCF-owned dedicated Chrome/Chromium process controlled through CDP and a dedicated profile;
   - an Electron host using isolated remote `WebContents`/`WebContentsView` with background throttling policy under DCF control.
7. A dedicated managed Chrome/Chromium process is the compatibility baseline because it preserves the behavior, login model and extension environment of a real browser. Electron is a serious candidate when tighter lifecycle, window and preload control materially reduces complexity. The comparative spike must decide from real ChatGPT and one second-provider surface, not from framework preference.
8. System WebView wrappers and Tauri-style shells are not the default first choice because engine differences, extension limitations and platform-specific behavior can enlarge the adapter problem before the first bootstrap pair is stable. They may be reconsidered later for packaging or platform-specific adapters.
9. Critical progress must never depend solely on page timers, DOM polling or animation frames. The local core maintains the clock and heartbeat. The web adapter reports observations and performs bounded actions; a missing heartbeat becomes an explicit recoverable state rather than silent suspension.
10. DCF may control its own host policies, but it must not attempt to bypass provider-side rate limits, authentication, anti-abuse controls or service policy. A managed runtime reduces accidental browser lifecycle interference; it does not grant authority over the remote service.
11. Remote pages remain untrusted content. Any embedded implementation must preserve process and context isolation, expose only narrow adapter capabilities, disable direct Node access, and require explicit policy for write-capable local actions.
12. The ordinary-browser extension remains useful as a convenience and migration adapter. It is no longer treated as the only or most reliable execution environment.

## Consequences

- switching away from the window no longer has to destroy the DCF workflow merely because the user is using another application;
- page crashes, throttling, replacement and lost observers become observable lifecycle events instead of unexplained product behavior;
- the same local core and adapter protocol can support ChatGPT, Claude, Gemini and other web surfaces without pairwise integration with every local AI;
- the application gains additional responsibility for browser updates, authentication compatibility, profile safety, permissions, resource use and provider-specific breakage;
- embedding a webpage inside an App is not by itself considered success: durable orchestration must already have moved out of the page;
- real-provider acceptance remains necessary because no harness can prove login, streaming, rendering and anti-automation compatibility for all surfaces.

## Rejected shortcuts

- continuing to treat a normal user tab as a reliable unattended execution container;
- defeating throttling with silent audio, synthetic activity or perpetual focus tricks;
- putting the scheduler into an Electron preload script while leaving task state ephemeral;
- building a complete custom browser before the first web–local pair is stable;
- making headless automation the primary human-facing DCF surface;
- assuming one provider's DOM and lifecycle model can define the common adapter protocol.

## Acceptance boundary for the first managed web surface

The first implementation is accepted only when:

1. one real web AI and one real local AI participate in the same persisted DCF task;
2. the user can focus another window for a meaningful interval without the task silently stopping;
3. the host distinguishes page hidden, throttled, disconnected, crashed, reloaded and provider-side waiting states;
4. closing and reopening the managed host can recover the task without reusing stale page-instance assumptions;
5. adapter version, exact page target, last consumed event, last performed action and last delivery state are queryable by the maintenance AI;
6. a page or adapter failure does not erase the local task or permission history;
7. the user is not required to carry logs, target IDs, session IDs or intermediate results between the web AI and local AI;
8. the same core can attach a second web adapter without changing the first local adapter contract.

## Reconsideration conditions

Reconsider the chosen runtime vehicle when a provider blocks embedded engines, authentication cannot be made reliable, browser-update ownership becomes disproportionate, or an official provider integration exposes the same conversation and lifecycle capabilities with less fragility. These conditions may change the host implementation, but they do not restore page JavaScript as DCF's durable coordinator.
