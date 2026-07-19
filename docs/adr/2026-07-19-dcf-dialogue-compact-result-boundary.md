# DCF dialogue bounded return profiles

Date: 2026-07-19

Status: accepted; implementation and GitHub Action verification complete; live browser acceptance pending

## Context

The dialogue adapter must observe the full OpenCode session internally so it can detect activity, permissions, questions, Todo, Diff and execution failures. Returning the raw `messages` collection copied that internal execution history into ChatGPT, including reasoning, tool calls and step records, and could exhaust the conversation context after only a few delegated tasks.

A final-text-only result solved the context problem, but it also removed two useful review surfaces. The remote assistant sometimes needs the complete reasoning path across the current delegated session to detect a gradual conceptual deviation. When the bridge or execution flow itself is faulty, it also needs structured tool and lifecycle evidence. Neither need requires raw OpenCode messages.

## Decision

1. `dcf.local-agent.result.v1` has three bounded request-level return profiles selected by `return_mode`.
2. `final` is the default. Legacy `summary` also maps to `final`. It returns the result envelope and only the latest formal Assistant `type: "text"` body. A bridge failure also includes its error text.
3. `reasoning` returns the same final body plus every Assistant `type: "reasoning"` part from every Assistant turn in the current delegated OpenCode session, in chronological order. It does not return tools, step records or raw messages. Aliases `review` and `audit` map to this profile.
4. `diagnostic` returns the final body, the complete current-session reasoning trace and bounded structured process evidence: Assistant turn metadata, finish reasons, provider/model/Agent identity, tokens, part types, tool calls, Todo, Diff, permissions, questions and execution endpoint status.
5. Tool input, output and metadata in the diagnostic profile are size-bounded. Oversized values become a preview, character count and hash rather than an unbounded payload.
6. Legacy `full` and alias `debug` map to `diagnostic`; they never restore the raw `messages` collection.
7. `assistant_result`, permission-request recent output and the visible progress preview continue to use only formal Assistant text.
8. Normal completion still requires formal Assistant text. Reasoning-only or `finish: length` execution cannot masquerade as a completed final result.

## Consequences

- Normal dialogue remains extremely compact.
- Reasoning review can assess the whole reasoning trajectory rather than only the final Assistant turn.
- Flow debugging receives enough structured evidence to identify wrong-model selection, truncation, tool failure or bridge state errors without copying the session transcript.
- The plugin keeps raw messages internal for observation and manual recovery only.

## Reconsideration conditions

Reconsider the diagnostic evidence fields when real incidents show that a missing bounded field prevents diagnosis. Raw session history must not be reintroduced into automatic result artifacts.
