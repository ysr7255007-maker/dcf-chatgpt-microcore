# DCF Current State

Updated: 2026-08-07

> 本文件只回答三个问题：**现在已经确定了什么、证据真实处在哪里、下一步从哪里开始。**
>
> 当前规范入口：`docs/spec/README.md`。

---

# 1. 当前最高层定义

DCF 仍然是：

> **长期个人认知基础设施。**

长期不可变价值仍然成立：

```text
系统拥有现实，DCF 拥有认知
机器负责确定事实与可重放材料
AI 负责开放理解
用户负责最终校准
历史认知不允许静默覆写
后来理解只能追加为新的解释与变化记录
事实、认知、查询相关性、求解结果、Agent 自述、真实 Effect 不得互相冒充
```

2026-08-07 的架构更新改变的是**实现与组合方式**，不是这些价值。

---

# 2. 当前正式架构语言

旧的“六层流水节点 = 功能边界”不再拥有施工权威。

当前正式构件：

```text
Capability
→ 对用户独立成立的完整软件功能

Public Facility
→ 吸收多个 Capability 重复工程复杂度的低业务语义设施

Provider / Probe
→ 把具体外部系统、模型、Agent、来源接进稳定公共契约

Shared Semantic Component
→ 多个 Capability 共同认识的真实世界状态

ExternalOperation
→ 所有 World 外异步执行在 World 内的统一生命周期身份
```

Capability 必须通过：

```text
Standalone World
```

独立证明，并在正式运行时进入：

```text
Composite World
```

组合。

核心原则：

> **重复代码允许存在；重复运行权威不允许存在。**

> **执行位置可以在 World 外；运行身份必须在 World 内。**

---

# 3. 已完成的架构实验

## 3.1 Capability × Bun+Becsy World 组合实验

证据 ADR：

```text
docs/adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md
```

裁决：

```text
ARCHITECTURE_FEASIBLE
```

已验证：

```text
Capability Standalone World 独立成立
Shared Semantic Component 真实 overlap
Composite World 唯一 provider
Becsy 自动 precedence
无业务 Adapter / Mapper / Bridge
新增 Capability 不要求修改旧 Capability
坏组合在启动前拒绝
```

---

## 3.2 公共能力架构消歧实验 E0–E5

远端实验分支：

```text
experiment/prebuild-public-facilities-v1
```

完整证据基准：

```text
159d579d586934bd798d36f62bc7f48faef2a8bf
```

报告元数据修订：

```text
2959fd0c55009110c50c5eb1ce1f0da89badc439
```

总体裁决：

```text
READY_WITH_EXPLICIT_EXCEPTIONS
```

六项实验：

```text
E0 WORLD_EXTERNAL_OPERATION_PASS
E1 ACP_STANDARD_CORE
E2 AI_SDK_CORE_ADOPT_WITH_THIN_DCF_LAYER
E3 SQLITE_AUTHORITY_PLUS_LANCEDB_DERIVED
E4 BORROW_PATTERNS_BUILD_THIN_INTAKE
E5 E5_REALITY_LOOP_PASS
```

无 blocking finding。

有 7 项非阻塞 finding，正式施工不得遗忘：

```text
CJK_FTS_TOKENIZER_PENDING
PERMISSION_EXERCISE_INSUFFICIENT
TOOL_EVENT_COVERAGE_PARTIAL
E4 B/C 只有 structural assessment
LanceDB teardown / handle lifecycle
Codex custom-provider / ACP model enumeration compatibility
SECOND_PROVIDER_LOCAL_ONLY
```

---

# 4. 已收敛的公共设施

## AI Turn Facility

当前结构：

```text
DCF AI Turn Contract
→ Vercel AI SDK Core
→ Provider
```

不再计划自研完整 AI Harness。

第一方产品候选：

```text
AI 工作台
```

---

## Agent Execution Facility

当前结构：

```text
DCF Agent Semantics
→ ACP
→ Codex / Claude / future agents
```

双真实 Agent 已通过同一客户端验证。

第一条正式可写 Agent 任务需要补真实 permission request/decision 验收。

第一方产品候选：

```text
AI 任务执行台
```

---

## Cognition Data Facility

正式冻结的是：

```text
SQLite Authority
+
replaceable / rebuildable Derived Retrieval
```

LanceDB 是当前通过实验的 default candidate，不是永久不可替换标准。

`bge-small-zh-v1.5` 是 E3 固定变量，不是生产 embedding 选型。

查询必须支持多范式：

```text
Structured
Exact / Phrase
Lexical
Temporal
Relationship
Dense
Hybrid
future strategies
```

语义引力场只是 Query Strategy 之一。

AI self-contained chunk 当前仍是：

```text
SELF_CONTAINED_CHUNKS_EXPERIMENTAL
```

第一方产品候选：

```text
认知数据工作台
```

---

## Evidence Intake Facility

当前裁决：

```text
DCF thin intake
```

借鉴：

```text
Home Assistant → lifecycle / unique identity
OTel → ack / pipeline / time semantics
Redpanda → cursor / checkpoint
```

不直接采用 OTel / Redpanda 作为 DCF 通用数据面。

第一方产品候选：

```text
证据源管理器
```

---

# 5. Reality / Fact 与 Cognition 当前边界

E5 已验证：

```text
AgentExecutionStatus
≠
ObservedEffect
```

Agent 声称完成不能进入 Reality Verifier 输入。

同时：

```text
Fact Authority
≠
Cognition Authority
```

当前不存在自动：

```text
ObservedEffect / RawEvidence
→ Cognition Authority
```

的晋级通道。

未来必须经过显式认知形成 / 审核 / 确认流程才能进入正式认知。

---

# 6. 当前功能候选池

以下是讨论后有独立产品意义的候选，**尚未冻结编号与最终边界**：

```text
证据源管理器
多源证据编译器
AI 协作审阅编辑器
个人叙事
认知数据工作台
AI 工作台
AI 任务执行台
项目叙事
Wiki
知识卡
语言弹药
约束决策助手
可验证行动执行
能力主页
上下文侧边栏
环境悬浮球
```

注意：

```text
项目叙事
```

不能提前假设只是展示层；它未来很可能拥有 AI 主动理解、查询与递归取证行为。

同样，Wiki / 知识卡 / 语言弹药虽然可以大量复用 Cognition Data Facility，仍允许因独立产品目的和 Surface 成为薄 Capability。

---

# 7. 当前施工位置

公共设施的大架构探索阶段已经结束。

当前不应该继续：

```text
再找一套平行大架构
为了保险重做第二套 Agent runtime
为了搜索自己造数据库内核
为了采集直接引入完整遥测平台
```

当前下一步：

```text
Capability Discovery
↓
Capability Registry 候选收敛
↓
选择第一个 Capability
↓
关闭 Capability Envelope
↓
Standalone World
↓
Composite World
↓
正式施工
```

正式施工控制以：

```text
docs/spec/2026-08-06-DCF-功能包络与施工控制规范.md
```

的 2026-08-07 同步版为准。

---

# 8. 当前最重要的设计纪律

1. **不要让第三方轮子定义 DCF 世界。**
2. **不要让不确定 AI 做确定机制已经能做的事。**
3. **功能可以增加，运行权威和接缝不能同比增加。**
4. **新功能优先复用 Public Facility；新来源优先新增 Provider；新认知表达优先新增 Recipe / Query Strategy。**
5. **只有出现新的独立用户目的与无法被已有机制表达的业务行为，才增加新的 Capability。**
6. **旧认知与旧设计保留为历史；新裁决通过显式版本追加，不静默改写过去。**
