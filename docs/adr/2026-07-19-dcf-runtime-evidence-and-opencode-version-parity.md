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
