# DCF Current State

Updated: 2026-07-20

## Product position

DCF is personal cognitive infrastructure jointly maintained by the user and AI. The current product shape is one Chrome extension whose static base preserves installation, immutable plugin storage, exact snapshots, startup evidence and recovery. All visible product behavior remains in independent first-party plugins while the user experiences one complete DCF.

- Chrome candidate: `1.0.0-rc.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Current documented baseline: `4b94bd224c2b910c9e4a1497e9a9118df7a549de`
- Product-semantic baseline: complete DCF Next before Core Review
- Data continuity: DCF Next + Chrome `rc.1`; no separate `0.18.2` migration

## Current composition

The fixed personal index currently contains eleven default first-party plugins:

- Shell;
- language ammo;
- long-conversation relief;
- question-answer attribution;
- appearance;
- Local Agent workbench;
- Local Agent dialogue loop;
- backup;
- plugin manager;
- Local Agent diagnostics;
- page lifecycle diagnostics.

Each plugin remains a self-contained immutable JavaScript artifact with a stable ID, SHA-256 and independent USER_SCRIPT world. Candidate/current/LKG are exact combinations; static recovery does not depend on Shell or any dynamic plugin.

## Accepted live boundaries

Real-browser evidence has established:

- independent plugin hot replacement and Shell panel remount;
- pinned workspace continuity and selectable language-ammo UI;
- post-start-only assistant artifact intake with existing history kept inert;
- direct Local Agent connection to the user's OpenCode service at `127.0.0.1:4096`;
- minimal request → independent session → execution → automatic result return, producing `DCF_READ_ONLY_SMOKE_OK`;
- observable-idle timeout instead of total wall-clock timeout;
- same-session permission delegation with a conversation-issued `once` decision;
- automatic rollback/update boundaries and immutable-version enforcement;
- runtime diagnosis that identified the prior HTTP 500 as standalone OpenCode CLI/database version mismatch rather than a DCF defect.

These accepted facts are recorded in the current ADRs. This file does not repeat their full evidence history.

## Current Local Agent dialogue boundary

The basic dialogue handoff works. Long-task control and return-path survivability do not yet pass.

Dialogue `.16` added first progress, `target: current`, request-ID resolution, status/steer/cancel and command idempotency. A real status command then exposed an invalid Promise assumption: synchronous `sendArtifact()` was followed by `.catch`, causing a TypeError and making later control ineffective.

Dialogue `.17` was merged through PR #63 and is the current published dialogue version. It:

- restores the synchronous enqueue contract;
- contains individual control-command errors;
- distinguishes task failure, delivery degradation and module-fatal failure at a basic level;
- preserves cancel behavior in unit-level harnesses.

The next real-browser test still failed the product boundary:

- the panel alternated between execution and delivery-failure text because both responsibilities shared one visible status field;
- status and cancel produced no visible ACK;
- source inspection showed that OpenCode polling was asynchronous and did not block the JavaScript event loop;
- the return path could remain stuck behind weak page-wide streaming detection and a serial confirmation loop;
- the UI and persisted state could not distinguish command-not-consumed from command-executed-but-not-delivered.

Therefore Issue #54 remains open. The accepted architecture is now recorded in `docs/adr/2026-07-20-dcf-dialogue-control-and-delivery-survivability.md`.

The next dialogue candidate must provide:

- narrow, visible composer-scoped streaming detection;
- separate execution, control and delivery state;
- a persistent non-blocking outbox state machine;
- priority for cancel/result/permission over progress and heartbeat;
- independent evidence for detection, consumption, side effect, enqueue and delivery;
- live proof that status, steer and cancel remain usable while earlier delivery is waiting or degraded.

No `.18` candidate is accepted yet.

## Diagnostics boundary

Diagnostics `.1` remains a privacy-bounded GET-only recovery path. It excludes message text, credentials, provider private options and raw configuration.

A second real sample confirmed that it can over-interpret `normalized: null` or absence from `/session/status` as proof that execution never became observable, even when the service, session, messages and other endpoints are healthy. Issue #62 remains open.

A missing active-status entry must be represented first as a neutral fact. Known terminal state, session existence, message evidence and endpoint health must be considered before generating a failure hypothesis. Normal terminal sessions should not automatically occupy the conversation with a failure diagnostic.

## Maintenance discipline

- GitHub is the durable project memory and publication source.
- The user must not be used as a log copier, session-ID carrier, dependency manager or multi-round test operator.
- Prefer one complete candidate and one meaningful real-browser acceptance.
- Source inspection and CI produce evidence, not runtime truth.
- Tests must exercise behavior and state transitions, not only source strings or schema tokens.
- Execution, control, delivery and module health are separate failure planes.
- A task may fail or a result may wait without disabling status and cancel.
- Normal browser/composer waits are not delivery failures.
- Repeated deterministic checks should become tools or structured evidence; AI judgment remains responsible for interpreting them and choosing the intervention.

## Open work

- **Issue #54:** finish and prove the Local Agent long-task control plane and non-blocking return path.
- **Issue #62:** correct Diagnostics terminal-session inference and automatic-report criteria.
- **PR #59:** draft browser runtime evidence bridge; separate from the current dialogue repair and must not be merged merely to compensate for missing plugin-owned evidence.
- model identity and all return profiles still need final real-browser acceptance.
- full Always authorization records, revocation, blocking, expiry and question-answer delegation remain later phases.
- the `DCF OpenCode Service` macOS shortcut remains later work after the existing service lifecycle is understood.

## Next action

Continue Issue #54 from the current baseline. Review the next implementation against the 2026-07-20 survivability ADR and the maintenance skill, then run one end-to-end long-task acceptance. Do not close the issue because CI passes or because the OpenCode task eventually terminates; close it only when the current conversation can observe, steer and cancel the task without user-carried identifiers or evidence.
