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

本次交互方向更新不重新打开功能发现。

---

# 3. 当前架构

当前整体实施权威：

```text
docs/spec/2026-08-08-DCF-当前架构与实施规范.md
```

当前已落盘结构仍为：

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

当前已落盘确定：

```text
Go
→ 当前主实现语言

DBOS Workflow
→ 当前长期过程实现权威

PostgreSQL
→ 当前因 DBOS Workflow 持久化需求进入架构

普通函数
→ 不因为存在 Workflow 而强制 Workflow 化
```

Workflow 不是新的 Capability。

最近关于 Conductor OSS、Restate 与“AI 可编程通用 Workflow Runtime”的讨论已经超出当前 GitHub 架构规范，但尚未形成替换 DBOS 的正式 ADR，因此当前不静默改写本节。

---

# 4. UI 与沉浸式交互当前边界

三种交互 Capability 继续成立：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

整体 UI 原则继续是：

> **Function Hard, UI Soft。**

> **UI 是可替换交互投影，不是业务本体。**

新增的全景沉浸交互专项权威：

```text
docs/spec/2026-08-08-DCF-沉浸式认知交互与游戏设计谱系规范.md
```

当前新增确定事项：

```text
全景沉浸交互
→ 不再以传统专业软件 UI 作为默认设计上限

主要参考谱系
→ 成熟剧情 / 推理 / 文字游戏真实交互
→ GDC / Postmortem / 设计师案例
→ 游戏设计与认知设计理论

核心产品判据
→ 剧本替换测试

现实数据额外责任
→ 从无导演、无剪辑的真实材料中恢复当前值得理解的结构
```

正式原则：

> **专业能力可以要求系统复杂，但不能要求用户替系统承担理解复杂度。**

> **DCF 不只是让信息可访问，还应主动承担让用户理解当前世界的责任。**

旧 `2026-08-05-DCF-叙事日历与三Surface交互规范.md` 中关于草稿、审阅、正式叙事、历史不可覆写与后续认知追加的业务语义继续有效。

其中三列布局、固定日历视觉、论坛回复式结构等具体 UI 形态不再是当前冻结要求。

Godot / 其他游戏引擎目前只是全景沉浸 Surface Runtime 的研究候选，尚未形成技术选型决策。

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

以下内容**不是当前正式架构更改**：

```text
Conductor OSS / Restate / Temporal 等 Workflow Runtime 的最终裁决
未来性能热点使用什么 P0 Backend
Effect 是否以及如何分类
Arrow / Bitmap / SIMD / ECS 等局部优化选择
Physical Optimizer
其他数据库是否迁移或统一
Godot 是否成为全景沉浸交互正式 Runtime
```

这些方向可以继续研究，但不得冒充当前已接受架构。

---

# 7. 当前下一步

当前优先顺序更新为：

```text
1. 继续用真实 DCF 任务评估 AI 可编程 Workflow Runtime 候选，不用预设功能表代替真实使用
2. 保持 Go + DBOS 作为当前已落盘架构，直到新的 Workflow ADR 正式替换
3. 建立 DCF Interaction Pattern Library（交互模式库）的第一批模式
4. 从成熟剧情 / 推理游戏中拆解真实认知交互案例
5. 用“剧本替换测试”设计一个全景沉浸交互候选，而不是先冻结 Dashboard / 三列布局
6. 在真实生活数据上验证叙事编译只发现意义、不制造事实
7. Godot 等游戏引擎只在形成真实 Surface 候选时进入运行验证
```

当前不重新进行 Capability Discovery，也不提前把任何具体游戏引擎或 Workflow Runtime 写成既定答案。

---

# 8. 当前设计纪律

1. **Capability Registry v1 不变。**
2. **功能边界与运行实现分开。**
3. **当前已落盘主实现语言仍是 Go。**
4. **当前已落盘长期 Workflow 实现仍是 DBOS，新的候选必须通过新 ADR 才能替换。**
5. **UI 不拥有业务正确性。**
6. **UI 层没有不可替换组件。**
7. **能力通过 Surface Contract 热插拔。**
8. **全景沉浸交互优先研究游戏工业已经验证的认知交互语法。**
9. **先设计认知动作，再设计 UI 控件。**
10. **不把内部数据结构和本体论直接转嫁给用户。**
11. **叙事可以重组意义，但不能伪造底层事实。**
12. **历史认知不得静默覆写。**
13. **剧本替换测试约束产品上限，不冻结具体视觉实现。**
14. **架构规范写当前结构；ADR 写变化原因；current-state 写当前进度。**
