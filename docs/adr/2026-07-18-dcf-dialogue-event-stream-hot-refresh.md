# ADR: Dialogue event stream and hot refresh

Date: 2026-07-18
Status: accepted; live acceptance pending

## Decision

Existing assistant messages are a historical baseline, not a task queue. The dialogue adapter consumes only assistant replies added after startup. Manual recovery checks only the latest assistant reply, and clearing deduplication records never replays history.

The adapter observes Local Agent panel replacement before loading plugin state, remounts its card when the panel appears or changes, and waits for a visible mount before reporting startup success. A periodic mount check remains only as recovery.

The adapter stays an independent plugin. The Chrome manifest, background code, Host API and DCF base remain unchanged.

## Acceptance

A DCF update must leave the dialogue card visible without refreshing the page. Historical marked replies must remain inert. A newly emitted request must be consumed exactly once.