# ADR — Go + DBOS Workflow 与可替换 UI

日期：2026-08-08  
状态：Accepted，实施验证待完成

本文只记录本次架构变化的**原因与决策过程**。当前系统应如何实现，以 `docs/spec/2026-08-08-DCF-当前架构与实施规范.md` 为准。

---

# 1. 背景

2026-08-07 已完成 Capability Discovery 收口，15 项 Capability 的产品身份已经确定。

随后讨论进入“这些 Capability 由什么运行结构承载”的问题。

原先 Bun + Becsy / ECS 路线能够证明声明式组合、共享状态和运行关系可以减少接缝，但在继续分析 Agent 的实际运行形状后，发现长期 AI 探索更自然地表现为：

```text
执行一步
→ 等模型 / 工具 / 用户
→ 根据结果分支
→ 产生子任务
→ 等待
→ 恢复
→ 继续
```

这首先是 Workflow 问题，而不是要求整个 DCF 业务世界预先变成 ECS 的问题。

同时，DCF 的 UI 与功能具有不同演化速度：功能通常可以较快定义和验收，UI 则需要长期反复试验、重写和换代。

因此需要同时解决：

```text
长期过程如何可靠存活
主实现语言如何降低长期工程成本
UI 如何允许以后不断推翻而不伤及功能
```

---

# 2. 决策一：主实现转向 Go

当前主应用实现选择 Go。

主要原因：

- 语言规则和工程模型简单，适合长期维护；
- AI Coding 时错误传播通常更局部；
- 编译、部署、并发与网络 I/O 能力成熟；
- 后续需要替换或迁移局部实现时，工程成本较低。

Go 不负责定义 DCF 的产品语义；Capability 边界保持不变。

---

# 3. 决策二：长期过程采用 DBOS Workflow

需要跨时间存活、等待、恢复和动态分支的过程采用 DBOS Workflow。

选择 Workflow 的原因不是“为了管理很多实例”，而是 Agent 探索行为本身天然具有时间过程结构。

普通即时逻辑仍然是普通 Go 代码，不强制进入 Workflow。

因此：

```text
Capability
├─ 普通行为 → Go
└─ 长期过程 → DBOS Workflow
```

Workflow 是横切执行语义，不新增 Capability。

---

# 4. 决策三：PostgreSQL 只作为 DBOS 当前所需持久底座进入本次架构

DBOS 使用 PostgreSQL 保存其 Workflow 持久状态。

本次决策只涉及：

```text
DBOS Workflow
→ PostgreSQL
```

不包含任何其他 DCF 数据库迁移、统一存储或历史数据改造决策。

其他数据如何存储，继续由各自已有或后续专项设计决定。

---

# 5. 决策四：UI 采用 Replaceable UI，而不是“伪自定义 UI”

DCF 的三种交互 Capability 继续成立：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

但它们不能被某套固定导航、Panel、Sidebar、组件库或 Shell 锁死。

选择：

> **Function Hard, UI Soft。**

稳定的是功能语义和交互契约；具体 UI 实现允许不断重做。

因此 Shell、Navigation、Panel、Layout、Controls、Theme 都只是实现，不得获得“底层不可修改”地位。

Capability 应通过稳定 Surface Contract 被界面发现和操作，使新增功能能够热插拔到已有界面，而不是每增加一个 Capability 都修改 Shell 的业务源码。

---

# 6. 对旧 Bun + Becsy / ECS 路线的处理

此前实验和文档继续作为历史证据保留。

它们已经证明的声明式组合、关系解耦、共享状态等经验仍有参考价值。

但当前实施不再要求：

```text
整个 DCF 必须运行在一个全局 Becsy World
所有 Capability 必须预先建模为 ECS System / Component
Bun 必须继续作为主应用语言
```

这是一项运行实现决策变化，不重新打开 Capability Discovery。

---

# 7. 本次没有做出的决策

本次 ADR **没有**决定：

```text
未来性能热点使用什么 P0 Backend
是否使用 Arrow / Bitmap / SIMD / ECS 等局部优化
Effect 是否需要分类以及如何分类
是否需要 Physical Optimizer
其他 DCF 数据是否迁移 PostgreSQL
未来数据库统一方案
```

这些都不是当前施工项。

若以后真实功能和真实负载提出相应问题，再单独讨论并形成新的 ADR。

---

# 8. 当前需要验证的内容

当前需要通过实现验证的只有本次真正选中的结构：

```text
Go 应用骨架
DBOS Workflow 基本执行
PostgreSQL 中的 Workflow 持久恢复
Capability 与 Workflow 的边界
Surface Contract
Capability Surface 动态发现
Shell / Panel 可替换边界
```

验证结果进入新的实施记录，不在架构规范中混写推演过程。
