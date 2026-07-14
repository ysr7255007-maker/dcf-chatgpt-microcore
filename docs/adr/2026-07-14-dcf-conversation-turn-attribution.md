# ADR: Conversation-turn performance attribution

Date: 2026-07-14  
Status: accepted

## Context

The user's dominant slowdown occurs after sending a message and during the wait and streaming reply. A fixed 60-second sample can mix unrelated idle, scrolling and typing work and can miss long replies or dilute the problematic interval.

## Decision

- Make one question-answer turn the primary attribution boundary.
- Arm first; start collection only on the next send click or Enter action.
- Use the send event timeline timestamp so the send interaction itself is included while the arm-button interaction is excluded.
- Mark first assistant DOM activity and automatically finish when the bounded reply observer declares the response complete.
- Report total send-to-complete, send-to-first-reply activity and first-reply-activity-to-complete durations.
- Keep a ten-minute default safety timeout and manual finish only as recovery.
- Capture no composer text, user message body or assistant reply body.

## Limits

Send-to-first-reply time includes backend, network, scheduling and browser work. Runtime APIs can identify simultaneous main-thread blocking but cannot decompose server-side waiting. Reply completion is detected after a quiet window, so the report retains that detection margin.
