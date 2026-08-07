# ADR — 从全局 Bun+Becsy / ECS 运行体转向 Go + DBOS + PostgreSQL 与后置机器特化

日期：2026-08-08  
状态：Accepted as current architecture direction; behavior verification pending

## 背景

2026-08-07 的 Capability × Bun+Becsy World 实验已经证明：

- Capability 可以在 Standalone World 独立成立；
- Shared Semantic Component 可以吸收部分私有调用接缝；
- 组件读写声明可以形成执行先后；
- Composite World 可以解析唯一 active provider；
- Bun 作为宿主可以减少一体化 JavaScript / TypeScript 工程接缝。

实验裁决为 `ARCHITECTURE_FEASIBLE`。

随后对“工程体质 / 问题体质 / 机器体质”的进一步讨论暴露了一个重要误区：

> 能够安全承载大量运行实例，不等于已经形成机器体质。

严格意义上的机器体质要求：

> **把大量问题降低为更少、更同质、更机器友好的表示，并因此降低单位运行成本。**

在这一标准下：

- Actor、Workflow 的背压、排队、隔离、恢复主要属于问题体质；
- ECS / SoA / Bitset / SIMD 等只有在问题天然具有同质性时才形成真正机器杠杆；
- 机器体质不应切穿问题体质；
- AI Agent 探索的自然形状更接近长期 Workflow，而不是全局 ECS 世界。

## 决策

### 1. Workflow 成为长期 Agent / 长期过程的自然问题语言

DCF 不再要求所有 Capability 作为全局 ECS System 运行。

需要跨时间存活、等待、恢复、动态分支和子流程的过程进入 Workflow；普通即时逻辑保留为普通语言函数。

### 2. 当前主实现方向改为 Go + DBOS Go + PostgreSQL

- Go：默认应用执行宿主与普通工作实现；
- DBOS Go：长期 Workflow / checkpoint / recovery；
- PostgreSQL：DBOS durable state 与新运行侧事务事实的默认候选底座。

该组合当前为架构选择，尚需 workflow-kernel 行为验证。

### 3. 保留既有 Cognition Data SQLite Authority

DBOS 选择 PostgreSQL 不自动推翻此前已验证的 Cognition Data Facility：

`SQLite Authority + replaceable/rebuildable Derived Retrieval`。

若未来需要迁移到 PostgreSQL，必须通过独立 ADR / 实验显式完成。

### 4. Go 承担默认机器执行，不重复发明 Go 已经解决的问题

Go runtime 已经承担大量通用机器执行能力，例如轻量并发、I/O 等待、M:N 调度和多核运行。

因此后续 P0 不再以重新发明普通 scheduler、worker pool 或 I/O runtime 为目标。

### 5. 机器优化采用 Late Machine Specialization

所有尚未形成稳定瓶颈的 Effect 默认使用 Go。

只有在真实运行中出现稳定 Problem Signature、规模成本与明确结构性优势时，才把该 Effect 晋升到专用 P0 Backend。

可能的局部岗位包括 Bitmap、Columnar/Arrow、SIMD、LLM batching、Solver 等，但当前不冻结具体技术。

### 6. 不预先穷举 Effect，不建立中央 Physical Optimizer

DCF 本质仍是 Workflow 世界，而不是随机任意任务世界。

Effect 类型可以随着真实系统生长；大多数 Effect 的 backend 可以在注册或实现时确定。

只有未来跨多个 backend 的物理计划选择本身成为独立复杂度时，才重新发现 Physical Optimizer 岗位。

### 7. ECS / Becsy 降级为局部候选与历史证据

原实验继续保留，证明声明式状态和访问关系具有接缝吸收价值。

但以下命题不再是当前运行前提：

- DCF 必须是一个全局 Becsy World；
- Capability 必须作为全局 ECS System；
- Bun 是唯一核心宿主；
- 为未来机器优化必须提前组件化整个业务世界。

如果未来某个局部 Effect 天然符合大量同质实体、稳定组件组合、批量查询与连续数据布局，ECS 可以重新作为局部 P0 Backend 使用。

## UI 同步决策

运行时重构同时暴露出另一条长期需求：功能很容易定义并验收，而 UI 会长期反复修改。

因此采用：

> **Function Hard, UI Soft**

并把目标从 `Customizable UI` 改为：

> **Replaceable UI**

正式要求：

- Capability / Workflow / Durable State 与 UI 实现分离；
- Shell、Navigation、Panel、Layout、Controls、Theme 全部可替换；
- 不允许“系统 UI”获得不可修改豁免；
- Capability 通过稳定 Surface Semantic Contract 暴露状态与动作；
- 前端可以整体删除重写而不破坏业务正确性；
- 能力热插拔优先于追求零帧 HMR；
- Canvas / 自定义绘制若破坏标准 AX 语义，必须保留独立语义模型或 Accessibility Projection。

## 为什么选择这一方向

### 原方案的问题

全局 ECS/Becsy 的机器体质很强，但必须提前把广泛业务语义压进 Entity / Component / System 几何。

这会产生语义几何残差：

- Workflow 必须为 ECS 暴露不自然的运行状态；
- Capability 增长可能被机器模型反向约束；
- 为尚未出现的性能问题提前支付建模成本。

### 新方案的杠杆

`Go + DBOS + PostgreSQL` 提供一个低残差默认底座：

```text
未知问题
→ Go 先承载

长期过程
→ DBOS 保证继续活

持久事实
→ PostgreSQL / 既有专项 Authority

真实热点
→ 再晋升局部 P0
```

因此系统可以先成立，再根据真实证据逐步长出机器器官，而不是一开始把整个世界改造成机器结构。

## 影响

### 保留

- Capability Registry v1；
- 产品主权判断；
- 原生 / 涌现 Capability 同级；
- Public Facility / Provider / Probe 的产品与工程分层思想；
- 历史不可静默覆写；
- 已完成 Bun+Becsy / E0–E5 实验作为证据。

### 被替代

- 全局 Becsy World 作为正式运行主权；
- Bun-first Host 作为当前唯一核心实现方向；
- 全局 ECS 作为默认 Capability 组合与机器优化机制；
- UI 具体布局 / Panel / Sidebar 获得架构冻结地位。

### 新增待验证项

1. Go + DBOS + PostgreSQL workflow-kernel 崩溃 / 恢复 / 事务行为；
2. 普通外部 Step 的 at-least-once 与幂等边界；
3. Capability Surface 动态发现与挂载；
4. Frontend Deletion Test；
5. Shell Replacement Test。

## 迁移纪律

旧代码和旧规范不做静默清洗。

迁移时：

- 先建立新 Go / DBOS kernel；
- 用行为证据确认边界；
- 再决定哪些旧 Bun/Becsy 实现保留、重写或降级为实验材料；
- 不因为运行时切换重新打开 Capability Discovery。
