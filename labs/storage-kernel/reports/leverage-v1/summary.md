# Leverage V1 — 黑洞架构 vs 普通数据库架构

Date: 2026-08-01
Dataset: full_trace (50,542,796 bytes, SHA-256 `b4fd2d8f…bdd225`)
Branch: `experiment/storage-kernel-local`
Physical representatives: black hole = `utf8-a1-sdsl` (byte CSA, `csa_wt<wt_hutu<rrr_vector<63>>, 64, 64>`);
conventional = `dcf-db-baseline` (SQLite facts + FTS5 trigram candidates + zstd level 19 256 KiB blocks + span mapping).

## Page One — Verdict Fields

```text
capability_parity: passed
black_hole_runtime_bytes: 21633369
conventional_runtime_bytes: 189727824
common_path_latency_class: same-interaction-class (black hole faster on count/locate/top10+context; conventional faster only on cached extract)
black_hole_sync_edges: 1
conventional_sync_edges: 4
black_hole_absorbed_complexity: [text+exact-index+positions+recovery in one self-index; FTS-to-span mapping; text/index/body synchronization; joint text+index recovery; searchable-content mirror + block directory + span map; candidate-layer build/rebuild]
black_hole_residual_complexity: [per-byte extract cost (~1.07 ms / 1 KiB, 7.6 ms / 8 KiB); manifest-hash-based corruption detection (no native checksum); NUL->0x01 canonicalization contract (canonical_byte_equivalent, not byte-exact vs raw source); append = new segment + harness-level PositionSet union; full recovery scales linearly (~19 us/byte) and was deferred for the main corpus]
leverage_status: near_dominant_leverage_candidate
```

**One-line answer:** yes — on the real 50.5 MB corpus, one compressed self-index absorbs the text body, the exact-substring index, the position mapping and the recovery path (1 synchronization edge, 21.6 MB runtime) while the ordinary DB baseline needs a separate FTS candidate layer, a searchable-content mirror, a block directory and a span map (4 synchronization edges, 189.7 MB runtime); all 13 functional-parity gates, 6 composition cases and both micro recoveries pass, and the common interaction path stays faster than the conventional baseline.

---

## 1. 功能对等 (capability parity)

Independent brute-force truth (overlapping byte scan over the canonical projection) verified BOTH engines:

| Check | Result |
|---|---|
| Count (13 queries: absent/zh/en/path/json/tool/short-2-scalar) | pass (count + first 1/10/100 spans after canonical sort) |
| Extract 128B / 1KiB / 8KiB + multibyte + tail + cross-block windows | pass (conventional byte-exact incl. sha256; black hole byte counts + byte-level proof via micro recovery) |
| Composition: intersect, union, difference_type, filter_type, filter_conversation, near_same_message | pass (harness-level sorted-span algebra; both engines' primitives == truth) |
| Hit trace (projection→TextId→conversation→message→ordinal→type) | pass (conventional native `records`; black hole small adapter over shared contract) |

Composition truth counts: intersect=0, union=1135, without-tool-result=720, visible-only=409, conversation-limited=29, near-same-message=41.

## 2. 物理成本 (storage BOM)

| Architecture | Runtime bytes | bytes/projection byte | Build |
|---|--:|--:|--:|
| Black hole (CSA + manifest) | 21,633,369 | 0.428 | 7.7 s |
| Conventional (SQLite db + zstpack + manifest) | 189,727,824 | 3.754 | 24.0 s |

- shared_source_bytes = 56,800,628 (projection copy 50.5 MB + span-boundary contract 6.26 MB + query sets), identical for both sides.
- `total_with_shared_source_bytes`: black hole 78.4 MB, conventional 246.5 MB.
- The conventional DB is dominated by the FTS5 trigram index + the searchable-content mirror inside SQLite (175 MB DB) plus the independent zstd body (14.6 MB). This is the honest cost of “database + FTS + compressed body + mapping” on this corpus.

## 3. 常见路径延迟 (application-hot, adaptive repetitions, P50)

| Query class | Arch | Count | Locate10 | Extract1KiB | Top10+1KiB context |
|---|:--|--:|--:|--:|--:|
| absent | black hole | 2.8 µs | 2.8 µs | 1.07 ms | 23 µs |
| absent | conventional | 11.6 ms | 11.4 ms | 4.5 µs | 24.1 ms |
| visible_text | black hole | 3.9 µs | 490 µs | 1.07 ms | 16.6 ms |
| visible_text | conventional | 76.2 ms | 77.4 ms | 4.5 µs | 159.2 ms |
| thinking | black hole | 3.8 µs | 621 µs | 1.07 ms | 15.6 ms |
| thinking | conventional | 65.9 ms | 65.9 ms | 4.5 µs | 135.9 ms |
| tool | black hole | 4.3 µs | 225 µs | 1.07 ms | 15.5 ms |
| tool | conventional | 89.1 ms | 88.8 ms | 4.5 µs | 179.3 ms |
| path | black hole | 3.6 µs | 259 µs | 1.07 ms | 12.4 ms |
| path | conventional | 23.1 ms | 23.1 ms | 4.5 µs | 48.0 ms |
| json | black hole | 3.1 µs | 412 µs | 1.07 ms | 8.3 ms |
| json | conventional | 11.0 ms | 11.3 ms | 4.5 µs | 24.2 ms |
| short_query_edge (2 scalars) | black hole | 3.3 µs | 370 µs | 1.07 ms | 16.3 ms |
| short_query_edge (2 scalars) | conventional | 326.4 ms | 331.4 ms | 4.5 µs | 661.8 ms |

- Both architectures stay interactive (< 1 s) on every common path. Count and Locate are 2–4 orders of magnitude faster in the black hole (no candidate layer to build or verify); the conventional baseline pays full candidate verification even for count (FTS narrows records, exact positions still require reading the zstd body).
- Extract is the one place the conventional baseline is faster (cached zstd block: 4.5 µs vs CSA byte-at-a-time 1.07 ms / 1 KiB). Both are interactive; the black hole’s per-byte extract is a documented residual.
- Short query edge: the conventional baseline honestly reports `operation_path = short_query_full_record_scan` (326 ms count); the black hole needs no fallback.
- First query in a new process: black hole 53 µs query / 16.6 ms process wall; conventional 78.4 ms query / 85.4 ms process wall.
- Actual repetitions recorded per row in `results.jsonl` (30/15/5/3/1 by pre-run latency); P95 only where reps >= 5.

## 4. 结构账本 (architecture ledger)

| Architecture | Authoritative structures | Rebuildable projections | Sync edges | Persistent file types | Independent recovery paths |
|---|--:|--:|--:|--|--:|
| Black hole | 1 (CSA self-index) | 1 (manifest) | 1 | CSA binary, JSON manifest (+ shared JSONL contract) | 1 (recover from self-index) |
| Conventional | 2 (records, text.zstpack + manifest) | 4 (search content, FTS5, block directory, manifest) | 4 | SQLite DB, zstd pack, JSON manifest | 2 (zstpack text; FTS rebuild) |

Black hole sync edges: CSA ↔ segment manifest (authority: canonical projection; detect: manifest hash vs frozen sha; recover: rebuild CSA; blast: segment).
Conventional sync edges: text_blocks ↔ zstpack frames; records spans ↔ text_blocks/pack; records_search_content ↔ records_fts; dataset_manifest ↔ all. Each with its own authority/detection/recovery and dataset-level blast radius.

Capability sources: black hole = count/locate/extract/recover/top10 native, composition+provenance+filter = small adapter over the shared contract (no new persistent structures). Conventional = count/locate/top10 cross-system orchestration (FTS candidates + zstd body must agree), extract/recover secondary structure (block directory + pack), provenance/filter native.

## 5. 生命周期 (short lifecycle, one run each)

| Operation | Black hole | Conventional |
|---|---|---|
| Append ~1% (521,207 B / 267 blocks) | 0.08 s, new segment (0 new rewrites; 3 files created), correct | 0.33 s, single transaction (records+content+FTS+zstpack), correct, byte-exact recover |
| Delete rebuildable projection + rebuild once | delete CSA → rebuild from projection: 7.6 s, correct | drop records_fts → rebuild from search content: 8.7 s, correct |
| Corruption containment (1 byte flipped, on a copy) | detected (manifest hash contract) | detected (block sha256 recompute, integrity mode) |
| Shared source unchanged | yes | yes |

## 6. 裁决依据 (decision rule, no weighted score)

Necessary conditions from the design spec:

1. 全部功能对等门禁 —— **met** (`capability-parity.json`, 13/13 queries + 6/6 compositions + extract).
2. `architecture_runtime_bytes` 不高于普通基线 —— **met** (21.6 MB vs 189.7 MB, 8.8x smaller; 0.428 vs 3.754 bytes/projection byte).
3. 常见路径 Count→Locate10→Extract1KiB 交互可用、无数量级退化 —— **met** (black hole is faster end-to-end; worst path ≈ 16.6 ms vs conventional 159 ms; both < 1 s).
4. 权威结构/同步接缝显著更少 —— **met** (1 vs 4 sync edges; 1 vs 6 authoritative+rebuildable structures owned by the architecture).
5. 查询组合主要靠 PositionSet 代数而非新增持久索引 —— **met** (composition is pure harness algebra over native primitives; no extra indexes on either side, but the conventional side needs its records/FTS/spans to stay in sync).
6. 追加、损坏、重建残差可局限在 Segment/可重建投影内 —— **met** (append = new immutable segment + manifest; corruption blast = segment; rebuild = deterministic CSA rebuild).

All six conditions met → **`near_dominant_leverage_candidate`**.

## 7. 黑洞吸收的复杂度 (absorbed, backed by ledger rows)

- 正文与精确索引双份运行主体 → 单个 CSA 同时承担正文保存、精确 Count、Locate、Extract、Recover；
- FTS 结果到规范位置的额外映射 → CSA locate 直接返回规范字节 Span；
- 正文更新与索引更新的同步（text_blocks↔zstpack、content↔FTS）→ 唯一接缝是 CSA↔manifest；
- 独立正文与索引的联合恢复 → 恢复只读 1 个结构（1 步），普通基线读 block directory + zstpack（2 步）再加 FTS 重建路径；
- 候选层及其重建（FTS rebuild 8.7 s / 候选验证成本）→ 黑洞无需候选层，count 4 µs vs 76–326 ms。

## 8. 黑洞残差复杂度 (residual, observed costs)

- 大 Span Extract 为逐字节成本（1 KiB ≈ 1.07 ms，8 KiB ≈ 7.6 ms；普通基线热缓存 4.5 µs）—— 交互可用但需要更长的 extract run 才能达到最优；
- 全文恢复按字节线性（~19 µs/byte；4.25 MB 微型语料 80.9 s），主语料全量恢复被推迟（既有历史证据，不重跑）；
- 损坏检测依赖 manifest 哈希契约（引擎自身无校验和）；
- NUL→0x01 规范化的 canonical_byte_equivalent 语义（已记录，非原始 ZIP byte-exact）；
- 追加采用“新 Segment + 上层 PositionSet 合并”策略（vs 普通基线单事务）；
- 命中追溯/过滤依赖共享边界契约（small adapter，非原生）。

## 9. 推迟的工作 (deferred, NOT performed)

- 200 GB / 2 TB 规模扩展与最终延迟；
- 长时间持续负载/数小时重建稳定性；
- 完整主语料 Recover 重跑；
- Unicode / r-index / Grammar / 采样参数优化；
- 生产实现选择（是否使用 SDSL）。

## 10. 证据文件

results.jsonl · capability-parity.json · architecture-ledger.json · storage-bom.json ·
lifecycle-results.jsonl · recovery-micro.json · machine.json · commands.log · verify-leverage.py ·
README.md · query-cases.jsonl · composition-cases.jsonl · build-recovery-micro.py · build-shared.py ·
verify-capabilities.py · run-leverage.py · run-lifecycle.py · run-recovery-micro.py · build-architecture-ledger.py
