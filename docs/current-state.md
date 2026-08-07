# DCF Current State

Updated: 2026-08-08

> 本文件只回答三个问题：**现在已经确定了什么、真实证据处在哪里、下一步做什么。**
>
> 当前规范入口：`docs/spec/README.md`。

---

# 1. 长期定义不变

DCF 仍然是：

> **长期个人认知基础设施。**

长期原则继续成立：

```text
机器负责确定事实与可重放材料
AI 负责开放理解
用户负责最终校准
历史认知不允许静默覆写
后来理解只能追加为新的解释与变化记录
不同证据层级不得互相冒充
```

---

# 2. Capability Discovery 已收口

Capability 身份最高权威：

```text
docs/spec/2026-08-07-DCF-Capability-Registry-v1与能力发现收口规范.md
```

当前状态：

```text
Capability Registry v1：15 项
开放式 Capability Discovery：关闭
现实闭环行动：DISCOVERY_DEFERRED
```

15 项 Capability 保持不变：

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

本次运行时讨论不重新打开功能发现。

---

# 3. 当前架构

当前整体实施权威：

```text
docs/spec/2026-08-08-DCF-当前架构与实施规范.md
```

当前结构：

```text
Capability
├─ 普通即时逻辑 → Go
└─ 跨时间长期过程 → DBOS Workflow
                         ↓
                     PostgreSQL
                  Workflow 持久状态

Capability / State / Action
        ↓
Surface Contract
        ↓
Replaceable UI
```

当前已确定：

```text
Go
→ 当前主实现语言

DBOS Workflow
→ 需要跨时间存活、等待、恢复、动态分支的长期过程

PostgreSQL
→ 当前因 DBOS Workflow 持久化需求进入架构

普通函数
→ 不因为存在 Workflow 而强制 Workflow 化
```

Workflow 不是新的 Capability。

---

# 4. UI 当前边界

三种交互 Capability 继续成立：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

当前 UI 原则：

> **Function Hard, UI Soft。**

> **UI 是可替换交互投影，不是业务本体。**

因此以下内容都允许反复修改甚至整体推翻：

```text
Shell
Navigation
Sidebar
Panel
Layout
Controls
Theme
Canvas / DOM 具体实现
视觉与交互风格
```

明确禁止“伪自定义 UI”：不得因为某个元素属于系统 Shell 或核心导航，就获得不可修改地位。

Capability 应通过 Surface Contract 被界面动态发现和操作，使后续功能能够挂载到现有交互空间，而不是每增加一个功能都修改 Shell 的业务逻辑。

---

# 5. 已有实验如何看待

2026-08-07 的 Bun+Becsy / Capability World 实验仍然是有效历史证据：

```text
ARCHITECTURE_FEASIBLE
```

它证明过声明式共享状态、组合验证等机制的价值。

但当前实施架构已经改为 Go + DBOS Workflow 路线，因此 Bun+Becsy / 全局 World 不再是当前强制施工前提。

具体原因见：

```text
docs/adr/2026-08-08-go-dbos-workflow-and-replaceable-ui.md
```

---

# 6. 当前没有做出的决策

以下内容**不是当前施工项，也不是当前架构更改**：

```text
未来性能热点使用什么 P0 Backend
Effect 是否以及如何分类
Arrow / Bitmap / SIMD / ECS 等局部优化选择
Physical Optimizer
其他数据库是否迁移或统一
```

这些讨论只说明未来有可扩展空间，不属于当前实施要求。

---

# 7. 当前下一步

当前优先顺序：

```text
1. 验证 Go + DBOS + PostgreSQL 的最小 Workflow 路径
2. 明确哪些过程需要 Workflow、哪些保持普通 Go
3. 实现全景沉浸交互的第一版 Surface
4. 验证 Capability Surface 动态发现 / 挂载
5. 验证 Shell / Panel 可以替换而不影响 Capability 行为
6. 继续按既有 Registry 推进 Capability Envelope
```

当前不需要重新进行功能发现，也不需要提前建设未来机器优化体系。

---

# 8. 当前设计纪律

1. **Capability Registry v1 不变。**
2. **功能边界与运行实现分开。**
3. **Go 是当前主实现语言。**
4. **长期过程才进入 Workflow。**
5. **PostgreSQL 当前只承担 DBOS Workflow 所需持久化职责。**
6. **不得由此推导其他数据库迁移。**
7. **UI 不拥有业务正确性。**
8. **UI 层没有不可替换组件。**
9. **能力通过 Surface Contract 热插拔。**
10. **架构规范写当前结构；ADR 写变化原因；current-state 写当前进度。**
11. **未提上日程的未来优化，不得冒充当前架构决策。**
