# ADR: Persistent DCF workspace tabs

Date: 2026-07-18
Status: accepted; live acceptance pending

## Context

DCF plugin updates rebuild the active plugin combination. During live use, a Local Agent panel pinned to the workspace tab bar disappeared after an otherwise successful update and had to be pinned again.

Pinned tabs and the active tab are user workspace choices, not properties of a plugin release. Requiring the user to reconstruct them after updates creates avoidable cognitive work.

## Decision

- Treat `pinned_panels` and `active_panel` as persistent user workspace state.
- Keep the existing Shell storage, and add a second copy owned by Plugin Manager because Plugin Manager is the UI that changes this preference.
- Persist the current Shell state before starting a DCF update.
- On Plugin Manager startup, seed its memory from existing Shell plugin data when its own namespace has no prior memory.
- After Shell reports ready, reapply remembered pins and the active panel without disabling any feature.
- Keep the Function panel permanently present.
- Do not move this preference into the DCF base or candidate snapshot.

## Rationale

A candidate transaction should change executable capability while preserving the user's working arrangement. Redundant preference storage is justified here because Shell and Plugin Manager can be replaced during the same activation, and the preference is small, deterministic and user-owned.

## Acceptance boundary

Automated checks cover storage ownership, pre-update saving, Shell-data migration and post-ready restoration. Browser acceptance must prove that Local Agent remains pinned after the next successful DCF update and that the previous active tab is restored when available.
