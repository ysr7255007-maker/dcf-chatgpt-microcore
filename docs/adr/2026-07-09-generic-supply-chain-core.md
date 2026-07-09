# ADR: Generic supply-chain core instead of per-project publishers

Date: 2026-07-09
Status: proposed

## Context

DCF needs a reliable supply chain for publishing native Tampermonkey userscripts, ammo packs, ADR updates, and project-specific assets.

The previous discussion identified that the official GitHub MCP surface exposed in the current ChatGPT window is useful for repository inspection and inline-content commits, but does not expose a local-file artifact upload parameter. A possible response would be to create a dedicated DCF publisher.

However, a dedicated publisher for every project would not scale as a long-term working model. The user needs a general mechanism for low-friction project updates, not a growing collection of bespoke release scripts that each require independent maintenance.

## Decision

Do not build a separate publisher for each project.

The correct direction is a generic supply-chain core with thin project release profiles.

The generic core should provide reusable operations:

- inspect repository status;
- copy or materialize local artifact files into a repo worktree;
- stage selected files;
- commit with a structured message;
- push to a selected branch;
- read back from the pushed ref;
- verify size, hash, and sentinels;
- optionally create pull requests;
- write or update ADR records;
- produce a machine-readable release receipt.

Each project should provide only a small release profile, not a custom publisher. A profile describes:

- repository identity;
- release branch policy;
- artifact source paths;
- target paths inside the repository;
- required files for a release;
- validation rules;
- forbidden runtime patterns;
- post-release readback checks;
- optional ADR paths and release notes paths.

For DCF, such a profile might say that `dcf-chatgpt-microcore.user.js`, `dcf-chatgpt-microcore.meta.js`, and selected ADR files are release-managed artifacts, and that runtime eval, remote engine manifests, and executable localStorage slots are forbidden.

## Consequences

The supply chain becomes a reusable personal infrastructure component rather than a one-off DCF tool.

DCF keeps a project-specific release profile, but the execution engine remains shared.

Other projects can reuse the same supply-chain core by adding their own profiles.

This preserves low friction without multiplying custom maintainers.

## Rejected alternatives

A dedicated DCF-only publisher is rejected as the long-term default. It may be acceptable as a temporary prototype only if it is shaped as the first profile of the generic core.

A separate custom publisher for every project is rejected because it creates maintenance burden and fractures the user's workflow.

Continuing to rely on the current official GitHub MCP surface as the full release backend is rejected because it lacks local artifact upload semantics in the current ChatGPT integration.

Returning to browser runtime remote loading is rejected because supply-chain limitations should not contaminate DCF runtime architecture.

## Reconsideration conditions

A project-specific publisher may be allowed only when the project has a truly unique release target that cannot be described by a generic profile.

Even then, the preferred shape is a plugin or adapter inside the generic supply-chain system, not an isolated release tool.
