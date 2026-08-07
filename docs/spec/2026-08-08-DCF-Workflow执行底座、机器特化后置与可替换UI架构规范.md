# DCF Workflow 执行底座、机器特化后置与可替换 UI 架构规范

日期：2026-08-08  
状态：**当前最高层运行时 / Workflow / UI 架构增量权威**  
适用范围：主实现语言、长期过程、DBOS + PostgreSQL、Go 默认执行、机器特化后置、P0 Backend 晋升、三种交互能力的 UI 可替换边界、旧 Bun + Becsy / 全局 ECS 运行假设的降级。

> 本规范不重新打开 Capability Discovery，不改变 2026-08-07 冻结的 Capability Registry v1。
>
> 本规范改变的是：**这些 Capability 如何承载长期过程、如何执行普通工作、何时引入机器优化、以及 UI 如何保持可替换。**
>
> 旧规范与实验继续作为历史证据保留。若旧文档把 Bun、Becsy World 或全局 ECS 写成当前正式运行底座，实施时以本文为准；旧结论不得静默删除。

---

# 0. 当前总裁决

DCF 当前运行骨架收敛为：

```text
Capability
    │
    ├─ 即时 / 普通逻辑
    │      ↓
    │      Go
    │
    └─ 需要跨时间存活的长期过程
           ↓
        DBOS Workflow（Go）
           ↓
        PostgreSQL
        durable authority
```

在此基础上：

```text
普通 Effect / 普通 Step
→ 默认 Go 实现

真实运行证据证明某类工作形成稳定 Problem Signature（问题签名）和规模瓶颈
→ 才允许晋升为专用 P0 Backend

P0 Backend
→ 只优化自己的局部问题
→ 不成为第二 durable truth
→ 可以替换、撤销、升级、回退
```

UI 采用另一条独立原则：

> **Function Hard, UI Soft —— 功能硬化，界面软化。**

以及：

> **Replaceable UI —— DCF 要的是可替换 UI，不是伪自定义 UI。**

因此：

```text
Capability / Workflow / Durable State
→ 稳定

Shell / Navigation / Panel / Layout / Components / Theme
→ 可替换
```

---

# 1. Capability Registry v1 不变

本次架构更新不增加、不删除、不改名当前 15 项 Capability：

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

`现实闭环行动` 继续保持：

```text
DISCOVERY_DEFERRED
```

正式原则：

> **Capability 描述“DCF 能做什么”；Workflow、Go、PostgreSQL 与后续 P0 Backend 描述“这些能力如何运行”。**

因此 Workflow 不是第 16 个 Capability，也不拥有独立产品主权。

---

# 2. Workflow 是横切执行语义，不是全局强制容器

只有当一个过程具有下列特征之一时，才进入 Workflow：

```text
跨较长时间运行
等待模型 / 工具 / 用户 / 定时器
中途可能崩溃或进程退出
需要从确定位置恢复
需要动态分支 / 子流程 / fan-out / fan-in
需要显式记录长期执行进度
```

普通逻辑不因为 DBOS 存在就 Workflow 化。

例如：

```text
RenderCard()
ParseConfig()
FormatTitle()
一次性纯函数转换
```

默认仍然只是普通 Go 函数。

正式原则：

> **长期过程进入 Workflow；即时逻辑留在语言本身。**

---

# 3. 当前默认长期过程底座：DBOS Go + PostgreSQL

当前实现方向采用：

```text
Go
+
DBOS Go
+
PostgreSQL
```

DBOS 负责：

```text
Workflow identity
Step checkpoint
长期等待
失败恢复
队列 / 调度语义
版本化 Workflow 生命
```

PostgreSQL 负责 DBOS durable state，并作为新运行侧事务事实的默认候选底座。

这里冻结的是**架构方向**，不是“已经完成行为验证”。

当前状态必须写成：

```text
GO_DBOS_POSTGRES_ARCHITECTURE_SELECTED
BEHAVIOR_VERIFICATION_PENDING
```

在 workflow-kernel 行为实验通过前，禁止写成 `behavior_passed`。

---

# 4. PostgreSQL 的主权边界：不要静默吞并既有 SQLite Authority

此前 Cognition Data Facility 已验证：

```text
SQLite Authority
+
replaceable / rebuildable Derived Retrieval
```

本文**不静默推翻**该专项结论。

因此当前必须区分：

```text
DBOS / Workflow durability
→ PostgreSQL

新运行侧事务事实
→ PostgreSQL 优先候选

既有 Cognition Data Authority
→ 仍按原专项规范保留 SQLite Authority
→ 是否迁移 PostgreSQL 必须另开独立决策与行为实验
```

正式原则：

> **DBOS 选择 PostgreSQL，不等于所有历史数据权威自动改成 PostgreSQL。**

---

# 5. Go 的正式角色：默认执行宿主 + 未知问题退路

Go 当前承担两层职责。

## 5.1 默认应用执行宿主

利用 Go 原生 runtime 吸收已经成熟的通用机器执行问题：

```text
goroutine
M:N scheduling
I/O 并发
network poller
work stealing
普通多核执行
```

因此新的 P0 不应再次发明普通 worker pool、普通 goroutine scheduler 或普通 I/O multiplexing。

## 5.2 Universal Fallback（通用退路）

任何尚未证明值得专用机器化的问题：

```text
规模还小
Problem Signature 尚不稳定
没有成熟 P0
优化收益不确定
```

默认先用普通 Go 实现。

正式原则：

> **先让 Go 承担未知，再让 P0 吸收已知。**

这使 DCF 不需要为了未来可能出现的性能问题，提前接受某个全局机器世界观。

---

# 6. Late Machine Specialization：机器特化后置

机器优化采用：

> **Generic First → Evidence → Problem Signature → P0 Promotion**

默认路径：

```text
Workflow Step / Effect
        ↓
普通 Go implementation
```

只有同时满足下列条件，才允许晋升：

```text
1. 真实运行中形成重复稳定的同类问题
2. 已出现明确成本 / 延迟 / 吞吐 / 内存瓶颈
3. 问题具有可利用的同质性或稳定结构
4. 存在成熟 P0 候选或明确结构性实现优势
5. 引入后的净杠杆 > 新增接缝残差
```

可能出现的局部机器黑洞示例：

```text
大集合筛选
→ Roaring Bitmap 类 backend

列式 / 批量数据变换
→ Arrow / Columnar / SIMD 类 backend

LLM 推理
→ continuous batching inference engine

约束满足
→ Solver

关系 / 事务 / 结构化查询
→ PostgreSQL / SQL
```

以上只是问题岗位示例，不冻结具体第三方依赖。

---

# 7. Effect 不要求前期穷举

DCF 不建立一个必须在第一天闭合的 Effect Vocabulary（效应词表）。

允许初期只有：

```text
Workflow
→ Step
→ Go
```

随着真实系统生长，若大量 Step 显示出稳定共同问题，再显式抽出：

```text
SetSelection
BatchTransform
LLMInference
ConstraintSolve
...
```

然后为该 Effect 注册专用 backend。

正式原则：

> **Effect 分类也属于可演化结构；不得为了“未来优化”提前把所有业务强行分类。**

---

# 8. 不引入中央上帝优化器

当前不建立全局 Physical Optimizer（物理执行优化器），也不建立统一的 Machine Execution Fabric。

原因：

```text
DCF 不是完全随机的任意任务世界
上层本质仍是 Workflow
真实 Effect 类型会从实际功能中逐渐长出
多数 Effect 的最优 backend 可以在注册 / 实现时直接确定
```

如果同一 Effect 内部存在：

```text
小规模 → Go
大规模 → Arrow
热点集合 → Bitmap
```

这种选择，优先由该 Effect Handler 自己根据局部证据处理。

只有未来真实出现“跨多个 backend 的物理计划选择已经形成独立复杂度”时，才重新发现 Physical Optimizer 这一 P0 岗位。

---

# 9. 全局 ECS / Becsy World 不再是当前运行前提

2026-08-07 已完成的 Bun + Becsy / Capability World 实验继续保留：

```text
ARCHITECTURE_FEASIBLE
```

该实验仍然证明过：

```text
声明式共享状态可以减少私有调用链
读写声明可以吸收部分执行 precedence
Standalone / Composite 验证可以暴露组合接缝
```

但本文正式降级以下旧结论：

```text
“DCF 必须是一个全局 Becsy World”
“Capability 必须作为全局 ECS System 运行”
“Bun 是当前唯一默认核心宿主”
“为了未来机器优化，业务必须提前组件化”
```

当前裁决：

> **ECS 是局部机器结构候选，不再是 DCF 全局世界观。**

如果未来某类 Effect 天然符合：

```text
大量同质实体
稳定组件组合
批量 Query
连续数据布局
```

ECS 可以作为该局部 P0 Backend 重新进入。

但它不得切穿 Workflow 问题语义，也不得要求其他 Capability 为它提前改造数据模型。

---

# 10. Runtime Detachment：长期生命不绑定当前执行器

当前目标是形成：

```text
长期过程的身份 / 历史 / 恢复
≠
当前承载它的执行 Runtime
```

因此：

```text
Go process 可以替换
P0 backend 可以替换
机器可以替换
局部语言可以替换

但 durable Workflow 与事实历史不因此丢失
```

这是 DBOS + PostgreSQL 在 DCF 中的重要组合杠杆之一。

正式原则：

> **执行器是可替换载体；长期生命属于 durable process。**

---

# 11. UI 总原则：功能硬化，界面软化

UI 与 Capability 正确性彻底分层。

稳定层：

```text
Capability semantic contract
State / Action / Event
Workflow
Durable data
Surface semantic contract
```

可替换层：

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
具体视觉与交互方式
```

正式原则：

> **UI 不追求稳定实现，追求稳定边界。**

以及：

> **任何前端实现不得成为 Capability 正确性的组成部分。**

---

# 12. 禁止“伪自定义 UI”

DCF 明确禁止下列架构：

```text
表面允许：
颜色 / 圆角 / 卡片顺序 / 少量插件槽

实际禁止：
改导航结构
改 Panel 组织
改控件行为
改 Shell 布局
改交互模型
```

若一个 UI 元素因为被称为“系统 UI”“核心导航”“固定 Panel”而获得不可修改地位，判为架构违规。

正式要求：

> **UI 层没有不可替换组件。**

可以稳定的是语义接口，不可以稳定的是某个具体视觉实现。

今天可以是：

```text
左侧导航 + Panel
```

未来可以整体改成：

```text
Command Bar + Spatial Workspace + Context Rail
```

只要仍然满足相同 Capability / Surface 语义契约，后端不应因此重构。

---

# 13. 三种交互 Capability 与 UI 实现解耦

以下 Capability 身份继续成立：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

它们描述的是三种稳定交互空间 / 注意力带宽，而不是三个固定控件。

例如：

```text
全景沉浸交互
→ 当前可以由主页 / Workspace Shell 承载
→ 未来可以换成完全不同的沉浸式空间实现

嵌入式交互
→ 当前可以是侧边栏 / IDE Panel
→ 未来可以换成其他宿主嵌入方式

环境微交互
→ 当前可以是悬浮球 / 菜单栏
→ 未来可以换成其他低注意力 Surface
```

因此旧专项规范中被冻结的某些具体三列布局、Panel 形状、Sidebar 形态，只保留为**第一版产品设计来源**，不得反向成为不可替换架构约束。

---

# 14. Capability Surface Hot-Plug：能力热插拔优先于 Shell 热更新

沉浸式界面应能动态发现 Capability 的 Surface Contribution（界面贡献）。

最小语义至少包括：

```text
capability identity
surface kind
state projection
available actions
entry / route / mount descriptor
```

新增 Capability 时，目标体验是：

```text
Capability 注册
↓
Surface Host 发现
↓
相应入口 / 面板 / 交互投影出现
```

而不是修改沉浸式 Shell 的业务源码才能“认识”新能力。

这叫：

> **能力热插拔。**

它比要求 Shell 自身做复杂机器码 / JS VM 原地 Hot Reload 更重要。

---

# 15. UI 本体允许替换，不要求零帧 HMR

沉浸式 Shell 自己也必须可替换。

正式要求：

```text
前端 bundle 可以升级
Shell 可以整体换代
Panel 可以独立替换
Theme / Layout 可以实时更新
```

但不要求：

```text
所有组件必须在同一个 JS VM 中零帧原地替换
```

允许：

```text
soft reload
panel remount
frontend bundle replacement
重新连接后端
恢复 route / selected capability / 可持久 UI preference
```

只要：

```text
Go backend 不停
DBOS Workflow 不丢
PostgreSQL durable truth 不丢
Capability 行为不失效
```

即可判定 UI 更新能力成立。

正式原则：

> **架构上的可替换性，优先于技术炫技式 HMR。**

---

# 16. UI 投影与语义树分离

DCF 允许局部使用：

```text
DOM / 标准 Web 控件
Canvas
WebGL / WebGPU
自定义绘制
```

但视觉自由不得等于语义消失。

如果某一块使用自定义 Canvas，导致标准 Accessibility / AX 语义无法自动生成，则必须保留独立的语义模型或可映射的 Accessibility Projection。

目标结构：

```text
Capability / Surface Semantic Model
          │
     ┌────┴────┐
     ▼         ▼
Visual UI    AX / AI Semantic Projection
```

正式原则：

> **视觉树可以推翻；语义契约不能跟着消失。**

---

# 17. 前端可替换性验收

正式 UI 架构必须至少通过以下思想实验 / 行为测试：

## 17.1 Frontend Deletion Test

```text
删除整个 frontend 实现
↓
重新做一个极简 UI
```

若仍能通过稳定后端契约：

```text
发现 Capability
读取状态
执行 Action
观察 Workflow
读取 / 写入允许的数据
```

则前后端边界成立。

若发现业务正确性依赖：

```text
某个 Vue / React component 内部状态
某个 Panel 私有事件
某段 UI 代码才能完成业务事务
```

判为架构违规。

## 17.2 Shell Replacement Test

```text
Shell v1
→ 完整替换为 Shell v2
```

要求：

```text
Capability 不改
Workflow 不改
Durable schema 不因视觉改版被迫迁移
```

---

# 18. 当前必须验证的 Workflow Kernel

本文冻结架构方向，但 DBOS Go + PostgreSQL 尚需行为实验证明。

第一批验证至少覆盖：

```text
Step A 后杀进程
事务提交前杀进程
事务提交后杀进程
并行 Step 中途杀进程
Sleep / Wait 中杀进程
重新启动后继续
```

必须观察：

```text
是否重复执行外部副作用
数据库事实是否出现半提交
Step checkpoint 是否正确复用
Workflow 是否从正确位置继续
```

特别要求：

> **普通外部 Step 必须明确 at-least-once / 幂等边界；数据库 exactly-once 只能在受控事务边界中宣称。**

---

# 19. 第一阶段施工方向

Capability Discovery 不重新打开。

当前施工顺序调整为：

```text
Capability Registry v1 保持不变
↓
补齐 Go + DBOS + PostgreSQL workflow-kernel 行为验证
↓
以“全景沉浸交互”作为第一批正式 Surface / UI 边界实现之一
↓
验证 Capability Surface 动态发现 / 挂载
↓
验证 Frontend Deletion / Shell Replacement
↓
继续逐项关闭 Capability Envelope
```

机器 P0 不作为第一阶段前置条件。

如果当前 Go 实现没有真实瓶颈：

> **不做机器特化。**

---

# 20. 当前最高设计纪律

1. **Capability Registry v1 不因运行时重构重新 Discovery。**
2. **Workflow 是横切长期执行语义，不是新的 Capability。**
3. **长期过程进入 DBOS；即时逻辑留在 Go。**
4. **PostgreSQL 当前负责 DBOS durable state；不得据此静默改写既有 SQLite cognition authority。**
5. **Go 是默认执行宿主与未知问题退路。**
6. **先让 Go 承担未知，再让 P0 吸收已知。**
7. **机器优化按证据晋升，不提前建模未来。**
8. **不预先穷举 Effect；Effect taxonomy 允许随真实问题生长。**
9. **不建立全局 ECS，不建立中央上帝优化器。**
10. **P0 Backend 不拥有 durable truth，必须可替换、可回退。**
11. **旧 Bun+Becsy / ECS 实验保留为历史证据，不再拥有全局运行主权。**
12. **功能硬化，界面软化。**
13. **UI 层没有不可替换组件。**
14. **禁止伪自定义 UI；导航、Panel、控件、布局和 Shell 都允许推翻。**
15. **能力热插拔优先于 Shell 零帧热更新。**
16. **整个前端应允许删除重做而不破坏 Capability、Workflow 与 durable truth。**
17. **视觉可以自由；语义模型必须继续存在。**
18. **旧历史不静默覆写；架构变化通过新规范与 ADR 显式追加。**
