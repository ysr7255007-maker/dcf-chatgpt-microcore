# ADR: DCF 从愿景文档到“实现闭合”的设计演化

Date: 2026-08-04  
Status: historical design record; current implementation authority moved to `docs/spec/2026-08-04-dcf-current-architecture-spec.md`

## Context

DCF 的需求文档最初承担了两个职责：

1. 记录 DCF 还没有被说清楚的愿景；
2. 尝试把愿景逐步变成可以交给 AI Coding Agent 的工程要求。

随着讨论深入，这两个职责开始冲突。

愿景文档需要保留探索、转折、被推翻的候选路线和“为什么”；实现文档则必须尽量消除一种危险：

> AI 做出了用户不接受的实现，却仍然可以从文档字面上证明自己“已经完成”。

因此，v3.5 之前持续增长的需求文档不再继续作为 Current Spec，而转为 ADR / 设计演化记录。本 ADR 提炼这段演化的主线；当前实现约束单独维护在 Current Spec。

---

## Decision 1 — DCF 不先分类现实，而让结构从证据中生长

早期讨论逐渐形成第一个稳定原则：

```text
现实先发生
↓
以尽量低解释度留下
↓
等待更强语义证据
↓
形成叙事 / 见解 / 结构
↓
证据继续增加
↓
再抽取更稳定的对象
```

这导致 DCF 不再要求：

- 每条交互进入系统时立即归属 Project；
- 每个念头立即升格为 Requirement / Insight；
- 每个变化立即解释成正式 Change；
- 一开始就穷举完整 Plugin API。

核心经验：

> 低解释度进入，延迟归纳，证据驱动升格。

---

## Decision 2 — 原件、确定性结构和 AI 解释必须分层

讨论项目叙事时逐渐发现，叙事不能成为新的“真相数据库”。

最终稳定成：

```text
Observable Records
↓
Deterministic Trajectory
↓
AI Narrative / Requirement / Knowledge Projection
↓
Human Calibration
```

机器负责历史不乱；AI 负责意义生长。

这进一步导致长期数据分层：

```text
facts.db
→ 稳定可观察事实

dcf.db
→ 可变认知投影与业务对象

ops.db
→ Job / Run / 恢复相关运行收据

logs/
→ 诊断
```

Runtime 可以替换，原始现实不能因为 Runtime 改变而消失或被重新解释。

---

## Decision 3 — 项目叙事不是第一层；第一层是确定性交互轨迹

早期曾把“机器叙事”理解成最靠近事实的一层。

继续具象化后发现，即使机器叙事也是解释。

因此第一层改为规则可重放的交互轨迹，只回答：

```text
发生了什么
顺序是什么
来自哪里
```

人物叙事才是第一层真正的 AI 语义叙事。

项目叙事则在需要回看历史时，从人物叙事、时间范围和其他事实源重新构造，不作为实时项目状态机持续维护。

---

## Decision 4 — Record Source 只提供观察；关联是公共能力，但规则不是公共规则

随着 Git、文件、浏览器、测试、IDE、Agent 等未来来源进入讨论，曾存在一个诱惑：用统一时间窗 / 全局 correlator 把所有事件自动对齐。

该方向被放弃。

新的结构是：

```text
Observable Record Source
→ 保留来源原生语义

Event Link
→ 统一承载关系

Source-specific Association Strategy
→ 各来源自己定义什么关系可靠
```

即：

> 关联是公共能力，规则不是公共规则。

---

## Decision 5 — Becsy 不是业务数据库，而是“活动计算状态层”

引入 ECS / Becsy 时最初容易把它理解成一种模块架构。

经过大量运行场景推演后，它的定位逐渐变成：

> DCF 当前正在发生什么的活动世界。

专业结构：

```text
Entity
→ 当前存在的活动对象

Component
→ 对象当前的一小块状态

System
→ 专门处理某类状态的机器

Query
→ System 的接活条件

World
→ 当前活动对象和状态的总表
```

最关键的变化不是用了 ECS 名词，而是：

```text
身份 ≠ 数据 ≠ 处理逻辑
```

以及：

> 功能关系优先通过共同 World 中的数据状态发生，而不是形成深层互调控制网。

---

## Decision 6 — 主线程不是工作线程，而是最小存在核 / 控制平面

最初容易把任务分成“短任务留主线程、长任务扔 Worker”。

这个标准被认为不稳定，因为今天 2ms 的工作未来可能变成 2s。

最终改成：

> 只要一件正式工作能够独立描述成 Job，它就默认离开主线程，与预计耗时无关。

主线程只维护：

```text
World
Job identity
状态推进
派发
Progress / Result / Failure
取消 / 超时 / 恢复
UI / API / 诊断响应
```

因此：

```text
某项正式工作卡死
≠
DCF 卡死
```

核心原则：

> 工作可以死，DCF 不能因为某项工作一起死。

---

## Decision 7 — “500 个 Agent”思想实验暴露了黑盒 Agent Runtime 的结构问题

为了检验未来规模，曾假设存在数百自由 Agent。

这个极端场景不是未来真实负载预测，而是压力镜头。

它暴露出：如果 Becsy 只看到：

```text
AgentRun #817 = Running
```

但 Agent 内部几十个模型调用、读写、Git、Browser、Spawn 全藏在第三方 Runtime 内，ECS 实际没有取得任何可重组工作。

于是先后讨论过几条路线：

1. 为所有 Tool / MCP 写 DCF Adapter —— 被否决，因为维护成本会随整个外部生态线性增长；
2. 只做 Trace / Observability —— 被否决，因为动作已经发生后才观察，无法进行资源重组；
3. 只做 Admission Gate / 并发限流 —— 被否决，因为这只是控制数量，没有利用 ECS 把分散工作变成同质数据流。

真正的突破是：

> Agent 先产生 Action Intent，现实动作执行前将 Intent 暴露为数据。

---

## Decision 8 — ECS 优化对象从 Tool Call 下沉到 Effect

继续追问“Read / Write / AI / Browser 是否已经足够本质”后，得到更稳定的抽象：

```text
Operation
→ 原始动作身份

Effect Projection
→ 它会读什么、写什么、影响什么、有哪些顺序限制
```

DCF 不需要理解整个 Tool Schema，只在能够确定时提取：

```text
Resource / Scope
ReadSet
WriteSet
EffectKind
Ordering Constraint
PayloadRef
ContinuationRef
```

这使工具生态仍然可以由原生 SDK / Runtime 承担，而 DCF 只拥有具有长期稳定性的优化接口。

后来进一步明确：

> Effect 未知时仍允许原生执行，但默认不得合并、去重或跨未知边界重排。

因此 Effect Projection 是优化权限，不是接入门槛。

---

## Decision 9 — ECS 的收益不仅来自“同质任务合并”

最初讨论重点是：

```text
500 logical reads
→ dedup / batch
→ 少量 physical reads
```

随后发现即使任务高度异构，ECS 仍可能通过机器级结构获益：

```text
热 / 冷数据分离
紧凑 Component 数据
按资源排序
时序局部性
减少锁竞争
减少上下文切换
提高缓存复用
```

因此形成：

> 同质化决定 ECS 收益上限；数据导向布局与时序局部性决定异构场景的收益下限。

同时明确：不得为了寻找优化机会，让所有 Operation 先支付昂贵 AI 语义判断税。

---

## Decision 10 — Agent 的“生命”可以从执行循环变成 World 状态变化

Becsy World 天然可以容纳 Agent，但不是因为 ECS 自带 Agent Framework。

关键是把：

```text
agent.run() / while loop / async stack
```

改写成：

```text
Agent Entity
+
State Components
```

例如：

```text
NeedsInference
→ InferenceSystem
→ WaitingForEffects
→ EffectSystem
→ ResultReady
→ Resume
```

Agent loop 在语义上仍然存在，但从隐藏控制流变成可查询的状态流。

大量等待中的 Agent 因此主要是数据，而不是大量常驻执行栈。

---

## Decision 11 — 未来主要负载并不是“500 个自由 Agent”

继续推演后又发现，极端思想实验不应该误导真正产品结构。

DCF 更可能拥有：

```text
少数高自由度 AI
→ 规划、架构、研究路线、异常处理

大量低自由度语义执行实例
→ 按已经确定的探索 / 研究方法推进
```

因此出现“高级语义状态机（Semantic FSM）”：

```text
当前语义阶段
已有证据
仍缺什么
合法动作
什么时候必须调用 AI
什么时候可以确定性推进
什么时候必须升级
```

它不是不用 AI，而是 AI 的自由度已经被上层认知压缩。

核心原则：

> 判断可以很智能，执行自由度可以很低。

---

## Decision 12 — AI 工作应该形成“自由度逐层下降”的认知漏斗

稳定结构最终变成：

```text
高自由度 Planner / Architect / Resolver
↓
中自由度 Investigator
↓
Semantic FSM
↓
Effect / Deterministic System
```

越往下：

```text
自由度降低
同质化提高
实例数量提高
单位成本降低
机器友好程度提高
```

而无法被下层结构吸收的问题形成：

```text
Residual
→ NeedsEscalation
→ 回到高自由度 AI
```

因此：

> 自由智能只用于吸收剩余未知，不重复承担已经被理解的问题。

---

## Decision 13 — 自研 AI Runtime 与成熟 Agent Runtime 不再二选一

这是整个演化后期最重要的收敛之一。

成熟 Agent Runtime 负责：

```text
未知任务
新能力
开放世界探索
复杂规划
异常诊断
```

DCF 自研 AI Kernel 负责：

```text
已理解的执行结构
Semantic FSM
单次 Model Turn
Action Intent 暴露
Result 回注
ECS 批处理
```

两者不是竞争关系。

新能力先使用成熟生态获得；真实使用产生轨迹；反复成功的稳定模式再下沉为 DCF 自己的 Execution Template。

---

## Decision 14 — 成熟 Agent Runtime 是“前沿解释执行器”，DCF 是“热路径编译后端”

最终形成一个类似 JIT 的循环：

```text
未知 AI 工作
↓
Mature Runtime 通用执行
↓
真实 trajectory / profiling
↓
发现稳定高频路径
↓
Execution Template
↓
Semantic FSM
↓
Becsy 优化执行
↓
Residual
↓
回到 Mature Runtime
```

第三方生态负责承担：

```text
快速变化 API
新工具
新模型范式
失败路线
生态试错
```

DCF 只收割：

```text
已经通过真实使用证明
已经被理解
高频且值得工业化
能够获得结构性效率收益
```

核心原则：

> 第三方 Agent 生态替 DCF 探索未来；DCF 从真实使用中不断把成熟 AI 行为编译成自己的高效执行结构。

---

## Decision 15 — DCF 追求的不是最大控制权，而是最大可重组性

并不是所有 Provider 内部动作都必须拉回 DCF。

如果某项工作：

```text
不会争抢 DCF 共享稀缺资源
不会与其他实例形成明显冲突或复用
Provider 自己执行更成熟
集中处理没有明显结构收益
```

可以保持黑盒。

但一旦涉及共享现实资源，必须进入 DCF 的隔离 / 资源边界。

这避免两种极端：

- 为了架构纯洁重做整个生态；
- 为了方便让外部 Agent 绕过所有 DCF 资源协调。

---

## Decision 16 — 逻辑工作身份与物理执行必须分开

当 ECS 发现 320 个相同 Read 可以共用一次物理读取时，不能把 320 个调用者的逻辑身份也合并掉。

因此最终需要区分：

```text
Logical Operation
→ 谁提出、谁等待、call id、continuation、取消、lineage

Physical Execution
→ 电脑实际为了满足它们做了几次工作
```

目标是：

```text
大量 Logical Work
→ 尽可能少的 Physical Work
```

而不是丢失因果身份。

---

## Decision 17 — AI Coding 的真正前置工作是“实现闭合”

这段长期讨论最后暴露出一条比任何具体架构都更通用的经验。

担心 AI Coding 的根本原因不只是“AI 会写错代码”，而是：

> 当需求仍存在关键语义自由度时，实现 AI 会替用户完成价值判断；它可能遗漏、缩水、偷换、黑盒实现、只做 Happy Path，或者做出一个代码上存在但现实体验上不存在的功能。

因此形成最终实施原则：

> **在把工作交给 AI 之前，不必把实现设计完，但必须把所有“做错了仍然可以声称做对”的关键空间尽可能消掉。**

这不是要求把代码预先设计完。

真正应该锁住的是：

```text
做成什么才算对
谁拥有状态
运行边界在哪里
失败后什么必须仍然存在
什么捷径虽然字面合规但不算实现
现实中用什么行为证据证明它真的存在
```

而保留给实现 AI 的是：

```text
函数怎么拆
局部类型怎么命名
模块怎么组织
具体算法怎么优化
符合不变量的工程实现路线
```

即：

> 锁定“什么才算对”，不要锁死“代码必须怎么写”。

---

## Consequence — 为什么从这里开始拆成 ADR + Current Spec

持续生长的旧文档已经同时包含：

```text
早期愿景
阶段性候选
已推翻路线
当前不变量
未来想法
仍未闭合问题
```

这对于回看思想演化很有价值，却对实现 AI 构成新的歧义源。

因此从 2026-08-04 起：

```text
ADR
→ 保存为什么、转折、失败路线、心路历程

Current Spec
→ 只保存现在仍成立的结构、硬约束与明确未闭合 Gate
```

当前实现权威：

`docs/spec/2026-08-04-dcf-current-architecture-spec.md`

历史文档的价值不被删除，但不再允许历史候选路线重新取得实施权威。
