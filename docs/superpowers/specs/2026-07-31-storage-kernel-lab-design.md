# DCF Storage Kernel Lab — Design

## Status

Approved experimental design. This branch is an executable outline, not a verified release.

## Goal

Build a disposable Rust laboratory that compares physical storage/search engines against the same logical DCF contract on three paired representations of the same conversations:

1. `zh_clean`: translated, cleaned Chinese projection.
2. `hybrid_clean`: Chinese visible text plus original English reasoning and English tool-call material, without the raw export envelope.
3. `raw_json`: untouched export bytes containing visible text, reasoning, tool calls, tool results, identifiers, timestamps, protocol fields and JSON structure. This representation is naturally about five times larger than the cleaned projection; it is not an artificial scale multiplier.

The laboratory must answer which physical engine is appropriate for which material body. It must not predeclare a universal winner.

## Non-negotiable logical contract

- Original source artifacts are immutable.
- Derived projections never overwrite or impersonate originals.
- All user-visible search evidence resolves to `TextId + canonical UTF-8 byte Span`.
- Every derived dataset and segment is bound to source identity and SHA-256.
- Search engines are replaceable projections.
- Engines are compared under one workload and one report schema.
- A failed engine build must not damage source artifacts or other engines.
- No result may be called verified until a local runner executes the conformance and benchmark suite.

## Repository isolation

All new work lives under `labs/storage-kernel/`. Existing DCF code is not modified.

The branch `experiment/storage-kernel-outline` is the frozen architectural outline. Local work should fork it to a separate branch such as `experiment/storage-kernel-local`.

## Architecture

```text
Paired source manifest
        |
        v
Corpus loader + profiler
        |
        v
Canonical dataset artifacts
        |
        +-------------------------+
        |                         |
        v                         v
Truth scanner               Engine adapters
                                  |
                  +---------------+----------------+
                  |               |                |
                  v               v                v
             UTF-8 A1       Unicode BA       Locate + zstd
                  |               |                |
                  +---------------+----------------+
                                  |
                                  v
                       Conformance + workload
                                  |
                                  v
                         Machine report JSON
```

## Material representations

Each representation is supplied as a UTF-8 byte file and paired through one manifest. The lab does not assume a vendor-specific export schema.

A representation record contains:

- stable `source_set_id` shared by all three representations;
- `variant` (`zh_clean`, `hybrid_clean`, `raw_json`);
- exact input path;
- optional record-boundary sidecar;
- optional provenance sidecar mapping projection spans to raw artifact spans.

The raw JSON file is indexed exactly as supplied when the `raw_json` candidate is tested. No parsing or reserialization may silently change its bytes.

## Engine model

Each engine implements the same process-neutral contract:

- `build(dataset, output_dir)`
- `open(segment_dir)`
- `count(query)`
- `locate(query, limit)`
- `extract(span)`
- `recover_all()`
- `measure_storage()`
- `verify()`

The Rust lab includes:

- an in-process truth scanner;
- an in-process zstd block text store;
- a JSON-lines external engine adapter so local C++/SDSL or later Rust engines can plug in without changing the lab contract;
- a composite locate-plus-zstd engine adapter.

The outline does not pretend to contain production FM-index implementations. Their executable adapters are local responsibilities.

## Experiment matrix

Every candidate is run against every representation for which it can satisfy the canonical-span contract:

| Representation | UTF-8 self-index | Unicode byte-aware self-index | UTF-8 locate + zstd | Unicode locate + zstd |
|---|---:|---:|---:|---:|
| `zh_clean` | yes | yes | yes | yes |
| `hybrid_clean` | yes | yes | yes | yes |
| `raw_json` | yes | yes if exact bytes remain UTF-8 | yes | yes if exact byte mapping is proven |

## Required measurements

### Correctness

- full SHA-256 recovery;
- exact count against truth scanner;
- exact locate spans against truth scanner;
- no cross-boundary false matches when a record map is present;
- exact extraction bytes;
- manifest/dataset mismatch refusal;
- delete-index-and-rebuild recovery.

### Corpus profile

- canonical bytes;
- Unicode codepoints;
- ASCII-byte share;
- Han-codepoint share;
- line count;
- optional record count;
- longest line/record;
- unique scalar count;
- SHA-256.

### Performance

- build wall time;
- peak RSS as supplied by the local wrapper;
- serialized bytes by component;
- open time;
- count P50/P95;
- locate P50/P95;
- end-to-end extract P50/P95 for 128 B, 1 KiB and 8 KiB windows;
- application-hot and application-cold text-store runs;
- same-block and dispersed-block workloads;
- full recovery time;
- rebuild time.

### Interpretation discipline

Reports must include absolute bytes, percentage relative to source bytes, and bytes per input byte. Current small-corpus absolute differences must never be used as long-term cost arguments.

## CLI workflow

```text
dcf-storage-lab profile --spec experiment/datasets.example.toml
dcf-storage-lab prepare --spec ... --out artifacts/
dcf-storage-lab truth --dataset artifacts/<variant>/ --queries experiment/queries.jsonl
dcf-storage-lab run --spec ... --engines experiment/engines.example.toml --out reports/
dcf-storage-lab verify-report reports/<run>.json
```

## Failure boundaries

- Source files are opened read-only.
- Each engine writes only beneath its own run directory.
- A partial build is marked incomplete and is never opened as a valid segment.
- Final segment activation uses write-to-temp then atomic rename.
- Every process protocol response is bound to `run_id`, `dataset_sha256`, `engine_id` and `config_sha256`.
- Unsupported operations return explicit capability errors; they are not silently emulated by another engine.

## Explicit non-goals

- No Electron, Chrome extension or current DCF integration.
- No semantic retrieval.
- No user account, sync or permission system.
- No claim that this code compiles or passes tests before local execution.
- No production FM-index implementation in this outline branch.
- No automatic promotion of a benchmark winner into a DCF architecture decision.

## Success criterion

The local branch can run one command that produces a self-describing report for all three paired representations and all configured engines, with every performance number attached to passed or failed correctness gates. The result must make it possible to explain why an engine wins a material role, not merely that it has the smallest number in one column.
