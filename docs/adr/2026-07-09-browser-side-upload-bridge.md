# ADR: Browser-side GitHub upload bridge

Date: 2026-07-09
Status: proposed

## Context

The current ChatGPT-hosted official GitHub MCP surface can inspect repositories and commit inline text content, but it does not expose a local-file artifact upload parameter. This led to the question of whether a Tampermonkey userscript could download a file produced in the browser and upload it to a selected GitHub repository.

A userscript can interact with the current page, read suitable DOM links or in-memory text/blob data, perform cross-origin requests through Tampermonkey APIs when allowed, and call GitHub REST endpoints. GitHub's repository contents endpoint can create or replace a file by sending Base64-encoded content, commit message, branch, and SHA when updating an existing file.

However, a userscript cannot silently read arbitrary files from the browser download folder. It can only upload data it already has in memory, data it can fetch through an accessible URL, or files explicitly selected by the user through a file picker or drag-and-drop.

## Decision

A Tampermonkey-based browser-side upload bridge is technically feasible, but it should not be the default long-term supply-chain backend.

It may be used as a prototype, emergency bridge, or single-user low-frequency path when the release payload is already available in the browser as text/blob/link content.

The bridge must be treated as a browser-side control surface, not as DCF's trusted release core.

## Recommended boundary

Allowed responsibilities:

- detect or accept a candidate artifact from the current page;
- compute size, hash, and sentinel checks in browser memory;
- preview the target repository/path/branch/commit message;
- require explicit user confirmation before write;
- call GitHub API to create/update a file when the payload is small enough and single-file commits are acceptable;
- read back from GitHub and verify content hash;
- emit a release receipt.

Forbidden or discouraged responsibilities:

- silently reading arbitrary local download directories;
- storing a broad GitHub token permanently in userscript code;
- mixing runtime code loading with release uploading;
- treating browser-side upload as a replacement for a generic local supply-chain core;
- bypassing explicit confirmation for repository writes;
- using this path for multi-file atomic releases unless implemented through Git Data API or a trusted backend.

## Security stance

A GitHub token in a userscript/browser environment is high risk. If used at all, it should be fine-grained, repository-limited, permission-limited, short-lived where possible, and never hard-coded into the userscript.

The safer long-term path is still a generic supply-chain core outside the browser, with project release profiles. The userscript can act as a front-end launcher for that core.

## Consequences

For DCF, a Tampermonkey bridge could be useful for quickly firing a ChatGPT-generated artifact into a test branch, but it should not become the canonical release architecture.

For long-term work, the architecture should be:

- DCF runtime remains a stable native userscript;
- browser bridge optionally captures user-approved payloads;
- generic supply-chain core performs durable release operations;
- project profile defines release artifacts and validation rules;
- ADR records the release decision and verification result.

## Rejected alternatives

Using a userscript as a fully trusted release backend is rejected.

Hard-coding GitHub credentials into DCF is rejected.

Allowing the browser bridge to reintroduce remote runtime code loading is rejected.

Expecting userscript code to read arbitrary local downloaded files without user selection is rejected.

## Reconsideration conditions

The browser bridge may be promoted only if it proves low-friction without weakening credential safety, produces reliable readback receipts, and remains clearly separated from DCF runtime execution.

For multi-file release, it must support atomic commits through Git Data API or delegate to a trusted supply-chain core.
