# DCF Chrome Maintenance Skill

Use this file when changing, diagnosing, releasing or migrating DCF.

## Required read order

1. `README.md`
2. `docs/current-state.md`
3. `docs/architecture-current.md`
4. `docs/dcf-basic-consensus-prompt.md`
5. `docs/adr/status-index.md`
6. the relevant current ADR
7. source, tests, open issues/PRs and generated verification evidence

The repository is the durable project memory. A handoff prompt identifies the current boundary; it must not replace reading the repository.

## Maintainer role

The maintainer is not a message relay or a patch dispatcher. It must understand the user's purpose, inspect the real system, form a judgment, coordinate implementation, review the resulting change and carry the work through runtime acceptance.

The user is the product owner and final experiential judge, not the routine test runner, log copier, session-ID carrier or dependency manager. Ask the user only for facts that DCF and its tools cannot observe reliably.

## Value discipline

DCF is personal cognitive infrastructure jointly maintained by the user and AI. It exists to absorb complexity before that complexity reaches the user.

Internally independent plugins must still appear as one complete product. A change that adds repeated installation, manual copying, dependency judgment, version selection, staged acceptance, routine log reading or multi-round trial-and-error is a product regression even when the internal architecture looks cleaner.

Prefer one complete candidate and one meaningful acceptance over many partial patches and many user-operated checks. Normal success should be quiet. Failure should preserve control, recovery and enough bounded evidence for the AI to continue.

AI judgment and deterministic tools have different jobs. Judgment identifies the real problem and chooses the intervention. Repeatable facts should then be turned into tools, tests or structured evidence. Passing a format check, token assertion or CI workflow is not a substitute for product correctness.

## Current invariants

- one Chrome extension is the only user installation;
- the static base contains no normal product feature;
- every feature is an independently stored self-contained plugin;
- every plugin version is immutable and SHA-256 verified;
- every plugin has its own USER_SCRIPT world and registration;
- candidate/current/LKG are exact combinations;
- candidates commit only after complete startup evidence;
- failure restores LKG and leaves minimal evidence;
- plugin data is generic and namespaced by plugin ID;
- static recovery never depends on Shell or plugin manager;
- plugin updates pull from the fixed GitHub personal index;
- base updates are built from GitHub and distributed through a non-public Chrome Web Store workflow;
- data continuity covers DCF Next and Chrome rc.1 only.

## Failure and control discipline

Do not collapse task execution, control availability, result delivery and module health into one status.

- A task may fail while status and cancel remain available.
- Result delivery may wait or degrade while control intake continues.
- A single malformed artifact or failed ACK must not stop later artifacts.
- Only an initialization or core-dependency failure may become module-fatal.
- Normal transport waits are not failures.
- Recovery, diagnosis and abort paths should survive as far as the underlying platform permits.

For long-running work, the ability to observe, steer and stop the task is part of correctness. A system that can start work but loses its control surface under pressure has not completed the feature.

## Change workflow

1. Identify the user value and the actual broken boundary before choosing a code location.
2. Gather runtime evidence from the owning layer. Source inspection generates hypotheses; it does not establish browser or external-runtime causes.
3. Decide whether the change belongs to the static base, one plugin, data migration or build/release tooling.
4. Keep ordinary feature changes inside one plugin directory and do not add a platform layer for a hypothetical future need.
5. Prepare the complete source change in an isolated branch/worktree.
6. Add behavior tests that exercise the real state transition, not only source strings or schema tokens.
7. Run `npm run verify:chrome`, then repository `npm run verify` before publication.
8. Produce one atomic business change. CI may verify it; CI must not become a remote patching machine or a substitute development environment.
9. Review the diff against the value goal, failure boundaries and user friction, not only against the task wording.
10. Update ADR/current state/architecture when a durable decision or live boundary changes.
11. Perform real-browser acceptance for claims that depend on ChatGPT, Chrome, extension lifecycle or external services.

## Plugin rules

A plugin is one self-contained built JavaScript file. It may use a source build tool, but runtime does not resolve npm packages. Plugins must own their primary data and UI, clean up the previous instance on replacement, and must not import another plugin's source.

Shell is a normal plugin. It may expose a thin DOM mounting convention, but must not become a business SDK or a condition for static recovery.

When a plugin has concurrent responsibilities, give them explicit state and evidence rather than a shared mutable label. Background delivery must be a bounded, persistent, non-blocking state machine; one waiting item must not monopolize unrelated control or critical results.

## Update rules

Remote plugin code is accepted only from the fixed raw GitHub origin when index identity, plugin identity, version and SHA-256 agree. It enters the normal candidate path.

The Chrome base is not self-replaced from GitHub. GitHub Actions produces the verified ZIP and, once one-time Chrome Web Store credentials are configured, submits it through the official API. Do not require recurring local reloads.

An immutable plugin whose content changes must receive a new version. Never repair a published version by silently changing its hash.

## Validation and evidence

`npm run verify:chrome` must cover pure-base boundaries, plugin independence, hashes, unique worlds, snapshots, GitHub install/update, startup evidence, rollback, extension-update reconstruction, DCF Next/rc.1 continuity, dark static pages, recovery and deterministic packaging.

When browser facts can be observed by the owning plugin, provide one explicit action or automatic evidence surface that gathers a privacy-bounded structured report. Do not ask the user to transcribe logs or confirm those facts one by one. The report may change only the state being tested, must disclose that change, and must never include conversation text, hidden reasoning, credentials or complete sensitive payloads.

Evidence must distinguish at least:

- whether an artifact was detected;
- whether a control command was consumed;
- whether its side effect succeeded;
- whether the resulting artifact entered the outbox;
- whether it was actually delivered;
- whether the underlying task is still active or terminal.

The user should be asked only for irreducibly experiential judgments or external effects that DCF cannot observe reliably. Never report a real-browser pass, cancellation, delivery or Chrome Web Store publication without direct evidence.

## Stop conditions

Stop and return to the value goal when:

- independent plugin updates require rebuilding the extension;
- normal base updates require repeated local loading;
- recovery depends on a dynamic plugin;
- DCF Next data cannot be preserved;
- language-ammo automation is reduced;
- a task can continue while its control surface is lost;
- a waiting or delivery failure can disable later control commands;
- the proposed mechanism asks the user to carry evidence between tools;
- tests prove implementation shape but not the claimed behavior;
- the mechanism adds more user friction than it removes.
