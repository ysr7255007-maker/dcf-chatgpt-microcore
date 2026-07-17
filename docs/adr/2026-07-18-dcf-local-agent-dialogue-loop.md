# ADR: Local Agent dialogue loop

Date: 2026-07-18
Status: accepted; live acceptance pending

## Context

The Local Agent workbench can submit OpenCode tasks and place results into ChatGPT, but the current conversation still needs the user to copy both directions. DCF therefore lacks a direct conversation-to-local-agent handoff.

The first live test exposed two additional correctness requirements. An assistant message is streamed incrementally, so inspecting its DOM node only once can miss the completed artifact. The Local Agent workbench also rebuilds its content after save/connect, so a bridge card mounted inside that content is transient. Finally, a user cannot trust an automated handoff that gives no visible acknowledgement or progress.

The first successfully returned request then exposed an execution-level failure: `POST /session/:id/prompt_async` returned success, but the new session remained absent from `/session/status`, produced no listed messages, and timed out with every observation endpoint still reachable. An asynchronous acceptance response therefore cannot be treated as proof that OpenCode has started or completed the task.

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
- Show the current stage, request ID, full session ID, elapsed time, status, message/todo/diff/permission/question counts, and recent local output.
- Mount the dialogue card outside the Local Agent `.content` rerender boundary and remount it if the whole panel host is replaced.
- Use only generic plugin storage and startup evidence. The Chrome manifest, background code, Host API and base version remain unchanged.

## Rationale

The workbench owns observation and manual intervention. The adapter owns reliable handoff. Keeping these responsibilities separate allows the handoff to be disabled independently without moving OpenCode behavior into the DCF base.

Observability is part of correctness: the user must be able to distinguish not detected, received, connecting, submitted, running, waiting for intervention, completed and failed. A silent background path increases rather than reduces cognitive loss.

An HTTP 204 from an asynchronous enqueue endpoint proves only that the server accepted the request. The synchronous message endpoint provides a direct success or failure result while parallel polling preserves the interactive behavior required for permissions, questions and progress.

## Acceptance boundary

Automated checks cover the artifact boundary, tolerant parsing, streaming completion detection, manual rescan, stable controls, synchronous message completion, parallel intervention observation, progress surface, rerender-resistant mounting, deduplication, result return and base independence. Browser acceptance must still prove a completed local response, composer return, intervention states and the reserved task: creating the `DCF OpenCode Service` shortcut.