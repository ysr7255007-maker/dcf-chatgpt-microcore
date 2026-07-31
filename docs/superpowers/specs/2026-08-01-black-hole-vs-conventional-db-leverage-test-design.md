# DCF 黑洞架构 vs 普通数据库架构——杠杆验证设计

## 状态

本设计承接 `reports/calibration/` 的操作语义校准结果。

此前约 9.5 MiB 的自索引结果已经提供了足够强的物理可行性信号：正文保存、精确 Count、Locate、Extract 与 Recover 可以由同一个压缩结构承担，并且没有出现不可接受的空间膨胀。

本阶段不再以“继续优化某个索引参数”为目标，而是验证：

> 压缩自索引与规范位置代数，是否相对普通数据库架构形成了真正的系统杠杆——用一个主导结构吸收正文、精确索引、位置映射、同步一致性与恢复路径中的多份复杂度，同时保持可接受的空间与交互性能。

---

## 一、研究问题

本轮只回答一个主问题：

> 在完成同一组 DCF 能力时，黑洞架构与普通数据库架构分别需要多少物理存储、多少运行结构、多少同步接缝、多少恢复路径，以及什么级别的查询与上下文恢复成本？

本轮不回答：

- 200 GB 或 2 TB 下的最终延迟；
- 哪个 CSA 采样参数最优；
- Unicode、r-index、Grammar 等候选谁是冠军；
- 最终生产实现是否选用 SDSL；
- 长时间满负载、连续数小时恢复或重建是否稳定。

只有当黑洞架构在当前真实语料上显示出明显杠杆后，才值得进入规模扩展与物理优化阶段。

---

## 二、对照对象

### A. 黑洞架构候选：Compressed Self-Index Segment

使用当前通过校准的 `utf8-a1-sdsl` 作为物理代表，但本轮评价的是架构体质，不是给 SDSL 授予最终实现资格。

逻辑结构：

```text
Canonical Projection
        ↓
Compressed Self-Index Segment
        ↓
TextId + canonical UTF-8 byte Span
        ↓
PositionSet operations
```

该结构尝试原生承担：

- 正文保存；
- 精确 Count；
- Locate；
- 任意 Span Extract；
- 全文恢复能力；
- 搜索结果的规范字节位置。

允许存在：

- Manifest；
- 来源与投影身份；
- Segment 边界和少量元数据；
- 查询结果组合层。

不得另存一份完整可搜索正文来帮助查询或恢复，否则不再是本轮定义的黑洞候选。

### B. 普通数据库架构基线：SQLite + FTS + zstd Text Store

构建一个诚实且足够强的本地数据库基线，不故意选择弱实现。

逻辑结构：

```text
SQLite structured facts
        +
FTS5 trigram / equivalent exact-substring index
        +
zstd 256 KiB text blocks
        +
row/block/offset → canonical Span mapping
```

它至少包含：

- SQLite 消息和内容块事实表；
- 日常搜索投影；
- 能支持本轮精确子串查询的 FTS/倒排结构；
- 独立 zstd 正文块；
- 从数据库或索引结果映射到规范字节 Span 的表或确定性映射；
- Manifest 和版本身份。

如本机 SQLite 不支持满足精确子串语义的 FTS5 trigram，执行者可以采用等价的成熟倒排实现，但必须：

1. 保留“结构化数据库 + 独立正文 + 独立搜索索引 + 位置映射”的普通架构体质；
2. 在报告中说明替代原因；
3. 不得用暴力全文扫描冒充普通数据库搜索基线。

---

## 三、公平比较边界

### 共享且不参与胜负的部分

两种架构共享：

- 原始 ZIP / JSON 事实源；
- `full_trace` 投影内容与 SHA-256；
- 查询集与暴力真值；
- `TextId + canonical byte Span` 的上层合同；
- 测试机器和进程控制方式。

共享原始事实必须单独列出，不得只计入某一方。

### 必须计入各自空间的部分

为了“打开后能完成全部声明能力”，每种架构所需的所有文件都必须计入：

- 正文或自索引主体；
- 搜索索引；
- FTS 表或倒排文件；
- block directory；
- rowid/offset/span mapping；
- 字典、码表、采样表；
- Manifest；
- 必要 SQLite WAL/SHM 的稳定态处理说明；
- 任何恢复、Extract 或定位所依赖的独立文件。

同时报告：

```text
shared_source_bytes
architecture_runtime_bytes
total_with_shared_source_bytes
bytes_per_projection_byte
```

主比较使用 `architecture_runtime_bytes`；`total_with_shared_source_bytes` 用于观察完整 DCF 成本。

---

## 四、主语料与小型恢复语料

### 主矩阵语料

只使用已经固定的：

```text
full_trace
```

当前约 50.5 MB，包含：

- visible text；
- thinking；
- tool_use；
- tool_result。

`legacy_message_text` 仅保留为历史校准，不进入本轮主架构裁决。

### 微型恢复语料

从同一 `full_trace` 来源确定性生成约 4 MiB 的 `full_trace_recovery_micro`：

- visible text 约 1 MiB；
- thinking 约 1 MiB；
- tool_use 约 1 MiB；
- tool_result 约 1 MiB。

要求：

- 按稳定块顺序选择，不随机漂移；
- 记录来源 block ids、投影 SHA-256 和生成规则；
- 包含中文、多字节 UTF-8、英文、JSON、路径、工具参数和长块；
- 两种架构使用完全相同的微型语料。

全文恢复只在该微型语料上每个架构运行一次。完整 50.5 MB 语料的 Recover 结果保留为既有证据，本轮不得重新运行。

---

## 五、时间预算硬门禁

研究效率优先。任何长时间测试都不得自动吞掉执行周期。

### 单项预算

- 默认单个命令硬超时：300 秒；
- 预计超过 180 秒的操作，先缩小语料或降低重复次数；
- 超过 300 秒必须自动终止、保存局部日志，并标记 `deferred_long_run`；
- 禁止未经用户明确批准运行预计超过 10 分钟的测试；
- 禁止重新运行完整 50.5 MB SDSL `recover_all`；
- 禁止把 30 次重复机械应用于慢操作。

### 自适应重复次数

先做 1 次预跑，按预跑耗时选择重复数：

```text
< 10 ms       30 次
10–100 ms     15 次
100–1000 ms    5 次
1–5 s          3 次
> 5 s          1 次，且只报告单次耗时，不伪造 P95
```

对于 build、完整 rebuild、故障恢复和微型 `recover_all`，默认 1 次。

报告必须记录实际重复次数。

---

## 六、功能对等门禁

两套架构必须在同一查询与规范 Span 下完成以下能力，才能进入比较。

### 精确搜索

- `count_only`；
- `locate_first_1`；
- `locate_first_10`；
- `locate_first_100`；
- `locate_all` 仅用于中低命中查询；高频 `locate_all` 不进入主矩阵；
- 不存在查询；
- 中文、英文、路径、JSON、thinking 和 tool 内容查询。

### 正文访问

使用固定真值 Span 测：

- `extract_128b`；
- `extract_1k`；
- `extract_8k`；
- 同块与跨块窗口；
- 消息尾部和多字节 UTF-8 边界。

### 查询组合

至少完成并返回同一 PositionSet 真值：

- 两个词的交集；
- 两个词的并集；
- 查询结果减去某类内容；
- 限定 conversation；
- 限定 content type；
- `near` / 同一消息内邻近；
- 命中扩展为上下文 Span。

普通数据库架构可以通过 SQL、FTS 和结果集合并完成；黑洞架构通过 PositionSet 操作完成。比较重点包括结果正确性、所需中间结构和新增代码路径。

### 来源追溯

任一命中必须能返回：

```text
projection_id
TextId
canonical_start
canonical_end
conversation_uuid
message_uuid
content_block_ordinal
```

---

## 七、主性能矩阵

本轮主矩阵只测真实交互路径，不重复长时间操作。

### 查询路径

```text
count
locate_first_10
extract_1k for selected results
```

分别记录单项时间，并增加端到端：

```text
search_top10_with_1k_context
```

### 必测指标

- build time；
- open time；
- architecture runtime bytes；
- Count P50/P95；
- Locate1/10/100 P50/P95；
- Extract 128B/1KiB/8KiB P50/P95；
- Top10 + 1KiB context 端到端 P50/P95；
- application-hot；
- 新进程首次查询 3 次，不声称 storage-cold；
- 实际重复次数。

### 不进入主矩阵的项目

- 完整主语料 Recover；
- 高频查询的 LocateAll；
- 200 GB / 2 TB 合成扩展；
- 长时间持续负载；
- 数小时重建；
- 参数海量扫描。

---

## 八、架构杠杆账本

跑分只是第四层证据。本轮必须输出两套架构的结构账本。

### 权威事实数量

列出每一份会影响用户可见结果、必须保持正确的持久结构，并分类：

```text
authoritative_fact
rebuildable_projection
cache
display_only
```

### 同步接缝

每一条“两个结构必须一起变化，否则结果错误”的关系记为一条同步接缝，例如：

```text
text block ↔ FTS index
FTS result ↔ span map
message update ↔ compressed block
segment identity ↔ manifest
```

每条接缝必须说明：

- 谁是权威；
- 怎样检测失配；
- 怎样恢复；
- 失配影响范围。

### 能力来源

对每项能力标记：

```text
native
small adapter
secondary structure
cross-system orchestration
```

重点看黑洞架构是否把普通架构中的多个 `secondary structure` 或 `cross-system orchestration` 吸收到一个 `native` 结构中。

### 工程表面积

记录但不盲目评分：

- 自定义源文件数；
- 生产代码逻辑行；
- 外部依赖；
- 持久文件类型；
- 独立构建流程；
- 独立恢复流程；
- 需要保持一致的版本号或哈希数量。

LOC 只作弱证据，不能单独决定胜负。

---

## 九、短生命周期测试

只做能在分钟级完成、能暴露架构接缝的测试。

### Append

追加约 1% 的新内容块：

- 黑洞架构：构建一个新小 Segment，不重写旧 Segment；
- 普通架构：事务插入事实、正文块、位置映射并更新 FTS/倒排。

测量：

- 写入时间；
- 新增持久字节；
- 被改写的文件数量；
- 必须协调的结构数量；
- 追加后查询正确性。

### Delete index and rebuild

删除可重建索引结构，保留事实或规范正文：

- 黑洞架构：从共享事实/规范投影重建 Segment；
- 普通架构：从事实和正文重建 FTS/倒排与映射。

本轮数据量较小，单次执行；超过 300 秒则终止并降级为 `deferred_long_run`。

### Corruption containment

每种架构只做一个最小故障注入：

- 破坏一个索引/Segment 文件副本；
- 验证检测失败；
- 验证共享原始事实没有改变；
- 记录恢复所需步骤和影响范围。

不得在真实唯一副本上注入故障。

---

## 十、微型全文恢复验证

仅对 `full_trace_recovery_micro` 执行。

每种架构各运行一次：

- 输出恢复字节；
- 比较 SHA-256；
- 记录总耗时；
- 记录实际输入大小；
- 记录是否需要读取一个结构还是组合多个结构；
- 记录恢复路径包含的步骤数。

对于 SDSL 的 NUL 规范化行为，继续沿用现有已记录合同并明确标记：

```text
canonical_byte_equivalent
```

本轮不重新争论该边角问题，也不将其冒充原始 ZIP 的 byte-exact 恢复。

---

## 十一、杠杆裁决

不使用单一加权总分。最终输出原始 Pareto 表和一份结构性裁决。

### 黑洞架构显示杠杆的必要条件

至少满足：

1. 完成全部功能对等门禁；
2. `architecture_runtime_bytes` 不高于普通数据库基线；
3. 常见路径 `Count → Locate10 → Extract1KiB` 保持交互可用，不因统一结构而出现数量级退化；
4. 持久权威结构或同步接缝显著少于普通架构；
5. 新增查询组合主要通过 PositionSet 代数完成，而不是增加新的持久索引和映射体系；
6. 追加、损坏和重建残差可局限在 Segment 或可重建投影内。

### 接近支配的信号

若黑洞架构：

- 空间更小或相当；
- 常用查询处于同一体验等级；
- Extract 与上下文恢复可接受；
- 同步接缝和权威结构显著更少；
- 生命周期没有引入等量的新复杂度；

则可标记：

```text
near_dominant_leverage_candidate
```

### 否定信号

若统一结构导致：

- 常用交互数量级变慢；
- Append 或重建必须长期阻塞；
- 为获得过滤和组合能力又重新建立普通数据库的多套索引；
- 自索引之外仍需保存完整正文和复杂映射；
- 残差复杂度接近或超过被吸收部分；

则应把黑洞架构降级为局部物理构件，而不是 DCF 主体。

---

## 十二、交付物

所有新增结果放在：

```text
labs/storage-kernel/reports/leverage-v1/
```

至少包含：

```text
README.md
results.jsonl
capability-parity.json
architecture-ledger.json
storage-bom.json
lifecycle-results.jsonl
recovery-micro.json
machine.json
commands.log
summary.md
```

`summary.md` 的第一页必须回答：

1. 两套架构是否功能对等；
2. 谁的完整运行空间更小；
3. 常见查询路径是否处于同一体验等级；
4. 黑洞吸收了哪些结构与接缝；
5. 黑洞新增了哪些残差；
6. 当前证据是否足以将其列为 `near_dominant_leverage_candidate`。

禁止用“实现了多少文件”“用了多少轮”代替上述答案。

---

## 十三、执行纪律

- 当前 `reports/calibration/` 冻结，不修改历史结果；
- 不运行完整主语料全文恢复；
- 不开启 200 GB / 2 TB 长负载；
- 不进入 Unicode、r-index、Grammar 或采样参数优化；
- 不新增与双架构对照无关的基础设施；
- 先得到完整的双架构杠杆报告，再决定是否进入规模阶段；
- 任一预计超过 10 分钟的任务必须停下并向用户报告，不得自行继续。
