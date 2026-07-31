# Leverage V1 — Black Hole vs Conventional Database Architecture

Date: 2026-08-01
Branch: `experiment/storage-kernel-local`

## Frozen Inputs

- Dataset: `full_trace` (text + thinking + tool_use + tool_result projection)
- Corpus path: `reports/second-matrix/corpus/full_trace.bin`
- Corpus bytes: 50,542,796
- Corpus SHA-256: `b4fd2d8fa97444c40d49a36f9da6542124d119755b1724db61efefb411bdd225`
- Commit at freeze: `ef247723ab69e925c0b5a0947cae90dee2671bb9`
- Source of canonical projection: `reports/import/conversations.db` `content_blocks`
  (projection order: conversation created_at, message created_at, block ordinal;
  NUL between messages, newline after each block, trailing NUL; NUL inside content
  replaced with U+FFFD by the exporter)

## Architectures Under Comparison

### Black hole (compressed self-index segment)

- Physical representative: `utf8-a1-sdsl` = `reports/first-matrix/bin/utf8-a1-engine`
  (`csa_wt<wt_hutu<rrr_vector<63>>, 64, 64>` byte CSA, `construct_im`, NUL->0x01 canonicalization)
- One dominant structure absorbs: text storage, exact-substring search, arbitrary-span
  extract, full-text recovery, canonical byte positions.
- Runtime files: CSA index + small manifest (+ shared provenance contract).

### Conventional database baseline

- `SQLite structured facts + FTS5 trigram candidate index + zstd 256 KiB text blocks
  + row/span mapping` (crate `dcf-db-baseline`).
- FTS5 only narrows candidates; exact positions come from overlapping byte search on
  canonical bytes decompressed from independent zstd blocks. No full-scan masquerading.
- Queries shorter than 3 Unicode scalars are a measured residual:
  `operation_path = short_query_full_record_scan`.

## Shared (not counted toward either architecture)

- Canonical projection bytes and SHA-256 (copy in `shared/`)
- Block provenance contract: `shared/projection-boundaries.jsonl`
  (conversation_uuid, message_uuid, content_block_ordinal, content_type, canonical span)
- Query set (`query-cases.jsonl`), composition cases (`composition-cases.jsonl`),
  brute-force truth (`shared/query-truth.jsonl`)
- Test machine and process control (see `machine.json`)

## Deliverables

results.jsonl, capability-parity.json, architecture-ledger.json, storage-bom.json,
lifecycle-results.jsonl, recovery-micro.json, machine.json, commands.log, summary.md,
verify-leverage.py (+ harness scripts).

## Time Discipline

- Default subprocess timeout: 300 s
- Expected > 180 s: shrink corpus or repetitions first
- > 300 s: save log, mark `deferred_long_run`, never auto-extend
- No full main-corpus `recover_all` rerun; full recovery only on ~4 MiB
  `full_trace_recovery_micro`, once per architecture
- Adaptive repetitions: <10 ms -> 30; 10-100 ms -> 15; 100-1000 ms -> 5;
  1-5 s -> 3; >5 s -> 1 (no fabricated P95)
