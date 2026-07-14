# ADR: Runtime performance attribution sessions

Date: 2026-07-14  
Status: accepted

## Context

The first real 0.16.0 safe-mode report observed 116 optimized turns and only 1ms for the last DCF reconciliation, but still recorded 10 Long Tasks totaling 4212ms in one minute. Long Tasks prove main-thread blocking but generally do not identify the responsible page script or distinguish script execution from rendering and layout.

## Decision

- Add a user-started, bounded 60-second Runtime attribution session.
- Prefer `long-animation-frame` entries for frame duration, blocking duration, render/style-layout breakdown and script attribution.
- Observe `event` entries for input, processing and presentation delay, and `layout-shift` entries without retaining source nodes.
- Keep `longtask` as a fallback and comparison signal.
- Measure DCF apply work separately with reason, count, total and maximum duration, plus mutation batch counts.
- Exclude entries whose Performance Timeline start precedes the session start so the start-button interaction does not dominate the sample.
- Sanitize script sources to category, hostname and final path components; omit query, fragment, event target, DOM/message text and stack.
- Export one `DCF_CONVERSATION_PERFORMANCE_ATTRIBUTION` block for analysis.

## Limits

LoAF script attribution covers page main-world work and can omit extension isolated worlds, cross-origin work or callbacks without source data. Reported locations are entry points rather than guaranteed hotspots. Script, render, layout and interaction durations overlap. The report is evidence for the next investigation, not an automatic causal verdict.
