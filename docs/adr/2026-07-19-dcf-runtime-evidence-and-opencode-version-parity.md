# ADR: Diagnose runtime failures from selectable evidence surfaces and verify OpenCode service version parity

Date: 2026-07-19  
Status: accepted; live recovery and minimal dialogue acceptance passed

## Context

The first successful DCF dialogue handoff created an OpenCode session but received HTTP 500 from `POST /session/:id/message`. Reading the DCF source suggested several plausible causes, including Provider, model, Agent, update rollback and composer-return failures. None of those hypotheses contained the missing browser and OpenCode runtime state.

The user required a different maintenance method: do not modify code from source inspection alone. Let a trusted local AI attach to the exact browser target and collect selectable runtime evidence from the current page, DCF extension state and local service.

That investigation used:

- Chrome DevTools Protocol against the exact ChatGPT page and DCF Service Worker;
- current Shell and plugin Shadow DOM state;
- the original Chrome extension LevelDB in read-only mode;
- DCF snapshot, startup and plugin-data evidence;
- OpenCode HTTP endpoints;
- OpenCode SQLite data;
- OpenCode process and server logs.

The evidence proved the DCF update transaction had committed and diagnostics `.1` had started. It also proved the failed OpenCode session existed but had zero messages. Server logs then exposed `SQLiteError: no such column: replacement_seq`.

The regularly used Desktop App had been updated while the standalone CLI used by DCF remained at `1.17.8`. The independent `serve` process therefore ran code incompatible with the shared database state. Upgrading the standalone CLI to `1.18.3` and restarting it gracefully removed the error. Native OpenCode smoke and the fresh DCF dialogue smoke both passed.

## Decision

1. Source code is a hypothesis generator, not runtime proof. A browser, extension or external-service failure must not be repaired until the relevant runtime evidence surface confirms the failing boundary.
2. Runtime evidence is collected through deterministic selectable surfaces, not through an AI embedded inside DCF. The local AI may decide which surface to inspect next, while the data source itself remains a bounded tool or log.
3. The preferred surfaces are:
   - exact browser target identity and page state;
   - DCF DOM and open Shadow DOM;
   - DCF Service Worker, Host snapshots, registrations, startup evidence and plugin data;
   - browser console and network evidence;
   - original on-disk extension state when live storage cannot answer a historical question;
   - OpenCode health, session and catalog APIs;
   - OpenCode database schema and rows;
   - OpenCode process metadata and service logs.
4. Every conclusion must distinguish runtime-proven fact, repository fact, source-derived hypothesis, missing evidence and excluded explanation.
5. DCF must not compensate for an external OpenCode failure until a native OpenCode message smoke has been attempted. If the native smoke fails, repair the service first.
6. The Desktop App and standalone CLI are treated as independently maintained runtime artifacts. DCF currently connects to the standalone CLI service, so Desktop App updates do not prove that the DCF service binary is current.
7. The future `DCF OpenCode Service` launcher must:
   - identify the standalone CLI and currently listening process;
   - detect an outdated or stale service process;
   - stop it gracefully rather than using `kill -9`;
   - update the standalone CLI when required;
   - start exactly one loopback service with the required CORS origins;
   - verify `/global/health` and a minimal native message smoke before declaring the service ready.
8. Do not hand-edit the OpenCode database merely to satisfy an observed missing-column error unless the exact official migration contract and recovery path have first been established.
9. DCF failure artifacts should still preserve bounded endpoint, status, response-body and session evidence so common failures do not always require external forensic work.

## Consequences

- maintenance no longer treats a suspicious source line as the root cause of a runtime incident;
- trusted local tooling can inspect evidence that a remote conversational assistant cannot access directly;
- browser and external-service failures can be separated from DCF product defects before code changes are made;
- independent App and CLI update drift becomes an explicit operational risk rather than a hidden assumption;
- the service shortcut becomes a verified service supervisor, not merely a shell command launcher;
- the diagnostic process may take multiple evidence rounds, but each round narrows the boundary without accumulating speculative patches.

## Acceptance

Live recovery evidence:

- old standalone CLI: `1.17.8`;
- failing endpoint: `POST /session/:id/message`;
- service error: `SQLiteError: no such column: replacement_seq`;
- upgraded standalone CLI: `1.18.3`;
- old service PID `67133` stopped gracefully;
- new service PID `89985` started with the same loopback port, CORS and no-password behavior;
- native message smoke: `OPENCODE_SCHEMA_OK`;
- DCF request: `dcf-dialogue-readonly-smoke-20260719-upgrade-01`;
- DCF session: `ses_089953d95ffe3kyJBThTifGIoj`;
- DCF result: `DCF_READ_ONLY_SMOKE_OK`;
- elapsed time: 6.452 seconds;
- endpoint errors: all `null`.

## 2026-07-20 architecture clarification: bootstrap one web–local pair, then grow a host-neutral DCF mesh

DCF is not fundamentally a ChatGPT browser extension with a local bridge. Its intended scope is to connect multiple remote AI web surfaces and multiple local AI surfaces to one continuous personal cognitive system.

The browser implementation and the current local-agent path are the first two concrete surfaces because they already contain the strongest real requirements. They are not permanent architectural centres. The first strategic milestone is to make one web surface and one local surface communicate through a complete, trustworthy, inspectable round trip, then use that working pair to help build, diagnose and accept additional adapters.

The architecture is hub-and-adapter rather than a growing set of direct pairwise integrations:

```text
AI web adapters ─────┐
                     ├── DCF local core / protocol / durable state
local AI adapters ───┘
```

Each ChatGPT, Claude, Gemini or other web integration should eventually be a replaceable web adapter. Each ChatGPT/Codex desktop integration, OpenCode, Codex CLI or other local AI should be a replaceable local adapter. Business continuity, language ammunition, task identity, permissions, delivery state, runtime evidence and recovery must not be owned exclusively by any one host.

The initial web–local bootstrap pair must prove more than message forwarding. It must establish the reusable DCF connection contract:

1. **Stable surface and conversation identity.** DCF knows which adapter, account, window, page, conversation and local task an event belongs to without asking the user to carry identifiers.
2. **Bidirectional event transport.** A bounded event can travel web-to-local and a result, progress item, permission request, control acknowledgement or failure artifact can travel local-to-web.
3. **Durable delivery semantics.** Events are idempotent, ordered where required, acknowledged explicitly, recoverable after refresh or process restart and distinguish execution from delivery.
4. **Capability discovery.** Every adapter declares what it can observe, invoke, persist, render, control and verify instead of pretending that all AI hosts expose the same abilities.
5. **Permission and responsibility boundary.** Observation is read-only by default; consequential side effects have explicit intent, evidence and revocation semantics.
6. **Selectable runtime truth.** Plugin-owned business evidence and an external local observer remain complementary. No adapter is the sole witness of its own health.
7. **Host-neutral core state.** Long-term DCF state can outlive the replacement, failure or removal of either member of the bootstrap pair.
8. **Human experiential authority.** The system absorbs technical complexity, while the user retains the final judgment about whether the cross-surface experience is actually useful and trustworthy.

The first pair is therefore a bootstrap environment, not the final product boundary. Once it works, the connected remote and local AIs can jointly inspect repository memory, runtime evidence and adapter contracts; implement a new adapter; run deterministic verification; and return one bounded acceptance request to the user. This is the intended meaning of DCF self-expansion. It does not mean granting an AI unrestricted recursive control over the machine or accepting an adapter because it generated its own success report.

The development order becomes:

```text
extract the minimum host-neutral DCF connection contract
→ connect one real AI web surface to one real local AI surface
→ prove identity, bidirectional delivery, control, persistence and evidence
→ let the working pair assist development of a second adapter
→ connect a second web or local host to expose hidden host assumptions
→ expand language ammunition and higher-level cognitive workflows on the stable mesh
```

The decisive early acceptance is not “all DCF features work in ChatGPT.” It is:

```text
one web adapter
↔ one durable local DCF core
↔ one local AI adapter
```

with an end-to-end event, local action, result return, status/control exchange, restart recovery and evidence package completed without the user copying logs, session IDs or protocol envelopes.

Rejected framings:

- treating the browser as DCF's permanent primary product and the local side as a subordinate service;
- replacing browser-first thinking with desktop-first thinking while keeping the same host dependency;
- implementing every pair of AI surfaces directly, creating an `N × N` integration problem;
- moving all intelligence into the local core and reducing host AIs to passive terminals;
- building many shallow adapters before one complete web–local round trip is trustworthy;
- calling transport success “self-expansion” without deterministic evidence and external acceptance.