# DCF Local Agent canonical model persistence

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
