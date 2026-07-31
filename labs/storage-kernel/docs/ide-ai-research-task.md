# DCF Storage Kernel Lab — 本地 IDE AI 研究执行任务包

## 0. 你的身份

你不是在修一个普通程序，也不是在为旧沙盒报告补几张跑分表。

你是本轮 **DCF 材料事实层、搜索投影与物理索引正式研究的本地执行者**。你的任务是利用仓库中现有的 Rust 实验大纲、外部引擎协议、旧沙盒源码与完整原始导出，重建一条可复现、可追溯、能推翻旧结论的证据链。

你的第一责任不是“让程序跑起来”，而是保证：

> 被测材料没有在导入阶段被静默裁剪；任何性能数字都绑定到明确的数据集、实现、机器、缓存状态和通过的正确性门禁。

---

## 1. 仓库与分支纪律

仓库：`ysr7255007-maker/dcf-chatgpt-microcore`

只在以下分支工作：

```bash
git fetch origin
git switch experiment/storage-kernel-local
```

禁止修改或强推：

```text
experiment/storage-kernel-outline
```

该分支是未经本地编译与现实约束修正前的原始实验假设。你的分支负责记录现实如何改变它。

所有改动都限制在：

```text
labs/storage-kernel/
docs/superpowers/specs/
docs/superpowers/plans/
```

不要修改现有 DCF 产品代码，不要尝试与 Electron、Chrome 或旧控制平面对接。

建议按阶段提交，每个提交只承担一种证据或能力：

```text
chore: record local toolchain baseline
feat(import): preserve typed content blocks
feat(projection): build full trace projection
feat(engine): add sdsl utf8 adapter
experiment: rerun unicode space comparison
report: revise grammar claim
```

---

## 2. 已知事实与旧实验的证据状态

完整原始导出中约有：

```text
484 conversations
13,287 messages
14,601 visible text blocks
5,619 thinking blocks
2,941 tool_use blocks
2,915 tool_result blocks
329 attachments
487 file references
```

原始导出不是规范数据库，但已经是带稳定 UUID、时间、父子关系、类型化内容块和工具调用关联的文档图。

旧沙盒约 22.6 MB 数据集不是完整材料。旧导入器优先读取 `message.text`，只有它为空时才遍历 `content[]`；备用路径还会把真实 thinking 替换为 `[thinking]`。因此旧实验实际测的是：

```text
legacy_message_text
```

它既不是纯中文完整投影，也不是完整中英轨迹，更不是原始 JSON。

当前证据状态：

```text
算法候选发现               behavior_passed
旧 message.text 基线       measured_with_narrow_scope
最终性能排名               implemented_unverified
完整 full_trace 适用性     not_tested
原始 JSON 适用性           not_tested
正式 DCF 架构裁决           not_tested
```

旧结果不得删除，但必须重新命名并绑定到 `legacy_message_text`。

---

## 3. 可用输入

本地应具备：

```text
完整原始导出 ZIP
  data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000(1).zip

旧沙盒实验源码、报告和证据包
  dcf-benchmark-package.tar.gz
```

不要把私人语料、解压后的原文、工具结果或附件内容提交到 Git。

可以提交：

- SHA-256；
- 文件大小；
- 数量统计；
- Schema 摘要；
- 无敏感内容的 Manifest；
- 实验报告；
- 命令、日志和错误摘要；
- 小型人工构造测试夹具。

---

## 4. 不可静默改变的逻辑合同

以下内容若确实无法成立，先写 ADR，再修改代码：

1. 原始 ZIP 和原始 JSON 字节只增不改。
2. 平台 UUID 必须作为来源身份保留，内部整数 ID 不能替代它。
3. `content[]` 存在时，它是消息事件事实；`message.text` 只能作为旧格式回退或一致性对照。
4. Thinking、Tool Use、Tool Result、附件提取文本和未知块不得被占位符替换或静默丢弃。
5. 未解析关系进入 `import_anomalies`，不得由 AI 猜测修复。
6. 搜索坐标属于投影：`TextId + projection_id + canonical UTF-8 byte Span`。
7. 每个投影 Span 必须能够追溯到原始 Blob、Conversation UUID、Message UUID、Content Block ordinal 和来源字段哈希。
8. 搜索引擎是可删除、可重建的投影；错误索引不能改写原始事实。
9. Count、Locate、Extract、Recover 任一不正确，性能数字自动无效。
10. 空间统计包含打开并使用 Segment 所需的全部文件，不允许漏掉码表、目录、字典、边界、Manifest 或独立正文库。
11. 缓存状态必须按实际控制能力命名，不允许把 application-cold / OS-hot 写成 storage-cold。
12. 所有结论必须绑定数据集哈希、投影版本、引擎配置哈希、二进制构建身份、机器身份和原始报告。

---

## 5. 总体目标

建立以下确定性链路：

```text
Raw Archive
→ Deterministic Fact Import
→ Material Conservation Report
→ Search Projections
→ Truth Sets
→ Engine Conformance
→ Experiment Packs
→ Claim Registry
→ Architecture Decision Evidence
```

最终不要求宣布一个全局冠军，而要回答：

- 哪种材料应永久保存；
- 哪种投影应作为日常默认搜索对象；
- 哪些内容只在诊断模式下搜索；
- 不同 Segment 是否真的需要不同物理结构；
- 哪些旧结论被确认、缩小适用范围、修正或推翻。

---

# 第一阶段：建立本地基线

## 任务 1.1：记录环境

执行并保存：

```bash
cd labs/storage-kernel
rustup show
rustc -Vv
cargo -V
cmake --version
c++ --version
uname -a
```

记录：

- 当前分支与 commit SHA；
- OS；
- CPU；
- RAM；
- 存储类型；
- 电源模式；
- Rust/C++/SDSL/zstd版本；
- 是否位于 WSL、Docker 或原生系统。

输出：

```text
reports/environment/<machine-id>.json
reports/environment/<machine-id>.log
```

## 任务 1.2：编译现有大纲

执行：

```bash
cargo check --workspace
cargo test --workspace --no-run
```

不要边看边大面积重写。先保存原始失败日志，再按最小修改修复。

必须生成：

```text
reports/baseline/cargo-check.before.log
reports/baseline/cargo-check.after.log
reports/baseline/outline-diff.md
Cargo.lock
```

`outline-diff.md`逐项说明：

```text
原始假设
编译器/依赖/平台证据
所做修改
是否改变逻辑合同
```

---

# 第二阶段：重建事实导入层

## 任务 2.1：原始档案登记

新增 Raw Artifact Store。至少记录：

```text
source_blob_id
sha256
original_filename
byte_length
media_type
source_platform
imported_at
archive_member_path
```

原始 ZIP 与每个原始 JSON 文件都要单独登记哈希。

禁止 parse 后重新序列化并冒充原件。

## 任务 2.2：确定性 Structured Fact Import

建议第一版使用 SQLite，使事实对象、异常和关联能够直接检查。若改用其他实现，需要 ADR。

至少建立：

```text
source_blobs
conversations
messages
content_blocks
text_blocks
thinking_blocks
tool_calls
tool_results
attachments
file_refs
citations
import_anomalies
```

保留：

```text
conversation UUID
message UUID
parent_message_uuid
sender
created_at / updated_at
content block ordinal
content block type
raw_payload
source JSON Pointer
source field hash
```

`content[]`解析优先级：

```text
content[] 存在
→ 按原始 ordinal 遍历全部块

content[] 不存在
→ 才使用 message.text 作为 legacy fallback
```

禁止：

```text
thinking → [thinking]
tool_use → [tool]
未知块 → 跳过
```

未知类型应保存 raw payload，并记录 `unknown_content_type`。

## 任务 2.3：异常守恒

对已知异常进行复核并输出实际数量：

```text
dangling_parent
unmatched_tool_result
missing_tool_result
missing_tool_use_id
unknown_content_type
missing_file_blob
design_chat_schema_variant
```

不得让外键约束阻止事实导入。关系可以未解析，但原始事实必须进入库。

## 任务 2.4：材料守恒报告

输出每类块的：

```text
source block count
imported block count
dropped block count
placeholder block count
source payload bytes
imported payload bytes
coverage ratio
```

硬门禁：

```text
静默 dropped blocks = 0
placeholder thinking/tool blocks = 0
未知块未保存 = 0
```

若不满足，停止后续所有性能实验。

输出：

```text
reports/material/material-conservation.json
reports/material/material-conservation.md
```

---

# 第三阶段：构建同源搜索投影

从完全相同的 484 个对话生成以下投影。每个投影拥有独立 `projection_id`、版本、SHA-256和来源账本。

## P0：`legacy_message_text`

精确复现旧沙盒导入逻辑，用于复跑旧结果。不要修正它。

## P1：`visible_text`

只包含真正可见的 text blocks，不包含 thinking 和工具轨迹。

## P2：`full_trace`

按原始消息和内容块顺序包含：

```text
visible text
thinking
complete tool use
complete tool result
attachment extracted text（存在时）
```

每类块使用确定性的类型边界；边界不能代替内容。

## P3：`translated_zh_full`

仅当已有同源中文翻译资料可可靠配对时生成。它不是删除工具轨迹的“纯正文”，而是完整事件的中文化投影。无法配对的块保留原文并标记转换状态。

## P4：`raw_json_exact`

原始 JSON 逐字节不变。该投影用于证据和诊断实验，不自动成为默认用户搜索对象。

## P5：`raw_json_compact`

由解析后的事实确定性生成的紧凑控制组。它是派生物，不能替代 `raw_json_exact`。

## P6：Component Corpora

分别生成：

```text
component_text
component_thinking
component_tool_use
component_tool_result
component_attachment_text
```

目的不是产品使用，而是识别Unicode、zstd、Grammar、r-index和重复性优势来自哪一类材料。

## 每个投影必须输出

```text
source_blob_sha256
projection_id
projection_version
conversation_count
message_count
content_block_count
canonical_bytes
codepoint_count
ASCII byte share
Han codepoint share
unique scalar count
text/thinking/tool byte shares
longest record
whole-projection SHA-256
provenance sidecar SHA-256
```

## 来源账本

每个投影块至少记录：

```text
source conversation UUID
source message UUID
source content ordinal
source type
source payload SHA-256
projection span
transformation = verbatim | translated | canonicalized | legacy_derived
```

---

# 第四阶段：真值与查询工作负载

## 任务 4.1：字节级真值

对每个投影使用独立暴力字节扫描生成：

```text
exact count
all exact canonical spans
expected extract bytes
```

支持重叠命中，不允许只验证“无假阳性”而忽略漏报。

## 任务 4.2：查询分类

至少建立：

```text
visible Chinese phrases
English thinking-only phrases
tool names
tool input keys
file paths
error messages
code identifiers
JSON field names
UUIDs
absent queries
high-frequency queries
single-hit queries
long phrases
queries near long-message tails
```

每个查询声明允许命中的投影和内容类型。

## 任务 4.3：真实用户动作回放

固定以下完整链路：

```text
Search
→ top 20
→ 20 × 128B snippets
→ open 1 × 1KiB context
→ open full message
→ previous/next message
```

另加：

- 搜索英文 thinking；
- 搜索工具名和错误；
- 从投影 Span 回到原始 content block；
- 搜索 Raw JSON 字段并统计结构噪声。

---

# 第五阶段：稳定实验框架和外部引擎

## 任务 5.1：修复并测试 Rust 实验框架

优先补齐：

- Span反转和越界；
- 重叠Truth Match；
- Raw JSON逐字节准备；
- zstd跨块Extract；
- Engine Binding不匹配；
- 报告空间总额一致性；
- 错误引擎不得拥有有效性能结果；
- 投影来源账本覆盖；
- 未知块不丢失。

## 任务 5.2：实现持久外部引擎

通过现有 JSON-lines 协议接入：

```text
utf8_self_index
unicode_byte_aware_self_index
utf8_locate_only
unicode_byte_aware_locate_only
```

要求：

- 返回精确 canonical byte Span；
- 不允许上层按平均 bytes/codepoint 修正；
- 不允许使用模拟 zstd Extract；
- `row % sample_rate == 0` 不得冒充SDSL真实SA采样规则；
- 若仍使用极稀疏ISA完整CSA，必须准确命名，不能写成 no-ISA FM Core；
- 每个二进制输出构建身份、依赖版本和配置哈希。

## 任务 5.3：旧证据复现审计

修复或记录：

```text
README引用的缺失命令
check_spans / check_spans_exact差异
缺失机器结果
临时C++程序与正式报告的对应关系
早期 top10_ctx 实际只Extract命中词的问题
```

旧报告无法复现的条目不得伪造重建，应标记：

```text
reported_without_machine_artifact
```

---

# 第六阶段：结论驱动实验包

所有实验先跑正确性，再跑性能。每组报告必须包含 P50、P95、样本数和原始样本文件。

## Pack A：Legacy Reproduction

在 `legacy_message_text` 上复跑旧UTF-8 A1基线，确认新框架与旧沙盒的差异来自哪里。

## Pack B：Unicode vs UTF-8

对所有正式投影重测：

```text
full storage bill
build time
peak RSS
open time
count
locate
128B / 1KiB / 8KiB extract
full recovery
bytes/input-byte
```

禁止只用13层对8层解释性能，需记录相同canonical Span下的总rank/access工作量。

## Pack C：Locate-only＋zstd

比较：

```text
UTF-8 locate-only + zstd
Unicode locate-only + zstd
self-index
self-index + independent original body
raw artifact + projection index
```

缓存状态分别记录：

```text
application-hot
application-cold / OS-hot
process-cold
storage-cold（只有真正控制时才使用）
```

工作负载包括：

```text
10 results in same block
10 results in 10 blocks
10 results in 10 conversations
128B / 1KiB / 8KiB / full message
very large tool result
```

## Pack D：SA/ISA采样前沿

扫描：

```text
SA = 32, 64, 128, 256, 512, 1024, 2048
ISA = disabled, sparse, normal
```

记录平均与P95 LF步数，不允许一个任意配置代表整条路线。

## Pack E：Grammar重新开案

至少在以下语料上测试：

```text
full_trace
raw_json_exact
component_thinking
component_tool_use
component_tool_result
```

扫描规则数量，完整统计：

```text
rule table
top-level sequence
codebook
random extract
full recovery
build time
peak RSS
```

只有在完整结构化语料上仍显著输给zstd，才能正式关闭Grammar路线。

## Pack F：重复性、r-index与去重

分别测：

```text
BWT runs r
n/r
LZ phrase count
exact message/block dedup
stable-hash dedup
CDC
shared fragments
```

Python内置 `hash()` 禁止用于持久结论。

## Pack G：Segment切分

比较：

```text
single whole corpus
time-based
conversation-based
content-type based
language based
content-type + language
```

Segment尺寸扫描：

```text
16, 64, 256, 1024 MiB
```

统计固定开销、压缩率、查询扇出、重建范围和多Segment合并成本。

## Pack H：规模行为

按累计字节构造完整对话边界的子集：

```text
1 MiB
5 MiB
20 MiB
full corpus
```

禁止按消息条数粗切并把不同分支随意拼接。不得通过重复复制制造“5倍语料”。

## Pack I：真实体验

测量完整用户动作，不只测内核函数。报告每一步和总链路P50/P95。

## Pack J：故障恢复

注入：

```text
index truncation
manifest hash mismatch
zstd block corruption
block directory corruption
external engine crash
interrupted build
publish-before-rename failure
wrong text/index pairing
```

必须证明：

- 原始事实未受损；
- 错误Segment不会激活；
- 可以从事实正文重建；
- 失败证据保留。

---

# 第七阶段：Claim Registry

建立机器可读：

```text
experiment/claims.json
```

至少登记以下旧结论：

```text
unicode saves ~12-14% space
unicode is final compact winner
locate-only cold end-to-end is ~7ms
locate-only costs +51-62% storage
dual physical has limited benefit
grammar is not useful
r-index is unsuitable
fixed block boosting saves ~2.7%
three schemes already have stable jobs
raw artifact is too large to retain independently
```

每条Claim包含：

```text
claim_id
statement
original_dataset
original_evidence
risk = local_numeric | architecture_reversing
required_experiment_packs
status
new_evidence
scope
notes
```

合法状态：

```text
not_tested
inconclusive
confirmed
confirmed_with_narrower_scope
revised
overturned
```

当前所有依赖完整语料的结论初始化为：

```text
not_tested
```

不要用“看起来仍然合理”代替实验状态。

---

# 第八阶段：证据包与完成条件

## 每次运行必须绑定

```text
repository commit SHA
dataset/projection SHA-256
projection version
engine binary SHA-256
engine config SHA-256
machine ID
OS and compiler
dependency lock
cache state
exact command
start/end time
raw stdout/stderr
correctness result
raw timing samples
full storage components
```

## 完整机器证据包

建议目录：

```text
reports/<machine>/<run-id>/
├── run-manifest.json
├── material-report.json
├── correctness.jsonl
├── timings.raw.jsonl
├── summary.json
├── storage-components.json
├── stdout.log
├── stderr.log
└── interpretation.md
```

## 停止条件

出现以下任何一项时，停止性能解释：

- 材料覆盖不完整；
- 未知块被丢弃；
- 数据集身份不一致；
- Count或Locate与真值不完全相等；
- Extract不是引擎返回Span上的真实字节；
- 完整恢复哈希不一致；
- 空间账单缺组件；
- 缓存状态无法证明却被命名为冷态；
- 报告无法绑定到代码和二进制身份。

## 最终交付

1. 可编译并有测试的本地分支；
2. Raw Artifact登记和Structured Fact Store；
3. 材料守恒报告；
4. 全部同源投影与Manifest；
5. Truth Set和真实用户回放；
6. 四种物理候选的正确性与性能报告；
7. 各实验包原始证据；
8. Claim Registry最终状态；
9. `outline → local`差异说明；
10. 最终研究报告，严格区分：

```text
Measured Fact
Implementation Limitation
Inference
Open Question
Architecture Recommendation
```

在 `full_trace` 和 `raw_json_exact` 尚未通过材料守恒、正确性与正式实验之前，禁止宣布最终DCF存储架构。

---

# 执行沟通格式

不要每遇到一个编译错误就向用户请求决定。优先采用最小、可撤销、遵守合同的修复。

每完成一个阶段，汇报：

```text
本阶段目标
实际完成
新增证据
发现的原假设偏差
是否改变逻辑合同
下一阶段
Commit SHA
```

若发现可能颠覆架构的新事实，立即单独报告，不要等全部实验跑完。

最终目标不是证明某个方案正确，而是让任何方案都必须在完整事实、严格真值和可重放证据面前赢得自己的岗位。