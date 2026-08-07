# DCF Current State

Updated: 2026-08-08

> 本文件只回答三个问题：**现在已经确定了什么、证据真实处在哪里、下一步从哪里开始。**
>
> 当前规范入口：`docs/spec/README.md`。

---

# 1. 当前最高层定义

DCF 仍然是：

> **长期个人认知基础设施。**

长期不可变价值继续成立：

```text
系统拥有现实，DCF 拥有认知
机器负责确定事实与可重放材料
AI 负责开放理解
用户负责最终校准
历史认知不允许静默覆写
后来理解只能追加为新的解释与变化记录
事实、认知、查询相关性、求解结果、Agent 自述、真实 Effect 不得互相冒充
```

2026-08-08 的运行时更新改变的是：

```text
Capability 如何承载长期过程
普通工作由谁执行
机器优化何时出现
UI 如何保持可替换
```

不改变 DCF 的长期价值与 Capability Registry v1。

---

# 2. 当前正式架构语言

当前最高运行架构：

```text
Capability
→ 用户可独立理解、使用和验收的产品能力

Go
→ 默认应用执行宿主
→ 普通即时逻辑
→ 未知问题 / 未形成 P0 的默认退路

DBOS Go
→ 跨时间长期 Workflow
→ Step checkpoint / recovery / wait / child flow

PostgreSQL
→ DBOS durable state
→ 新运行侧事务事实的默认候选底座

P0 Backend
→ 只在真实瓶颈形成后，为某类稳定 Effect 提供局部机器黑洞

Replaceable UI
→ Capability / Workflow / durable state 之上的可替换交互投影
```

核心原则：

> **长期过程进入 Workflow；即时逻辑留在 Go。**

> **先让 Go 承担未知，再让 P0 吸收已知。**

> **功能硬化，界面软化。**

> **架构上的可替换性优先于炫技式 Hot Reload。**

---

# 3. Capability Discovery 已正式收口

当前 Capability 身份最高权威：

```text
docs/spec/2026-08-07-DCF-Capability-Registry-v1与能力发现收口规范.md
```

当前结果保持不变：

```text
Capability Registry v1：15 项
Discovery 暂缓：1 项
开放式 Capability Discovery：关闭
```

当前 15 项：

```text
1. 证据源采集管理
2. 多源证据编译
3. AI 协作审阅编辑器
4. 个人叙事
5. 项目叙事
6. Wiki
7. 知识卡
8. 语言弹药
9. AI 工作台
10. 认知数据工作台
11. AI 任务执行台
12. 约束决策助手
13. 全景沉浸交互
14. 嵌入式交互
15. 环境微交互
```

`现实闭环行动` 继续：

```text
DISCOVERY_DEFERRED
```

Workflow 不是新的 Capability。

---

# 4. 2026-08-08 运行时转向

当前运行时最高权威：

```text
docs/spec/2026-08-08-DCF-Workflow执行底座、机器特化后置与可替换UI架构规范.md
```

对应 ADR：

```text
docs/adr/2026-08-08-workflow-go-dbos-postgresql-late-specialization-replaceable-ui.md
```

当前裁决：

```text
GO_DBOS_POSTGRES_ARCHITECTURE_SELECTED
BEHAVIOR_VERIFICATION_PENDING
```

即：

- Go 作为新的默认主实现 / 执行宿主方向；
- DBOS Go 承担长期 Workflow；
- PostgreSQL 承担 DBOS durable state；
- 普通 Step / Effect 默认先用 Go；
- 尚未完成 workflow-kernel 行为验证，因此不得写成 `behavior_passed`。

---

# 5. 旧 Bun + Becsy / ECS 证据如何处理

2026-08-07 已完成：

```text
Capability × Bun+Becsy World 组合实验
→ ARCHITECTURE_FEASIBLE
```

该实验继续证明：

```text
声明式共享状态能减少私有调用链
读写声明可以吸收部分执行 precedence
Standalone / Composite 组合验证能暴露接缝
```

但以下旧表述不再拥有当前全局运行主权：

```text
DCF 必须是一个全局 Becsy World
Capability 必须作为全局 ECS System
Bun 是唯一默认核心宿主
为了未来机器优化必须提前组件化业务世界
```

当前理解：

> **ECS 可以是局部机器 P0，但不是 DCF 全局世界观。**

旧实验和旧规范继续保留，不静默改写。

---

# 6. Late Machine Specialization（机器特化后置）

当前默认：

```text
Workflow Step / Effect
→ Go implementation
```

只有真实运行中出现：

```text
稳定 Problem Signature
明确规模瓶颈
可利用同质性
成熟结构性 P0
净杠杆高于接缝残差
```

才晋升到专用 backend。

潜在岗位示例：

```text
大集合筛选 → Bitmap
列式批量数据 → Arrow / Columnar / SIMD
LLM 推理 → continuous batching engine
约束满足 → Solver
结构化关系 / 事务 → SQL / PostgreSQL
```

不冻结具体产品，不把它们作为第一阶段前置依赖。

正式原则：

> **Generic First → Evidence → Problem Signature → P0 Promotion。**

---

# 7. Effect 不要求提前穷举

当前不建立完整固定的 Effect Vocabulary。

允许先只有：

```text
Workflow
→ Step
→ Go
```

未来真实工作长出稳定共同结构，再抽出：

```text
SetSelection
BatchTransform
LLMInference
ConstraintSolve
...
```

Effect taxonomy 本身允许演化。

当前也不建立中央 Physical Optimizer。

只有未来跨多个 backend 的物理计划选择本身形成独立复杂度时，才重新发现该 P0 岗位。

---

# 8. PostgreSQL 与既有 Cognition Data Authority

必须保持两件事同时成立：

```text
DBOS durable state
→ PostgreSQL
```

以及此前已经验证的：

```text
Cognition Data
→ SQLite Authority
→ replaceable / rebuildable Derived Retrieval
```

因此：

> **DBOS 采用 PostgreSQL，不等于 Cognition Data 自动迁移 PostgreSQL。**

SQLite → PostgreSQL 的认知权威迁移如果未来发生，必须通过独立专项 ADR / 实验完成。

---

# 9. UI 当前最高原则

三种交互 Capability 身份继续成立：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

但具体 UI 不冻结。

当前最高原则：

> **Function Hard, UI Soft —— 功能硬化，界面软化。**

> **Replaceable UI —— 可替换 UI，而不是伪自定义 UI。**

稳定的是：

```text
Capability semantic contract
State / Action / Event
Workflow
Durable data
Surface semantic contract
```

可替换的是：

```text
Shell
Navigation
Sidebar
Panel / Panel Host
Layout
Toolbar
Card
Modal
Canvas
Theme
Components
具体交互模型
```

明确禁止：

> 因为某个元素叫“系统 UI / 核心导航 / 固定 Panel”，就不给后续修改权限。

---

# 10. UI 更新目标

DCF 不要求所有 UI 在同一个 JS VM 中做到零帧 HMR。

真正要求：

```text
能力可以动态注册 / 注销 Surface
Panel 可以替换
Shell 可以整体换代
Theme / Layout 可以快速更新
soft reload 后能够恢复当前交互上下文
```

并保证：

```text
Go backend 不停
DBOS Workflow 不丢
PostgreSQL durable truth 不丢
Capability 行为不失效
```

因此：

> **能力热插拔优先于 Shell 热更新；UI Replaceability 优先于 HMR。**

---

# 11. Frontend Deletion / Shell Replacement 验收

未来正式 UI 架构必须能证明：

```text
删除整个 frontend
↓
重写极简 UI
↓
仍然可以发现 Capability、读状态、执行 Action、观察 Workflow
```

以及：

```text
Shell v1
→ Shell v2
```

不得迫使：

```text
Capability 重写
Workflow 重写
Durable data 因视觉改版迁移
```

如果业务正确性藏在 React / Vue / Panel 私有状态里，判为架构违规。

---

# 12. 自定义 Canvas 与语义树

DCF 可以使用 DOM、Canvas、WebGL / WebGPU 或其他自由绘制技术。

但：

> **视觉自由不得以语义消失为代价。**

若 Canvas 使标准 AX / Accessibility 语义不能自动生成，必须保留独立 Surface Semantic Model 或 Accessibility Projection。

目标：

```text
Capability / Surface Semantic Model
          │
     ┌────┴────┐
     ▼         ▼
Visual UI    AX / AI Semantic Projection
```

---

# 13. 已收敛公共设施与专项证据

以下历史实验和专项结论继续保留其作用域内的证据价值：

```text
AI Turn Facility
→ Vercel AI SDK Core + 薄 DCF 语义层

Agent Execution Facility
→ ACP + 薄 DCF Agent 语义

Cognition Data Facility
→ SQLite Authority + 可重建派生检索

Evidence Intake Facility
→ 继续吸收来源生命周期 / ack / cursor / checkpoint 等输入侧复杂度
```

旧 `World / ExternalOperation runtime` 中依赖 Becsy World 作为唯一全局运行主权的部分需要按 08-08 新架构重新设计；其已验证的外部操作状态与失败语义证据不自动失效。

---

# 14. 当前施工状态

Capability Registry 身份与 Envelope 施工状态继续分离。

建议状态仍可使用：

```text
REGISTERED
ENVELOPE_NOT_CLOSED
ENVELOPE_CLOSED
PATH_PASS
STANDALONE_PASS
READY_FOR_COMPOSITE
COMPOSITE_PASS
PASSED
DESIGN_BLOCKED
DISCOVERY_DEFERRED
```

但旧 `Standalone World / Composite World` 若特指 Becsy World，不再是所有 Capability 的强制施工形态。

后续验收应围绕：

```text
独立功能行为
稳定契约
长期 Workflow 边界
组合接缝
持久事实
UI 可替换性
```

重新定义具体测试形态。

---

# 15. 当前下一步

当前优先顺序：

```text
1. Go + DBOS + PostgreSQL workflow-kernel 行为验证
2. 明确普通外部 Step 的 at-least-once / 幂等 / transaction 边界
3. 以全景沉浸交互作为第一批正式 Surface 实现之一
4. 验证 Capability Surface 动态发现 / 挂载 / 卸载
5. 验证 Frontend Deletion Test / Shell Replacement Test
6. 继续逐项关闭 Capability Envelope
```

当前**不**把 Arrow、Bitmap、SIMD、ECS、Solver 等机器 P0 作为前置施工要求。

真实瓶颈没有出现：

> **不优化。**

---

# 16. 当前最重要的设计纪律

1. **Capability 看产品主权，不看独占代码量。**
2. **Capability Registry v1 不因运行时变化重新 Discovery。**
3. **Workflow 是长期过程横切语义，不是新的 Capability。**
4. **长期过程进入 DBOS；即时逻辑留在 Go。**
5. **Go 是默认执行宿主与未知问题退路。**
6. **先让 Go 承担未知，再让 P0 吸收已知。**
7. **机器优化按真实证据晋升，不提前建模未来。**
8. **不预先穷举 Effect，不预先建立中央物理优化器。**
9. **ECS 降级为局部 P0 候选，不再是全局世界观。**
10. **P0 Backend 不拥有 durable truth。**
11. **DBOS 使用 PostgreSQL 不静默改写既有 SQLite cognition authority。**
12. **功能硬化，界面软化。**
13. **UI 层没有不可替换组件。**
14. **禁止伪自定义 UI。**
15. **能力热插拔优先于 Shell 零帧热更新。**
16. **整个 frontend 应允许删除重做而不破坏 Capability / Workflow / durable truth。**
17. **视觉可以自由；语义模型必须继续存在。**
18. **不要让不确定 AI 做确定机制已经能做的事。**
19. **旧认知与旧设计保留为历史；新裁决通过显式版本追加，不静默覆写过去。**
