# DCF Time Evidence Bundle Kernel

This directory contains the first executable form of the new DCF storage architecture.

It does **not** make AI search recorder folders. It turns independent timestamped facts into ready-to-narrate behavior evidence bundles before AI is invoked.

```text
independent JSONL recorders
        ↓
SQLite temporal fact index
        ↓
output/click continuity chains
        ↓
output-to-output behavior anchors
        ↓
time-window evidence bundle compiler
        ↓
prompt-view.md
        ↓
AI writes the personal behavior narrative
```

## Authority boundaries

- Raw recorder JSONL is the authority for what a recorder observed.
- SQLite is a rebuildable time index and derivative-state store.
- Behavior anchors are rebuildable candidates, not claims about the semantic shape of an influence.
- Evidence bundles are versioned derivatives. Late facts create a new version.
- `prompt-view.md` is the only file AI needs for baseline narration.
- Recorders never call DCF and DCF never controls recorders.

## Runtime requirements

- Node.js 22.5 or newer, because the kernel uses the built-in `node:sqlite` module.
- No third-party runtime dependencies.

## Fact envelope

Every recorder owns its payload schema. Only this outer envelope is shared:

```json
{
  "event_id": "optional stable id",
  "source": "computer-state-macos",
  "kind": "computer.frontmost.changed",
  "observed_at": "2026-08-01T07:20:19.123+09:00",
  "ended_at": "2026-08-01T07:20:48.000+09:00",
  "context": {"device": "macbook"},
  "payload": {"application": "Chrome", "window_title": "DCF"},
  "payload_ref": "optional/path/to/large-payload"
}
```

Required fields are `kind` and `observed_at`. Missing `source` becomes `unknown-recorder`. Missing `event_id` becomes a SHA-256 content address.

A repeated event ID with identical content is a duplicate. A repeated event ID with different content is an explicit conflict and is not silently accepted.

## Evidence folder

Recorders may choose their own subdirectories:

```text
Evidence/
├── output/2026-08-01.jsonl
├── click/2026-08-01.jsonl
├── computer-state-macos/2026-08-01.jsonl
├── browser-visible/2026-08-01.jsonl
├── ai-visible/2026-08-01.jsonl
└── code-state/2026-08-01.jsonl
```

The importer recursively reads every `.jsonl` file. Recorder names and payload formats do not need to be registered in advance.

## Current anchor detector

The baseline detector intentionally avoids deciding what kind of influence occurred.

1. Sort `user.text.output` and `user.control.click` facts by system time.
2. Break continuity when the idle gap exceeds the configured limit.
3. Keep clicks inside the continuous chain.
4. For every consecutive pair of text outputs in one chain, create a deterministic behavior-transition anchor.

This produces the minimal statement:

```text
previous user output
→ intervening input and operation interval
→ next user output
```

It does not claim that the second output supports, rejects, corrects, or replaces the first. AI may describe that later from the compiled bundle.

## Evidence bundle

For every anchor, the compiler queries the temporal index once and writes:

```text
bundles/
└── anchor_<id>/
    ├── v0001/
    │   ├── manifest.json
    │   ├── timeline.jsonl
    │   └── prompt-view.md
    └── v0002/                 # created only when relevant evidence changes
```

Evidence tiers:

- `core`: the two boundary outputs and user clicks/outputs inside the behavior interval.
- `direct`: non-user facts overlapping the behavior interval.
- `context`: facts found only in the configured before/after padding windows.

`manifest.json` records every source event ID, content hash, source file, tier, relation, compiler version, source digest, and exact time window. Recompiling identical evidence is idempotent. Importing a late overlapping fact changes the source digest and creates the next version.

## Daily command

```bash
node src/cli.js daily \
  --date 2026-08-01 \
  --utc-offset +09:00 \
  --evidence-root /path/to/Evidence \
  --db /path/to/DCF/state/evidence.sqlite \
  --bundles /path/to/DCF/state/bundles
```

Optional controls:

```text
--idle-gap-minutes 30
--padding-before-seconds 60
--padding-after-seconds 60
```

The command performs:

```text
recursive fact import
→ conflict/deduplication check
→ continuity and anchor derivation
→ time-overlap bundle compilation
→ daily/YYYY-MM-DD.json index write
```

The returned JSON tells the caller exactly how many facts, anchors, bundle versions, conflicts, and malformed lines were observed.

## AI handoff

AI receives one `prompt-view.md`, not the raw evidence folder. The view is already chronological and contains:

- the two user-output boundaries;
- intervening clicks;
- matching computer, browser, AI, code, terminal, or other facts;
- evidence tiers and relation to the behavior interval;
- an instruction not to invent causality from time adjacency.

The AI output may later be stored as a narrative derivative associated with the bundle ID and version. This branch deliberately stops before choosing a model provider or making narrative text authoritative.

## SQLite contents

The database stores only rebuildable coordination structures:

- `facts`: temporal metadata, small payloads, hashes, and source-file locations;
- `anchors`: deterministic output-pair boundaries and continuity-chain identity;
- `bundles`: bundle version, source digest, generated prompt, and output path;
- `bundle_members`: exact facts included in each version and their evidence tier.

Large payloads may remain external through `payload_ref`.

## Tests

```bash
npm test
npm run verify
```

The executable tests prove:

- recursive multi-recorder JSONL import;
- interval overlap query;
- duplicate and conflict behavior;
- deterministic continuity chains and anchors;
- core/direct/context evidence classification;
- idempotent recompilation;
- late-fact bundle versioning;
- end-to-end daily compilation;
- recorder JSONL and Chrome native-messaging framing.

## Verification boundary

Verified in the implementation sandbox:

- Node storage kernel and all unit/end-to-end tests;
- shared JSONL writer;
- native-messaging framing and writer protocol;
- JavaScript syntax of browser and macOS recorder frameworks.

Not verified here:

- Chrome extension installation and real native-host connection;
- macOS frontmost-window polling permissions;
- a real Accessibility-based final-text/click recorder;
- integration with the existing Companion Core or DCF Surface;
- full repository `npm run verify`, because the execution sandbox cannot clone GitHub.

The local AI should treat those states as `not_tested`, run them on the target machine, and modify the framework without changing the core rule: recorders write timestamped files independently; DCF compiles evidence by time.
