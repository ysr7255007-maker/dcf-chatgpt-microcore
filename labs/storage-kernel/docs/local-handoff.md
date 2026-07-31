# Local Handoff — DCF Storage Kernel Lab

## Branch discipline

Do not repair this branch in place.

```bash
git fetch origin
git switch experiment/storage-kernel-outline
git switch -c experiment/storage-kernel-local
```

The outline branch records the intended experiment before local compiler, dependency and platform constraints alter it. The local branch records reality.

## Local worker responsibilities

1. Compile the workspace and record the exact toolchain.
2. Fix compile errors without silently changing logical contracts.
3. Add tests before relying on any path.
4. Implement or adapt external engine executables.
5. Prepare paired local datasets from the same conversations.
6. Run correctness gates before benchmarks.
7. Record hardware, OS, compiler, dependency versions and cache state.
8. Commit changes and evidence in reviewable units.

## Contracts that require explicit ADR before changing

- `TextId + canonical UTF-8 byte Span`.
- raw source bytes are immutable.
- derived projections have separate identity.
- manifests bind dataset SHA-256 and engine configuration SHA-256.
- incorrect engines do not receive valid performance results.
- storage totals include every byte required to open and use the segment.
- reports include bytes/input-byte, not only current absolute MiB.
- cache states are named according to what was actually controlled.

If one of these contracts is impossible, record:

```text
Original assumption
Observed local evidence
Why the assumption failed
Smallest contract change
Blast radius
Migration/rebuild implications
```

Do not change the contract merely to make an engine adapter easier to implement.

## First local sequence

### 1. Compile only

```bash
cd labs/storage-kernel
rustup show
cargo check --workspace
```

Capture stdout/stderr and compiler version. Do not claim success from source inspection.

### 2. Add minimal contract tests

Start with:

- span reversal and bounds;
- overlapping truth matches;
- raw JSON byte-for-byte preparation;
- zstd cross-block extraction;
- response binding mismatch;
- report storage-total consistency.

### 3. Create paired datasets

The three files must come from the same source conversations:

```text
zh_clean
  translated/cleaned Chinese projection

hybrid_clean
  Chinese visible text + original English reasoning + English tool calls/results

raw_json
  exact original export bytes, with complete tools and protocol envelope
```

Do not synthesize “5x” by copying data. The raw export is naturally larger.

Create `datasets.local.toml` from the example. Keep private corpus paths and data out of Git.

### 4. Implement the external engine executable

A first adapter may wrap the existing C++/SDSL experiments. It must implement `protocol/engine-protocol.md`.

Minimum modes:

- `utf8_a1`;
- `unicode_dense_byte_aware`;
- `utf8_locate_only`;
- `unicode_dense_locate_only_byte_aware`.

The locate-only modes must report no Extract/Recover capability. The Rust composite supplies those operations through the zstd store.

### 5. Establish truth queries

Build local queries from four content classes:

- visible Chinese text;
- original English reasoning;
- tool names, parameters, paths and failures;
- raw JSON fields and structure.

Include absent queries and queries near long-message tails.

### 6. Run conformance before release benchmarks

Any mismatch in Count, Locate, Extract or recovery must stop performance interpretation. Preserve the failing report and engine stderr.

### 7. Run both machines

Record separately:

- Apple machine: exact model, memory, OS, compiler, storage and power mode;
- desktop: CPU, RAM, storage, OS/WSL mode and compiler.

Do not merge results into one average. Hardware differences are part of the evidence.

## Expected local modifications

The outline intentionally leaves local choices open for:

- exact SDSL build system;
- C++/Rust FFI versus child process;
- memory mapping;
- peak RSS collection;
- storage-cold harness;
- record/provenance sidecar schema;
- persistent engine process lifecycle;
- benchmark pinning and CPU governor controls.

Changes here are not failures. The experiment value comes from documenting why they were necessary.

## Completion evidence

A local run is complete only when the repository contains or references:

- compiler and dependency lockfiles;
- passing test output;
- dataset manifests without private contents;
- external engine build identity;
- machine metadata;
- full machine report JSON;
- list of differences from the outline branch;
- interpretation that distinguishes measured fact from architectural inference.
