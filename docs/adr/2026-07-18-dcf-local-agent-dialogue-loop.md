# ADR: Local Agent dialogue loop

Date: 2026-07-18
Status: accepted; live acceptance pending

## Context

The Local Agent workbench can submit OpenCode tasks and place results into ChatGPT, but the current conversation still needs the user to copy both directions. DCF therefore lacks a direct conversation-to-local-agent handoff.

The first live test exposed two additional correctness requirements. An assistant message is streamed incrementally, so inspecting its DOM node only once can miss the completed artifact. The Local Agent workbench also rebuilds its content after save/connect, so a bridge card mounted inside that content is transient. Finally, a user cannot trust an automated handoff that gives no visible acknowledgement or progress.

## Decision

- Add `dcf.firstparty.local-agent-dialogue` as an independent protocol adapter.
- Do not add a new tab. Put its status and switches inside the existing Local Agent panel.
- Accept only a complete assistant message carrying the exact versioned request artifact. Normal prose, examples, partial snippets and user messages are ignored.
- Reinspect assistant messages while their rendered text changes, and allow a manual rescan that bypasses prior observations.
- Create a separate OpenCode session for each v1 request and persist request IDs for deduplication.
- Reuse the Local Agent connection, agent and model settings.
- Return one versioned result artifact to the same conversation. Do not overwrite an occupied composer.
- Surface permission or question waits to the user instead of answering them automatically.
- Keep connection and endpoint failures in the result evidence.
- Show the current stage, request ID, full session ID, elapsed time, status, message/todo/diff/permission/question counts, and recent local output.
- Mount the dialogue card outside the Local Agent `.content` rerender boundary and remount it if the whole panel host is replaced.
- Use only generic plugin storage and startup evidence. The Chrome manifest, background code, Host API and base version remain unchanged.

## Rationale

The workbench owns observation and manual intervention. The adapter owns reliable handoff. Keeping these responsibilities separate allows the handoff to be disabled independently without moving OpenCode behavior into the DCF base.

Observability is part of correctness: the user must be able to distinguish not detected, received, connecting, submitted, running, waiting for intervention, completed and failed. A silent background path increases rather than reduces cognitive loss.

## Acceptance boundary

Automated checks cover the artifact boundary, streaming completion detection, manual rescan, progress surface, rerender-resistant mounting, deduplication, API paths, result return and base independence. Browser acceptance must still prove one-time detection, long-task completion, composer return, intervention states and the first reserved task: creating the `DCF OpenCode Service` shortcut.
