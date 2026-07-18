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
  - dialogue `.7` proved the card can hot-remount inside the Shell-hosted Local Agent panel, history is shown as an inert baseline, the latest-only control is visible and idle status is no longer `unknown`;
  - the same live check found that dialogue controls were rendered but unbound because `ShadowRoot.dataset` was used as an event-binding marker;
  - dialogue `.8` fixed the binding boundary and its real-page `一键验收并回传` report passed all ten checks;
  - the accepted report proved true in-page hot replacement, one event binding, inert three-message history baseline, persisted clearing without replay, retained active `local-agent` workspace and matching plugin versions/hashes;
  - fresh request `dcf-dialogue-readonly-smoke-20260718-1549-01` was detected after startup, created session `ses_08a14519cffe3I29cL7721KlVm` and automatically returned a structured result;
  - OpenCode synchronous execution then failed at `POST /session/:id/message` with HTTP 500 after 1.314 seconds;
  - the failed session contains no Assistant result, so manual message copying cannot expose the cause;
  - diagnostics `.1` now performs one automatic read-only probe of the most recent undiagnosed session and returns privacy-bounded Provider/model/Agent and endpoint evidence to the same conversation; live diagnostic evidence is pending.
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
- diagnostics reads the latest dialogue request/session identifiers, performs loopback GET-only evidence recovery and returns one `dcf.local-agent.diagnostic.v1` artifact automatically;
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
- actual post-start request detection, new-session creation and automatic result return are also proven;
- successful OpenCode execution is not proven: the first read-only task reached `/session/:id/message` and received HTTP 500;
- the next step is to update diagnostics `.1`; it will automatically probe existing session `ses_08a14519cffe3I29cL7721KlVm` without another model request and return `dcf.local-agent.diagnostic.v1`;
- use that report to repair the actual Provider/model/Agent or OpenCode configuration cause;
- a later dialogue revision must also preserve synchronous HTTP and session-side failure evidence directly in `dcf.local-agent.result.v1`;
- after the cause is repaired, send a new read-only request ID and require `DCF_READ_ONLY_SMOKE_OK`;
- only after that minimal task succeeds should the reserved task create and verify the `DCF OpenCode Service` macOS shortcut;
- long-task completion and intervention handoff remain separate future acceptance boundaries;
- `serve.sh` remains manually managed until that shortcut exists and the start-service control is wired to it;
- the candidate index points to the candidate branch, while formal store builds point to `main`;
- PR #23 remains unmerged until explicit browser acceptance of successful OpenCode execution and automatic result return.
