# DCF dialogue compact result boundary

Date: 2026-07-19

Status: accepted; implementation and automated verification complete; live browser acceptance pending

## Context

The dialogue adapter observes the full OpenCode session so it can detect activity, permissions, questions, Todo and Diff. That internal evidence was also copied into `dcf.local-agent.result.v1` whenever a request used `return_mode: full`. The returned artifact therefore included every Assistant reasoning part, tool call, step marker and prior message. A few normal exchanges could consume a large portion of the ChatGPT conversation context even though the user only needed the final answer.

The same broad extractor treated reasoning, tools and `step-finish` markers as an Assistant result. This allowed a reasoning-only or truncated turn to look like a formal result and could mark an idle session completed without a final text response.

## Decision

1. Automatic `dcf.local-agent.result.v1` artifacts never contain the raw `messages` collection.
2. `assistant_result` is the text from the latest Assistant message that contains one or more `type: "text"` parts. Reasoning, tools, patches and step markers are excluded.
3. A session reaches the normal `completed` result path only when formal Assistant text exists.
4. Permission-request `recent_assistant_output` and the visible progress preview use the same formal-text extractor.
5. Raw messages remain available inside the plugin for activity fingerprints, permissions, questions, diagnostics and manual evidence recovery; they are not transported into the normal conversation result.
6. `return_mode` remains accepted for request compatibility, but `full` no longer expands the automatic result artifact.

## Consequences

- Normal dialogue results remain bounded by the final answer plus structured Todo, Diff, permissions, questions and execution metadata.
- Internal observability is preserved without turning the ChatGPT conversation into an execution log archive.
- Users needing raw messages must use an explicit diagnostic or manual evidence surface rather than the automatic final result.
- Live browser acceptance must confirm that a request carrying `return_mode: full` still returns no `messages` field and that `assistant_result` contains only the final formal text.

## Reconsideration conditions

Reconsider only if a separately named diagnostic protocol is introduced with explicit user intent, size limits and privacy boundaries. Raw session history must not be restored to the normal result schema merely for convenience.
