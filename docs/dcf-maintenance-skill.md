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

## Value discipline

DCF exists to reduce the user's cognitive and operational load. Internally independent plugins must still appear as one complete product. A change that adds repeated installation, manual copying, dependency judgment, version selection, staged acceptance or routine log reading is a regression.

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

## Change workflow

1. Identify whether the change belongs to the static base, one plugin, data migration or build/release tooling.
2. Keep ordinary feature changes inside one plugin directory.
3. Do not add a platform layer for a hypothetical future need.
4. Prepare the complete source change locally.
5. Run `npm run verify:chrome`, then repository `npm run verify` before publication.
6. Produce one atomic business commit.
7. Read one structured CI result and artifact summary.
8. Create a second complete commit only for a real CI defect.
9. Update ADR/current state/architecture when an invariant changes.

## Plugin rules

A plugin is one self-contained built JavaScript file. It may use a source build tool, but runtime does not resolve npm packages. Plugins must own their primary data and UI, clean up the previous instance on replacement, and must not import another plugin's source.

Shell is a normal plugin. It may expose a thin DOM mounting convention, but must not become a business SDK or a condition for static recovery.

## Update rules

Remote plugin code is accepted only from the fixed raw GitHub origin when index identity, plugin identity, version and SHA-256 agree. It enters the normal candidate path.

The Chrome base is not self-replaced from GitHub. GitHub Actions produces the verified ZIP and, once one-time Chrome Web Store credentials are configured, submits it through the official API. Do not require recurring local reloads.

## Validation

`npm run verify:chrome` must cover pure-base boundaries, plugin independence, hashes, unique worlds, snapshots, GitHub install/update, startup evidence, rollback, extension-update reconstruction, DCF Next/rc.1 continuity, dark static pages, recovery and deterministic packaging.

When several browser acceptance facts can be observed by the owning plugin, provide one explicit action that gathers a privacy-bounded structured report and returns it to the current conversation. Do not ask the user to transcribe logs or confirm those facts one by one. The report may change only the state that the acceptance operation is specifically testing, must disclose that change, and must never include conversation text, prompts, credentials or complete sensitive payloads.

The user should be asked only for irreducibly experiential judgments or external effects that DCF cannot observe reliably. Never report a real browser pass or a Chrome Web Store publication without direct evidence.

## Stop conditions

Stop and present root options if independent plugin updates require rebuilding the extension, normal base updates require repeated local loading, recovery depends on a dynamic plugin, DCF Next data cannot be preserved, language-ammo automation is reduced, or a proposed mechanism adds more user friction than it removes.
