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

# 3. 当前架构已重新收口到 Shared World / Executable Seam

当前整体实施权威：

```text
docs/spec/2026-08-08-DCF-当前架构与实施规范.md
```

本轮新增 ADR：

```text
docs/adr/2026-08-09-executable-semantic-seam-and-minimal-emergence-proof.md
```

当前普通后台不再以“Go + DBOS 统一承担业务”为当前权威结构。

当前硬化结构为：

```text
Capability
    ↓
Application Semantics
    ↓
Executable Semantic Seam
    ↓
Ordinary Backend Runtime
Shared World / Mature ECS / Scheduler
    ↓
Durable State / PostgreSQL

AI 探索与跨时间智能体任务
    ↓
AI Workflow Plane

Capability / State / Action / Evidence
    ↓
Surface Contract
    ↓
Replaceable Surface Runtime
```

当前已经确定：

```text
普通后台
→ 需要统一吸收大量异构、长期活动程序的等待 / 调度 / I/O / Timer / 并发与共享计算成本
→ 目标成本更接近“实际世界变化 × 被影响计算”

ECS / Shared World
→ 当前普通后台目标体质
→ 程序组合优先压缩成 facts / state / relations / effects / queries 的组合

具体 ECS
→ 尚未裁决
→ Bevy ECS / Flecs 为当前成熟候选

Ordinary Backend 语言
→ 尚未冻结
→ 随 Runtime 选型一起决定

PostgreSQL
→ 继续作为 durable state 重要底座
→ 与 ECS Active World 的具体边界未冻结

AI Workflow
→ 与普通后台分离
→ Conductor 继续作为 AI Workflow 专项方向
→ 不允许反向成为整个 DCF 的统一运行时
```

旧 `2026-08-08-go-dbos-workflow-and-replaceable-ui.md` 保留为历史 ADR，不再代表当前 Ordinary Backend 实施权威。

---

# 4. Capability 边界的新硬要求：Executable Semantic Seam

本轮把 2026-08-07 Becsy / Capability World 实验继续向前推进。

当前正式要求：

> **A 的输出脚手架与 B 的输入脚手架不是两份 Mock，而是同一个 Executable Semantic Seam。**

若：

```text
A provides X
B requires X
```

则双方共同引用：

```text
Semantic Seam X
```

它至少承载：

```text
共享业务语义
数据形状
合法性条件
来源 / 证据要求
生命周期
Provider policy
读写 / 基数 / merge 规则
Minimal Realization
Probe / 验证表面
```

当前关键纪律：

```text
Seam First
→ 先冻结最小真实边界

Standalone
→ 缺失的一侧由 Seam 的最小真实实践补齐

Composite
→ 真实 Provider 出现后，standalone-only 实现退出

single-provider
→ 正式运行只允许一个实际权威
```

Seam 不是 Public Facility，也不是新的 Capability。

---

# 5. Minimal Realization 与能力涌现证明已进入架构

Seam 的 Standalone 行为不得只是随机 Mock。

当前要求：

> **最小实践可以缩规模，但不能缩掉真实业务语义。**

因此允许：

```text
1 条记录
1 个项目
1 条确定关系
内存状态
```

但不允许为了方便把真实业务对象降级成无语义字符串。

能力组合现在分三层证明：

```text
Level 1
Constraint / Contract Composition
→ 证明逻辑组合闭合

Level 2
Minimal Emergence Proof
→ 只组合 Executable Semantic Seams / Minimal Realizations
→ 证明最小真实业务语义能够组合并产生新结果

Level 3
Full Runtime / Behavioral Proof
→ 接回真实 Capability / I/O / DB / AI / 并发 / 外部环境
→ 证明完整现实实现兑现
```

候选组合不需要一开始就启动所有完整程序。

例如：

```text
A ─ X1 ─ B ─ X2 ─ ... ─ X25 ─ Z
```

可以先移除 A~Z，只运行：

```text
X1 ─ X2 ─ ... ─ X25
```

首尾自动以最小真实 Source / Sink 补齐，中间依靠真实契约与 Minimal Realization 组成一个极小但真实的业务世界。

若终点 Probe 得到满足最终语义的结果：

```text
MINIMAL_EMERGENCE_PASS
```

这已经是能力涌现的最小行为证据，而不只是线路 continuity test。

---

# 6. Solver / AI 的新探索表面

当前已经形成一个适合约束求解器和 AI 搜索的低成本结构：

```text
Capability Manifest
+
Semantic Seam Contract
+
Minimal Realization
+
Constraints
```

Solver 可以优先探索：

```text
可闭合组合
Provider 冲突
缺失依赖
环
最小能力组合
目标输出路径
潜在能力涌现
```

推荐漏斗：

```text
大量候选
↓
Constraint Solve
↓
合法候选
↓
Minimal Emergence Proof
↓
少量真实成立候选
↓
Full Runtime Proof
```

当前正式表达：

> **影子世界负责便宜探索“什么能成立”；真实世界负责昂贵证明“完整实现真的成立”。**

---

# 7. 2026-08-07 Becsy 实验当前如何看待

2026-08-07 的 Bun+Becsy / Capability World 实验继续是有效历史证据：

```text
ARCHITECTURE_FEASIBLE
38 tests
116 assertions
8 / 8 hard gates PASS
AUTO_PRECEDENCE_PASS
EMERGENCE_PATH_PASS
```

它真实证明过：

```text
Standalone A / B 独立 PASS
Composite 中重复 Provider 运行权威收敛
A / B 源码不因组合修改
错误 Provider / 假语义重叠在 World 创建前拒绝
共享状态读写可吸收执行接缝
新增 C 不修改 A / B 即可进入组合
Composer 可以保持很薄
```

当前解释进一步明确：

```text
Provider 收敛
→ 主要属于 DCF Composition 语义

共享 World / Query / Scheduler
→ 属于 ECS Runtime

Becsy
→ 是成功证明该模式的历史载体
→ 不是唯一可实现该语义的 Runtime
```

因此不再单独做“成熟 ECS 原则上能不能复现 Becsy”的重复实验。

后续 Runtime 实验只在 Bevy / Flecs 真实选型需要时比较具体工程代价与运行特性。

---

# 8. UI 与沉浸式交互继续保持二次收口

当前专项权威：

```text
docs/spec/2026-08-08-DCF-沉浸式认知交互与游戏设计谱系规范.md
```

对应 ADR：

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

继续成立：

```text
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

---

# 9. SillyTavern 与 Godot 当前地位

## 9.1 SillyTavern

SillyTavern 当前作为**叙事交互实验场 / 活体原型候选**。

重点验证：

```text
Edit
Branch
Regenerate / Continue
World Info / Lorebook
用户持续干预 AI 叙事的真实体验
```

SillyTavern 不成为 DCF 事实源。

## 9.2 Godot

Godot 当前仍是：

> **高表现力实时 Surface Runtime 的强候选。**

已识别价值包括：

```text
显式位置 / 层级 / 场景关系
统一 UI / 2D / 3D / 动画模型
适合空间化和连续动态界面
编辑器直接预览和调整场景
独立 Scene 快速运行验证
适合 AI 高频修改 + 用户视觉验收
开放源码，可逐层下钻
```

但当前仍未决定：

```text
Godot 正式成为唯一 Surface Runtime
所有 UI 使用 Godot
Godot 拥有业务事实世界
```

---

# 10. 当前没有做出的决策

以下内容仍保持开放：

```text
Bevy ECS vs Flecs
Ordinary Backend 最终语言
PostgreSQL ↔ ECS Active World 边界
进程拓扑
Surface transport
Provider / Probe / Public Facility 的最终运行形态
Observability / verification 设施
Solver 最终技术实现
可选局部 Dataflow / batching / SIMD optimizer
Godot 是否成为正式 Surface Runtime
SillyTavern 是否最终直接进入正式产品
```

这些方向保留可塑性，不得冒充已接受架构。

---

# 11. 当前阶段：先收完底层架构，再逐项敲定 Capability

Capability Discovery 已经完成。

但在 15 项 Capability 逐项定稿前，普通后台组合体质被重新打开并完成了一次关键收敛：

```text
ECS / Shared World
Executable Semantic Seam
Standalone Minimal Realization
唯一运行权威
Composition Compiler
Minimal Emergence Proof
Solver-friendly Shadow World
```

当前还剩一个主要底层选型问题：

```text
Bevy ECS vs Flecs
+ 对应 Ordinary Backend 语言与运行形态
```

这一层收口后，再回到 Capability Registry v1 的 15 项能力逐项定稿。

每个 Capability 至少需要明确：

```text
1. 用户真正要完成什么
2. requires / provides 什么
3. 与相邻世界共享哪些 Semantic Seam
4. Seam 的真实业务语义与最小 Contract 是什么
5. Seam 的 Minimal Realization / Probe 如何工作
6. Capability 自己真正负责的正式业务是什么
7. 长期业务状态是什么
8. 用户 / AI / 系统可以执行哪些 Action
9. 依赖哪些 Public Facility / Provider / Probe
10. 哪些属于 Ordinary Backend，哪些属于 AI Workflow
11. 需要哪一种 Surface / 注意力带宽
12. 原始材料、AI 推断、用户确认如何区分
13. Standalone 如何 PASS
14. Minimal Emergence 如何验证
15. Full Runtime 如何验收
16. 哪些问题仍明确保持开放
```

逐项定稿继续遵守：

> **未知保持可塑，已知逐渐硬化。**

`现实闭环行动` 继续冻结。

---

# 12. 当前设计纪律

1. **Capability Registry v1 不变。**
2. **现实闭环行动继续 `DISCOVERY_DEFERRED`。**
3. **普通后台与 AI Workflow 是两个不同岗位，不重新合并。**
4. **普通后台当前要求成熟 ECS / Shared World 体质，具体实现仍开放。**
5. **Capability 保独立业务意义，不复制整个依赖链来证明独立。**
6. **A 输出与 B 输入共同引用同一个 Executable Semantic Seam。**
7. **Seam 不是 Public Facility，也不是新 Capability。**
8. **先定义 Seam 的最小真实边界，再实现 Capability 正式业务。**
9. **Minimal Realization 缩规模，不缩语义。**
10. **Standalone 缺失环境由 Seam 自动补齐。**
11. **Composite Runtime 中 single-provider 只能存在一个实际运行权威。**
12. **组合不得要求修改旧 Capability 或增加 Capability-pair Glue。**
13. **Composition Compiler 必须保持通用。**
14. **Capability 关系优先通过共享 World 状态 / 关系表达，不形成深层互调。**
15. **Solver 优先在 Contract + Seam + Minimal Realization 上探索。**
16. **能力组合证据明确分为 Contract、Minimal Emergence、Full Runtime 三层。**
17. **UI 不拥有业务正确性。**
18. **UI 层没有不可替换组件。**
19. **事实节点硬，解释软；新解释不得静默覆写旧解释。**
20. **架构规范写当前结构；ADR 写变化原因；current-state 写当前进度。**
