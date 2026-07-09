# DCF Maintenance Skill

Date: 2026-07-09
Status: draft

## Purpose

This document defines the maintenance skill for DCF ChatGPT Microcore.

The skill is not merely a bug-fixing checklist. It is a reusable operating protocol for any AI session that maintains DCF as part of the user's personal cognitive infrastructure.

DCF has two inseparable layers:

1. **Language ammunition system**: high-quality expressions, judgment frameworks, role protocols, handoff texts, ADR prompts, and multi-step collaboration flows become persistent, versioned, searchable, and precisely launchable language ammunition.
2. **Low-friction control architecture**: the system must reduce the user's operational friction through a small stable kernel, plugin-style replaceable capabilities, failure isolation, reliable publishing, and text-driven evolution.

The maintenance skill exists to preserve both layers while changing the project.

## When to invoke this skill

Use this skill when:

- onboarding a new AI window to DCF;
- modifying the userscript, release process, prompt library, ammo model, or plugin model;
- diagnosing a runtime failure in ChatGPT or Tampermonkey;
- deciding whether a proposed capability belongs in the stable kernel, a plugin, an ammo pack, or documentation;
- preparing a release or verifying a GitHub publishing path;
- updating project ADRs after a meaningful decision.

## Core responsibility

The maintainer must keep DCF aligned with its actual purpose:

> DCF is a low-friction language ammunition firing system inside the user's personal cognitive infrastructure. It turns high-quality cognitive tools from user-AI collaboration into persistent, versioned, evolvable, precisely launchable language ammunition, while keeping the runtime small, replaceable, recoverable, and friendly to the user's flow state.

Do not reduce DCF to "a ChatGPT webpage button" or "a userscript bug". The userscript is the current launcher shell; it is not the whole product.

## Operating principles

### 1. Preserve the two-layer model

Every change should be evaluated against both questions:

- Does it make language ammunition easier to capture, maintain, classify, evolve, retrieve, combine, or fire?
- Does it reduce operational friction, isolate failure, preserve replaceability, or make text-driven updates easier?

A feature that is powerful but increases everyday friction may be a bad DCF feature.

### 2. Separate product architecture from publishing tools

GitHub, GitHub MCP, the ChatGPT GitHub connector, local git, and build scripts are supply-chain tools. They may make publishing easier, but they must not dictate browser runtime architecture.

Tool limits must not cause runtime bootloaders, remote code eval, manual chunk loading, or fragile browser-side code supply chains.

### 3. Keep runtime code stable and complete

The public Tampermonkey release artifact should be a complete `.user.js` file. Tampermonkey should update through native `@updateURL` and `@downloadURL`.

Rejected runtime paths:

- downloading JavaScript from GitHub or a CDN and executing it with `Function(source)` or eval;
- treating `localStorage` as an executable code release channel;
- requiring chunk manifests for normal runtime code;
- making the browser responsible for release assembly.

Data may be synchronized more flexibly. Executable code changes should enter through source, build, release, and full userscript publication.

### 4. Make ammunition a first-class object

When a discussion produces a stable expression, judgment framework, role prompt, workflow, handoff, or maintenance protocol, treat it as a candidate ammo item or ammo pack.

Do not leave important language assets buried only in conversation history. Decide whether they belong in:

- a prompt/consensus guide;
- a maintenance skill;
- an ammo pack;
- an ADR;
- a release note;
- a project adapter.

### 5. Prefer the shortest correct path, then verify

Before inventing a replacement architecture, test the direct path that should work. Only escalate after there is concrete failure evidence.

A proper maintenance cycle is:

```text
observe the actual failure or need
classify the layer affected
choose the minimal correct change
apply the change
read back or run the result
verify with explicit evidence
record durable decisions in ADR
```

## Layer classification

When handling a task, classify it first.

```text
Product intent
  The purpose, user value, and conceptual model of DCF.

Ammo model
  How language ammunition is named, stored, categorized, versioned, selected, and fired.

Plugin/control architecture
  How capabilities are registered, isolated, replaced, disabled, and composed.

Runtime userscript
  Code that actually runs on ChatGPT pages.

Supply chain
  GitHub, MCP, build, release, update URLs, full-file upload, verification.

Documentation and consensus
  Handoff texts, shared-understanding prompts, ADRs, maintenance skills.
```

Avoid solving a problem in the wrong layer.

## Standard maintenance workflow

1. **Recover current state**
   - Identify current branch, release version, relevant files, and existing ADRs.
   - Confirm whether the current issue is product, runtime, supply chain, plugin, ammo, or documentation.

2. **State the working interpretation**
   - Explain what DCF is in this context.
   - Name the layer being changed.
   - State what must not be changed.

3. **Make the smallest coherent change**
   - Preserve the stable kernel.
   - Keep code/plugin/data boundaries clear.
   - Avoid adding runtime complexity to solve publishing friction.

4. **Verify directly**
   - Read back GitHub files after writing.
   - Check versions and forbidden runtime patterns.
   - For upload-path tests, verify file size, beginning, ending sentinel, and integrity.
   - For browser runtime changes, verify Tampermonkey update and visible ChatGPT behavior.

5. **Record durable knowledge**
   - Update the relevant ADR when a decision changes project direction.
   - Add or update maintenance docs when a reusable protocol emerges.
   - Promote stable prompts or workflows into ammo documentation.

## Required release checks

For every public userscript release, verify:

```text
user.js and meta.js version match
@updateURL and @downloadURL are correct
published user.js is complete
no Function(source)
no eval-based engine loading
no GitHub chunk manifest for runtime code
no CDN chunk loading for runtime code
no GM_xmlhttpRequest remote engine execution
Tampermonkey can install or update
ChatGPT page can show the DCF launcher
```

## Required ADR triggers

Update ADR when:

- a release architecture is accepted or rejected;
- a runtime boundary is changed;
- a supply-chain tool becomes trusted or untrusted;
- a new first-class object is introduced, such as Ammo, Ammo Pack, Plugin, Chain, Mode, or Project Adapter;
- a previously used approach is formally rejected;
- a failure reveals a durable project rule.

## Maintenance output format

A good maintenance report should include:

```text
Current interpretation
Files changed or inspected
Verification performed
Decision recorded or not recorded
Next concrete action
```

Do not replace action with apology. Do not replace verification with confidence.
