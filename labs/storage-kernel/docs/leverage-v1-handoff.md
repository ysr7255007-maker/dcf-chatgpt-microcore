# Leverage V1 — 本地 IDE AI 交接入口

## 唯一任务

停止继续优化 CSA、Unicode、Grammar、r-index 或恢复性能。

本轮只验证：

> 压缩自索引黑洞架构，相对普通的“数据库 + 搜索索引 + 压缩正文 + 位置映射”架构，是否用一个主导结构吸收了足够多的空间、同步、映射与恢复复杂度，并保持同一体验等级的常用查询能力。

## 必读文件

按顺序完整阅读：

1. `docs/superpowers/specs/2026-08-01-black-hole-vs-conventional-db-leverage-test-design.md`
2. `docs/superpowers/plans/2026-08-01-black-hole-vs-conventional-db-leverage-test.md`

设计文件定义研究问题和裁决标准；计划文件定义文件路径、任务顺序、测试与提交边界。

## 当前事实

- 分支：`experiment/storage-kernel-local`
- 已有校准结果：`reports/calibration/`
- 该目录冻结，不修改历史结果。
- 主语料：`reports/second-matrix/corpus/full_trace.bin`
- 黑洞物理代表：现有 `utf8-a1-sdsl`
- 普通架构基线：`SQLite structured facts + FTS5 trigram candidate index + zstd 256 KiB text blocks + row/span mapping`

## 立即停止的工作

禁止：

- 再跑完整 `full_trace` 的 `recover_all`；
- 任何预计超过 10 分钟、未经用户批准的测试；
- 200 GB / 2 TB 扩展测试；
- 长时间持续负载；
- Unicode、r-index、Grammar、采样率参数优化；
- 新建与双架构对照无关的研究框架；
- 用实现文件数量或阶段数量代替结果。

## 时间预算

- 所有子进程默认 `timeout=300` 秒。
- 预跑预计超过 180 秒：先缩小语料或降低重复次数。
- 超过 300 秒：保存日志，标记 `deferred_long_run`，继续其他项目；不得自动延长。
- 完整恢复只在约 4 MiB 的 `full_trace_recovery_micro` 上，每个架构运行 1 次。
- 主语料全文恢复已有历史证据，不得重跑。

重复次数使用：

```text
<10 ms        30 次
10–100 ms     15 次
100–1000 ms    5 次
1–5 s          3 次
>5 s           1 次，不报告伪造的 P95
```

## 实现注意

普通数据库基线必须是诚实的强基线，不得用全文扫描冒充搜索索引。

SQLite Schema 创建顺序：

1. `dataset_manifest`
2. `records`
3. `records_search_content`
4. `records_fts`，其 `content='records_search_content'`
5. `text_blocks`

FTS5 只负责筛选候选记录；必须回到独立 zstd 正文进行精确重叠字节匹配，最终返回规范 Span。

短于 3 个 Unicode scalar 的查询若无法由 trigram FTS 处理，可以扫描全部记录正文，但必须输出：

```text
operation_path = short_query_full_record_scan
```

不得把它隐藏成普通 FTS 性能。

## 必须完成的比较

### 功能对等

两侧必须在相同真值下完成：

- Count；
- Locate 1/10/100；
- Extract 128B/1KiB/8KiB；
- Top10 + 1KiB 上下文；
- 查询结果交、并、差；
- content type / conversation 过滤；
- 同一消息内 Near；
- 命中追溯到 conversation/message/content block。

### 物理成本

报告完整运行所需：

- 正文或自索引；
- FTS/倒排；
- Span mapping；
- zstd block directory；
- Manifest、码表、采样表；
- 所有打开后必须存在的文件。

输出：

```text
shared_source_bytes
architecture_runtime_bytes
total_with_shared_source_bytes
bytes_per_projection_byte
```

### 架构杠杆

对每个架构列出：

- authoritative facts；
- rebuildable projections；
- synchronization edges；
- persistent file types；
- independent build/recovery paths；
- 每项能力是 `native`、`small_adapter`、`secondary_structure` 还是 `cross_system_orchestration`。

### 短生命周期

只做分钟级测试：

- 追加约 1% 数据；
- 删除可重建搜索投影后重建一次；
- 在副本上破坏一个索引文件并验证隔离与恢复。

## 交付目录

所有新结果放在：

```text
reports/leverage-v1/
```

必须包含：

```text
results.jsonl
capability-parity.json
architecture-ledger.json
storage-bom.json
lifecycle-results.jsonl
recovery-micro.json
machine.json
commands.log
summary.md
verify-leverage.py
```

独立验证必须输出：

```text
ALL LEVERAGE-V1 CHECKS PASS
```

## 最终裁决

不要生成加权总分。按原始 Pareto 数据和结构账本选择：

```text
near_dominant_leverage_candidate
partial_leverage
no_leverage
```

`summary.md` 第一页必须直接给出：

```text
capability_parity
black_hole_runtime_bytes
conventional_runtime_bytes
common_path_latency_class
black_hole_sync_edges
conventional_sync_edges
black_hole_absorbed_complexity
black_hole_residual_complexity
leverage_status
```

## 停止条件

完成并推送 `summary.md` 与全部证据后立即停止。不要自行进入规模测试或候选优化。

最终只汇报：

1. 完整 Commit SHA；
2. 四个核心证据文件路径；
3. 第一页裁决字段；
4. `deferred_long_run` 项；
5. 确认没有重跑完整主语料 Recover，也没有未经批准运行超过 10 分钟的任务。
