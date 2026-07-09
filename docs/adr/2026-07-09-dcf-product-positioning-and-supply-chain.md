# ADR: DCF product positioning and GitHub MCP supply-chain status

Date: 2026-07-09
Status: proposed

## Context

DCF is being repositioned away from a generic ChatGPT webpage enhancement script.

The durable product identity is a low-friction language ammunition system inside the user's personal cognitive infrastructure. Its primary objects are not buttons or page widgets, but reusable language tools: high-quality expressions, judgment frameworks, role protocols, workflow prompts, ADR maintenance prompts, handoff protocols, evidence-chain structures, and multi-step collaboration chains.

DCF also has a second equally important engineering goal: it should preserve the user's flow state by keeping the runtime core small and stable while allowing capabilities to grow through replaceable data packs, source-level code plugins, project adapters, and a reliable supply chain.

The previous release-structure ADR rejected runtime chunk loading and remote eval. That decision remains valid. GitHub MCP, if usable, belongs to the supply chain, not to the browser runtime architecture.

## Decision

DCF should be evaluated as a two-layer system:

1. Language ammunition system.
   - Ammo, ammo packs, modes, chains, project adapters, and reusable prompts are first-class product objects.
   - The system should make high-quality cognitive tools easier to save, classify, search, version, compose, and fire into the current conversation.

2. Low-friction replaceable control architecture.
   - Stable kernel: startup, plugin registry, base UI, state read/write, version info, error isolation, launch entry.
   - Ammo system: storage, classification, search, versioning, composition, launch.
   - Plugin layer: summary, handoff, ADR, evidence-chain, project adapter, ammo pack management, and related capabilities.
   - Supply chain: GitHub release, full userscript update, ammo pack sync, ADR updates, rollback.

Pluginization means source-level modularity and data-level configurability. It does not mean browser runtime remote eval.

Data plugins such as ammo packs, templates, workflow definitions, project configs, and classification indexes may be synced more flexibly because they are data.

Code plugins that change runtime behavior must enter through source, build, and full userscript release. They must not be pulled from GitHub at runtime and executed through `Function(source)`, `eval`, localStorage executable slots, or chunk manifests.

## Current GitHub MCP status

A GitHub MCP connection is available in the current ChatGPT window. The following capabilities were verified on branch `research/mcp-supply-chain-upload-2026-07-09`:

- list repository branches;
- create a test branch from `main`;
- read `dcf-chatgpt-microcore.user.js` from `main`;
- read `dcf-chatgpt-microcore.meta.js` from `main`;
- read `docs/adr/2026-07-09-dcf-release-structure.md` from `main`;
- push multiple small files in one commit;
- read back a pushed file and verify its sentinel content.

The current `main` release baseline was read back as:

- `dcf-chatgpt-microcore.user.js`: version `0.8.1`, 11,525 bytes, SHA-256 `55bddd398c626319b8078fecd00398b5e9ff999b3dbb41c5a273ca0cd16a22f4`;
- `dcf-chatgpt-microcore.meta.js`: version `0.8.1`, 697 bytes, SHA-256 `154867d6daafd7dfe268b36457b4fd3e2a022d9337710646a474d300f79fad39`.

The readback check found no `Function(`, no `eval(`, no runtime manifest reference, and no jsDelivr reference in the root userscript. The remaining `github.engine` and `dcf.local.engine.v1` strings appear only as legacy storage keys to clean up, not as executable loading paths. The `raw.githubusercontent.com` references are the expected Tampermonkey `@updateURL` and `@downloadURL` metadata.

## Important unresolved point

The most important GitHub MCP supply-chain test is not yet passed.

The exposed write APIs currently accept file content as inline `content` strings. They do not expose a true local-file upload parameter for `create_or_update_file` or `push_files`.

Therefore a 70KB+ local generated userscript or ammo pack cannot yet be honestly marked as verified through a local-file upload path in this ChatGPT window. Passing `/mnt/data/file.js` as `content` would only upload the path string, not the file body. Passing base64 as `content` would upload base64 text, not the real artifact. Neither would satisfy the supply-chain requirement.

The verified status is: GitHub MCP can write and read repository files when full text is supplied inline. The unverified status is: whether this MCP surface can reliably replace manual pasting or commit a large generated artifact from a local file path without truncation, escaping pollution, path-string mistakes, or base64 mistakes.

This limitation must not be converted into runtime architecture. If the supply-chain tool cannot upload large local artifacts directly, the correct solution is to improve the release backend, use a proper Git push/build pipeline, or expose a file-parameter upload action. It is not a reason to reintroduce runtime chunk loading, GitHub raw engine manifests, localStorage executable code, or eval.

## Consequence

The product direction should continue from the native `0.8.1` Tampermonkey baseline, but the next engineering milestone should not be a large feature expansion.

The next milestone should be a minimal DCF architecture slice:

- stable kernel remains small and recoverable;
- ammo is represented as a first-class data object;
- firing an ammo item into the current conversation is the core user action;
- plugin registration exists at source level, with error isolation;
- data packs can be imported/exported without becoming executable code;
- GitHub supply-chain status remains explicit and testable;
- ADR updates are part of the normal maintenance flow.

## Rejected options

Treating DCF as a generic ChatGPT enhancement panel is rejected because it misses the durable value: preserving and firing accumulated cognitive tools.

Treating pluginization as remote browser eval is rejected.

Treating a partially verified MCP write path as a reliable release backend is rejected.

Treating MCP upload limitations as a reason to change browser runtime architecture is rejected.

Expanding features before the ammo model and kernel/plugin boundary are clear is rejected.

## Reconsideration conditions

A GitHub MCP release backend may be promoted from experimental to reliable only after it passes a full artifact test:

- create a test branch;
- upload a 70KB+ real userscript or ammo pack body, not a path string and not base64 text;
- read it back;
- verify size, start sentinel, end sentinel, and SHA-256 or equivalent integrity marker;
- update two files in one commit when needed, such as `.user.js` plus `.meta.js`;
- confirm that no truncation, escaping pollution, path-string substitution, or base64 substitution occurred.

Until then, GitHub MCP should be treated as useful for repository inspection, small edits, ADR updates, and possibly inline-content commits, but not yet as a fully verified large-artifact release backend.
