# ADR: Recover Local Agent execution failures through the diagnostics plugin

Date: 2026-07-18  
Status: accepted; live diagnostic evidence pending

## Context

Dialogue `.8` successfully consumed a new assistant request, created an independent OpenCode session and returned a result to the same ChatGPT conversation. The synchronous `POST /session/:id/message` call then returned HTTP 500 before OpenCode persisted any Assistant message.

The returned `bridge_error` kept the session ID but discarded the evidence needed to distinguish an adapter failure from a model, Provider, Agent or OpenCode execution failure. Opening the session and copying messages could not recover the cause because the session contained no Assistant result or persisted message error.

The failed session ID and request ID already exist in dialogue plugin data. The existing diagnostics plugin is the product boundary intended to turn runtime state into privacy-bounded evidence.

## Decision

1. Extend the existing `dcf.firstparty.diagnostics` plugin instead of adding a temporary eleventh plugin, a new tab or any base behavior.
2. The diagnostics plugin may read the dialogue plugin's most recent request/session identifiers and the Local Agent plugin's connection, Agent and model selection.
3. For each previously undiagnosed recent session, perform one automatic read-only probe after the diagnostics plugin starts. Store only the diagnosed session ID and diagnostic timestamp in the diagnostics namespace so the same session is not automatically reported again.
4. The probe is restricted to loopback HTTP GET requests. It may read health, session details, session status, message metadata, todo/diff counts, Provider/model catalogs, Agent catalogs and workspace path/VCS identity. It must not submit prompts, commands, shell requests, permissions or configuration changes.
5. Emit `dcf.local-agent.diagnostic.v1` between exact markers and automatically return it to the current conversation when the composer is free.
6. The returned artifact excludes message text, task text, credentials, Provider private options and raw OpenCode configuration. It may include bounded persisted error objects, role counts, selected Agent/model IDs, Provider/model presence, connected/default Provider summaries and endpoint failures.
7. This recovery path does not remove the dialogue adapter's responsibility. A later dialogue revision must preserve synchronous HTTP response details and session-side evidence directly in `dcf.local-agent.result.v1`. The diagnostics plugin remains useful for failures that occurred before that revision or outside the adapter.
8. The Manifest, background, Host API and static base remain unchanged.

## Consequences

- the user no longer has to open a failed session, inspect empty panels or manually copy multiple logs;
- an update to diagnostics can recover evidence from the already-created failed session without invoking the model again;
- the current HTTP 500 can be separated into missing model, missing Provider connection, invalid Agent, server/config failure or another endpoint-level cause;
- automatic evidence remains one-shot, read-only and privacy-bounded;
- a successful diagnostic report is not proof of model execution; after the cause is repaired, a fresh read-only dialogue request must still complete.

## Acceptance

After installing diagnostics `.1`, the existing failed session `ses_08a14519cffe3I29cL7721KlVm` is probed without a new model request. The current conversation receives one complete `dcf.local-agent.diagnostic.v1` artifact automatically. The artifact must explicitly state that message text and credentials are excluded and must provide enough Provider/model/Agent and endpoint evidence to identify the next repair.
