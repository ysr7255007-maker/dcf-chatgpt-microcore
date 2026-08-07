# E3 — SQLite Authority × 派生认知检索实验

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》§7。

## 研究问题

```text
SQLite = 正式认知权威
LanceDB = 可删除、可重建的派生检索世界
```

能否同时得到稳定权威 + 结构化/精确/全文/向量/混合查询，而不制造第二份事实权威？

## 结构

```text
CognitionAuthority（bun:sqlite）
  objects / revisions（不可变）/ anchors / relations / time
        │ 全量重建（唯一方向）
        ▼
DerivedWorld（@lancedb/lancedb embedded）
  chunks 表：chunk_id / object_id / revision_id / span / text / recipe / vector
  build-manifest.json：complete / interrupted / 缺口数字（禁止表面 healthy）
        │ 组合（不拥有索引）
        ▼
QueryStrategy：Lexical + Dense + Temporal + RRF（+ 最小语义引力场形态）
```

- 语料：真实 DCF 文档（docs/spec 13 份 + current-state + 2 份骨干 ADR），非玩具语料。
- **Embedding 固定**（[修订5]）：`@huggingface/transformers`（ONNX 进程内）+
  `Xenova/bge-small-zh-v1.5`（512 维），全部候选共用同一份向量；
  HF Hub 不可达时经 `HF_ENDPOINT=https://hf-mirror.com`（已记入 environment.json）。

## 运行

```bash
bun install --trust
HF_ENDPOINT=https://hf-mirror.com bun test tests/   # 9 tests（主套件 + 7.6 子实验）
```

## 关键结果（两次独立复跑 9/9）

| 引擎 | Recall@5 | MRR |
| --- | --- | --- |
| dense（LanceDB 向量） | 0.875 | 0.8125 |
| lance_fts | 0（中文分词缺口，如实记录） | 0 |
| hybrid_rrf | 0.875 | 0.8125 |

- 破坏实验全过：全删重建（命中集合逐条一致）、文件系统级删除重建、
  半途中断 manifest 明确 `interrupted` + 缺口数字、新 revision + 派生失败权威仍正确。
- 7.6 四策略对比：semantic 以零体积增量达到 MRR 1.0；AI self-contained 未显示增益
  （词保留 100%，体积 ×3.69，成本 2235 tokens）→ 裁决 EXPERIMENTAL。
- 退出期 trace trap（lancedb/onnx 原生层 teardown）记入 failures F3。

裁决见 [decision.md](./decision.md)；真值与逐引擎数据见 results/。
