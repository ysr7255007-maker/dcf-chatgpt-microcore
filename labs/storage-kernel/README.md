# DCF Storage Kernel Lab

This directory is a disposable Rust experiment outline for the future DCF material-store kernel.

## Important status

The branch `experiment/storage-kernel-outline` has been written without local compilation or execution. It is not evidence that the code builds, tests pass, an engine is correct, or a benchmark number is valid.

Local work should fork this branch and preserve it as the original experiment hypothesis.

```bash
git switch experiment/storage-kernel-outline
git switch -c experiment/storage-kernel-local
```

## What the lab compares

Three paired representations of the same conversations:

- `zh_clean`: translated and cleaned Chinese projection.
- `hybrid_clean`: Chinese visible text plus original English reasoning and English tool-call material.
- `raw_json`: untouched export bytes, naturally about five times larger because it retains complete reasoning, tool calls, tool results, metadata and JSON structure.

Four physical candidates:

- UTF-8 self-index (`utf8-a1`).
- dense Unicode byte-aware self-index.
- UTF-8 locate-only index plus independent zstd text store.
- dense Unicode byte-aware locate-only index plus independent zstd text store.

The lab does not assume that one candidate should win every representation.

## What remains stable

- source artifact identity;
- SHA-256 binding;
- canonical UTF-8 byte spans;
- engine protocol;
- truth queries;
- correctness gates;
- report fields.

Physical engine code, compression layout, cache strategy and CLI implementation are disposable.

## Workspace

```text
crates/dcf-contract         language-neutral experiment types
crates/dcf-corpus           read-only source preparation and profiling
crates/dcf-engine-api       common engine contract and truth scanner
crates/dcf-engine-external  persistent JSON-lines child-process adapter
crates/dcf-text-zstd        independent fixed-block zstd text store
crates/dcf-lab-core         engine composition, conformance and benchmark runner
crates/dcf-lab-cli          command-line entry point
protocol/                   external engine protocol
experiment/                 example dataset, engine and query specifications
docs/                       local handoff and evidence rules
```

## Intended commands

```bash
cd labs/storage-kernel

cargo run -p dcf-storage-lab -- profile \
  --spec experiment/datasets.local.toml

cargo run -p dcf-storage-lab -- prepare \
  --spec experiment/datasets.local.toml \
  --out artifacts

cargo run -p dcf-storage-lab -- truth \
  --dataset artifacts/<dataset-id> \
  --queries experiment/queries.local.jsonl

cargo run --release -p dcf-storage-lab -- run \
  --datasets experiment/datasets.local.toml \
  --engines experiment/engines.local.toml \
  --queries experiment/queries.local.jsonl \
  --artifacts artifacts \
  --runs runs \
  --report reports/local-run.json \
  --machine experiment/machine.local.json

cargo run -p dcf-storage-lab -- verify-report \
  --report reports/local-run.json
```

These commands are intended interfaces. Local compilation and repair may alter implementation details but should not silently weaken the contracts.

## Correctness before speed

For each dataset-engine pair the runner checks:

1. engine binding matches dataset identity, length and SHA-256;
2. full recovery matches canonical SHA-256;
3. Count matches the byte truth scanner;
4. Locate returns the same canonical byte spans;
5. Extract returns identical bytes.

If any gate fails, performance fields are suppressed for that run.

## Cache terminology

The in-process runner can distinguish only:

- `application_hot`: decoded blocks may remain in an engine-owned cache;
- `application_cold_os_unspecified`: engine-owned cache was cleared, but operating-system page cache was not controlled.

A true storage-cold measurement requires a local privileged wrapper and must be recorded as external evidence. The runner must not relabel application-cold data as disk-cold.

## Raw JSON discipline

`raw_json` is copied and indexed exactly as supplied. It must not be parsed and reserialized during preparation. Any cleaned projection is a separate derived artifact with an optional provenance sidecar.

A good compression ratio on raw JSON does not by itself prove a good user search experience. Reports must keep visible-text, reasoning, tool-call and JSON-structure query classes separate.
