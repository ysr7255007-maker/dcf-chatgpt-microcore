# DCF Current State

Updated: 2026-07-17

## Current product state

- Chrome native candidate: `1.0.0-rc.1`
- Legacy formal fallback: Tampermonkey `0.18.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Product center: low-friction language-ammunition loop
- User acceptance: **pending one complete real-use acceptance**

## Implemented in the candidate

- one Manifest V3 Chrome extension;
- `chrome.userScripts` controlled execution in `USER_SCRIPT` world;
- immutable code-unit versions with SHA-256 verification;
- installed code store separated from candidate/current/LKG snapshots;
- register/update/unregister/getScripts reconciliation;
- candidate confirmation only after startup evidence from every enabled unit;
- automatic LKG rollback on registration or startup failure;
- registration reconstruction after extension update or browser startup;
- static onboarding, migration bridge and recovery page independent of dynamic plugins;
- first-party language-ammunition unit with bounded reply intake, automatic loading, same-ID updates, editing, firing, import/export and visible item versions;
- automatic old-side-rail migration for ammo, fire mode and observable appearance;
- deterministic build, one ZIP candidate, structured summary and GitHub Actions artifact.

## Automated evidence

`npm run verify:chrome` currently passes:

- code-unit SHA-256 and immutable revision conflict tests;
- exact snapshot validation and actual registration diff;
- language-ammo same-ID update semantics;
- MV3 manifest and `userScripts` permission checks;
- migration bridge and static recovery page presence;
- full mocked Chrome lifecycle: install → candidate registration → complete startup evidence → current/LKG confirmation;
- simulated extension update clearing registrations → automatic reconstruction;
- controlled code-unit failure → candidate removal and LKG restoration;
- unique `dcf-chrome-extension-1.0.0-rc.1.zip` generation.

The current container could not complete a stable graphical Chromium extension Service Worker inspection, so no claim is made that a real Chrome/ChatGPT run has already passed. That is deliberately reserved for the single user acceptance.

## Migration truth

The extension cannot directly read Tampermonkey private GM storage. The implemented migration instead reads the old DCF's open Shadow DOM while the old script is still active. It does not modify or delete old state.

Migrated:

- language-ammunition content and IDs;
- title, purpose, tags and body;
- fire mode;
- observable shell side/anchor/size offsets.

Not migrated by design:

- obsolete package/runtime combinations;
- diagnostic caches and operation receipts;
- implementation-only state with no continuing user value.

If the old side rail is not present, migration remains pending and the old data is untouched. Enabling the old formal script for one ChatGPT refresh is the fallback migration action; it is not a permanent dependency.

## Known limitations before acceptance

- ChatGPT selectors may require adaptation if the live page differs from the current bounded selector set.
- Official remote update URLs target `main`; the bundled code units work before merge, while remote update becomes available after the generated release index is present on `main`.
- Chrome Web Store remote-code policy approval has not been claimed; this candidate is delivered as one unpacked/ZIP extension using the userScripts capability selected by the task book.
- Old settings not exposed by the formal side rail cannot be extracted automatically and are intentionally not guessed.

## Stop conditions still active

Stop and return to architecture discussion if real acceptance shows that `chrome.userScripts` cannot provide stable independent code updates without additional user burden, the language-ammunition loop needs degraded automation, recovery depends on a dynamic manager, or migration cannot preserve the real ammo library.
