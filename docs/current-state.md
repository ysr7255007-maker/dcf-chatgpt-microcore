# DCF Current State

Updated: 2026-07-18

## Current product state

- Chrome candidate: `1.0.0-rc.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Product baseline: complete DCF Next before Core Review
- User acceptance:
  - Shell hot update and exclusive panel switching passed in a real browser;
  - pinned workspace tabs, arrows, wheel switching and selectable ammo UI are in real use;
  - Local Agent connected on the real Mac to an independent OpenCode server at `127.0.0.1:4096`, without authentication and with the required browser origins allowed;
  - the dialogue loop is implemented in the candidate and awaits its first end-to-end browser task.
- Data continuity: DCF Next + Chrome `rc.1`; no separate `0.18.2` migration

## Implemented

- one Manifest V3 Chrome extension as the only user installation;
- static pure base with no normal DCF product code;
- ten independent self-contained first-party plugins:
  - shell;
  - language ammo;
  - long-conversation relief;
  - question-answer attribution;
  - appearance;
  - Local Agent OpenCode client;
  - Local Agent dialogue-loop adapter;
  - backup;
  - plugin manager;
  - diagnostics;
- one unique `USER_SCRIPT` world and registration per plugin;
- immutable plugin versions and SHA-256 verification;
- candidate/current/LKG exact combinations and startup-evidence commit;
- automatic rollback and registration reconstruction;
- fixed GitHub plugin index and six-hour update checks;
- Shell shows pinned workspaces while the Function page manages pinning;
- language ammo uses selectable cards, a scrollable list and one shared action dock;
- Local Agent remains a pure plugin and directly uses the OpenCode HTTP API;
- the manual workbench covers connection, agent/model, sessions, tasks, status, messages, todo, diff, abort, permissions, questions, result insertion and diagnostics;
- the dialogue adapter accepts only exact `dcf.local-agent.request.v1` artifacts, creates an independent session, and returns `dcf.local-agent.result.v1` to the same conversation;
- request IDs are persisted for deduplication;
- permission and question waits are surfaced rather than answered automatically;
- an occupied ChatGPT composer is never overwritten.

## Automated evidence

`npm run verify:chrome` proves:

- the base contains no bundled product unit archive;
- ten plugin hashes, unique worlds and self-contained IIFEs;
- default GitHub install, exact registration and startup evidence;
- updating one plugin preserves the other nine references;
- generic plugin data isolation and base update checks;
- deterministic Chrome ZIP generation;
- workspace tab and selectable ammo boundaries;
- Local Agent and its dialogue adapter do not add dedicated Manifest, background or Host API behavior;
- exact request/result markers, persistent deduplication, OpenCode session submission and result-return code paths exist.

## Known boundary before acceptance

- the dialogue loop still needs real ChatGPT DOM and OpenCode verification;
- the first task is intentionally reserved for creating and verifying the `DCF OpenCode Service` macOS shortcut;
- automated checks do not claim long-task completion, intervention handoff or automatic composer sending already passed live acceptance;
- `serve.sh` remains manually managed until that shortcut exists and the start-service control is wired to it;
- the candidate index points to the candidate branch, while formal store builds point to `main`;
- PR #23 remains unmerged until explicit browser acceptance.
