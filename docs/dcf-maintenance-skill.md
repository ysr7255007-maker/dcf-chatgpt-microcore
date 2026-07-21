# DCF Chrome Maintenance Skill

Use this file when changing, diagnosing, releasing or migrating DCF.

## Required read order

1. `README.md`
2. `docs/current-state.md`
3. `docs/architecture-current.md`
4. `docs/dcf-basic-consensus-prompt.md`
5. `docs/adr/status-index.md`
6. the relevant current ADR
7. source, tests, open issues and generated verification evidence

The repository is durable project memory. A handoff prompt identifies the current boundary; it never replaces reading current source and evidence.

## Maintainer role

The maintainer is not a patch dispatcher or message relay. It must understand the user value, identify the fact owner, inspect the real system, choose the intervention radius, implement one coherent change and carry claims through the appropriate evidence level.

The user is the product owner and final experiential judge, not the routine test runner, log copier, session-ID carrier or internal-state interpreter.

## Value discipline

DCF exists to absorb complexity before it reaches the user. Internal plugin independence must still appear as one complete product.

Prefer one semantic candidate and one meaningful acceptance over a chain of temporary versions. CI is verification, not a remote repair machine. Repeatable facts belong in tools, tests and structured records; AI remains responsible for uncertain diagnosis and architecture judgment.

## Control-plane model

All control-plane work follows:

```text
Desired → Observed → Committed → Reconcile
```

- **Desired** is an explicit target owned by the host.
- **Observed** is evidence from Chrome, pages or external runtimes and may be missing, stale, duplicated or delayed.
- **Committed** is a host-owned fact created atomically after its invariants hold.
- **Reconcile** compares them and executes the next minimal idempotent action.

Never infer user intent from the active tab, current composer, external process working directory, transient memory or the last step that happened to run.

## Current invariants

- one Chrome extension is the only user installation;
- the static base contains no ordinary product feature;
- every feature is an independently stored self-contained plugin;
- CodeUnit identity is `unit_id + SHA-256`;
- Snapshot references exact hashes;
- the release builder rejects published `unit_id + semantic_version` with different content;
- historical same-version hashes remain separate artifacts and are never overwritten;
- DesiredSnapshot is durable;
- legacy v2 candidate is not imported as Desired;
- Current and LKG advance only after minimum Canary proof;
- Stable advances only through explicit behavior acceptance;
- registration and page migration are Observed convergence tasks after commit;
- page migration failure never rolls back Current;
- static recovery never depends on Shell or plugin manager;
- data continuity covers DCF Next and Chrome rc.1.

## Evidence levels

Use these terms precisely:

- `observed`
- `hypothesized`
- `implemented_unverified`
- `runtime_verified`
- `behavior_passed`
- `failed`
- `blocked`
- `not_tested`
- `needs_user_judgment`
- `environment_difference`

Source inspection, a green unit test, a generated artifact, a successful Canary load and a user-visible behavior pass are different facts.

## Activation workflow

1. Validate and save exact content-addressed artifacts.
2. Declare one DesiredSnapshot.
3. Compute proof refs relative to Committed Current.
4. Create or reuse the host Canary page.
5. Execute only changed enabled artifacts.
6. Record `loaded / ready / degraded / failed`.
7. Commit Current and LKG only when proof invariants hold.
8. Reconcile persistent registrations.
9. Attempt existing-page migration independently.
10. Preserve ActivationRecord, ReconcileRecord and bounded evidence.

A failed Canary leaves Current/LKG untouched. A failed existing-page migration records `stale`, `reload_required` or `migration_failed` and continues to preserve Current.

## Plugin rules

A plugin owns its business data, UI and cleanup boundary. It may report runtime observations but cannot write Committed control-plane facts.

`unit.started` is a migration-compatible `ready` observation. New control-plane-aware code should report explicit `runtime.observe` states. Optional state restoration or external dependencies should produce `degraded` when the core interface remains usable, not module-fatal failure.

Shell remains a normal plugin. It may expose a thin panel-mounting convention but cannot become the control-plane fact owner or a condition for static recovery.

## Release rules

Source and declarative unit metadata are the only release inputs. Build tooling generates:

- content hash and artifact ID;
- official index;
- exact default Snapshot;
- release manifest;
- verification summary;
- deterministic extension ZIP.

Never hand-edit a published hash to repair content under the same semantic version. The build must fail before browser runtime if a released semantic version is reused.

## Local Agent boundary

Execution, control, delivery and module health are separate survivability planes.

- A task may fail while status and cancel remain available.
- Result delivery may wait while control intake continues.
- A malformed artifact or ACK cannot stop later control.
- Normal transport waits are not failures.
- User-carried IDs or logs are not an acceptable control path.

S6 remains frozen until RESULT is a host-persisted Artifact with ConversationBinding. F2f remains frozen until WorkspaceBinding is explicit and verified before and after session creation.

## Change-radius rule

L1 module-internal and L2 explicit two-sided interface changes may be iterated by local AI with real-browser verification.

Stop local patching and return to architecture when a change affects:

- fact ownership;
- Desired/Observed/Committed semantics;
- Current/LKG/Stable;
- shared durable state, CAS, lease or transaction;
- recovery protocol;
- three or more independent modules;
- a pattern of compensating exceptions.

## Validation workflow

1. Identify user value and fact owner.
2. Gather runtime evidence from the owning layer.
3. Choose L1, L2 or L3 modification radius.
4. Make one coherent source change.
5. Add behavior tests for state transitions and failure boundaries.
6. Run `npm run verify:chrome`, then repository `npm run verify`.
7. Publish one atomic commit.
8. Inspect GitHub Actions as evidence, not as a patch loop.
9. Perform real-browser acceptance for Chrome, ChatGPT, Canary, page lifecycle and external-service claims.
10. Update ADR/current state/acceptance records without overstating certainty.

## Stop conditions

Stop and redesign when:

- a page or external process is being treated as the authority for user intent;
- a candidate needs every existing page to complete before commit;
- page migration failure can roll back Current;
- Stable advances without behavior evidence;
- same-version content is repaired by editing only the hash;
- recovery depends on a dynamic plugin;
- a business failure disables the control plane;
- the user must carry evidence between tools;
- tests prove implementation shape but not the claimed transition;
- the mechanism adds more user friction than it removes.
