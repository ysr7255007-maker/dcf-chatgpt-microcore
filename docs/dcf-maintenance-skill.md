# DCF Chrome Maintenance Skill

Use this file when changing, diagnosing, releasing or migrating DCF.

## Required read order

1. `README.md`
2. `docs/current-state.md`
3. `docs/architecture-current.md`
4. `docs/dcf-basic-consensus-prompt.md`
5. `docs/adr/status-index.md`
6. relevant current ADRs
7. source, tests, open issues/comments, recent commits and generated evidence

The repository is the durable project memory. Handoffs provide leads, not truth.

## Maintainer role

Understand the user value, inspect the actual owning layer, form a judgment, implement a coherent change and carry it to the strongest available evidence. The user is the final experiential judge, not a routine tester, log copier, session-ID carrier or dependency manager.

## Value and ownership discipline

DCF exists to absorb complexity before it reaches the user. Before changing code, identify:

- who declares Desired;
- which layer owns Committed;
- which sources only provide Observed;
- which component may reconcile or advance state.

Do not infer user intent from the current page, current directory, old memory or incidental message order. Unproven delivery, recovery, workspace identity or activation stays unknown/unverified/unroutable/failed with evidence.

## Current control-plane invariants

- one Chrome extension is the only user installation;
- the static base contains no ordinary product feature;
- every feature is an independently stored self-contained CodeUnit;
- CodeUnit identity is `unit_id + content_hash`;
- semantic versions are release labels and may not be reused for different content;
- DesiredSnapshot is explicit and durable;
- ObservedRuntime never directly overwrites Committed;
- Current and LKG commit only after dedicated Canary proof and registration verification;
- Stable advances only through explicit acceptance evidence;
- `loaded / ready / degraded / failed` are distinct;
- required failure blocks a candidate; optional failure does not bind the whole product;
- existing-page migration happens after commit and cannot roll Current back;
- PageRuntime refresh/reload creates new observation, not a guessed continuation;
- static recovery never depends on Shell or plugin manager;
- generic plugin data is not a substitute for host-owned control facts;
- data continuity covers DCF Next and Chrome rc.1.

## Modification radius

### L1 — one module

A local AI may iterate on selectors, module data, UI, internal transitions and unit tests inside one plugin.

### L2 — explicit interface pair

A local AI may modify both sides of a clear request/response or serialization contract and add contract tests.

### L3 — control plane

Stop local patching and redesign when the change alters fact ownership, Desired/Committed semantics, Current/LKG/Stable, shared durable state, transaction, lease, recovery, workspace identity, permissions, or spreads through multiple independent modules.

After an L3 design is established, L1/L2 implementation and real-environment retest may return to the local AI within the declared radius.

## Change workflow

1. Read the current branch and live issue comments; do not reuse old HEAD or failure reports as permanent facts.
2. Identify the shared prerequisite before fixing multiple symptoms.
3. Separate observed, hypothesized, implemented_unverified, runtime_verified and behavior_passed.
4. Modify source and generated release inputs together; do not hand-edit only the published index.
5. Add behavior tests for state transitions, repetition, delay, restart and failure—not only source-string checks.
6. Run `npm run verify:chrome`, then `npm run verify` when the legacy line is affected.
7. Produce one semantic commit. CI verifies it; CI is not a remote patching machine.
8. Update ADR/current-state/architecture when ownership or durable semantics change.
9. Use real Chrome/ChatGPT evidence before claiming activation, migration, delivery, recovery or external-service behavior.
10. Promote Stable only with an exact evidence reference.

## CodeUnit and release rules

- Source plus declarative metadata is the only release input.
- Build generates hash, `content_id`, official index, version ledger, build manifest and verification summary.
- A published `unit_id + semantic_version` with changed content is a build failure.
- Historical collisions remain evidence; never rewrite them into a single false identity.
- Snapshot references content hash, never an ambiguous version lookup.
- Runtime may read legacy v1/v2 index/state during migration but writes v3 control state.

## Activation rules

- Use a dedicated inactive Canary, not all user pages, to prove a candidate.
- `loaded` is the minimum synchronous execution and exact-identity observation; stronger modules may require `ready`.
- A normal data-restore or optional enhancement failure should become degraded when core ability remains usable.
- Registration commits after proof; existing page migration follows commit.
- A failed migration becomes stale/reload_required and preserves Current.
- Service Worker restart reruns reconcile from Desired/Observed/Committed; it does not replay a historical procedure.

## Evidence rules

Evidence must distinguish detection, exact identity, execution, runtime state, registration, commit and page migration. ActivationRecord and ReconcileRecord must be bounded and traceable to snapshot, operation and page identity.

Do not ask the user to transcribe logs. Provide one structured evidence surface owned by the layer that can observe the fact. Never claim real-browser pass, delivery, cancellation, workspace match or store publication without direct evidence.

## Stop conditions

Return to the value goal when:

- a business failure blocks the survival core;
- page migration can roll back a proven candidate;
- a version label silently changes content;
- a page or external directory becomes the source of user intent;
- unknown is converted into success;
- each new failure requires another numbered patch or recovery branch;
- an implementation-shape test is used as product proof;
- the user is asked to carry evidence between tools.
