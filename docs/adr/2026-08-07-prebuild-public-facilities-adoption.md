# ADR: 公共设施架构消歧实验吸收与正式施工前提

Date: 2026-08-07  
Status: accepted

## Context

Capability × Bun+Becsy World 组合实验已经证明：

- Capability 可以在 Standalone World 中独立证明；
- Shared Semantic Component 可以承载真实 overlap；
- Composite World 可以解析唯一 active provider；
- Becsy 可以根据 Component read/write 关系形成执行 precedence；
- Composer 可以保持机械、薄、无业务 glue。

但正式 Capability 施工前仍有另一组高杠杆未知数：

```text
外部异步任务怎样进入 World？
AI 调用是否需要自研 Harness？
外部 AI IDE 是否需要一 Agent 一 Adapter？
认知权威与派生检索如何分离？
证据来源不断增加时如何避免监管失控？
多个公共设施组合以后是否重新长出 glue 和重复权威？
```

因此在分支：

```text
experiment/prebuild-public-facilities-v1
```

执行 E0–E5 公共能力架构消歧实验。

完整证据基准 commit：

```text
159d579d586934bd798d36f62bc7f48faef2a8bf
```

报告元数据修订：

```text
2959fd0c55009110c50c5eb1ce1f0da89badc439
```

最终总体裁决：

```text
READY_WITH_EXPLICIT_EXCEPTIONS
```

---

## Decision 1 — ExternalOperation 成为统一外部异步生命周期语义

E0 裁决：

```text
WORLD_EXTERNAL_OPERATION_PASS
```

真实 AI Turn 与真实 ACP Session 使用同一 World 外执行 / World 内监管骨架。

正式裁决：

> **AI、Agent、Probe、未来其他外部 worker 不得分别建立平行生命周期权威。**

统一由 ExternalOperation 表达：

```text
stable opId
状态机
lease / health
requires_action
cancel intent
result / error reference
```

执行位置可以在 World 外；运行身份必须在 World 内。

---

## Decision 2 — ACP 成为外部长任务 Agent 标准边界

E1 裁决：

```text
ACP_STANDARD_CORE
```

Codex 与 Claude 两个真实 Agent 已经由同一个 DCF ACP Client 驱动。

正式结构：

```text
DCF Agent Semantics
→ ACP
→ external agent
```

不得恢复成：

```text
CodexAdapter
ClaudeAdapter
OpenCodeAdapter
...
```

的品牌矩阵。

非阻塞例外：真实 permission request 尚未触发，第一条正式可写任务必须补齐验收。

---

## Decision 3 — AI Turn 采用成熟 SDK，DCF 只保留薄契约

E2 裁决：

```text
AI_SDK_CORE_ADOPT_WITH_THIN_DCF_LAYER
```

正式结构：

```text
DCF AI Turn Contract
→ Vercel AI SDK Core
→ Provider
```

实验已经实际暴露 reasoning 暴露差异、structured output API 变化、tool failure 默认语义等问题，并证明可以由 thin layer 吸收。

DCF 不再承担完整通用 AI Harness 工程。

---

## Decision 4 — 认知数据冻结“权威 / 派生”分离，而不是冻结某个检索产品

E3 裁决：

```text
SQLITE_AUTHORITY_PLUS_LANCEDB_DERIVED
```

正式冻结：

```text
SQLite = Cognition Authority
Derived Retrieval = replaceable / rebuildable
```

LanceDB 是当前验证通过的 default candidate，不是永久标准。

E3 已证明：

```text
派生全删可重建
构建中断可显式识别 stale/incomplete
派生更新失败不污染正式 revision
```

`bge-small-zh-v1.5` 只用于固定实验变量，不自动晋级生产 embedding 选型。

中文 FTS tokenizer 尚未解决。

AI self-contained chunk 当前仍为：

```text
SELF_CONTAINED_CHUNKS_EXPERIMENTAL
```

因为小样本没有观察到检索增益。

---

## Decision 5 — Evidence Intake 自己保持薄，只继承成熟系统的失败经验

E4 裁决：

```text
BORROW_PATTERNS_BUILD_THIN_INTAKE
```

正式吸收：

```text
Home Assistant
→ source lifecycle / unique identity / dedup

OpenTelemetry Collector
→ ack / pipeline / time separation

Redpanda Connect
→ durable cursor / checkpoint
```

不直接采用 OTel / Redpanda 作为 DCF 通用数据面。

原因：

```text
语义强扭
sidecar / daemon 运维
第二运行权威
定制组件成本
```

可靠性按来源是否可重放分治，不统一强制 WAL。

---

## Decision 6 — Reality Effect 与 Agent Execution 类型级分离

E5 裁决：

```text
E5_REALITY_LOOP_PASS
```

负控制已经证明：

```text
Agent completed + Reality FAIL
Agent error + Reality PASS
```

都可能成立。

因此：

> **Agent 负责劳动；现实负责验收。**

Reality Verifier 的输入类型必须排除 Agent 最终声明，不能依靠调用者“记得不要相信”。

---

## Decision 7 — Fact Authority 与 Cognition Authority 禁止自动晋级

ObservedEffect / RawEvidence / Reality Fact 不得因为方便查询而直接进入正式认知权威。

当前明确不存在：

```text
Fact
→ Cognition Authority
```

自动通道。

未来只有定义并验收：

```text
材料
→ 认知形成
→ AI 草稿
→ 用户 / 明确授权确认
→ 正式认知
```

以后才允许晋级。

---

## Decision 8 — 查询层改为多 Query Engine + Query Strategy

“查询诱导语义场”不再代表整个查询层。

Cognition Data Facility 必须允许：

```text
Structured
Exact
Lexical
Temporal
Relationship
Dense
Hybrid
```

等 Query Engine。

语义引力场降为：

> **一种高级 Query Strategy。**

它可以组合确定查询与语义发现，但不得成为所有查询的默认入口。

---

## Decision 9 — 复杂公共设施优先拥有第一方工作台

为了防止关键公共能力隐形在业务功能内部，长期演化的 Public Facility 优先拥有使用同一正式接口的第一方 Capability：

```text
AI Turn ↔ AI 工作台
Cognition Data ↔ 认知数据工作台
Agent Execution ↔ AI 任务执行台
Evidence Intake ↔ 证据源管理器
```

工作台不得使用测试后门绕过正式 Facility contract。

---

## Consequences

### 正面结果

以后新增功能更可能只增加：

```text
新的业务语义
Recipe
State
Surface
Query Strategy
Provider
```

而不是重新增加：

```text
AI runtime
Agent lifecycle
数据库内核
采集守护系统
第二套运行权威
```

### 当前必须保留的例外

实验分支 `decision.json` 登记 7 项非阻塞 finding：

```text
CJK_FTS_TOKENIZER_PENDING
PERMISSION_EXERCISE_INSUFFICIENT
TOOL_EVENT_COVERAGE_PARTIAL
E4 B/C 只有 structural assessment
LanceDB teardown / handle lifecycle
Codex custom-provider / ACP model enumeration compatibility
SECOND_PROVIDER_LOCAL_ONLY
```

这些不改变当前结构裁决，但不得在正式施工中被遗忘。

### 不再做的事

在出现新证据前，不再启动另一轮“整体公共设施大架构”平行竞争。

下一阶段转为：

```text
Capability Discovery
→ Registry
→ Envelope
→ Standalone World
→ Composite World
→ 正式施工
```
