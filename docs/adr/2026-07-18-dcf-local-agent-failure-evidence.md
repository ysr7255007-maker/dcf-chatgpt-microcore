# ADR: Recover Local Agent execution failures through the diagnostics plugin

Date: 2026-07-18  
Status: accepted; implementation present, original automatic-report acceptance not exercised

## Context

Dialogue `.8` successfully consumed a new assistant request, created an independent OpenCode session and returned a result to the same ChatGPT conversation. The synchronous `POST /session/:id/message` call then returned HTTP 500 before OpenCode persisted any Assistant message.

The returned `bridge_error` kept the session ID but did not expose enough bounded server/session evidence to distinguish an adapter failure from a model, Provider, Agent or OpenCode execution failure. Opening the session and copying messages could not recover the cause because the session contained no Assistant result or persisted message error.

The failed session ID and request ID were expected to exist in dialogue plugin data. The existing diagnostics plugin is the product boundary intended to turn runtime state into privacy-bounded evidence.

Diagnostics `.1` was subsequently downloaded, registered, started and committed successfully. When it started, however, the persisted dialogue `last_session_id` was already empty. It therefore displayed `没有可诊断的最近本机 session`, generated no diagnostic report and created no diagnostics plugin data. The original automatic-report acceptance was not exercised and must not be recorded as passed.

The actual HTTP 500 cause was recovered externally through browser CDP, the original extension LevelDB, OpenCode HTTP/SQLite data and service logs. Standalone OpenCode CLI `1.17.8` was incompatible with the database schema already used by the regularly updated Desktop App and failed with `SQLiteError: no such column: replacement_seq`. Upgrading the standalone CLI to `1.18.3` and restarting the service restored native and DCF execution without a DCF code change.

## Decision

1. Extend the existing `dcf.firstparty.diagnostics` plugin instead of adding a temporary eleventh plugin, a new tab or any base behavior.
2. The diagnostics plugin may read the dialogue plugin's most recent request/session identifiers and the Local Agent plugin's connection, Agent and model selection.
3. For each previously undiagnosed recent session, perform one automatic read-only probe after the diagnostics plugin starts. Store only the diagnosed session ID and diagnostic timestamp in the diagnostics namespace so the same session is not automatically reported again.
4. The probe is restricted to loopback HTTP GET requests. It may read health, session details, session status, message metadata, todo/diff counts, Provider/model catalogs, Agent catalogs and workspace path/VCS identity. It must not submit prompts, commands, shell requests, permissions or configuration changes.
5. Emit `dcf.local-agent.diagnostic.v1` between exact markers and automatically return it to the current conversation when the composer is free.
6. The returned artifact excludes message text, task text, credentials, Provider private options and raw OpenCode configuration. It may include bounded persisted error objects, role counts, selected Agent/model IDs, Provider/model presence, connected/default Provider summaries and endpoint failures.
7. This recovery path does not remove the dialogue adapter's responsibility. A later dialogue revision must preserve synchronous HTTP status, bounded response-body details and session-side evidence directly in `dcf.local-agent.result.v1`. The diagnostics plugin remains useful for failures that occurred before that revision or outside the adapter.
8. A missing persisted recent-session pointer is an explicit evidence gap. Diagnostics must not infer a historical session from unrelated page history or re-run a model request merely to recreate the pointer.
9. The Manifest, background, Host API and static base remain unchanged.

## Consequences

- the user does not need to open a failed session, inspect empty panels or manually copy multiple logs when a recent persisted session pointer exists;
- diagnostics can recover evidence from an already-created failed session without invoking the model again;
- the recovery path can separate missing model, missing Provider connection, invalid Agent, server/config failure or another endpoint-level cause;
- automatic evidence remains one-shot, read-only and privacy-bounded;
- the original incident also proved that source inspection and plugin-local state may be insufficient. Runtime failures may require selectable external evidence surfaces such as the exact browser target, DCF Host state, original extension storage, OpenCode API/database data and service logs;
- a successful diagnostic report is not proof of model execution; after the cause is repaired, a fresh read-only dialogue request must still complete.

## Acceptance outcome

Implementation evidence proves diagnostics `.1` is registered, starts successfully and contains the loopback GET-only privacy-bounded recovery path.

The original live automatic-report acceptance did not pass or fail at the HTTP-probe stage. It was not reached because dialogue plugin data no longer contained session `ses_08a14519cffe3I29cL7721KlVm` when diagnostics `.1` started.

The incident itself is closed by separate runtime evidence and a fresh end-to-end acceptance:

- OpenCode standalone CLI upgraded from `1.17.8` to `1.18.3`;
- native message smoke returned `OPENCODE_SCHEMA_OK`;
- DCF request `dcf-dialogue-readonly-smoke-20260719-upgrade-01` completed in session `ses_089953d95ffe3kyJBThTifGIoj`;
- the same conversation automatically received `DCF_READ_ONLY_SMOKE_OK` with no endpoint errors.

A future intentionally retained failed-session fixture may exercise the automatic `dcf.local-agent.diagnostic.v1` return path without changing this incident's recorded outcome.
