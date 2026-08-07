# E3 裁决

## 主裁决

```text
SQLITE_AUTHORITY_PLUS_LANCEDB_DERIVED
```

带一项显式例外（不阻塞）：

```text
CJK_FTS_TOKENIZER_PENDING   # Lance FTS 与 SQLite FTS5 的中文分词待 P4 选型
                            # 在此之前，中文 lexical 通道按精确/短语（LIKE）计
```

## 子裁决（§7.6 自包含文本块）

```text
SELF_CONTAINED_CHUNKS_EXPERIMENTAL
```

3 span 小样本上 AI 改写无检索增益（semantic 已 MRR 1.0）、体积 ×3.69、
有生成成本；术语保留 100%（无事实丢失证据）。不晋级正式机制，也不否决。

## 依据（任务书 §7 逐项）

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| SQLite 表达 object/revision/anchor/relation/time/kind/source | PASS | authority.ts schema + T1/T6（不可变修订、幂等摄入） |
| Structured / Exact / Temporal / Relationship 查询 | PASS | T3（四类权威查询全部命中预期对象） |
| Dense / Hybrid（LanceDB embedded + TS API + filter + row→anchor 映射） | PASS | T2/T3（chunk 携带 revision_id + span，可回到权威锚点） |
| FTS | PARTIAL（中文分词缺口） | F1：lance_fts Recall=0；精确短语经权威层 LIKE 成立 |
| 全删重建：对象/revision/anchor 无损、query truth 恢复 | PASS | T4：命中集合删除前后逐条一致 + fs 级删除变体 |
| 半途中断可观察 incomplete | PASS | T5：build-manifest state=interrupted + 缺口数字 |
| 新 revision + 派生更新失败 → 权威仍正确 | PASS | T6：修订历史 [0,1] 正确，派生行数不变（不假装更新） |
| LanceDB 永远只是 Derived Retrieval | PASS | 全链路单向重建；无任何回写权威路径；destroy 后权威无损 |
| Query Strategy 组合 Engines 而不拥有索引 | PASS | T7：query-strategy.ts 零建表零写入；temporal 门 + 引力场最小形态 |

## 检索质量真值（8 条先冻结的查询真值，results/e3-results.json）

```text
dense      Recall@5 = 0.875  MRR = 0.8125
hybrid_rrf Recall@5 = 0.875  MRR = 0.8125（受 F1 限制 lexical 未贡献）
lance_fts  Recall@5 = 0      MRR = 0（F1）
```

## 7.6 策略对比（results/e3-self-contained.json）

| 策略 | Recall@3 | MRR | 体积增量 | 术语保留 |
| --- | --- | --- | --- | --- |
| fixed | 1.0 | 0.83 | ×17.3 | 1.0 |
| semantic | 1.0 | 1.0 | ×1.0 | 1.0 |
| semantic-nb | 1.0 | 1.0 | ×3.7 | 1.0 |
| ai-self-contained | 1.0 | 1.0 | ×3.7 | 1.0 |

## 对后续实验/施工的约束

- E5 的事实权威落点使用 bun:sqlite 同款权威模式（但按 [修订1] 与认知权威分离）；
- 正式认知施工时：分词器到位后必须重测 hybrid（F4 的数字型问题场景）；
- LanceDB 进程隔离或显式 dispose 顺序是长驻宿主的前置（F3）。
