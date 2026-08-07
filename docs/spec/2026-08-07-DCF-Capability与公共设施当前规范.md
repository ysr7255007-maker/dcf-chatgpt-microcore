# DCF Capability 与公共设施当前规范

日期：2026-08-07  
状态：**当前最高层架构增量裁决**  
适用范围：DCF 正式 Capability 划分、公共设施、Provider / Probe、Bun+Becsy World 组合、外部异步能力、认知数据、AI、外部 Agent、Evidence Intake 与 Reality Effect。

> 本规范吸收 2026-08-07 Capability × Bun+Becsy World 组合实验与 E0–E5 公共能力架构消歧实验的已验证结论。
>
> 它不删除旧规范。旧规范继续保存历史推演与需求语义；若与本文冲突，**本文优先**。

---

# 0. 当前总裁决

DCF 不再按“现实层 → 认知层 → 查询层 → 求解层 → 行动层”的内部流水节点切 Capability。

当前正式结构是：

```text
完整软件功能（Capability）
        │
        ├─ 使用稳定公共设施（Public Facility）
        ├─ 通过 Shared Semantic Component 与其他能力共享世界状态
        └─ 在 Standalone World 中独立证明，在 Composite World 中组合运行

公共设施
        │
        ├─ 使用成熟轮子吸收行业已经解决的工程困难
        └─ 只保留 DCF 必须自己拥有的薄语义边界

Provider / Probe
        │
        └─ 负责把具体外部系统、模型、Agent、证据源接入公共设施
```

核心公式：

> **独立性存在于 Capability；组合性存在于 Shared Semantic Component；运行选择存在于 Composer；执行秩序存在于 World。**

以及：

> **执行位置可以在 World 外；运行身份与生命周期权威必须在 World 内。**

---

# 1. 三类正式构件

## 1.1 Capability：对用户成立的完整软件功能

Capability 必须通过“去 DCF 测试”：

> 抹掉 DCF 语境以后，这个功能是否仍能作为普通软件需求独立解释、独立使用、独立验收？

Capability 的独立性是**业务语义独立**，不是“零依赖”。

允许依赖：

```text
经过独立验收
+
低业务语义
+
稳定契约
```

的 Public Facility。

禁止依赖另一个业务 Capability 的私有实现来维持自身存在意义。

因此：

> **独立 ≠ 零依赖；独立 = 不借别人的业务意义活着。**

---

## 1.2 Public Facility：吸收重复工程复杂度的公共运行设施

Public Facility 不按“用户会不会单独购买”判断，而按：

> 是否用稳定、通用、低业务语义的机制，吸收多个 Capability 会反复支付的工程复杂度。

当前已被实验支持的核心公共设施：

```text
Evidence Intake Facility
AI Turn Facility
Agent Execution Facility
Cognition Data Facility
World / ExternalOperation runtime
```

公共设施不得拥有上层业务意义。

例如 AI Turn 可以知道：

```text
model
stream
reasoning
tool call
structured output
usage
cancel
provider metadata
```

但禁止知道：

```text
个人叙事意味着什么
Wiki 应该写什么
项目叙事该怎样组织
哪段历史对用户最重要
```

---

## 1.3 Provider / Probe：具体外部能力接入件

Provider / Probe 负责把现实中的具体实现接入稳定公共契约，例如：

```text
Codex / Claude ACP Agent
DeepSeek / Ollama AI Provider
Git Evidence Provider
FSEvents Probe
Browser Connector
第三方 App Probe
```

Provider 可以运行在：

```text
独立进程
CLI
App
系统服务
XPC / IPC 对端
网络服务
```

但必须被 World 以稳定领域身份监管。

> **物理位置不决定逻辑主权。**

---

# 2. Shared Semantic Component：关系来自共同认识的现实状态

Capability 之间默认不建立深层直接调用网。

若两个 Capability 都必须理解同一段世界状态，这段状态应优先形成 Shared Semantic Component。

它不是为了“把 A 输出塞给 B”制造的 DTO，而是：

> **世界已经推进到某个双方都能独立理解的状态。**

Shared Semantic Component 必须同时包含：

```text
数据形状
+
语义契约
```

Schema 一样不代表语义兼容。

禁止：

```text
A private API
   ↓ mapper
B private API
```

优先：

```text
System A writes SharedState
System B reads SharedState
```

由 Becsy 根据 Component 访问关系形成执行 precedence。

---

# 3. Standalone World 与 Composite World

## 3.1 Standalone World 是独立证明形态

每个 Capability 必须能够在自己的最小 Bun+Becsy World 中证明：

```text
合法输入 / fixture / standalone provider
↓
Capability 核心行为
↓
有意义输出 / 状态变化
↓
完整行为验收
```

Standalone World 允许为了独立证明拥有本地 fallback / fixture provider。

这不代表生产环境必须同时运行很多隔离 World。

---

## 3.2 Composite World 是正式组合形态

正式运行时，多个 Capability 进入同一个 Composite World。

允许源码存在重叠实现；运行时必须解析唯一 active provider。

> **重复代码允许存在；重复运行权威不允许存在。**

默认不再做“为了组合先物理融合源码”。

只有出现下列真实证据才重新考虑物理融合：

```text
明确性能成本
必须共享不可拆原子事务
Shared Component 无法表达一致性
长期维护证据证明重复实现成本更高
```

---

# 4. World Composer 的边界

Composer 只允许机械处理：

```text
Capability manifests
Shared Semantic contracts
requires / provides
provider candidates
目标 Capability 集合
↓
唯一 Provider 解析
语义兼容检查
Component / System defs 选择
```

Composer 禁止：

```text
转换业务字段
解释正文
修复业务语义
保存业务状态
知道 Codex / DeepSeek / LanceDB 等具体品牌意义
成为 Workflow Engine
随 Capability 数量增长堆 case-by-case 规则
```

Capability 数增长时 Composer 核心算法应基本稳定。

若 Composer 复杂度近似随 Capability 数量线性增长：

> **判为接缝重新外溢。**

---

# 5. ExternalOperation：所有外部异步能力的统一生命周期

E0 已验证：真实 AI HTTP Turn 与真实 ACP Session 可以复用同一套 World 外执行 / World 内监管骨架。

正式外部异步能力原则上统一表达为 ExternalOperation。

World 至少拥有：

```text
稳定 operation identity
所属 Capability / Facility
created / running / requires_action / completed / error / cancelled / orphaned
开始时间
最近活动
lease / worker health
取消意图
结果引用
错误引用
```

必须满足：

```text
World 主循环不等待外部 I/O
领域稳定 ID 不使用 ECS entity id 代替
取消后迟到结果不能复活终态
重复事件不能重复应用结果
worker 死亡必须可观察
World 重建后非终态不能伪装仍在 running
```

当前已验证 ExternalOperation 核心无 provider-specific branch。

因此 AI、ACP、Probe、未来其他外部执行器禁止各自再建立平行生命周期权威。

---

# 6. 成熟轮子原则

DCF 的目标不是“尽量自研”。

正式原则：

> **成熟生态负责已经被行业解决过的工程困难；DCF 只负责真正属于自己的语义与组合方式。**

新公共设施在自研前必须回答：

1. 是否存在已经成熟解决 70%～90% 问题的实现？
2. 剩余差异是 DCF 独特价值，还是工程偏好？
3. 组合 / fork / 薄包装是否比重写十年总复杂度更低？
4. 自研是否意味着重新发现别人已经踩过多年的失败模式？

同时禁止让第三方轮子反向定义 DCF 世界。

> **继承机制，不交出世界定义权。**

---

# 7. 已验证公共设施

## 7.1 AI Turn Facility

当前结构：

```text
Capability
↓
DCF AI Turn Contract
↓
Vercel AI SDK Core
↓
AI Provider
```

实验裁决：`AI_SDK_CORE_ADOPT_WITH_THIN_DCF_LAYER`。

DCF 自己保留：

```text
Turn 领域契约
reasoning 归一
工具失败的 DCF 任务语义
provider metadata / raw escape hatch 的受控边界
```

不再自研：

```text
通用 streaming
provider wire 适配矩阵
通用 structured output 工程
通用 tool-call 协议工程
```

当前非阻塞例外：第二真实 Provider 为本地 Ollama；cache 受控实验、多模态、真实 TCP 中断尚未覆盖。

第一方 reference consumer 候选：**AI 工作台**。

---

## 7.2 Agent Execution Facility

当前结构：

```text
DCF Agent Semantics
↓
ACP
↓
Codex / Claude / future agents
```

实验裁决：`ACP_STANDARD_CORE`。

双真实 Agent 已通过同一 DCF ACP Client 互操作；session new/list/resume/close、stream/cancel/并发等核心路径成立。

DCF 保留：

```text
AgentSession
TaskState
Activity
PermissionRequest / Decision
AgentManifest
```

ACP 字段漂移优先以 manifest / compatibility data 吸收，不允许在核心客户端堆品牌行为分支。

当前非阻塞例外：真实 permission request 尚未触发；第一条正式可写 Agent 任务必须补验收。

第一方 reference consumer 候选：**AI 任务执行台**。

---

## 7.3 Cognition Data Facility

最高原则：

```text
权威历史
≠
派生检索表示
```

当前结构：

```text
SQLite Authority
├─ object
├─ immutable revision
├─ stable anchor
├─ relation
├─ time
└─ structured truth

Derived Retrieval World
├─ chunk
├─ lexical index
├─ dense vector
├─ hybrid candidates
└─ other rebuildable representations
```

E3 已验证 SQLite Authority + LanceDB Derived 的结构成立，包括：

```text
完整删除派生世界后重建
中断构建后显式 stale / incomplete
新 revision 写入但派生失败时权威仍正确
```

因此正式冻结的是：

> **SQLite Authority + replaceable/rebuildable Derived Retrieval。**

不是永久冻结 LanceDB 或某个 embedding 模型。

LanceDB 当前为 default candidate，但存在 teardown trace trap / handle lifecycle 工程项，正式长驻宿主接入前必须解决 dispose 顺序或进程隔离。

固定 `bge-small-zh-v1.5` 在 E3 中用于消除实验变量，不等于生产模型选型。

---

# 8. 认知查询不是“语义搜索”单一路径

Cognition Data Facility 必须支持多种 Query Engine：

```text
Structured
Exact / Phrase
Lexical
Temporal
Relationship
Dense Semantic
Similarity
Change / Contrast
Aggregation
```

以及组合这些原语的 Query Strategy：

```text
Hybrid
RRF / rerank
recursive discovery
Semantic Gravity Field
future custom strategy
```

因此：

> **语义引力场是高级 Query Strategy，不是数据库唯一查询方式，也不等于整个查询层。**

确定事实优先使用确定查询。

未知关系 / 开放关联才进入语义发现。

当前 CJK lexical tokenizer 尚未选定；不得把本轮中文 FTS 零召回伪装成已解决。

AI self-contained chunk 当前裁决为：

```text
SELF_CONTAINED_CHUNKS_EXPERIMENTAL
```

小样本中未证明检索增益，正式个人叙事数据与真实 Query Truth 扩大前不得晋级默认机制。

第一方 reference consumer 候选：**认知数据工作台**。

---

# 9. Evidence Intake Facility

Evidence Intake 负责：

```text
Source identity
lifecycle
ack
cursor / checkpoint
health
buffer / backpressure
RawEvidence intake
recovery
```

当前裁决：`BORROW_PATTERNS_BUILD_THIN_INTAKE`。

直接采用的不是 OTel / Redpanda 数据面，而是成熟机制：

```text
Home Assistant
→ source lifecycle + unique identity / dedup

OpenTelemetry Collector
→ receiver/processor/exporter 分工经验 + ack + 时间语义

Redpanda Connect
→ cursor/checkpoint + declarative boundary
```

OTel / Redpanda 作为 DCF 通用数据面被早停拒绝，因为会引入语义强扭、sidecar / daemon 运维或第二运行权威。

Evidence Source 必须区分：

```text
source_occurrence_time
source_sequence（若来源拥有）
ingestion_time
processing_time / order
```

processing order 禁止冒充现实发生顺序。

可靠性按“来源是否可重放”分治：

```text
可重放来源
→ 持久 cursor/checkpoint 优先

不可重放来源
→ 才考虑 WAL / durable buffering
```

禁止所有 Source 一刀切上同一种消息持久化机制。

第一方管理产品候选：**证据源管理器**。

---

# 10. Evidence Source Manager 与 Evidence Compiler 必须分离

证据采集管理和证据编译是两个不同的软件问题。

## 证据源管理器

负责：

```text
发现
注册
配置
权限
启停
健康
游标
心跳
恢复
最近原始证据
```

回答：

> **现实从哪里进来，这些入口现在正常吗？**

它不解释证据内容的业务意义。

## 多源证据编译器

消费已经取得的 RawEvidence，负责：

```text
source-local deterministic translation
cross-source alignment
排序
去噪
显式关系
material assembly
provenance mapping
```

回答：

> **机器事实怎样成为人与 AI 可以重新进入、且仍可回源核验的 EvidenceMaterial？**

Evidence Compiler 不负责连接 Git、监听文件、申请权限或重启 Probe。

---

# 11. AI 协作审阅编辑器与个人叙事

AI 协作审阅编辑器是独立候选 Capability，其独特价值是：

```text
材料
→ AI 初稿
→ 人类精确审阅 / 批注 / 局部编辑
→ AI 按批注定向修改
→ diff
→ 接受 / 拒绝 / 再审
→ 正式文本
```

它使用 AI Turn Facility，但不把个人叙事语义塞进 AI Facility。

个人叙事应优先表达为：

```text
EvidenceMaterial
+
Personal Narrative Recipe / Profile
+
AI 协作审阅编辑器
+
个人叙事自己的产品状态与 Surface
```

Recipe 不应退化为“只有一段 prompt”；它可以包含：

```text
目标
允许材料范围
检索范围
生成纪律
输出对象类型
审核工具
确认边界
provenance 要求
```

---

# 12. 薄产品 Capability 可以很多

公共能力变厚不意味着项目叙事、Wiki、知识卡、语言弹药“不再是功能”。

它们可以继续作为独立产品 Capability，只要拥有独立用户目的、状态、交互或检索行为。

它们应尽量薄：

```text
Product Recipe
+
Product State
+
Product Surface
+
必要的独立业务机制
```

而不重复实现：

```text
AI provider engineering
长期认知存储
向量引擎
全文引擎
通用 query infrastructure
Agent runtime
```

项目叙事当前明确保留为独立 Capability 候选；它未来可能拥有 AI 主动理解与递归检索机制，不应现在被提前压成“纯展示 Recipe”。

---

# 13. Reality Effect：执行完成不等于现实成立

E5 已验证：

```text
AgentExecutionStatus
≠
ObservedEffect
```

允许：

```text
Agent completed + Reality FAIL
Agent error + Reality PASS
```

Reality Verifier 的输入类型必须结构上排除 Agent 的自我完成声明。

禁止：

```text
Agent final text = done
↓
直接写 ObservedEffect PASS
```

必须重新观察现实来源。

这是行动世界的长期不变量：

> **Agent 负责劳动；现实负责验收。**

---

# 14. 事实权威与认知权威分离

现实事实、ObservedEffect、RawEvidence 等不能自动进入正式认知权威。

当前正式边界：

```text
Reality / Fact Authority
        │
        │ 当前无自动晋级通道
        ▼
Cognition Authority
```

未来只有显式定义并验收：

```text
事实材料
→ 认知形成
→ AI 草稿
→ 用户 / 明确授权确认
→ 正式认知
```

以后才允许跨越。

> **系统拥有现实；DCF 的认知历史拥有被确认的理解。两者不能因为都存 SQLite 就变成同一权威。**

---

# 15. 第一方工作台原则

复杂、长期演化、自研语义明显的 Public Facility，优先拥有一个使用**同一正式接口**的第一方 Capability，用于直接体验、测试、诊断和改进。

当前候选：

```text
AI Turn Facility
↕
AI 工作台

Cognition Data Facility
↕
认知数据工作台

Agent Execution Facility
↕
AI 任务执行台

Evidence Intake Facility
↕
证据源管理器
```

工作台禁止走测试后门或直接绕过 Facility 私有操作内部存储。

若工作台觉得公共接口难用，那就是公共能力本身的真实问题。

---

# 16. 当前 Capability 候选池（未冻结 Registry）

以下仅是当前讨论后具有独立产品意义的候选，不代表最终编号、边界和施工顺序：

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

下一阶段必须重新执行 Capability Discovery。

每个候选逐一回答：

```text
去掉 DCF 后是否仍然是完整软件功能？
独立用户目的是什么？
它自己的状态 / Surface / 行为是什么？
哪些只是 Public Facility？
哪些只是 Provider / Probe？
哪些差异其实只是 Recipe？
```

在这些问题没有闭合以前，不得为了恢复旧“能力 DAG”而匆忙编号。

---

# 17. 当前实验例外必须保留

公共设施消歧总体裁决：

```text
READY_WITH_EXPLICIT_EXCEPTIONS
```

当前无 blocking finding，但有 7 项非阻塞 finding：

```text
CJK_FTS_TOKENIZER_PENDING
PERMISSION_EXERCISE_INSUFFICIENT
TOOL_EVENT_COVERAGE_PARTIAL
E4 B/C 只有 structural assessment
LanceDB teardown / handle lifecycle
Codex custom-provider / ACP model enumeration 兼容缺口
SECOND_PROVIDER_LOCAL_ONLY
```

这些不推翻结构，但不得在正式实现报告中被遗忘或写成“已经全部解决”。

实验完整证据保存在远端分支：

```text
experiment/prebuild-public-facilities-v1
```

证据基准 commit：

```text
159d579d586934bd798d36f62bc7f48faef2a8bf
```

报告元数据修订 commit：

```text
2959fd0c55009110c50c5eb1ce1f0da89badc439
```

---

# 18. 当前下一步

公共设施大架构探索阶段结束。

下一步不是继续横向寻找另一套“大架构”，而是：

```text
Capability Discovery
↓
Capability Registry 候选收敛
↓
Capability Envelope
↓
Standalone World 验收
↓
Composite World 组合验收
↓
正式功能施工
```

新想法若只要求：

```text
新增 Recipe
新增 Query Strategy
新增 Provider
新增 SurfaceContribution
```

优先作为局部增长，不得自动升级成新的基础设施层。

最终追求：

> **功能空间可以持续增长，但公共机制数量、运行权威数量和接缝复杂度不随功能数量同比增长。**
