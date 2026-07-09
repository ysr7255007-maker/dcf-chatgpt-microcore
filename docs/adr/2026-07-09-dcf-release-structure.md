# ADR: DCF release structure after GitHub raw 429

Date: 2026-07-09
Status: accepted

## Context

The first public GitHub bootloader release split the DCF engine into many base64 chunks. The browser bootloader fetched the manifest and all chunks from GitHub raw on every page load and appended a timestamp query string to every request. In practice this produced HTTP 429 errors and made each small code change require many file updates.

After the `0.7.1` mitigation, one observed failure mode was: the script updated without visible HTTP errors, but the DCF floating window did not appear. The likely cause was nested boot behavior. The GitHub bootloader loaded the full legacy userscript engine, and that engine still attempted to honor the older `dcf.local.engine.v1` local engine slot before initializing its own UI. If a stale or broken local engine slot existed, it could intercept startup without producing the expected floating window.

After `0.7.2`, the browser reported a hard Content Security Policy failure: evaluating a downloaded string as JavaScript violates ChatGPT's CSP because `unsafe-eval` is not allowed. This means the remote-engine-by-string-eval model is not merely inconvenient; it is structurally invalid on ChatGPT pages.

A process error also occurred: an implementation limitation around uploading a full userscript through the available connector was allowed to distort the runtime architecture. That should not have happened. Upload or deployment friction must be solved at the release pipeline level, not by adding fragile runtime indirection to the user-facing script.

The direct `GitHub.update_file` path was then tested against the root userscript. It succeeded for a native single-file DCF release artifact. This proves the correct path is not chunking or runtime bootloading; the root `.user.js` can be replaced directly through the GitHub contents update flow when the complete text is supplied as `content`.

## Decision

The multi-chunk GitHub raw loading design is rejected as the long-term release structure.

The remote bootloader design that downloads JavaScript text and runs it through `Function(source)` / eval is also rejected for ChatGPT pages.

DCF should use GitHub as the reliable version source, but the normal release unit must be a complete Tampermonkey `.user.js` updated by Tampermonkey native `@updateURL` / `@downloadURL`.

Future runtime releases should replace the root `.user.js` as a complete artifact. This is acceptable and expected for Tampermonkey userscripts. It does not require hand-maintaining one giant source file: development may remain modular, and a build script may generate the final single-file artifact. The installed/released artifact remains full-file.

The browser may cache non-authoritative runtime data for startup speed and fallback, but that cache must not be the authoritative code release source.

Implementation constraints in the assistant/tooling layer must not be converted into product architecture. If a full `.user.js` cannot be uploaded through one mechanism, the correct response is to use a proper release path, build pipeline, Git push, or ask for the missing capability; not to invent runtime chunking or eval-based loading.

## Release update policy

For each public DCF userscript release:

- bump `@version` in both `dcf-chatgpt-microcore.user.js` and `dcf-chatgpt-microcore.meta.js`;
- upload/replace the complete generated `dcf-chatgpt-microcore.user.js` file;
- upload/replace the complete `dcf-chatgpt-microcore.meta.js` metadata file;
- keep `@updateURL` and `@downloadURL` pointing to the root files on `main`;
- verify the root script has no runtime remote-code execution path such as `Function(source)`, eval-based engine loading, GitHub chunk manifest loading, or CDN chunk loading.

Git will record the change as a normal file update. Even when the release artifact is uploaded as a complete file, the repository diff, commit history, and review should focus on the actual changed lines or generated artifact comparison.

## Immediate mitigation and correction

Release `0.7.1` was a compatibility stopgap:

- bump Tampermonkey metadata to `0.7.1`;
- remove per-request timestamp cache busting;
- run a cached engine first when available;
- check the remote engine at most every 6 hours;
- use jsDelivr chunk URLs in the compatibility manifest to avoid repeatedly hitting GitHub raw for every chunk.

Release `0.7.2` was a compatibility fix on top of `0.7.1`:

- bump Tampermonkey metadata to `0.7.2`;
- add `@run-at document-idle`;
- set the legacy `__DCF_LOCAL_ENGINE_BOOTING__` flag while executing the remote engine, so the old `dcf.local.engine.v1` slot cannot suppress normal DCF UI initialization.

The CSP failure supersedes these mitigations. They should not be treated as a viable release path.

Release `0.8.1` corrects the official root update path:

- `dcf-chatgpt-microcore.user.js` is a native single-file userscript;
- `dcf-chatgpt-microcore.meta.js` is updated to the same version;
- the official update/download URLs remain the same;
- no remote engine loading is required for the installed userscript to run.

## Rejected option

Continuing to publish every engine change as 17+ chunk files is rejected. It creates needless operational complexity, increases request count, makes verification harder, and turns small script changes into many repository writes.

Continuing to download remote JavaScript and evaluate it at runtime is rejected because it is blocked by ChatGPT's CSP.

Treating connector upload inconvenience as a reason to complicate runtime architecture is rejected.

Skipping the direct full-file upload attempt before moving to a build pipeline is rejected. The first release-path test should be direct root `.user.js` replacement; build automation is only justified after a concrete failure or for later repeatability.

## Current target

The stable target is a native Tampermonkey release artifact:

- `dcf-chatgpt-microcore.user.js` contains the whole DCF script;
- `dcf-chatgpt-microcore.meta.js` contains only the Tampermonkey metadata;
- no `Function(source)`, no eval, no remote engine execution;
- legacy local-engine auto-boot is disabled or absent.

The final choice should favor fewer moving parts and easier recovery over architectural cleverness.

## Reconsideration condition

Chunked releases may be reconsidered only if a future release artifact exceeds practical single-file limits and the chunking is generated, uploaded, hashed, and verified automatically by a build pipeline rather than hand-managed files. Runtime eval remains rejected on ChatGPT pages unless a future execution mechanism avoids page CSP and is explicitly validated.
