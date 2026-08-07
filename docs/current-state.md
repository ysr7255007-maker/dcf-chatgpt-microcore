# DCF Current State

Updated: 2026-08-07

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

2026-08-07 的架构变化改变的是**功能怎样组合、运行和施工**，不是这些价值。

---

# 2. 当前正式架构语言

当前正式构件：

```text
Capability（能力）
→ 拥有稳定用户目的与产品主权的完整软件能力

Public Facility（公共设施）
→ 吸收多个 Capability 重复专业工程复杂度的低业务语义设施

Provider / Probe（提供者 / 探针）
→ 把具体外部系统、模型、Agent、来源接入稳定公共契约

Shared Semantic Component（共享语义组件）
→ 多个 Capability 共同认识的真实世界状态

ExternalOperation（外部操作）
→ World 外异步执行在 World 内的统一生命周期身份

Becsy World（运行世界）
→ Capability 共同参与并推进的统一运行现实

Bun
→ 当前宿主层一体化 JavaScript / TypeScript 运行时
```

核心原则：

> **Capability 看产品主权，不看独占代码量。**

> **重复代码允许存在；重复运行权威不允许存在。**

> **执行位置可以在 World 外；运行身份必须在 World 内。**

---

# 3. Capability Discovery 已正式收口

当前最高权威：

```text
docs/spec/2026-08-07-DCF-Capability-Registry-v1与能力发现收口规范.md
```

本轮开放式 Capability Discovery（能力发现）已经关闭。

当前结果：

```text
Capability Registry v1：15 项
Discovery 暂缓：1 项
下一阶段：逐项关闭 Capability Envelope（能力包络）
```

能力身份不再要求拥有大量独占底层机制。

当前判断门禁：

```text
稳定用户目的
产品主权
独立产品身份
独立验收
四刀净化后的职责边界
```

“去 DCF 测试”继续成立，但解释为：

> **去掉 DCF 品牌以后，这个用户目的是否仍然是可以独立命名、使用和验收的软件能力。**

而不是“去掉所有公共设施后还能不能自己实现所有底层机制”。

---

# 4. 原生能力与涌现能力

当前正式承认：

```text
原生能力
→ 直接对应一个独立问题闭环

涌现能力
→ 公共设施、共享语义、配方、查询、交互等组合后形成新的稳定产品目的
```

两者在 Registry 和运行时地位相同。

因此：

> **能力独立性 ≠ 实现独立性。**

> **四刀法用于净化 Capability 的职责，不用于按实现厚度否定产品。**

当前两条额外独立性证据：

```text
跨多个 Capability 被产生 / 消费 / 引用后仍保持同一业务身份
→ 强独立性证据

稳定高频使用 + 独特交互节奏
→ 可以形成产品重力
```

Wiki、知识卡、语言弹药据此继续保留独立 Capability 身份。

---

# 5. 三条复杂度切线

## ECS（实体组件系统）切线

主要吸收：

```text
谁通知谁
谁订阅谁
谁把结果交给谁
一对多 / 多对一分发
状态交接
UI 贡献发现
权限 / 审核交接
诊断共享
恢复需求发现
```

正式原则：

> **上游不指定消费者；下游不指定生产者；双方围绕共同理解的世界状态和产物语义发生关系。**

> **关系不是“谁订阅谁”，而是“谁认识同一种现实”。**

---

## Becsy World（运行世界）切线

主要吸收：

```text
系统生命周期
系统启停
运行身份
组件读写形成的大量执行先后
坏组合启动前拒绝
统一活动 Provider 运行权威
ExternalOperation 生命周期
```

当前理解：

> **DCF 是一个 World；Capability 是共同参与并推进这个 World 的系统。**

World 不替代长期权威数据库与历史存储。

---

## Bun 切线

当前采用 Bun-first Host（Bun 优先宿主）原则：

> **Bun 已稳定原生提供的宿主层通用工程能力，默认先直接使用；只有出现明确不足证据才新增替代层。**

优先覆盖：

```text
子进程
HTTP
WebSocket
IPC / PTY
SQLite 驱动
测试
构建
单文件部署
常规文件 / 定时机制
```

Bun 只吸收宿主工程，不定义 DCF 业务世界。

---

# 6. Capability Registry v1

当前已登记 15 项：

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

这些能力的**产品身份已经承认**，但不等于 Envelope 已关闭，也不等于已经实现或验收。

当前详细产品主权、形成方式与边界见 Registry v1 权威规范。

---

# 7. 三种交互能力

旧候选名：

```text
能力主页
上下文侧边栏
环境悬浮球
```

已经降级为当前 Surface（界面载体）名称。

当前 Capability 名称：

```text
全景沉浸交互
嵌入式交互
环境微交互
```

## 全景沉浸交互

当用户主动把主要注意力交给 DCF 时：

```text
自动发现 Capability
收集状态 / 健康 / 产物 / 动作
归纳 / 组织
形成能力交互投影
提供完整浏览 / 搜索 / 配置 / 管理 / 操作 / 诊断
```

当前典型 Surface：主页。

## 嵌入式交互

把 DCF 的部分信息与操作嵌入其他宿主工作空间，与原工作并存。

筛选可以来自：

```text
用户固定配置
手动钉住
当前任务
当前项目
上下文匹配
其他规则
```

“上下文相关”不是能力定义。

当前典型 Surface：侧边栏 / IDE 面板 / 浏览器面板等。

## 环境微交互

不占据工作空间，以极低信息量和极短操作路径长期存在于环境中。

当前典型 Surface：悬浮球 / 菜单栏状态等。

三者不是三个 UI 控件，而是三种稳定的交互空间与注意力带宽。

---

# 8. 现实闭环行动：暂缓

`现实闭环行动` 当前状态：

```text
DISCOVERY_DEFERRED
```

原因：

```text
当前讨论最少
潜在边界最广
会同时触及执行、权限、风险、副作用、现实观察、效果验收、失败、补偿、人工介入、因果归属等问题
```

当前只保留 E5 已验证不变量：

> **Agent 执行状态 ≠ 现实效果。Agent 负责劳动；现实负责验收。**

暂不冻结：

```text
最终名称
完整 Capability 边界
Reality Verifier 是否独立公共设施
完整状态机
施工结构
```

本阶段不进入 Envelope 与施工。

---

# 9. 已完成的架构实验

## Capability × Bun+Becsy World 组合实验

ADR：

```text
docs/adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md
```

裁决：

```text
ARCHITECTURE_FEASIBLE
```

已验证：

```text
Capability 可以在 Standalone World 独立成立
共享语义组件表达真实重叠
Composite World 只保留一个 active provider
Becsy 根据组件访问形成执行先后
无业务适配器 / 映射器 / 桥接器
新增 Capability 不要求修改旧 Capability
坏组合启动前拒绝
```

---

## 公共设施消歧实验 E0–E5

远端实验分支：

```text
experiment/prebuild-public-facilities-v1
```

完整证据基准：

```text
159d579d586934bd798d36f62bc7f48faef2a8bf
```

报告元数据修订：

```text
2959fd0c55009110c50c5eb1ce1f0da89badc439
```

总体裁决：

```text
READY_WITH_EXPLICIT_EXCEPTIONS
```

六项实验：

```text
E0 WORLD_EXTERNAL_OPERATION_PASS
E1 ACP_STANDARD_CORE
E2 AI_SDK_CORE_ADOPT_WITH_THIN_DCF_LAYER
E3 SQLITE_AUTHORITY_PLUS_LANCEDB_DERIVED
E4 BORROW_PATTERNS_BUILD_THIN_INTAKE
E5 E5_REALITY_LOOP_PASS
```

仍有 7 项非阻塞 finding：

```text
CJK_FTS_TOKENIZER_PENDING
PERMISSION_EXERCISE_INSUFFICIENT
TOOL_EVENT_COVERAGE_PARTIAL
E4 B/C 只有 structural assessment
LanceDB teardown / handle lifecycle
Codex custom-provider / ACP model enumeration 兼容缺口
SECOND_PROVIDER_LOCAL_ONLY
```

不得在正式实现报告中写成“全部解决”。

---

# 10. 已收敛的公共设施

当前已被实验支持的核心公共设施：

```text
Evidence Intake Facility（证据接入公共设施）
AI Turn Facility（AI 单轮调用公共设施）
Agent Execution Facility（Agent 执行公共设施）
Cognition Data Facility（认知数据公共设施）
World / ExternalOperation runtime（运行设施）
```

当前重要结构：

```text
AI Turn
→ Vercel AI SDK Core + 薄 DCF 语义层

Agent Execution
→ ACP + 薄 DCF Agent 语义

Cognition Data
→ SQLite 权威层 + 可替换 / 可删除 / 可重建的派生检索层

Evidence Intake
→ 借鉴 Home Assistant 生命周期、OpenTelemetry 确认 / 时间语义、Redpanda 游标 / 检查点
```

公共设施只吸收重复专业机制，不拥有个人叙事、Wiki、项目叙事等上层产品意义。

---

# 11. 当前专项能力边界

证据链前两个 Capability 的专项规范：

```text
docs/spec/2026-08-07-DCF-证据采集与多源证据编译增量规范.md
```

当前已经收敛：

```text
证据源采集管理
→ 输入侧复杂度

多源证据编译
→ 已到达证据的输出侧确定性加工
```

两者以及后续 Capability 优先通过 ECS 公共语义状态与声明匹配组合，而不是私有调用链。

---

# 12. 当前施工状态与下一步

Capability Registry 身份与 Envelope 施工状态正式分离。

建议施工状态：

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
```

暂缓 Discovery：

```text
DISCOVERY_DEFERRED
```

当前正确顺序：

```text
Capability Registry v1
↓
选择一个已登记 Capability
↓
关闭 Capability Envelope
↓
冻结 Shared Semantic requires / provides
↓
冻结 Public Facility 依赖 / Provider / fallback
↓
冻结用户可观察行为、失败语义和验收
↓
Standalone World
↓
Composite World
↓
正式实现与行为验收
```

不再继续开放式 Capability Discovery，也不先人工重画大 DAG。

---

# 13. 当前最重要的设计纪律

1. **Capability 看产品主权，不看独占代码量。**
2. **原生能力与涌现能力运行地位相同。**
3. **四刀净化职责：ECS 切关系、World 切运行、Bun 切宿主、Public Facility 切重复专业机制。**
4. **上游不指定消费者；下游不指定生产者；通过共享世界状态声明匹配。**
5. **World 管当前运行现实，长期权威历史留在持久层。**
6. **不要让第三方轮子定义 DCF 世界。**
7. **不要让不确定 AI 做确定机制已经能做的事。**
8. **功能可以增加，运行权威和接缝不能同比增加。**
9. **Registry 身份 ≠ Envelope 已关闭 ≠ 已实现 ≠ 已验收。**
10. **现实闭环行动本阶段暂缓，不为了 Registry 数量完整而强迫成熟。**
11. **旧认知与旧设计保留为历史；新裁决通过显式版本追加，不静默改写过去。**
12. **面向用户判断与架构选择的文档，中文优先；必须保留英文原名时，第一次同时给出中文含义。**
