# DCF Chrome Maintenance Skill

Use this file when changing, diagnosing, releasing or migrating DCF.

## Required read order

1. `README.md`
2. `docs/current-state.md`
3. `docs/architecture-current.md`
4. `docs/dcf-basic-consensus-prompt.md`
5. `docs/adr/status-index.md`
6. the relevant current ADR
7. source, tests and generated verification summary

The current Chrome candidate supersedes Tampermonkey as the target architecture. Root userscript files remain a fallback and historical evidence, not a source of current architecture truth.

## Value discipline

Language ammunition owns product value. Before changing engineering structure, verify that the change preserves or improves automatic loading, same-ID updating, contextual firing, visibility, migration, privacy and recovery without transferring maintenance work to the user.

A simpler implementation that requires manual copying, multiple installations, repeated confirmations or staged user testing is a regression.

## Current architecture invariants

- one Chrome extension is the only user installation;
- the static survival core is independent of dynamic code units;
- code-unit versions are immutable and SHA-256 verified;
- installed code and active startup snapshots are separate facts;
- candidate/current/last-known-good are explicit exact snapshots;
- every lifecycle change uses the code-unit + snapshot path;
- candidate registration never overwrites LKG before complete startup evidence;
- failure restores LKG and retains minimal evidence;
- dynamic units use `USER_SCRIPT` world and a narrow message API;
- the survival core does not learn ammo or ChatGPT business semantics;
- product data stays in local extension storage unless the user explicitly exports;
- old GM state is read only through a bounded one-time migration bridge, never guessed.

## Change workflow

1. Read enough of the repository to understand the current fact model.
2. Decide whether the change belongs to the static survival core, a code unit, product data or build tooling.
3. Prefer changing the fact model over adding lifecycle-specific branches.
4. Prepare the complete source change locally.
5. Run `npm run verify`.
6. Produce one atomic business commit on a branch.
7. Read one structured CI result and artifact summary.
8. Only create a second complete commit when CI found a real defect.
9. Update the ADR, status index, current architecture, current state and this skill when architecture changes.

Do not commit files one by one. Do not turn CI into a source-modifying agent. Do not add a platform layer merely to satisfy documentation shape.

## Code-unit rules

A release unit must be self-contained built JavaScript. Browser runtime does not resolve npm dependencies or execute TypeScript/build scripts.

Every unit manifest includes ID, version, code, hash, source, matches, run time, world, world ID, host API, phase and required state. The host verifies hash before storage and again through generated build evidence.

Remote official code is accepted only from the fixed trusted origin and only when index identity, unit identity and SHA-256 all agree. It then enters candidate activation exactly like bundled code.

## Recovery rules

The static recovery page must always be able to:

- show saved code versions;
- show candidate/current/LKG;
- query actual Chrome registrations;
- display minimal deviations and recent evidence;
- restore LKG;
- disable a code unit through a new candidate;
- copy one complete privacy-bounded diagnostic package.

If recovery requires the page code unit or plugin manager to work, the architecture is broken.

## Language-ammunition source truth

The ammo unit must observe only new/current assistant replies plus a small startup compensation window. Work per reply must not grow with conversation length.

Ammo writes are keyed by stable ID. A revised artifact replaces the same logical item and increments its visible version. Extraction and update prompts return complete `DCF_AMMO`; firing adds the contextual invocation marker while copying exports raw body.

## Validation

`npm run verify` must cover the Chrome candidate and the retained old formal fallback. The Chrome suite must prove manifest validity, hashes, snapshots, registration reconciliation, extension-update restoration, failed-candidate rollback, migration, ammo semantics, recovery availability and deterministic packaging.

Do not report a real browser pass unless a real Chrome instance loaded the extension and produced direct evidence. The one user acceptance remains the final truth for live ChatGPT compatibility.

## Mandatory stop conditions

Stop implementation and present root options when independent updates still require reinstalling the whole extension, multiple user installations are needed, a local runtime becomes necessary, migration requires repeated manual transfer, language-ammo automation must be reduced, recovery depends on a dynamic unit, special lifecycle branches multiply, or GitHub iteration expands into many serial commits.
