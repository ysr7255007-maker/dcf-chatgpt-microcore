# ADR: DCF release structure after GitHub raw 429

Date: 2026-07-09
Status: accepted

## Context

The first public GitHub bootloader release split the DCF engine into many base64 chunks. The browser bootloader fetched the manifest and all chunks from GitHub raw on every page load and appended a timestamp query string to every request. In practice this produced HTTP 429 errors and made each small code change require many file updates.

## Decision

The multi-chunk GitHub raw loading design is rejected as the long-term release structure.

DCF should use GitHub as the reliable version source, but the normal release unit must be either:

1. a complete Tampermonkey `.user.js` updated by Tampermonkey native `@updateURL` / `@downloadURL`, or
2. a small Tampermonkey bootloader plus one remote engine file.

The browser may cache the currently working engine for startup speed and fallback, but that cache is not the authoritative release source.

## Immediate mitigation

Release `0.7.1` is a compatibility stopgap:

- bump Tampermonkey metadata to `0.7.1`;
- remove per-request timestamp cache busting;
- run a cached engine first when available;
- check the remote engine at most every 6 hours;
- use jsDelivr chunk URLs in the compatibility manifest to avoid repeatedly hitting GitHub raw for every chunk.

This does not make the chunk design acceptable. It only reduces the chance that the current installed script fails before the next structural release.

## Rejected option

Continuing to publish every engine change as 17+ chunk files is rejected. It creates needless operational complexity, increases request count, makes verification harder, and turns small script changes into many repository writes.

## Next target

Release `0.8.0` should collapse the engine into a single release artifact. The preferred path is:

- one `dcf-chatgpt-microcore.user.js` for Tampermonkey-native updates, or
- one `engine/latest.js` / `engine/<version>.js` fetched by a stable bootloader.

The final choice should favor fewer moving parts and easier recovery over architectural cleverness.

## Reconsideration condition

Chunked releases may be reconsidered only if a future release artifact exceeds practical single-file limits and the chunking is generated, uploaded, hashed, and verified automatically by a build pipeline rather than hand-managed files.
