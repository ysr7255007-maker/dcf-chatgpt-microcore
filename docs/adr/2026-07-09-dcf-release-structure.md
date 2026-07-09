# ADR: DCF release structure after GitHub raw 429

Date: 2026-07-09
Status: accepted

## Context

The first public GitHub bootloader release split the DCF engine into many base64 chunks. The browser bootloader fetched the manifest and all chunks from GitHub raw on every page load and appended a timestamp query string to every request. In practice this produced HTTP 429 errors and made each small code change require many file updates.

After the `0.7.1` mitigation, one observed failure mode was: the script updated without visible HTTP errors, but the DCF floating window did not appear. The likely cause was nested boot behavior. The GitHub bootloader loaded the full legacy userscript engine, and that engine still attempted to honor the older `dcf.local.engine.v1` local engine slot before initializing its own UI. If a stale or broken local engine slot existed, it could intercept startup without producing the expected floating window.

After `0.7.2`, the browser reported a hard Content Security Policy failure: evaluating a downloaded string as JavaScript violates ChatGPT's CSP because `unsafe-eval` is not allowed. This means the remote-engine-by-string-eval model is not merely inconvenient; it is structurally invalid on ChatGPT pages.

A process error also occurred: an implementation limitation around uploading a full userscript through the available connector was allowed to distort the runtime architecture. That should not have happened. Upload or deployment friction must be solved at the release pipeline level, not by adding fragile runtime indirection to the user-facing script.

The direct `GitHub.update_file` path was then tested against the root userscript. It succeeded for a native single-file DCF release artifact. This proves the correct path is not chunking or runtime bootloading; the root `.user.js` can be replaced directly through the GitHub contents update flow when the complete text is supplied as `content`.

An attempt to use the GitHub official remote MCP server from ChatGPT web in an old window showed a connector state where some enabled actions could not be invoked until reconnecting and refreshing permissions, but reconnect did not open a GitHub authorization page. Later discussion clarified that this was a window/tool-mount issue rather than a reason to introduce another publishing architecture. The current practical release path can use the official GitHub connector/MCP as long as the artifact is prepared in the sandbox and submitted as complete content through the GitHub write action.

A documentation gap was identified: the repository had release-structure notes but lacked a maintenance skill and a reusable consensus-insertion guide that explain DCF's two-layer purpose and how a new AI session should enter the project without reducing it to a userscript bug. This gap has been closed by adding `docs/skills/dcf-maintenance-skill.md` and `docs/prompts/dcf-consensus-insertion-guide.md`.

## Decision

The multi-chunk GitHub raw loading design is rejected as the long-term release structure.

The remote bootloader design that downloads JavaScript text and runs it through `Function(source)` / eval is also rejected for ChatGPT pages.

DCF should use GitHub as the reliable version source, but the normal release unit must be a complete Tampermonkey `.user.js` updated by Tampermonkey native `@updateURL` / `@downloadURL`.

Future runtime releases should replace the root `.user.js` as a complete artifact. This is acceptable and expected for Tampermonkey userscripts. It does not require hand-maintaining one giant source file: development may remain modular, and a build script may generate the final single-file artifact. The installed/released artifact remains full-file.

The browser may cache non-authoritative runtime data for startup speed and fallback, but that cache must not be the authoritative code release source.

Implementation constraints in the assistant/tooling layer must not be converted into product architecture. If a full `.user.js` cannot be uploaded through one mechanism, the correct response is to use a proper release path, build pipeline, Git push, or ask for the missing capability; not to invent runtime chunking or eval-based loading.

For the current scale, the official GitHub connector/MCP is sufficient for DCF publishing when combined with sandbox preprocessing. The assistant does not need to emit a large userscript character-by-character in user-visible prose. It may read or generate the artifact inside the sandbox, compute the exact text or base64 form required by the GitHub action, submit that complete value through the tool call, and then read back the repository file to verify integrity.

A third-party GitHub MCP or custom wrapper should only be introduced after a concrete missing capability is demonstrated, such as an unavailable write action, missing branch/PR workflow, or inability to submit complete content. It is not needed merely because the release artifact is large.

DCF's documentation must also preserve project intent. Maintenance skills, consensus prompts, and handoff materials are part of the language-ammunition layer and should be stored in the repository rather than remaining only in chat history.

## Release update policy

For each public DCF userscript release:

- generate or assemble the complete `dcf-chatgpt-microcore.user.js` artifact in the sandbox or build environment;
- bump `@version` in both `dcf-chatgpt-microcore.user.js` and `dcf-chatgpt-microcore.meta.js`;
- upload/replace the complete generated `dcf-chatgpt-microcore.user.js` file;
- upload/replace the complete `dcf-chatgpt-microcore.meta.js` metadata file;
- keep `@updateURL` and `@downloadURL` pointing to the root files on `main`;
- verify the root script has no runtime remote-code execution path such as `Function(source)`, eval-based engine loading, GitHub chunk manifest loading, or CDN chunk loading;
- read the uploaded files back from GitHub and verify version, expected beginning, expected ending, size/hash when applicable, and absence of truncation or path-string/base64-string mistakes.

Git will record the change as a normal file update. Even when the release artifact is uploaded as a complete file, the repository diff, commit history, and review should focus on the actual changed lines or generated artifact comparison.

## Documentation and consensus policy

DCF repository documentation should include not only code and release notes, but also the operating language needed to preserve project intent across AI sessions.

Current project-intent documents:

- `docs/skills/dcf-maintenance-skill.md`: reusable maintenance protocol for AI sessions that modify DCF.
- `docs/prompts/dcf-consensus-insertion-guide.md`: reusable prompt and usage guide for aligning a new AI session with DCF's two-layer model before project work begins.

These documents are treated as language ammunition. They should evolve with the project and can later be represented as first-class ammo entries.

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

Treating a failed or incomplete ChatGPT web MCP authorization attempt as a reason to reintroduce runtime bootloading is rejected.

Leaving maintenance skills and consensus prompts only in chat history is rejected. They are part of the project's language-ammunition infrastructure and should be versioned in the repository.

Assuming that full-file publishing requires the model to manually type the entire artifact into visible chat is rejected. Large artifacts should be prepared by script or file processing, passed through the GitHub tool interface as complete content, and verified by read-back.

Introducing another GitHub MCP or custom wrapper before the official connector/MCP path has a concrete demonstrated deficiency is rejected.

## Current target

The stable target is a native Tampermonkey release artifact:

- `dcf-chatgpt-microcore.user.js` contains the whole DCF script;
- `dcf-chatgpt-microcore.meta.js` contains only the Tampermonkey metadata;
- no `Function(source)`, no eval, no remote engine execution;
- legacy local-engine auto-boot is disabled or absent.

The product target is a low-friction language ammunition firing system:

- language ammunition becomes a first-class, persistent, versioned, evolvable object;
- the control architecture remains small, pluginized, replaceable, and failure-isolated;
- GitHub remains a publishing, documentation, and ammunition supply source rather than a browser runtime code execution source.

The final choice should favor fewer moving parts and easier recovery over architectural cleverness.

## Reconsideration condition

Chunked releases may be reconsidered only if a future release artifact exceeds practical single-file limits and the chunking is generated, uploaded, hashed, and verified automatically by a build pipeline rather than hand-managed files. Runtime eval remains rejected on ChatGPT pages unless a future execution mechanism avoids page CSP and is explicitly validated.
