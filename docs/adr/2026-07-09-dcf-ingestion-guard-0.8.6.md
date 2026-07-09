# ADR: DCF guarded ingestion repair 0.8.6

Date: 2026-07-09
Status: accepted

## Context

After release `0.8.5`, the automatic module-ingestion path successfully produced feedback, but it also exposed a guard failure: explanatory placeholder text between module-pack markers was treated as a real package and passed to `JSON.parse`.

The reported feedback was a `json_parse_failed` event caused by an ellipsis placeholder. This means the feedback path worked, but the ingestion candidate filter was too permissive.

A second safety issue was identified at the same time: feedback insertion used a replace-style composer write. That is acceptable only when the composer is empty. It must not overwrite user draft text.

## Decision

Release `0.8.6` keeps the light capability-bus kernel and adds an ingestion guard.

The guarded ingestion path now classifies each detected module-pack block before parsing:

- empty block: ignore;
- ellipsis or explanatory placeholder: ignore;
- content that does not begin as a JSON object: ignore;
- content without an obvious schema marker: ignore;
- JSON-looking content: parse and validate normally.

Ignored placeholders are recorded in the lightweight local log and `seenBlocks`, but they do not emit failure feedback to the conversation.

Real JSON parse failures still emit concise feedback, because those likely indicate an attempted module package with malformed JSON.

Feedback emission is also made draft-safe:

- empty composer: insert feedback and attempt to send;
- non-empty composer: copy feedback to clipboard and show a sidebar notice instead of replacing the user's draft;
- missing composer: copy feedback and show fallback notice.

## Boundary

This is a kernel repair because it changes the generic ingestion and feedback safety path. It does not add language ammunition behavior, business UI, or plugin-specific logic.

Future explanatory documentation and assistant replies should avoid placing active module-pack open and close markers around non-installable examples. Use escaped or inactive notation for format explanations.

## Verification target

After installing `0.8.6`:

1. A placeholder-only module-pack example should be ignored and logged as an ignored package, without failure feedback.
2. A malformed JSON object that looks like a real package should still produce `json_parse_failed` feedback.
3. A valid module package should install as before.
4. If the composer already contains user text, feedback should not overwrite it.
