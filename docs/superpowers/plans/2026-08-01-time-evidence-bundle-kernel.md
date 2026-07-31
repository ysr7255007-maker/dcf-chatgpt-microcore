# Time Evidence Bundle Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first DCF data-storage kernel that indexes independent timestamped fact files, detects output-anchored behavior transitions, automatically compiles all matching evidence into deterministic bundles, and hands AI a ready-to-narrate prompt view.

**Architecture:** Independent recorders write JSONL facts and never call DCF. The kernel imports only fact envelopes into SQLite, derives behavior anchors from user text output and control-click facts, queries all evidence by overlapping time windows, and writes versioned evidence bundles. AI integration consumes bundle files only; it never searches recorder folders directly.

**Tech Stack:** Node.js 22+ built-ins, `node:sqlite`, JSONL, `node:test`, SHA-256 content addressing. No third-party runtime dependencies.

## Global Constraints

- New implementation work is confined to top-level `seed/`.
- Existing Chrome and legacy implementations remain untouched except for adding a discoverable seed test script to the root `package.json`.
- Recorders remain independent file producers; no recorder calls a DCF API.
- System time is the shared join coordinate. Every fact must carry `observed_at`; intervals may also carry `ended_at`.
- Raw facts remain authoritative. Indexes, anchors, bundles, prompt views, and narratives are rebuildable derivatives.
- AI receives a compiled evidence bundle and must not enumerate source folders or align timestamps itself.
- Platform-specific recorders may be framework-only when the current environment cannot execute their native APIs; their verification state must remain explicit.

---

## File Map

- `seed/evidence-bundle-kernel/src/database.js` — SQLite schema and transactions.
- `seed/evidence-bundle-kernel/src/facts.js` — fact-envelope validation, recursive JSONL import, deduplication, and overlap queries.
- `seed/evidence-bundle-kernel/src/anchors.js` — continuity grouping and deterministic output-to-output behavior anchors.
- `seed/evidence-bundle-kernel/src/bundles.js` — evidence classification, bundle versioning, timeline and prompt-view generation.
- `seed/evidence-bundle-kernel/src/daily.js` — one-command daily indexing, anchoring, and bundle compilation.
- `seed/evidence-bundle-kernel/src/cli.js` — CLI entry point.
- `seed/evidence-bundle-kernel/test/*.test.js` — executable storage and end-to-end specifications.
- `seed/evidence-bundle-kernel/recorders/` — independent recorder protocol and unverified browser/macOS examples.
- `seed/evidence-bundle-kernel/README.md` — local-AI handoff, formats, commands, and verification boundaries.

### Task 1: Temporal Fact Store

**Files:**
- Create: `seed/evidence-bundle-kernel/src/database.js`
- Create: `seed/evidence-bundle-kernel/src/facts.js`
- Test: `seed/evidence-bundle-kernel/test/facts.test.js`

**Interfaces:**
- Produces: `openDatabase(path)`, `ingestEvidenceRoot(db, root)`, `queryFactsByOverlap(db, startMs, endMs)`, `listBehaviorFacts(db)`.

- [ ] Write a failing test that imports JSONL from multiple recorder folders, rejects malformed envelopes, deduplicates stable event IDs, and returns all facts overlapping a time interval in chronological order.
- [ ] Run `node --test test/facts.test.js` and confirm failure because the store does not exist.
- [ ] Implement the SQLite schema, recursive JSONL reader, envelope normalization, SHA-256 fallback event IDs, source-file provenance, and overlap query.
- [ ] Re-run `node --test test/facts.test.js` and confirm pass.
- [ ] Commit with `feat(seed): add temporal fact store`.

### Task 2: Behavior Continuity and Anchors

**Files:**
- Create: `seed/evidence-bundle-kernel/src/anchors.js`
- Test: `seed/evidence-bundle-kernel/test/anchors.test.js`

**Interfaces:**
- Consumes: `listBehaviorFacts(db)`.
- Produces: `detectBehaviorAnchors(db, options)`, `listAnchors(db, dateRange)`.

- [ ] Write a failing test proving that clicks remain inside a continuous chain, consecutive text outputs form deterministic transition anchors, long idle gaps start a new chain, and reruns do not duplicate anchors.
- [ ] Run `node --test test/anchors.test.js` and confirm expected failure.
- [ ] Implement continuity grouping with a configurable idle gap and deterministic anchor IDs derived from the two boundary output facts.
- [ ] Re-run the test and confirm pass.
- [ ] Commit with `feat(seed): derive behavior anchors`.

### Task 3: Evidence Bundle Compiler

**Files:**
- Create: `seed/evidence-bundle-kernel/src/bundles.js`
- Test: `seed/evidence-bundle-kernel/test/bundles.test.js`

**Interfaces:**
- Consumes: anchors and `queryFactsByOverlap`.
- Produces: `compileEvidenceBundle(db, anchorId, outputRoot, options)` and `compileBundlesForRange(...)`.

- [ ] Write a failing test proving that one anchor produces `manifest.json`, `timeline.jsonl`, and `prompt-view.md`; boundary user actions are core evidence; same-window machine/browser/AI facts are direct evidence; padding-only facts are context evidence.
- [ ] Add a failing late-data test: importing a new overlapping fact must create the next bundle version, while recompiling unchanged evidence must remain idempotent.
- [ ] Implement deterministic classification, source digest, versioning, bundle membership, atomic directory replacement, and prompt-view rendering.
- [ ] Run `node --test test/bundles.test.js` and confirm pass.
- [ ] Commit with `feat(seed): compile versioned evidence bundles`.

### Task 4: Daily Pipeline and AI Handoff

**Files:**
- Create: `seed/evidence-bundle-kernel/src/daily.js`
- Create: `seed/evidence-bundle-kernel/src/cli.js`
- Create: `seed/evidence-bundle-kernel/package.json`
- Test: `seed/evidence-bundle-kernel/test/daily.test.js`

**Interfaces:**
- Produces: `runDaily({date, evidenceRoot, databasePath, bundleRoot})` and CLI command `daily`.

- [ ] Write a failing end-to-end test that starts from recorder JSONL files and ends with a bundle index containing compiled prompt views.
- [ ] Implement the daily orchestrator and CLI with structured JSON output and non-zero exit codes on invalid arguments.
- [ ] Run `npm test` inside `seed/evidence-bundle-kernel` and confirm all tests pass.
- [ ] Commit with `feat(seed): add daily evidence compilation pipeline`.

### Task 5: Independent Recorder Frameworks

**Files:**
- Create: `seed/evidence-bundle-kernel/recorders/shared/jsonl-writer.mjs`
- Create: `seed/evidence-bundle-kernel/recorders/browser-visible/manifest.json`
- Create: `seed/evidence-bundle-kernel/recorders/browser-visible/service-worker.js`
- Create: `seed/evidence-bundle-kernel/recorders/browser-visible/content-script.js`
- Create: `seed/evidence-bundle-kernel/recorders/native-writer/native-writer-host.mjs`
- Create: `seed/evidence-bundle-kernel/recorders/computer-state/macos-state-poller.mjs`
- Test: `seed/evidence-bundle-kernel/test/recorder-protocol.test.js`

**Interfaces:**
- All recorders emit the same thin fact envelope but retain source-specific payloads.

- [ ] Write a protocol test for append-only JSONL output and length-prefixed native-messaging input.
- [ ] Implement the shared writer and native host; verify them in Node.
- [ ] Add a browser extension framework that records visible page state through native messaging without importing DCF code.
- [ ] Add a macOS polling framework for frontmost application/window state changes; mark runtime verification as unavailable outside macOS Accessibility execution.
- [ ] Run protocol tests plus `node --check` on all JavaScript modules.
- [ ] Commit with `feat(seed): add independent evidence recorder frameworks`.

### Task 6: Documentation and Repository Entry Point

**Files:**
- Create: `seed/evidence-bundle-kernel/README.md`
- Modify: `package.json`

- [ ] Document authority boundaries, JSONL envelope, database schema, bundle layout, late-data recompilation, privacy exclusions, and exact local-AI verification commands.
- [ ] Add root scripts `test:seed:evidence` and `verify:seed:evidence` without changing the meaning of the preserved Chrome/legacy scripts.
- [ ] Run `npm --prefix seed/evidence-bundle-kernel run verify` in the isolated implementation copy.
- [ ] Inspect the branch diff and confirm all production files are under `seed/` except the root script entry.
- [ ] Commit with `docs(seed): document evidence bundle kernel`.
