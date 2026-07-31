# DCF Storage Kernel Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a disposable Rust experiment harness that compares self-index and locate-plus-zstd candidates across paired Chinese-clean, hybrid-clean and untouched raw-JSON representations.

**Architecture:** The lab owns immutable dataset identity, canonical byte coordinates, truth scanning, workload orchestration and report generation. Physical indexes sit behind a process-neutral engine contract; local implementations may be C++/SDSL or Rust. A Rust zstd block store supplies the independent-text body for composite locate engines.

**Tech Stack:** Rust 2021, serde/serde_json/toml, clap, sha2, zstd, external JSON-lines engine protocol.

## Global Constraints

- Work only under `labs/storage-kernel/` plus the design and plan documents.
- Do not modify existing DCF runtime code.
- Source artifacts are read-only and byte-exact.
- Canonical coordinates are UTF-8 byte offsets.
- No benchmark result is valid unless correctness gates pass.
- This outline branch is written but not executed; local work owns compile fixes, tests and measurements.

---

### Task 1: Define language-neutral contracts

**Files:**
- Create: `labs/storage-kernel/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-contract/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-contract/src/lib.rs`

**Produces:** Dataset variants, spans, manifests, engine requests/responses, workload and report types.

- [ ] Write serialization tests for enum names, span bounds and report round trips.
- [ ] Run the tests and confirm expected failures before implementation.
- [ ] Implement the contract types without engine-specific fields leaking into logical spans.
- [ ] Run the tests locally and commit the verified result.

### Task 2: Load and profile paired source representations

**Files:**
- Create: `labs/storage-kernel/crates/dcf-corpus/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-corpus/src/lib.rs`

**Consumes:** `DatasetVariant`, `DatasetManifest`, `CorpusProfile`.

**Produces:** `load_experiment_spec`, `prepare_dataset`, exact SHA-256 and deterministic profiles.

- [ ] Write tests using three tiny paired files, including non-ASCII and raw JSON escapes.
- [ ] Verify that changing one byte changes dataset identity.
- [ ] Implement read-only loading, profile calculation and atomic dataset artifact creation.
- [ ] Verify the raw JSON artifact is copied byte-for-byte, not parsed and reserialized.

### Task 3: Define engine API and truth scanner

**Files:**
- Create: `labs/storage-kernel/crates/dcf-engine-api/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-engine-api/src/lib.rs`

**Produces:** `Engine` trait, capability model, `TruthScanner`, count/locate/extract/recover semantics.

- [ ] Write tests for overlapping matches, empty queries, multibyte UTF-8 queries and span validation.
- [ ] Implement byte-oriented truth scanning.
- [ ] Make unsupported capabilities explicit errors.

### Task 4: Implement independent zstd text store

**Files:**
- Create: `labs/storage-kernel/crates/dcf-text-zstd/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-text-zstd/src/lib.rs`

**Produces:** `ZstdBlockStoreBuilder`, `ZstdBlockStore`, exact cross-block extraction and full recovery.

- [ ] Write tests for zero-length input, exact block boundary, cross-block span and corrupted block hash.
- [ ] Implement fixed-size block compression with a versioned directory and per-block checksums.
- [ ] Use temp-directory build and atomic completion marker.
- [ ] Measure compressed body, directory and checksum bytes separately.

### Task 5: Implement external engine protocol adapter

**Files:**
- Create: `labs/storage-kernel/crates/dcf-engine-external/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-engine-external/src/lib.rs`
- Create: `labs/storage-kernel/protocol/engine-protocol.md`

**Produces:** Build and query process adapter for local SDSL/Rust engines.

- [ ] Write a fake executable fixture locally that returns deterministic JSON-lines responses.
- [ ] Test run-id, dataset-hash and config-hash mismatch rejection.
- [ ] Implement one-request/one-response JSON-lines calls with captured stderr and explicit timeouts.
- [ ] Do not reinterpret engine spans; reject invalid canonical byte ranges.

### Task 6: Implement composite locate-plus-zstd engine

**Files:**
- Create: `labs/storage-kernel/crates/dcf-lab-core/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-lab-core/src/lib.rs`

**Produces:** `CompositeEngine` that delegates count/locate to an external locator and extract/recover to the zstd store.

- [ ] Write tests proving the composite engine refuses mismatched corpus hashes.
- [ ] Implement capability composition without duplicating source truth.
- [ ] Record locator and text-store bytes as separate report components.

### Task 7: Implement workload runner and correctness gates

**Files:**
- Modify: `labs/storage-kernel/crates/dcf-lab-core/src/lib.rs`

**Produces:** Dataset-engine matrix execution, truth comparison, percentile summaries and report JSON.

- [ ] Write tests for a deliberately incorrect engine result and ensure performance results are marked invalid.
- [ ] Implement warmup, repeated samples, P50/P95, window workloads and dispersed-span workloads.
- [ ] Attach machine metadata supplied by the local wrapper; never guess peak RSS or cache state.
- [ ] Keep application-hot, application-cold/OS-hot and storage-cold labels distinct.

### Task 8: Implement CLI and example experiment files

**Files:**
- Create: `labs/storage-kernel/crates/dcf-lab-cli/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-lab-cli/src/main.rs`
- Create: `labs/storage-kernel/experiment/datasets.example.toml`
- Create: `labs/storage-kernel/experiment/engines.example.toml`
- Create: `labs/storage-kernel/experiment/queries.example.jsonl`
- Create: `labs/storage-kernel/README.md`
- Create: `labs/storage-kernel/docs/local-handoff.md`

**Produces:** `profile`, `prepare`, `truth`, `run`, and `verify-report` commands.

- [ ] Write CLI parser tests and end-to-end tests against fake engines.
- [ ] Implement commands with machine-readable stdout and human diagnostics on stderr.
- [ ] Document how local work creates `experiment/storage-kernel-local`, installs engine binaries and records compile/test evidence.
- [ ] Commit verified local changes in small reviewable commits; do not rewrite the frozen outline branch.
