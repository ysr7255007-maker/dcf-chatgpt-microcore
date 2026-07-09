# ADR: DCF release structure after GitHub raw 429

Date: 2026-07-09
Status: accepted

## Context

The first public GitHub bootloader release split the DCF engine into many base64 chunks. The browser bootloader fetched the manifest and all chunks from GitHub raw on every page load and appended a timestamp query string to every request. In practice this produced HTTP 429 errors and made each small code change require many file updates.

After the `0.7.1` mitigation, one observed failure mode was: the script updated without visible HTTP errors, but the DCF floating window did not appear. The likely cause was nested boot behavior. The GitHub bootloader loaded the full legacy userscript engine, and that engine still attempted to honor the older `dcf.local.engine.v1` local engine slot before initializing its own UI. If a stale or broken local engine slot existed, it could intercept startup without producing the expected floating window.

## Decision

The multi-chunk GitHub raw loading design is rejected as the long-term release structure.

DCF should use GitHub as the reliable version source, but the normal release unit must be either:

1. a complete Tampermonkey `.user.js` updated by Tampermonkey native `@updateURL` / `@downloadURL`, or
2. a small Tampermonkey bootloader plus one remote engine file.

The browser may cache the currently working engine for startup speed and fallback, but that cache is not the authoritative release source.

A GitHub bootloader must not let the legacy local-engine slot override the remote engine it just loaded. When running a remote engine artifact that was originally a complete userscript, the bootloader should explicitly bypass the old local-engine boot branch.

## Immediate mitigation

Release `0.7.1` is a compatibility stopgap:

- bump Tampermonkey metadata to `0.7.1`;
- remove per-request timestamp cache busting;
- run a cached engine first when available;
- check the remote engine at most every 6 hours;
- use jsDelivr chunk URLs in the compatibility manifest to avoid repeatedly hitting GitHub raw for every chunk.

Release `0.7.2` is a compatibility fix on top of `0.7.1`:

- bump Tampermonkey metadata to `0.7.2`;
- add `@run-at document-idle`;
- set the legacy `__DCF_LOCAL_ENGINE_BOOTING__` flag while executing the remote engine, so the old `dcf.local.engine.v1` slot cannot suppress normal DCF UI initialization.

These mitigations do not make the chunk design acceptable. They only reduce the chance that the current installed script fails before the next structural release.

## Rejected option

Continuing to publish every engine change as 17+ chunk files is rejected. It creates needless operational complexity, increases request count, makes verification harder, and turns small script changes into many repository writes.

## Next target

Release `0.8.0` should collapse the engine into a single release artifact. The preferred path is:

- one `dcf-chatgpt-microcore.user.js` for Tampermonkey-native updates, or
- one `engine/latest.js` / `engine/<version>.js` fetched by a stable bootloader.

The final choice should favor fewer moving parts and easier recovery over architectural cleverness.

## Reconsideration condition

Chunked releases may be reconsidered only if a future release artifact exceeds practical single-file limits and the chunking is generated, uploaded, hashed, and verified automatically by a build pipeline rather than hand-managed files.
