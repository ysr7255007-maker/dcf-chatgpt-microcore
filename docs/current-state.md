# DCF Current State

Updated: 2026-07-19

## Current product state

- Chrome candidate: `1.0.0-rc.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Product baseline: complete DCF Next before Core Review
- User acceptance:
  - Shell hot update and exclusive panel switching passed in a real browser;
  - pinned workspace tabs, arrows, wheel switching and selectable ammo UI are in real use;
  - Local Agent connected on the real Mac to an independent OpenCode server at `127.0.0.1:4096`, without authentication and with the required browser origins allowed;
  - dialogue `.7` proved the card can hot-remount inside the Shell-hosted Local Agent panel, history is shown as an inert baseline, the latest-only control is visible and idle status is no longer `unknown`;
  - the same live check found that dialogue controls were rendered but unbound because `ShadowRoot.dataset` was used as an event-binding marker;
  - dialogue `.8` fixed the binding boundary and its real-page `一键验收并回传` report passed all ten checks;
  - the accepted report proved true in-page hot replacement, one event binding, inert three-message history baseline, persisted clearing without replay, retained active `local-agent` workspace and matching plugin versions/hashes;
  - fresh request `dcf-dialogue-readonly-smoke-20260718-1549-01` was detected after startup, created session `ses_08a14519cffe3I29cL7721KlVm` and automatically returned a structured `bridge_error` result after synchronous `POST /session/:id/message` returned HTTP 500;
  - diagnostics `.1` was downloaded, registered, started and committed successfully, but its one-shot recovery report was not generated because the persisted dialogue `last_session_id` was already empty when diagnostics started;
  - browser CDP, the original Chrome extension LevelDB, OpenCode HTTP/SQLite data and server logs established that the HTTP 500 was not a DCF, Provider, model or Agent error: standalone OpenCode CLI `1.17.8` was incompatible with the database schema already used by the regularly updated Desktop App and failed with `SQLiteError: no such column: replacement_seq`;
  - the standalone CLI was upgraded to `1.18.3`, the old `serve` process was stopped gracefully and the service was restarted with the same port, CORS and no-password behavior;
  - native OpenCode smoke `OPENCODE_SCHEMA_OK` then passed and `POST /session/:id/message` returned HTTP 200;
  - fresh DCF request `dcf-dialogue-readonly-smoke-20260719-upgrade-01` created session `ses_089953d95ffe3kyJBThTifGIoj`, completed in 6.452 seconds and automatically returned `DCF_READ_ONLY_SMOKE_OK` with no endpoint, permission, question, todo or diff errors.
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
- existing assistant replies form an inert startup baseline; automatic intake consumes only assistant replies added after startup and manual recovery checks only the latest assistant reply;
- dialogue controls bind to the actual mounted ShadowRoot identity rather than storing metadata on ShadowRoot;
- `一键验收并回传` clears deduplication/recent-handoff state, verifies persistence, mount, event binding, status semantics and workspace preservation, then returns one `dcf.local-agent-dialogue.acceptance.v1` artifact automatically;
- diagnostics reads the latest dialogue request/session identifiers, performs loopback GET-only evidence recovery and returns one `dcf.local-agent.diagnostic.v1` artifact automatically when a persisted recent session exists;
- automatic Local Agent diagnostics excludes message/task text, credentials, Provider private options and raw OpenCode configuration;
- the same failed session is automatically diagnosed only once;
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
- Local Agent, dialogue and diagnostics changes do not add dedicated Manifest, background or Host API behavior;
- exact request/result/acceptance/diagnostic markers, persistent deduplication, latest-only intake, ShadowRoot event binding, synchronous OpenCode session submission, structured one-click acceptance and automatic return code paths exist;
- Local Agent failure diagnostics is loopback-only, GET-only, one-report-per-session and excludes message text, credentials, Provider private options and raw configuration.

## Current live boundary

- runtime acceptance for dialogue `.8` is complete;
- actual post-start request detection, independent session creation, successful OpenCode model execution and automatic result return are proven end to end;
- the accepted minimal result is `DCF_READ_ONLY_SMOKE_OK` from session `ses_089953d95ffe3kyJBThTifGIoj`, with status `completed`, OpenCode status `idle` and every observation endpoint error field `null`;
- the prior HTTP 500 was caused by an external runtime-version mismatch: an old standalone OpenCode CLI `1.17.8` was serving a database schema already used by a newer Desktop App; upgrading and restarting the CLI at `1.18.3` restored native and DCF execution without a DCF code change;
- source inspection is not sufficient evidence for browser/runtime failures. Future diagnosis must use selectable runtime evidence surfaces such as the exact ChatGPT target, DCF Host state, plugin storage, CDP console/network, OpenCode API/database and service logs;
- diagnostics `.1` remains implemented as a privacy-bounded recovery path, but its original auto-report acceptance was not exercised because the persisted recent-session pointer was absent;
- a later dialogue revision should still preserve bounded HTTP status, response-body and session-side failure evidence directly in `dcf.local-agent.result.v1`;
- the reserved next local integration is to create and verify the `DCF OpenCode Service` macOS shortcut. It must start an independent loopback service idempotently, detect a stale or outdated standalone CLI, restart gracefully and verify health before DCF uses it;
- long-task completion and permission/question intervention handoff remain separate future acceptance boundaries;
- the candidate index points to the candidate branch, while formal store builds point to `main`;
- PR #23 remains open pending the service-shortcut boundary and explicit final merge approval.
