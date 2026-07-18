# ADR: Local Agent dialogue loop

Date: 2026-07-18
Status: accepted; partial live acceptance, OpenCode execution failure under diagnosis

## Context

The Local Agent workbench can submit OpenCode tasks and place results into ChatGPT, but the current conversation still needs the user to copy both directions. DCF therefore lacks a direct conversation-to-local-agent handoff.

The first live test exposed two additional correctness requirements. An assistant message is streamed incrementally, so inspecting its DOM node only once can miss the completed artifact. The Local Agent workbench also rebuilds its content after save/connect, so a bridge card mounted inside that content is transient. Finally, a user cannot trust an automated handoff that gives no visible acknowledgement or progress.

The first successfully returned request then exposed an execution-level failure: `POST /session/:id/prompt_async` returned success, but the new session remained absent from `/session/status`, produced no listed messages, and timed out with every observation endpoint still reachable. An asynchronous acceptance response therefore cannot be treated as proof that OpenCode has started or completed the task.

After dialogue `.8` passed its complete in-page runtime acceptance, a fresh read-only request `dcf-dialogue-readonly-smoke-20260718-1549-01` proved post-start assistant-event intake, independent session creation and automatic result return. The synchronous `POST /session/:id/message` request then returned HTTP 500 after 1.314 seconds. The returned result preserved the session ID and endpoint classification but discarded the session messages and any assistant-side model/provider error, so the exact OpenCode cause remains unobserved.

## Decision

- Add `dcf.firstparty.local-agent-dialogue` as an independent protocol adapter.
- Do not add a new tab. Put its status and switches inside the existing Local Agent panel.
- Accept a complete versioned request artifact delimited by exact markers. Ignore normal prose, partial snippets and user messages.
- Normalize non-breaking and zero-width characters, tolerate an optional Markdown code fence and surrounding rendered text, and report the actual JSON parse error with a bounded excerpt.
- Reinspect assistant messages while their rendered text changes, and allow a manual rescan that bypasses prior observations.
- Create a separate OpenCode session for each v1 request and persist request IDs for deduplication.
- Reuse the Local Agent connection, agent and model settings.
- Use `POST /session/:id/message` as the execution and completion authority. Keep that request pending while polling status, messages, todo, diff, permissions and questions for observation and intervention.
- Treat `/session/status` as supplemental evidence, not the completion authority. A missing status entry is shown as `message-pending` while the message request remains active.
- Return one versioned result artifact to the same conversation. Do not overwrite an occupied composer.
- Surface permission or question waits to the user instead of answering them automatically.
- Keep connection, message-request and observation-endpoint failures in the result evidence.
- A failed synchronous message request must not be collapsed into an empty generic bridge error. Before returning failure, collect the created session's messages, status, todo, diff, permissions and questions; preserve assistant `info.error`, agent/model identity and the bounded HTTP response body when available.
- Distinguish transport/adapter failure from OpenCode execution/provider failure in the result status.
- Show the current stage, request ID, full session ID, elapsed time, status, message/todo/diff/permission/question counts, and recent local output.
- Mount the dialogue card outside the Local Agent `.content` rerender boundary and remount it if the whole panel host is replaced.
- Use only generic plugin storage and startup evidence. The Chrome manifest, background code, Host API and base version remain unchanged.

## Rationale

The workbench owns observation and manual intervention. The adapter owns reliable handoff. Keeping these responsibilities separate allows the handoff to be disabled independently without moving OpenCode behavior into the DCF base.

Observability is part of correctness: the user must be able to distinguish not detected, received, connecting, submitted, running, waiting for intervention, completed and failed. A silent background path increases rather than reduces cognitive loss.

An HTTP 204 from an asynchronous enqueue endpoint proves only that the server accepted the request. The synchronous message endpoint provides a direct success or failure result while parallel polling preserves the interactive behavior required for permissions, questions and progress. A synchronous HTTP failure is still an OpenCode session event and must retain the session-side evidence needed to identify its cause.

## Acceptance boundary

Live evidence already proves exact request detection after plugin startup, independent session creation and automatic result return. It does not yet prove successful OpenCode model execution. The next acceptance must first expose the persisted error from session `ses_08a14519cffe3I29cL7721KlVm`; after the cause is repaired, a new read-only request must complete with `DCF_READ_ONLY_SMOKE_OK`. Only then may the reserved write task create the `DCF OpenCode Service` shortcut.
