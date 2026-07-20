# ADR: Run web AI adapters inside a DCF-managed real Chrome work browser

Date: 2026-07-20  
Status: accepted vehicle for first implementation; DCF Work Browser spike and bootstrap acceptance pending

## Context

The first DCF web adapter currently runs inside a normal Chrome tab through an extension and injected scripts. This is sufficient to prove product semantics, but it inherits lifecycle decisions that belong to a general-purpose browser rather than to DCF. A hidden, occluded, backgrounded, discarded or replaced page may delay timers, stop animation frames, lose observers, defer rendering or terminate the exact script instance that DCF expected to continue a multi-turn workflow.

This failure class cannot be solved reliably by adding more polling or retry logic to Tampermonkey or extension code. The page itself is not a durable scheduler, and a remote or local AI cannot reconstruct the exact runtime state from repository source and user descriptions after the fact.

DCF is intended to connect multiple web AI surfaces and multiple local AI surfaces. The long-term web boundary therefore cannot remain “whatever browser tab the user happened to open.” At the same time, the user does not want an automation-only embedded shell that is separated from normal human browsing. The first web–local bootstrap pair should operate inside a real, visible and persistently used browser environment where the user's genuine login, reading, writing and navigation coexist with bounded DCF actions.

This is cohabitation, not impersonation. DCF should gain the compatibility and contextual advantages of the user's real AI browsing workspace without manufacturing synthetic human activity, hiding automation, bypassing provider controls or collecting the user's unrelated browsing life.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. The first managed runtime vehicle is a **DCF Work Browser**: a visible, real Google Chrome/Chromium process launched and supervised by DCF with a persistent non-default user data directory.
3. The DCF Work Browser profile is not a disposable automation or test profile. The user may genuinely use it as the normal home for AI websites, preserving durable logins, preferences, conversation use and ordinary human interaction. It must not be implemented by copying or remotely debugging the default Chrome profile.
4. The DCF local core remains the durable coordinator. It owns task identity, event persistence, permissions, control, retries, delivery, recovery and evidence indexing. A browser page is an interactive surface and actuator, not the durable workflow engine.
5. Every web provider is connected through a replaceable adapter. An adapter maps provider-specific page events and actions into the host-neutral DCF protocol; it does not directly integrate with every local AI.
6. The managed host owns and exposes at least:
   - an explicit browser process and persistent profile identity;
   - page, frame, worker and Service Worker target identity;
   - lifecycle state, focus, visibility, crash, discard and reload evidence;
   - adapter installation, version, activation and teardown;
   - bounded DOM, console, network and storage evidence;
   - explicit file, clipboard, download, notification and origin permissions;
   - restart and recovery hooks that preserve the DCF task independently of the page instance.
7. Chrome extension APIs and CDP are complementary rather than competing control planes:
   - the extension and provider adapter expose provider-aware semantic events and bounded page actions;
   - CDP exposes exact targets, process and lifecycle evidence, console/network diagnostics and recovery hooks;
   - a native local channel connects both to DCF Core;
   - no extension Service Worker, content script or page timer is treated as the durable scheduler.
8. Human use is a first-class mode of the managed runtime. DCF actions are limited to explicitly enrolled provider tabs and declared capabilities. The browser must visibly identify DCF-controlled activity, allow immediate pause or stop, and yield when the user takes over the relevant surface.
9. DCF must not record or export the user's general browsing history merely to create a “human trace.” Evidence collection is limited to registered AI surfaces, task-related events and explicitly selected diagnostic scopes.
10. DCF may reduce accidental browser lifecycle interference and benefit from genuine user sessions, but it must not use stealth patches, synthetic activity, fingerprint manipulation, CAPTCHA bypass, hidden interaction or other measures intended to evade provider-side rate limits, authentication, anti-abuse controls or service policy.
11. Electron is deferred as the primary first implementation. It may be reconsidered later for packaging or tighter integrated UI, but it no longer blocks the first bootstrap pair and must prove a material advantage over the real Chrome work-browser route.
12. System WebView wrappers and Tauri-style shells are not the default first choice because engine differences, extension limitations and platform-specific behavior can enlarge the adapter problem before the first bootstrap pair is stable.
13. The ordinary-browser extension remains useful as a convenience and migration adapter. It is no longer treated as the only or most reliable execution environment.

## Consequences

- the user's real AI browsing and DCF's bounded actions can coexist in the same visible browser workspace instead of being split between a human browser and an automation shell;
- switching to another application no longer has to destroy the DCF workflow merely because the page-side script was expected to own the task;
- page crashes, throttling, replacement and lost observers become observable lifecycle events instead of unexplained product behavior;
- the same local core and adapter protocol can support ChatGPT, Claude, Gemini and other web surfaces without pairwise integration with every local AI;
- the DCF Work Browser profile becomes important user state and therefore requires careful backup, version compatibility, permission, corruption and recovery policies;
- DCF gains no authority to defeat provider restrictions; some tasks may still pause for login, human confirmation, provider waiting or policy limits;
- embedding or supervising a webpage is not by itself considered success: durable orchestration must already have moved out of the page;
- real-provider acceptance remains necessary because no harness can prove login, streaming, rendering and provider compatibility for all surfaces.

## Rejected shortcuts

- continuing to treat an arbitrary normal user tab as a reliable unattended execution container;
- attaching unrestricted debugging to the user's default Chrome data directory;
- creating a disposable automation-only profile that the user never genuinely inhabits;
- copying the user's default browser profile, cookies or secrets into a managed profile;
- defeating throttling with silent audio, synthetic activity, perpetual focus tricks or fake human input;
- hiding DCF actions from the user or operating outside explicitly enrolled provider tabs;
- putting the scheduler into an Electron preload, extension Service Worker or content script while leaving task state ephemeral;
- building a complete custom browser before the first web–local pair is stable;
- making headless automation the primary human-facing DCF surface;
- assuming one provider's DOM and lifecycle model can define the common adapter protocol.

## Acceptance boundary for the first DCF Work Browser

The first implementation is accepted only when:

1. one real web AI and one real local AI participate in the same persisted DCF task;
2. the user can log in and genuinely use the same persistent DCF Work Browser profile for ordinary AI browsing;
3. the user can focus another window for a meaningful interval without the task silently stopping;
4. the host distinguishes page hidden, throttled, disconnected, crashed, reloaded and provider-side waiting states;
5. closing and reopening the managed browser can recover the task without reusing stale page-instance assumptions;
6. adapter version, exact page target, last consumed event, last performed action and last delivery state are queryable by the maintenance AI;
7. a page, extension or adapter failure does not erase the local task or permission history;
8. the user can visibly identify DCF activity, pause it immediately and take over the page without racing an invisible controller;
9. unrelated browsing history and non-enrolled tabs are outside the default evidence and control scope;
10. the user is not required to carry logs, target IDs, session IDs or intermediate results between the web AI and local AI;
11. the same core can attach a second web adapter without changing the first local adapter contract.

## Reconsideration conditions

Reconsider the chosen runtime vehicle when a provider blocks the managed real-browser arrangement, authentication cannot be made reliable, maintaining the DCF Work Browser profile becomes disproportionate, Chrome removes a required control surface, or an official provider integration exposes the same conversation and lifecycle capabilities with less fragility. These conditions may change the host implementation, but they do not restore page JavaScript as DCF's durable coordinator or justify stealth-based provider evasion.