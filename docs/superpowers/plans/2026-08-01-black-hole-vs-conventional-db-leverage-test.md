# DCF 黑洞架构 vs 普通数据库架构杠杆验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一 `full_trace` 语料和同一规范 Span 合同下，实现一个诚实的普通数据库基线，与现有压缩自索引黑洞候选进行功能、空间、交互性能、同步接缝和生命周期的完整对照。

**Architecture:** 黑洞侧复用现有 `utf8-a1-sdsl` 与统一位置结果；普通侧新增 `SQLite structured facts + FTS5 trigram candidate index + zstd text blocks + row/span mapping`。两侧通过同一 JSON-lines 协议返回规范字节 Span，由一个受 300 秒硬超时和自适应重复策略约束的 Python harness 生成 `reports/leverage-v1/` 证据包。

**Tech Stack:** Rust 2021、rusqlite bundled SQLite/FTS5、zstd 0.13、现有 SDSL C++ 引擎、Python 3 标准库、JSONL。

## Global Constraints

- 只在 `experiment/storage-kernel-local` 工作，不修改 `experiment/storage-kernel-outline`。
- 当前 `reports/calibration/` 冻结，不改写历史结果。
- 主语料只使用 `reports/second-matrix/corpus/full_trace.bin` 及其固定 SHA-256。
- 完整主语料不得再次运行 `recover_all`。
- 全文恢复只在约 4 MiB 的确定性均衡微型语料上，每个架构运行 1 次。
- 默认单命令超时 300 秒；预计超过 180 秒先降规模或降重复数。
- 未经用户明确批准，不运行预计超过 10 分钟的任务。
- 不进入 Unicode、r-index、Grammar、采样参数扫描、200 GB/2 TB 压测。
- 不用暴力全文扫描冒充普通数据库搜索索引；短查询被迫回退时必须明确标记。
- 两套架构必须返回同一 `TextId + canonical UTF-8 byte Span`，正确性不过则性能无效。
- 所有可运行所需正文、索引、映射、目录、Manifest 都计入各自 `architecture_runtime_bytes`。

---

## File Structure

### New conventional baseline crate

- Create: `labs/storage-kernel/crates/dcf-db-baseline/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/lib.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/schema.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/store.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/search.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/protocol.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/bin/dcf-db-baseline.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/tests/baseline_contract.rs`
- Modify: `labs/storage-kernel/Cargo.toml`

### New experiment harness and reports

- Create: `labs/storage-kernel/reports/leverage-v1/README.md`
- Create: `labs/storage-kernel/reports/leverage-v1/build-recovery-micro.py`
- Create: `labs/storage-kernel/reports/leverage-v1/query-cases.jsonl`
- Create: `labs/storage-kernel/reports/leverage-v1/composition-cases.jsonl`
- Create: `labs/storage-kernel/reports/leverage-v1/run-leverage.py`
- Create: `labs/storage-kernel/reports/leverage-v1/run-lifecycle.py`
- Create: `labs/storage-kernel/reports/leverage-v1/verify-leverage.py`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/results.jsonl`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/capability-parity.json`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/architecture-ledger.json`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/storage-bom.json`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/lifecycle-results.jsonl`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/recovery-micro.json`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/machine.json`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/commands.log`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/summary.md`

---

### Task 1: Freeze inputs and establish the experiment identity

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/README.md`
- Create: `labs/storage-kernel/reports/leverage-v1/query-cases.jsonl`
- Create: `labs/storage-kernel/reports/leverage-v1/composition-cases.jsonl`

**Interfaces:**
- Consumes: `reports/second-matrix/corpus/full_trace.bin`, existing truth sets, `utf8-a1-engine-v2`.
- Produces: immutable dataset/query identities consumed by every later task.

- [ ] **Step 1: Record the branch and corpus identity**

Run:

```bash
cd labs/storage-kernel
git status --short
git rev-parse HEAD
shasum -a 256 reports/second-matrix/corpus/full_trace.bin
wc -c reports/second-matrix/corpus/full_trace.bin
```

Write the exact commit, corpus bytes and SHA-256 into `reports/leverage-v1/README.md`.

- [ ] **Step 2: Create exact-substring query cases**

Create `query-cases.jsonl` with at least 12 cases copied from the calibrated truth set, covering:

```json
{"query_id":"absent-sentinel","query":"DCF_ABSENT_SENTINEL_7F3A","class":"absent"}
{"query_id":"zh-medium","query":"架构","class":"visible_text"}
{"query_id":"en-reasoning","query":"reasoning","class":"thinking"}
{"query_id":"tool-name","query":"tool_use","class":"tool"}
{"query_id":"code-path","query":"/Users/","class":"path"}
```

Use actual query strings from existing truth files rather than inventing replacements when available. Include at least one query shorter than three Unicode scalars and label it `short_query_edge`.

- [ ] **Step 3: Create composition cases**

Create `composition-cases.jsonl` with exact expected semantics:

```json
{"case_id":"and-architecture-tool","op":"intersect","left":"zh-medium","right":"tool-name"}
{"case_id":"or-thinking-tool","op":"union","left":"en-reasoning","right":"tool-name"}
{"case_id":"without-tool-result","op":"difference_type","base":"zh-medium","excluded_type":"tool_result"}
{"case_id":"within-one-message","op":"near_same_message","left":"en-reasoning","right":"tool-name","max_bytes":4096}
{"case_id":"visible-only","op":"filter_type","base":"zh-medium","content_type":"text"}
```

- [ ] **Step 4: Commit the frozen experiment identity**

```bash
git add reports/leverage-v1/README.md reports/leverage-v1/query-cases.jsonl reports/leverage-v1/composition-cases.jsonl
git commit -m "experiment(storage-kernel): freeze leverage-v1 inputs"
```

---

### Task 2: Build the deterministic 4 MiB recovery micro corpus

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/build-recovery-micro.py`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/corpus/full_trace_recovery_micro.bin`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/corpus/full_trace_recovery_micro.manifest.json`

**Interfaces:**
- Consumes: structured import database and/or existing Full Trace provenance sidecar.
- Produces: one deterministic balanced corpus used only by Task 9.

- [ ] **Step 1: Write a manifest test before the builder**

The script must support:

```bash
python3 reports/leverage-v1/build-recovery-micro.py --check-only
```

Before implementation, run it and confirm it fails because the script does not exist.

- [ ] **Step 2: Implement stable block selection**

Implement the builder with these constants:

```python
TARGET_PER_TYPE = 1 * 1024 * 1024
BLOCK_TYPES = ["text", "thinking", "tool_use", "tool_result"]
TOTAL_LIMIT = 4 * 1024 * 1024 + 256 * 1024
```

For each type, iterate blocks in stable `(conversation_uuid, message_uuid, ordinal)` order and append complete blocks until that type reaches at least 1 MiB. Never split a source block. Write a deterministic boundary separator already used by `full_trace` generation.

Manifest fields:

```json
{
  "dataset_id":"full_trace_recovery_micro",
  "generator":"build-recovery-micro.py",
  "source_dataset_sha256":"...",
  "output_sha256":"...",
  "output_bytes":0,
  "block_counts":{"text":0,"thinking":0,"tool_use":0,"tool_result":0},
  "bytes_by_type":{"text":0,"thinking":0,"tool_use":0,"tool_result":0},
  "source_blocks":[{"message_uuid":"...","ordinal":0,"type":"text"}]
}
```

- [ ] **Step 3: Add deterministic self-checks**

The builder must fail unless:

```python
assert all(block_counts[t] > 0 for t in BLOCK_TYPES)
assert all(bytes_by_type[t] >= TARGET_PER_TYPE for t in BLOCK_TYPES)
assert output_bytes <= TOTAL_LIMIT
assert sha256(second_generation) == sha256(first_generation)
```

- [ ] **Step 4: Generate and verify twice**

```bash
python3 reports/leverage-v1/build-recovery-micro.py
cp reports/leverage-v1/corpus/full_trace_recovery_micro.bin /tmp/recovery-micro-first.bin
python3 reports/leverage-v1/build-recovery-micro.py
cmp /tmp/recovery-micro-first.bin reports/leverage-v1/corpus/full_trace_recovery_micro.bin
```

Expected: `cmp` exits 0.

- [ ] **Step 5: Commit the builder and non-private manifest only**

Do not commit private corpus bytes if repository policy excludes them.

```bash
git add reports/leverage-v1/build-recovery-micro.py reports/leverage-v1/corpus/full_trace_recovery_micro.manifest.json
git commit -m "experiment(storage-kernel): add balanced recovery micro corpus"
```

---

### Task 3: Add the conventional database baseline crate

**Files:**
- Modify: `labs/storage-kernel/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/Cargo.toml`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/lib.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/schema.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/store.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/search.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/protocol.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/src/bin/dcf-db-baseline.rs`
- Create: `labs/storage-kernel/crates/dcf-db-baseline/tests/baseline_contract.rs`

**Interfaces:**
- Consumes: canonical projection bytes and record/provenance boundaries.
- Produces CLI modes: `build`, `open`, `calibrate`, `recover`, `storage`, `append-fixture`, `verify`.

- [ ] **Step 1: Add the workspace member and dependency**

Add to workspace members:

```toml
"crates/dcf-db-baseline",
```

Create crate `Cargo.toml`:

```toml
[package]
name = "dcf-db-baseline"
version = "0.1.0"
edition.workspace = true

[dependencies]
anyhow = { workspace = true }
clap = { workspace = true }
rusqlite = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
sha2 = { workspace = true }
zstd = { workspace = true }
```

- [ ] **Step 2: Write failing schema and capability tests**

In `tests/baseline_contract.rs`, add tests that require:

```rust
#[test]
fn schema_has_fact_fts_span_and_block_structures() { /* inspect sqlite_master */ }

#[test]
fn exact_locate_returns_canonical_byte_spans() { /* small UTF-8 fixture */ }

#[test]
fn extract_crosses_zstd_block_boundary() { /* 256 KiB boundary */ }

#[test]
fn short_query_fallback_is_explicitly_reported() { /* <3 scalar query */ }

#[test]
fn recover_reproduces_projection_sha256() { /* small fixture only */ }
```

Run:

```bash
cargo test -p dcf-db-baseline --test baseline_contract
```

Expected: compile/test failure because implementation is absent.

- [ ] **Step 3: Implement the persistent schema**

`schema.rs` must create:

```sql
CREATE TABLE dataset_manifest (
  dataset_id TEXT PRIMARY KEY,
  projection_sha256 TEXT NOT NULL,
  projection_bytes INTEGER NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE records (
  record_id INTEGER PRIMARY KEY,
  text_id TEXT NOT NULL,
  conversation_uuid TEXT NOT NULL,
  message_uuid TEXT NOT NULL,
  content_block_ordinal INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  canonical_start INTEGER NOT NULL,
  canonical_end INTEGER NOT NULL,
  text_store_block_first INTEGER NOT NULL,
  text_store_block_last INTEGER NOT NULL
);

CREATE VIRTUAL TABLE records_fts USING fts5(
  searchable_text,
  content='records_search_content',
  content_rowid='record_id',
  tokenize='trigram'
);

CREATE TABLE records_search_content (
  record_id INTEGER PRIMARY KEY,
  searchable_text TEXT NOT NULL
);

CREATE TABLE text_blocks (
  block_id INTEGER PRIMARY KEY,
  canonical_start INTEGER NOT NULL,
  canonical_end INTEGER NOT NULL,
  compressed_offset INTEGER NOT NULL,
  compressed_len INTEGER NOT NULL,
  uncompressed_len INTEGER NOT NULL,
  sha256 TEXT NOT NULL
);
```

Keep the compressed bytes in a separate `.zstpack` file to preserve the ordinary architecture’s independent body/index/mapping structure.

- [ ] **Step 4: Implement FTS5 trigram capability preflight**

At build start, execute:

```sql
CREATE VIRTUAL TABLE temp.__dcf_trigram_probe USING fts5(x, tokenize='trigram');
DROP TABLE temp.__dcf_trigram_probe;
```

If unavailable, exit with a clear capability error. Do not silently substitute a full scan. Record the failure so the user can decide on an alternative mature index.

- [ ] **Step 5: Implement the zstd block store**

`store.rs` must:

- split canonical projection into fixed 256 KiB blocks;
- compress each block independently with zstd level 19;
- append compressed frames to `.zstpack`;
- write offsets and hashes to `text_blocks`;
- extract any byte Span by decompressing only intersecting blocks;
- maintain a small application-hot decompressed-block cache used only after `open`.

Public interface:

```rust
pub struct TextBlockStore { /* paths, directory, cache */ }

impl TextBlockStore {
    pub fn build(input: &[u8], pack_path: &Path, conn: &Connection) -> Result<Self>;
    pub fn open(pack_path: &Path, conn: &Connection) -> Result<Self>;
    pub fn extract(&mut self, start: u64, end: u64) -> Result<Vec<u8>>;
    pub fn recover_all(&mut self) -> Result<Vec<u8>>;
}
```

- [ ] **Step 6: Implement exact candidate verification**

`search.rs` must not treat FTS row matches as exact occurrence positions.

Algorithm:

```text
FTS trigram query
→ candidate record_ids
→ read exact canonical bytes for candidate records
→ overlapping byte search for the original pattern
→ canonical byte spans
→ sort and deduplicate
```

For patterns shorter than three Unicode scalars:

```text
operation_path = short_query_full_record_scan
```

Scan all record bodies, not the entire packed blob, and expose this path in protocol output. This is a measured residual, not a hidden optimization.

Public interface:

```rust
pub struct CanonicalHit {
    pub text_id: String,
    pub start: u64,
    pub end: u64,
    pub conversation_uuid: String,
    pub message_uuid: String,
    pub content_block_ordinal: u32,
    pub content_type: String,
}

pub fn count_exact(query: &[u8], limit: Option<usize>) -> Result<SearchResult>;
pub fn locate_exact(query: &[u8], limit: Option<usize>) -> Result<SearchResult>;
```

- [ ] **Step 7: Implement JSON-lines protocol compatibility**

Support the calibrated instructions:

```json
{"op":"count","pattern":"架构"}
{"op":"locate","pattern":"架构","limit":10}
{"op":"extract","start":100,"end":1124}
```

Each response includes:

```json
{
  "ok":true,
  "time_us":123.4,
  "count":10,
  "returned":10,
  "spans":[],
  "operation_path":"fts_trigram_verify"
}
```

CLI:

```bash
dcf-db-baseline <corpus> <output-dir> build
dcf-db-baseline <corpus> <output-dir> calibrate
dcf-db-baseline <corpus> <output-dir> recover
dcf-db-baseline <corpus> <output-dir> storage
dcf-db-baseline <corpus> <output-dir> verify
```

- [ ] **Step 8: Run tests and compile release**

```bash
cargo test -p dcf-db-baseline
cargo build -p dcf-db-baseline --release
```

Expected: all tests pass and `target/release/dcf-db-baseline` exists.

- [ ] **Step 9: Commit the conventional baseline**

```bash
git add Cargo.toml Cargo.lock crates/dcf-db-baseline
git commit -m "feat(storage-kernel): add conventional database baseline"
```

---

### Task 4: Establish capability parity and PositionSet composition

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/verify-capabilities.py`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/capability-parity.json`

**Interfaces:**
- Consumes: SDSL engine, DB baseline engine, query/composition cases.
- Produces: one machine-readable gate that later tasks must check before timings are considered valid.

- [ ] **Step 1: Write truth generation using overlapping byte scan**

In `verify-capabilities.py`, load the canonical projection and record boundaries. For each query, generate:

```json
{
  "query_id":"zh-medium",
  "count":0,
  "spans":[{"start":0,"end":0,"text_id":"..."}]
}
```

Do not use either candidate engine as truth.

- [ ] **Step 2: Verify Count, Locate and Extract**

For each engine verify:

```text
count == truth count
locate1 == truth first 1 after canonical sorting
locate10 == truth first 10
locate100 == truth first 100
extract bytes == canonical source bytes
```

- [ ] **Step 3: Verify composition cases at the common harness layer**

Implement pure sorted-span operations in Python:

```python
def intersect(left, right): ...
def union(left, right): ...
def difference_type(base, excluded_type): ...
def filter_type(base, content_type): ...
def near_same_message(left, right, max_bytes): ...
```

Both engines supply primitive PositionSets; composition logic is the same. Record whether either architecture required an extra persistent structure to provide the primitive facts.

- [ ] **Step 4: Fail closed**

The script exits nonzero unless every required case passes. Output:

```json
{
  "status":"passed",
  "dataset_sha256":"...",
  "engines":{
    "black_hole":{"passed":true},
    "conventional_db":{"passed":true}
  },
  "query_cases":[],
  "composition_cases":[]
}
```

Run:

```bash
python3 reports/leverage-v1/verify-capabilities.py
```

- [ ] **Step 5: Commit the parity harness and evidence**

```bash
git add reports/leverage-v1/verify-capabilities.py reports/leverage-v1/capability-parity.json
git commit -m "test(storage-kernel): establish architecture capability parity"
```

---

### Task 5: Implement the bounded main benchmark harness

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/run-leverage.py`
- Create during execution: `results.jsonl`, `storage-bom.json`, `machine.json`, `commands.log`.

**Interfaces:**
- Consumes: passed `capability-parity.json`.
- Produces: bounded, resumable, operation-separated performance and storage evidence.

- [ ] **Step 1: Add a fail-fast parity gate**

At startup:

```python
parity = json.load(open("reports/leverage-v1/capability-parity.json"))
if parity["status"] != "passed":
    raise SystemExit("capability parity has not passed")
```

- [ ] **Step 2: Implement the 300-second hard timeout**

Every child process call uses:

```python
subprocess.run(..., timeout=300)
```

On timeout, append:

```json
{"status":"deferred_long_run","timeout_seconds":300}
```

and continue with unrelated tasks. Never retry automatically with a longer timeout.

- [ ] **Step 3: Implement adaptive repetitions**

Pre-run each operation once and choose:

```python
def choose_repetitions(seconds: float) -> int:
    if seconds < 0.010: return 30
    if seconds < 0.100: return 15
    if seconds < 1.000: return 5
    if seconds <= 5.000: return 3
    return 1
```

Only report P95 when repetitions >= 5. Otherwise set `p95_us: null` and record the single/median result honestly.

- [ ] **Step 4: Measure the common interaction path**

For each query and engine record separately:

```text
count_only
locate_first_1
locate_first_10
locate_first_100
extract_128b
extract_1k
extract_8k
search_top10_with_1k_context
```

`search_top10_with_1k_context` is:

```text
Count
→ Locate first 10
→ Extract a 1 KiB window for each returned hit
```

Do not include engine process startup in application-hot timings.

- [ ] **Step 5: Measure first-query process cost without claiming storage-cold**

For each engine start a fresh process three times and run one fixed medium query. Record:

```json
{"cache_state":"new_process_os_uncontrolled","repetitions":3}
```

- [ ] **Step 6: Measure storage BOM**

For each architecture enumerate files and roles:

```json
{
  "architecture_id":"black_hole",
  "shared_source_bytes":0,
  "architecture_runtime_bytes":0,
  "total_with_shared_source_bytes":0,
  "components":[
    {"path":"...","role":"self_index","bytes":0,"required":true}
  ]
}
```

Ordinary DB must include SQLite DB, `.zstpack`, manifests, mapping tables/indexes and stable WAL treatment. Black-hole must include CSA, manifests and required provenance/segment files.

- [ ] **Step 7: Make the harness resumable**

Use `progress.json` keyed by:

```text
dataset|architecture|query|operation|cache_state
```

Save each result immediately after completion.

- [ ] **Step 8: Run the main matrix**

```bash
python3 reports/leverage-v1/run-leverage.py --phase build
python3 reports/leverage-v1/run-leverage.py --phase main
python3 reports/leverage-v1/run-leverage.py --phase first-query
python3 reports/leverage-v1/run-leverage.py --phase storage
```

- [ ] **Step 9: Commit harness and results**

```bash
git add reports/leverage-v1/run-leverage.py reports/leverage-v1/results.jsonl reports/leverage-v1/storage-bom.json reports/leverage-v1/machine.json reports/leverage-v1/commands.log
git commit -m "experiment(storage-kernel): run bounded leverage main matrix"
```

---

### Task 6: Build the architecture leverage ledger

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/build-architecture-ledger.py`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/architecture-ledger.json`

**Interfaces:**
- Consumes: actual source/files produced by both architectures.
- Produces: explicit authoritative structures, projections, caches, synchronization edges and capability sources.

- [ ] **Step 1: Define the ledger schema in code**

Use:

```python
ledger = {
  "black_hole": {
    "persistent_structures": [],
    "synchronization_edges": [],
    "capability_sources": {},
    "recovery_paths": [],
    "custom_source_files": [],
    "logical_loc": 0
  },
  "conventional_db": { /* same fields */ }
}
```

Each persistent structure includes classification:

```text
authoritative_fact
rebuildable_projection
cache
display_only
```

Each synchronization edge includes:

```json
{
  "from":"text_blocks",
  "to":"records_fts",
  "authority":"canonical projection",
  "detection":"manifest/hash + parity test",
  "recovery":"rebuild FTS",
  "blast_radius":"affected dataset"
}
```

- [ ] **Step 2: Populate from actual implementation, not architectural aspiration**

Read current files and code. Do not credit the black-hole architecture with a capability that still depends on an uncounted external body or mapping file.

- [ ] **Step 3: Count engineering surface reproducibly**

Use a Python line counter that excludes blank/comment-only lines and report:

- custom production files;
- logical LOC;
- external dependencies;
- persistent file types;
- independent build paths;
- independent recovery paths.

- [ ] **Step 4: Validate the ledger**

Require every measured component in `storage-bom.json` to appear in the ledger and every capability in `capability-parity.json` to have one source classification:

```text
native
small_adapter
secondary_structure
cross_system_orchestration
```

- [ ] **Step 5: Commit ledger generator and result**

```bash
git add reports/leverage-v1/build-architecture-ledger.py reports/leverage-v1/architecture-ledger.json
git commit -m "report(storage-kernel): record architecture leverage ledger"
```

---

### Task 7: Run short lifecycle and failure-containment tests

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/run-lifecycle.py`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/lifecycle-results.jsonl`

**Interfaces:**
- Consumes: built architecture artifacts and a deterministic 1% append fixture.
- Produces: append, rebuild and one corruption-containment result per architecture.

- [ ] **Step 1: Generate a deterministic 1% append fixture**

Select stable complete blocks totaling approximately 1% of `full_trace` bytes and write a manifest. Do not duplicate the entire corpus.

- [ ] **Step 2: Test append**

Black-hole path:

```text
build one new immutable small segment
publish its manifest
query old + new segments through the same PositionSet layer
```

Conventional path:

```text
SQLite transaction inserts record facts and span map
append/rebuild affected zstd blocks
update FTS rows
commit
```

Record:

```json
{
  "operation":"append_1pct",
  "elapsed_ms":0,
  "new_persistent_bytes":0,
  "files_rewritten":[],
  "structures_coordinated":[],
  "correct_after":true
}
```

- [ ] **Step 3: Delete rebuildable search projection and rebuild once**

Run once with 300-second timeout. Preserve canonical facts/body. Record exact files deleted, inputs used for rebuild, elapsed time and post-rebuild parity.

- [ ] **Step 4: Inject one corruption into a copy**

For each architecture:

```bash
cp -R <artifact-dir> /tmp/<architecture>-corrupt-copy
```

Flip bytes in one index file copy, then verify:

- open/verify rejects it;
- shared source hash remains unchanged;
- recovery instructions are deterministic;
- affected scope is recorded.

- [ ] **Step 5: Commit lifecycle harness and evidence**

```bash
git add reports/leverage-v1/run-lifecycle.py reports/leverage-v1/lifecycle-results.jsonl
git commit -m "experiment(storage-kernel): compare short lifecycle costs"
```

---

### Task 8: Run one micro-corpus full recovery per architecture

**Files:**
- Modify if required: `labs/storage-kernel/reports/leverage-v1/run-leverage.py`
- Create during execution: `labs/storage-kernel/reports/leverage-v1/recovery-micro.json`

**Interfaces:**
- Consumes: `full_trace_recovery_micro` and both built micro artifacts.
- Produces: one bounded recovery result per architecture.

- [ ] **Step 1: Build both architectures on the micro corpus**

Use the same configuration as the main matrix.

- [ ] **Step 2: Run each Recover exactly once**

Each subprocess has `timeout=300`.

Record:

```json
{
  "dataset_id":"full_trace_recovery_micro",
  "architecture_id":"black_hole",
  "input_bytes":0,
  "elapsed_ms":0,
  "sha256_match":true,
  "recovery_semantics":"canonical_byte_equivalent",
  "structures_read":[],
  "steps":[]
}
```

For the ordinary database baseline, use `byte_exact` if exact projection bytes are reproduced.

- [ ] **Step 3: Do not retry a timeout**

If one architecture exceeds 300 seconds, record `deferred_long_run` and stop that path. Do not enlarge timeout.

- [ ] **Step 4: Commit micro recovery evidence**

```bash
git add reports/leverage-v1/recovery-micro.json
git commit -m "experiment(storage-kernel): verify bounded micro recovery"
```

---

### Task 9: Independently verify the evidence package

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/verify-leverage.py`

**Interfaces:**
- Consumes: all generated reports.
- Produces: exit 0 only when the evidence package is internally consistent.

- [ ] **Step 1: Check file and row identities**

Verify:

- corpus SHA matches every report;
- engine binary hashes match `machine.json`;
- every result has actual repetitions and cache state;
- P95 is null when repetitions < 5;
- no operation exceeded 300 seconds without `deferred_long_run`;
- no full main-corpus recover row exists in `leverage-v1`.

- [ ] **Step 2: Check capability and timing linkage**

Every timing row must reference a passed capability case. Any failed case invalidates corresponding rows.

- [ ] **Step 3: Check storage and ledger completeness**

Every required storage component appears in both `storage-bom.json` and `architecture-ledger.json`.

- [ ] **Step 4: Check lifecycle and recovery evidence**

Require:

- append correctness after operation;
- corruption detected on copies;
- shared source hashes unchanged;
- at most one micro Recover row per architecture.

- [ ] **Step 5: Run independent verification**

```bash
python3 reports/leverage-v1/verify-leverage.py
```

Expected final line:

```text
ALL LEVERAGE-V1 CHECKS PASS
```

- [ ] **Step 6: Commit verifier**

```bash
git add reports/leverage-v1/verify-leverage.py
git commit -m "test(storage-kernel): verify leverage-v1 evidence package"
```

---

### Task 10: Produce the leverage decision report

**Files:**
- Create: `labs/storage-kernel/reports/leverage-v1/summary.md`

**Interfaces:**
- Consumes: verified raw evidence only.
- Produces: the architectural decision input for the next conversation.

- [ ] **Step 1: Put the answer on page one**

The first section must contain:

```text
capability_parity: passed/failed
black_hole_runtime_bytes: ...
conventional_runtime_bytes: ...
common_path_latency_class: same/faster/slower
black_hole_sync_edges: ...
conventional_sync_edges: ...
black_hole_absorbed_complexity: [...]
black_hole_residual_complexity: [...]
leverage_status: near_dominant_leverage_candidate / partial_leverage / no_leverage
```

- [ ] **Step 2: Include the core physical table**

```markdown
| Architecture | Runtime bytes | Count P95 | Locate10 P95 | Extract1KiB P95 | Top10+context P95 | Build |
```

Use representative query classes separately rather than averaging all queries into one misleading number.

- [ ] **Step 3: Include the structural table**

```markdown
| Architecture | Authoritative structures | Rebuildable projections | Sync edges | Persistent file types | Recovery paths |
```

- [ ] **Step 4: State absorbed complexity and residuals explicitly**

Examples of absorbed complexity must be backed by ledger rows:

```text
正文与精确索引双份运行主体
FTS结果到规范位置的额外映射
正文更新与索引更新同步
独立正文与索引的联合恢复
```

Residuals include actual observed costs:

```text
Segment build
Append strategy
High-occurrence Locate cost
Immature tooling
```

- [ ] **Step 5: Apply the decision rule without a weighted score**

Use:

```text
near_dominant_leverage_candidate
```

only if all necessary conditions in the design spec are met. Otherwise choose `partial_leverage` or `no_leverage` and state which condition failed.

- [ ] **Step 6: State deferred work**

Explicitly list:

- 200 GB/2 TB scaling;
- long sustained load;
- full-corpus Recover rerun;
- Unicode/r-index/Grammar optimization;
- production implementation selection.

Do not perform them.

- [ ] **Step 7: Run verifier, commit and push**

```bash
python3 reports/leverage-v1/verify-leverage.py
git add reports/leverage-v1/summary.md
git commit -m "report(storage-kernel): conclude black-hole leverage comparison"
git push origin experiment/storage-kernel-local
```

Report the full commit SHA and remote branch equality.

---

## Final Stop Condition

Stop immediately after Task 10. Do not start scale testing or candidate optimization.

The executor’s final response must contain only:

1. full commit SHA;
2. paths to `summary.md`, `results.jsonl`, `architecture-ledger.json`, and `verify-leverage.py`;
3. the six page-one decision fields;
4. any `deferred_long_run` rows;
5. confirmation that no full main-corpus Recover and no >10-minute unapproved test ran.
