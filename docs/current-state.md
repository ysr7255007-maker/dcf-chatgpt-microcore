# DCF Current State

Updated: 2026-08-09

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

当前不重新打开 Capability Discovery。

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

Conductor OSS、Restate、Temporal 等 Workflow Runtime 仍可继续作为未来研究对象，但没有新 ADR 替换 DBOS 前，不改变当前架构。

---

# 4. UI 与沉浸式交互已经二次收口

当前专项权威：

```text
docs/spec/2026-08-08-DCF-沉浸式认知交互与游戏设计谱系规范.md
```

本轮收口 ADR：

```text
docs/adr/2026-08-09-editable-narrative-and-surface-runtime-boundary.md
```

三种交互 Capability 继续成立：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

整体 UI 原则继续是：

> **Function Hard, UI Soft。**

> **UI 是可替换交互投影，不是业务本体。**

当前新增硬化结论：

```text
游戏级认知交互
→ 继续作为产品上限与交互技术谱系
→ 不再要求所有 Capability 优先游戏化

剧本替换测试
→ 继续成立
→ 只约束交互上限
→ 不要求普通日常材料天然好玩

Reality Canon
→ 事实节点不可篡改

Interpretation / Narrative
→ 当前解释可变化
→ 用户可随时修改当前故事并形成新分支
→ 旧解释继续作为历史认知保留

前台 / 后台
→ 后台可以是图
→ 前台优先让用户面对故事和意义
```

正式原则：

> **事实节点硬，解释软。**

> **现实不断写入不可修改的 Canon Events；用户拥有这些事件之间的叙事解释权。**

---

# 5. SillyTavern 与 Godot 当前地位

## 5.1 SillyTavern

SillyTavern 当前作为**叙事交互实验场 / 活体原型候选**。

重点验证：

```text
Edit
Branch
Regenerate / Continue
World Info / Lorebook
用户持续干预 AI 叙事的真实体验
```

允许研究直接嵌入、扩展桥接等工程路径，但尚未决定最终保留、部分重做或完全重做。

SillyTavern 不成为 DCF 事实源。

## 5.2 Godot

Godot 当前不是正式技术选型，但研究价值已经不再依赖“未来做完整游戏”。

当前把它视为：

> **高表现力实时 Surface Runtime 的强候选，同时保留未来升级成完整游戏级表现的潜力。**

已识别价值包括：

```text
显式位置 / 层级 / 场景关系
统一 UI / 2D / 3D / 动画模型
适合空间化和连续动态界面
编辑器直接预览和调整场景
独立 Scene 快速运行验证
无需先正式部署整个 DCF
适合 AI 高频修改 + 用户视觉验收
开放源码，可从脚本向插件 / GDExtension / 引擎源码下钻
```

但当前仍然没有决定：

```text
DCF 正式采用 Godot
所有 UI 使用 Godot
Godot 成为业务事实世界
三种 Surface 必须统一技术栈
```

Godot / Web / SillyTavern 等都必须服从同一个 Surface Contract 与 Replaceable UI 边界。

---

# 6. 已有实验如何看待

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

# 7. 当前没有做出的决策

以下内容**不是当前正式架构更改**：

```text
Conductor OSS / Restate / Temporal 等 Workflow Runtime 的最终裁决
未来性能热点使用什么 P0 Backend
Effect 是否以及如何分类
Arrow / Bitmap / SIMD / ECS 等局部优化选择
Physical Optimizer
其他数据库是否迁移或统一
Godot 是否成为正式 Surface Runtime
SillyTavern 是否最终直接进入正式产品
```

这些方向保留可塑性，不得冒充已接受架构。

---

# 8. 当前阶段切换：逐项敲定 Capability

跨 Capability 的大范围架构、交互与 Surface 讨论目前已经达到足够收口程度。

下一阶段不再继续无限扩展“DCF 还能有什么能力 / 应该像什么游戏”，而是回到 Capability Registry v1 的 15 项能力，**挨个敲定**。

每个 Capability 至少需要明确：

```text
1. 用户真正要完成什么
2. 输入是什么
3. 输出是什么
4. 长期业务状态是什么
5. 用户 / AI / 系统可以执行哪些 Action
6. 与其他 Capability 的边界在哪里
7. 依赖哪些 Public Facility / Provider / Probe
8. 哪些过程需要 Workflow，哪些只是普通即时逻辑
9. 需要哪一种 Surface / 注意力带宽
10. 原始材料、AI 推断、用户确认如何区分
11. 如何验收“功能真的成立”
12. 哪些问题仍明确保持开放
```

逐项定稿时继续遵守：

> **未知保持可塑，已知逐渐硬化。**

不为了让总设计书看起来完整而提前填充未经讨论的答案。

`现实闭环行动` 继续冻结，不进入本轮 15 项 Capability 的定稿范围。

---

# 9. 逐项定稿完成后的下一步

当 15 项 Capability 都完成定稿以后，再编写：

> **DCF 整体项目设计书。**

整体设计书的职责不是重新发明功能，而是把已经逐项确定的内容合并成一个一致系统，包括：

```text
产品目标
Capability 总图
公共设施与边界
数据 / 证据 / 认知历史模型
Workflow 与普通逻辑分工
Surface Contract
三种交互空间
各 Capability 之间的组合关系
运行部署结构
实施顺序
验收结构
仍保持开放的研究问题
```

正式顺序：

```text
Capability Discovery 已完成
        ↓
15 项 Capability 逐项定稿   ← 当前阶段
        ↓
整体 DCF 项目设计书
        ↓
按设计书进入系统化施工 / 验证
```

---

# 10. 当前设计纪律

1. **Capability Registry v1 不变。**
2. **现实闭环行动继续 `DISCOVERY_DEFERRED`。**
3. **功能边界与运行实现分开。**
4. **当前已落盘主实现语言仍是 Go。**
5. **当前已落盘长期 Workflow 实现仍是 DBOS，新的候选必须通过新 ADR 才能替换。**
6. **UI 不拥有业务正确性。**
7. **UI 层没有不可替换组件。**
8. **能力通过 Surface Contract 接入可替换交互 Runtime。**
9. **游戏级认知交互约束产品上限，不要求所有 Capability 游戏化。**
10. **事实节点硬，解释软；新解释不得静默覆写旧解释。**
11. **SillyTavern 是实验候选，不是事实源。**
12. **Godot 是高表现力 Surface 强候选，不是已选 Runtime。**
13. **下一阶段逐项敲定 Capability，不继续无边界发散。**
14. **整体项目设计书必须建立在逐项定稿之后。**
15. **架构规范写当前结构；ADR 写变化原因；current-state 写当前进度。**
