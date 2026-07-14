# ADR: Stateful command feedback

Date: 2026-07-14  
Status: accepted

## Context

Several DCF controls represent durable or live state, but were rendered like one-shot actions. After arming the next question-answer attribution, the button looked unchanged, so the user could not tell whether the click had taken effect. The same ambiguity applied to mutually exclusive performance modes and other current selections.

## Decision

- Add a finite declarative `command.ui_state` contract resolved only against named user/environment/runtime state sources.
- Render stateful controls with a status dot, distinct border/background, state-aware wording and `aria-pressed`.
- Use separate visual states for selected, armed, running and complete.
- Refresh question-answer command states in place on send and first-reply lifecycle signals; completion may continue to render the normal completion notice.
- Apply the same selected-state convention to current module role, active Profile and ammo firing mode.
- Leave one-shot actions visually neutral unless a reliable continuing state is declared.

## Boundaries

- State is never inferred from Chinese labels or the most recent command receipt.
- Color is not the sole signal.
- Package authors cannot query arbitrary page DOM through `ui_state`; runtime sources are supplied by the trusted bootstrap as a finite snapshot.
- A command that merely succeeded is not automatically considered active.
