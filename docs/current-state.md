# DCF Current State

Updated: 2026-07-17

## Current product state

- Chrome candidate: `1.0.0-rc.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Product baseline: complete DCF Next before Core Review
- User acceptance: pending one complete real-use acceptance
- Data continuity: DCF Next + Chrome `rc.1`; no separate `0.18.2` migration

## Implemented

- one Manifest V3 Chrome extension as the only user installation;
- static pure base with no normal DCF product code;
- eight independent self-contained first-party plugins:
  - shell;
  - language ammo;
  - long-conversation relief;
  - question-answer attribution;
  - appearance;
  - backup;
  - low-frequency plugin manager;
  - diagnostics;
- one unique `USER_SCRIPT` world and registration per plugin;
- immutable plugin versions and SHA-256 verification;
- candidate/current/LKG exact combinations;
- commit only after every enabled plugin returns startup evidence;
- automatic rollback on registration or startup failure;
- automatic registration reconstruction after base update or browser startup;
- fixed GitHub personal plugin index with automatic six-hour throttled checks;
- one user-facing DCF update action covering plugins and Chrome base;
- direct language-ammo library load from the fixed GitHub data branch;
- bounded DCF Next open-Shadow-DOM migration;
- one-time absorption of Chrome rc.1 product state into generic plugin namespaces;
- static onboarding and recovery pages with complete light/dark variables;
- GitHub Actions workflow for verified non-public Chrome Web Store publication once credentials are configured.

## Automated evidence

`npm run verify:chrome` proves:

- pure base contains no bundled product unit archive;
- eight plugin hashes, unique worlds and self-contained IIFEs;
- rc.1 state absorption without retaining the old product root;
- default GitHub install, exact registration and startup-evidence commit;
- updating one plugin preserves every other plugin reference;
- generic plugin data isolation;
- base update check path;
- DCF Next-only migration bridge;
- dark static surfaces;
- deterministic unique ZIP.

## Known boundary before acceptance

- live ChatGPT selectors and cross-world DOM panel cooperation still require the user's one normal browser acceptance;
- the candidate GitHub index points to the candidate branch; formal Chrome Web Store builds point to `main`;
- the Chrome Web Store workflow is implemented, but actual automatic base publication requires one-time store listing, visibility and repository-secret configuration;
- no claim is made that a store version has already been published.
