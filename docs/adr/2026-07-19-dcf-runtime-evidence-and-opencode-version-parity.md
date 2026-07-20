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

## 2026-07-20 architecture clarification: product surface and runtime truth are different planes

The browser remains DCF's primary product surface. Its value is created inside the user's current ChatGPT conversation, so replacing the browser product with a desktop application would move the experience away from the place where language ammo, dialogue handoff and cognitive continuity are actually used.

The browser must not, however, remain the only engineering and diagnostic surface. DCF now spans several independently failing truth planes:

- repository and build truth;
- Chrome page, extension, Service Worker, registration and storage truth;
- each plugin's own business-state projection;
- OpenCode service, session and process truth;
- the user's irreducibly experiential judgment.

No remote or local AI sees all of these by default. DCF must therefore construct a queryable evidence projection instead of expecting an AI to infer the whole system from source code or expecting the user to carry missing facts between tools.

This produces the following maintenance architecture:

1. **Plugin-owned evidence is the first line.** Each plugin exposes its own bounded state transitions, queue reasons, command consumption, side effects and delivery state because it understands its business semantics best.
2. **An external local runtime observatory is the fallback and cross-layer view.** It attaches to the exact Chrome target and related local services, remains read-only by default, identifies the observed target precisely and exposes privacy-bounded snapshots and events from CDP, extension state and OpenCode.
3. **Neither observer replaces the other.** A plugin cannot be the sole witness of its own initialization failure, while an external observer cannot infer business semantics that the plugin has not made explicit.
4. **The remote conversational AI receives structured projections automatically.** The local AI may query deeper selectable surfaces directly. The user does not copy logs, session IDs, DOM state or service evidence between them.
5. **CI loads the complete plugin where practical.** Extracted source fragments and token assertions may support a test, but they cannot stand in for full initialization, observer binding, side effects, queue transitions and teardown.
6. **Real-browser acceptance remains the final runtime fact.** A controlled harness reduces uncertainty before publication; it does not replace one meaningful acceptance against the actual ChatGPT page.

The corrected development sequence is therefore not “desktop first instead of web first.” It is:

```text
minimal browser vertical slice
→ full-plugin deterministic harness
→ local exact-target runtime observatory
→ product-owned structured evidence
→ feature expansion
→ one real-browser acceptance
```

The rejected alternatives are:

- abandoning the browser product merely because browser debugging is difficult;
- treating a native companion UI as the new primary DCF product;
- granting a general-purpose remote browser-control channel before a bounded evidence model exists;
- relying only on plugin self-report when the plugin itself may be broken;
- relying only on CDP or external observation without plugin business-state evidence;
- continuing feature growth while the maintenance AI sees only repository source and user descriptions.
