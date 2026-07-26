# ADR: Dialogue remount and status semantics

Date: 2026-07-18
Status: accepted; live acceptance pending

## Decision

The dialogue adapter must rediscover the Local Agent panel after the Shell has moved it into its visible component tree. It observes Shell and panel readiness events and does not report startup success until its card is mounted.

Local Agent and dialogue accept both direct and wrapped session-status maps. A successful status response without an active entry means idle; a failed status response is shown as unavailable. Synchronous message completion remains authoritative.

Current request and session identifiers appear only during active work. Retained identifiers are labeled as recent handoff history.

## Acceptance

An in-page DCF update restores the dialogue card without a page refresh. Idle or completed work does not show unknown, and retained identifiers do not appear as current execution state.
