from pathlib import Path

compact = Path('docs/adr/2026-07-19-dcf-dialogue-compact-result-boundary.md')
compact.write_text('''# DCF dialogue bounded return profiles

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
''')

model = Path('docs/adr/2026-07-19-dcf-local-agent-model-persistence.md')
model.write_text('''# DCF Local Agent canonical model persistence

Date: 2026-07-19

Status: accepted; implementation and GitHub Action verification complete; live browser acceptance pending

## Context

The Local Agent workbench encoded each model option as `providerID + U+0000 + modelID` inside an HTML `option` value. That control-character representation was not a reliable browser form value. In addition, immediately after plugin load the provider catalog could still be empty, so a valid persisted model had no matching option. Pressing `保存并连接` in either state could decode the selector as empty and overwrite the saved model with `null`.

The dialogue adapter also preferred the current model selector value over persisted configuration. Manual Local Agent tasks used `state.config.model`, while automatic dialogue delegation could consume a temporary unsaved DOM value. The two entry paths therefore lacked one authoritative model selection.

## Decision

1. Model option values use URI-encoded JSON and a shared safe decoder; the U+0000 separator is removed.
2. The persisted Local Agent model is the canonical model for every task-submission path.
3. If the provider catalog is unavailable or no longer lists the persisted model, the selector renders a synthetic `已保存` option for that exact provider/model pair and keeps it selected.
4. `保存并连接` preserves the restored model. It clears the model only when the user explicitly selects `OpenCode 默认模型` and saves.
5. Manual new-session execution and current-session continuation keep submitting `state.config.model`.
6. Automatic dialogue delegation reads the normalized persisted model rather than an unsaved dropdown value.
7. Page-only password input remains live-only because it is intentionally not persisted.

## Consequences

- One saved model governs the workbench, continued sessions and ChatGPT dialogue delegation.
- Hot refresh, page refresh and temporarily unavailable provider catalogs no longer silently erase the model.
- A saved model remains visible even if it is temporarily absent from the current provider catalog.

## Reconsideration conditions

Reconsider when explicit per-request model overrides are added to `dcf.local-agent.request.v1`. Such overrides must be isolated to that request and must not mutate the saved default model.
''')

index = Path('docs/adr/status-index.md')
text = index.read_text()
old = '- `2026-07-19-dcf-dialogue-compact-result-boundary.md` — **accepted; implementation and automated verification complete; live browser acceptance pending**; automatic dialogue results contain only the latest formal Assistant text and never return raw OpenCode message history\n'
new = '- `2026-07-19-dcf-dialogue-compact-result-boundary.md` — **accepted; implementation and GitHub Action verification complete; live browser acceptance pending**; final, all-session reasoning-review and bounded diagnostic profiles replace raw message-history return\n'
if old not in text:
    raise SystemExit('compact ADR index entry not found')
text = text.replace(old, new, 1)
model_line = '- `2026-07-19-dcf-local-agent-model-persistence.md` — **accepted; implementation and GitHub Action verification complete; live browser acceptance pending**; one persisted provider/model selection governs workbench, continued-session and dialogue delegation paths\n'
if model_line not in text:
    text = text.replace('## Current\n\n', '## Current\n\n' + model_line, 1)
index.write_text(text)

state = Path('docs/current-state.md')
text = state.read_text()
old_lines = '''- the manual workbench covers connection, agent/model, sessions, tasks, status, messages, todo, diff, abort, permissions, questions, result insertion and diagnostics;
- the dialogue adapter accepts exact `dcf.local-agent.request.v1` artifacts, creates an independent session, and returns one final `dcf.local-agent.result.v1` to the same conversation;
- dialogue `.10` keeps raw OpenCode messages internal and returns only the latest Assistant `type: "text"` content as `assistant_result`; automatic result artifacts never include the `messages` collection, including for legacy `return_mode: full`;
'''
new_lines = '''- the manual workbench covers connection, agent/model, sessions, tasks, status, messages, todo, diff, abort, permissions, questions, result insertion and diagnostics;
- Local Agent `.3` uses safe encoded model values, restores a persisted model even before the provider catalog is available, and clears it only after an explicit saved selection of `OpenCode 默认模型`;
- the dialogue adapter accepts exact `dcf.local-agent.request.v1` artifacts, creates an independent session, and returns one final `dcf.local-agent.result.v1` to the same conversation;
- dialogue `.11` uses the persisted Local Agent model for automatic delegation and supports `final`, `reasoning` and `diagnostic` return profiles; reasoning covers all Assistant turns in the current delegated session, diagnostic evidence is bounded, and no profile returns raw messages;
'''
if old_lines not in text:
    raise SystemExit('current-state product block not found')
text = text.replace(old_lines, new_lines, 1)
text = text.replace(
    '- compact-result tests execute the formal-text extractor against mixed reasoning/tool/text messages and prove raw `messages` are absent from the result payload;\n',
    '- return-profile tests prove final-text isolation, complete current-session reasoning extraction, bounded diagnostic evidence and absence of raw `messages`;\n- model-persistence tests prove safe model-value round trips, persisted fallback rendering and one canonical model for automatic delegation;\n',
    1,
)
text = text.replace(
    '- dialogue `.10` compact-result behavior has automated verification; real-browser acceptance of a `return_mode: full` request remains pending;\n',
    '- Local Agent `.3` model persistence and dialogue `.11` return profiles have automated verification; real-browser model-identity and three-profile acceptance remain pending;\n',
    1,
)
state.write_text(text)
