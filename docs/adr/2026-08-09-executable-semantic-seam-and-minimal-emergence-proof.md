# ADR — 可执行语义接缝、Standalone 最小实践与能力涌现证明

日期：2026-08-09  
状态：**Accepted**

本文在 `2026-08-07-capability-world-composition-runtime-seam-absorption.md` 的实验结论之上继续推进。

旧 ADR 保留 2026-08-07 当时的真实实验、证据状态和 Becsy 语境，不回写历史。本 ADR 记录后续讨论中对“overlap、Standalone、接口、组合验证和能力涌现”形成的更精确解释，并把它同步为当前架构要求。

---

# 1. 背景：旧实验真正证明了什么

2026-08-07 的最小实验已经证明：

```text
A Standalone PASS
B Standalone PASS

A / B 都能各自完整存在
↓
Composite World
↓
重复 Provider 运行权威收敛为一份
↓
A / B 源码不因组合修改

新增 C
↓
A / B 不修改
↓
EMERGENCE_PATH_PASS
```

同时证明：

```text
重复 Provider 可以保留在源码
重复运行权威必须被消除
Shared Semantic Component 的 Schema 与语义契约必须同时成立
Composer 可以保持很薄
读写关系可以吸收一部分执行接缝
```

后续继续讨论后发现，当时把“重叠”主要理解成“两个 Capability 都拥有一段真实业务能力”还不够准确。

更常见、更值得主动设计的重叠来自：

> **一个 Capability 为了能够脱离完整系统独立运行、调试和验收，不得不补齐本来应该由相邻 Capability 提供或消费的环境。**

因此，需要把“正式业务能力”和“Standalone 为自给自足而存在的边界脚手架”分开。

---

# 2. 决策一：Capability 独立完整，不等于复制整个依赖链

Capability 的正式业务实现必须保持独立意义、独立实现和独立验收。

但是：

> **独立完整不要求 Capability 把所有真实上游、下游业务重新实现一遍。**

例如：

```text
A provides X
B requires X
```

B 的正式职责就是消费 `X` 并完成自己的行为。

为了让 B 单独施工，不应该在 B 正式源码中复制一套 A：

```text
错误：
B Standalone
└─ 偷偷实现 A
   └─ X
      └─ B
```

正确结构是：

```text
B Standalone
└─ 由 X 的可执行边界补齐缺失环境
   └─ B
```

因此：

> **Capability 独立完整 = 真实依赖缺席时，标准 Standalone Environment 能在契约边界补齐它所需要的世界状态。**

---

# 3. 决策二：Seam First——两边不各自定义 Mock，而共同拥有一个接缝工件

A 的输出脚手架与 B 的输入脚手架不应该是两份独立实现。

如果：

```text
A provides X
B requires X
```

那么 A 与 B 之间只定义一份：

> **Executable Semantic Seam X —— 可执行语义接缝 X。**

它像一个双向插头：

```text
Capability A
      │
      ▼
┌────────────────────┐
│ Semantic Seam X    │
└────────────────────┘
      │
      ▼
Capability B
```

对 A 而言，它呈现 B 的边界切面：

```text
A → X
```

它可以接住、验证 A 的真实输出。

对 B 而言，它呈现 A 的边界切面：

```text
X → B
```

它可以提供 B 真正需要的合法输入。

两边引用的是同一个语义对象，不允许分别维护：

```text
AOutputMock
BInputMock
```

然后依赖人工保证二者“差不多”。

正式原则：

> **Capability 之间不分别定义彼此兼容的接口；双方共同引用同一个可执行语义接缝。**

---

# 4. 决策三：Seam 不是 Public Facility，也不是新的 Capability

Executable Semantic Seam 不得因为被多处复用，就被误升格为 Public Facility 或产品 Capability。

三者职责不同：

```text
Capability
→ 用户可感知、可独立成立的产品能力

Public Facility
→ 多个 Capability 共同依赖的低业务语义专业设施

Executable Semantic Seam
→ Capability 边界本身的共享语义、最小实践与可执行证明工件
```

Seam 的存在理由不是“系统缺一个公共服务”，而是：

> **两侧必须对同一条边界事实、状态、关系或行为达成一个机器可执行的共同定义。**

禁止因为出现 Seam，就把 Capability 正式业务拆成大量“公共小能力”。

---

# 5. 决策四：先做 Seam，本质上是先冻结边界契约

Capability 正式施工前，优先定义它与世界之间的最小稳定边界。

Seam 至少必须说明：

```text
业务语义
数据形状
合法输入 / 输出条件
来源与证据要求
生命周期
权威 / Provider policy
读写语义
基数与组合规则
错误与拒绝条件
```

但接口先行不等于抽象先行。

只允许定义当前 Capability 为完成真实行为已经明确需要的**最小语义表面**。

禁止为了“以后可能有用”提前设计庞大 Schema、万能 Event、Common DTO 或未来扩展字段。

正式原则：

> **边界先行，抽象后验。**

---

# 6. 决策五：Seam 必须携带最小真实实践，而不是任意 Mock

Executable Semantic Seam 不能只包含：

```text
Schema
+
随机假数据
```

它必须拥有保持真实业务语义的**最小可执行实践（Minimal Realization）**。

“最小”允许削减：

```text
数据规模
状态空间
并发规模
外部环境
持续时间
```

但不得削掉：

```text
业务语义
真实判定规则
合法性条件
关键状态变化
因果方向
证据要求
```

例如，正式系统可能处理十万条活动、多个项目、长期数据库和复杂并发；Seam 的最小实践可以只处理：

```text
1 条真实格式活动
1 个项目
1 条确定关系
内存状态
```

但形成 `ActivityMaterial`、`ProjectRelation` 等语义时使用的规则必须是真规则，而不是把它们降级成一个字符串或 nonce。

因此：

> **最小实践削减规模，不削减语义。**

---

# 7. 决策六：Seam 的运行角色由拓扑自然推导

同一个 Seam 不维护多套接口定义。

它根据当前两侧是否存在真实参与者，自动呈现不同运行角色。

## 7.1 缺上游：Source

```text
[无真实上游]
      ↓
Semantic Seam X
      ↓
Capability B
```

Seam 使用自己的最小真实实践生成合法输入，让 B 独立运行。

## 7.2 缺下游：Sink / Probe

```text
Capability A
      ↓
Semantic Seam X
      ↓
[无真实下游]
```

Seam 接收真实输出，以同一契约验证、记录并暴露给 Probe。

## 7.3 两侧都有真实参与者：Pass-through

```text
Capability A
      ↓
Semantic Seam X
      ↓
Capability B
```

此时 Seam 不再模拟任一 Capability。

它只保留必要的：

```text
契约约束
验证
观测
追踪
```

正式生产路径允许把这些成本进一步编译掉或降到最低。

核心原则：

> **模式不是人工配置出来的，而是连接拓扑的自然结果。**

---

# 8. 决策七：Standalone 重叠允许存在，但 Composite Runtime 必须只有一份真实运行权威

旧实验“允许重复代码、禁止重复运行权威”的原则继续成立，但解释进一步收紧。

重复来源可能包括：

```text
Capability 自己保留的 standalone-only provider
标准 Seam / Fixture 的最小实现
其他为了独立证明而存在的边界实现
```

这些可以存在于源码和验证工件中。

一旦进入 Composite Runtime：

```text
真实 Provider 存在
↓
Standalone 实现自动退出
↓
同一 single-provider 语义只允许一个实际运行权威
```

必须满足：

1. 不修改 A 源码；
2. 不修改 B 源码；
3. 不新增 AB 专用 Adapter / Bridge / Mapper / Controller；
4. 重复实现可以保留在源码；
5. 重复实现不得同时成为正式运行权威；
6. multiple authoritative providers 必须在运行世界创建前拒绝。

正式原则：

> **允许验证层重复，不允许正式运行层重复权威。**

---

# 9. 决策八：Composition Compiler 是通用编译器，不是业务 Glue

DCF 允许一个极薄、通用的 Composition Compiler / World Composer。

输入：

```text
Capability manifests
+
Executable Semantic Seam contracts
+
目标 Capability / 目标能力集合
+
Provider policies
```

输出：

```text
唯一运行 Provider 解析
有效 Systems / Components / Relations
执行依赖 / Schedule constraints
错误组合拒绝
```

它不得：

```text
转换具体业务字段
理解 Narrative 内容
持有业务状态
按 Capability pair 编写 case-by-case glue
修复语义不兼容
成为 Workflow Engine
```

健康指标仍然是：

> Capability 数量增长时，Compiler 核心算法应基本稳定；增长的主要是声明和契约数据，而不是 AB、AC、BCD 等专用组合代码。

---

# 10. 决策九：Becsy 是历史证明载体，不是当前语义的唯一实现

2026-08-07 的 Becsy 实验继续作为有效历史证据。

但后续分析确认：

```text
Provider 收敛
→ 主要来自 DCF 的 Composition 层

共享 World / Component / Query / Scheduler
→ 来自 ECS Runtime

执行顺序推导
→ 可由 Runtime 原生完成，或由通用 Compiler 根据 requires/provides、reads/writes 生成
```

因此这套业务模型不是 Becsy 私有能力。

当前硬需求是：

> **任何正式 Ordinary Backend Runtime 都必须能够在一个通用、非业务化的薄组合层帮助下，完整保留 Standalone、唯一运行权威、共享世界、低接缝组合和能力涌现这些性质。**

具体 ECS Runtime 可以替换。

Bevy ECS、Flecs 等成熟 ECS 当前都在理论上存在完整实现路径；后续选型无需再次证明“ECS 是否原则上能做到”，只需比较哪一个更符合 DCF 的运行时、动态性、并行和工程成本要求。

---

# 11. 决策十：能力涌现先在 Seam-only World 中做最小真实证明

能力涌现不应一开始就要求把多个完整程序全部启动。

若一个候选组合包含：

```text
A ─ X1 ─ B ─ X2 ─ C ─ ... ─ X25 ─ Z
```

为了验证组合是否在真实语义上成立，可以先移除完整 Capability，只保留对应的 Executable Semantic Seams：

```text
X1 ─ X2 ─ X3 ─ ... ─ X25
```

两端因为缺失真实邻居，自动启用最小真实 Source / Sink；中间边界使用各自的最小真实实践与同一语义契约完成连接和验证。

此时不发送无业务意义的随机字符串作为最终证明，而使用：

> **满足起点真实语义的最小输入，并要求终点 Probe 得到满足终点真实语义的预期结果。**

如果成立：

```text
MINIMAL_EMERGENCE_PASS
```

它证明：

> **这组边界语义和最小真实行为组合后，已经能够产生一个缩小到最低规模、但业务语义真实的新能力。**

它不是完整生产验收，但也不只是“线路能传 token”的结构测试。

---

# 12. 决策十一：建立三层能力组合证明

以后必须区分三种证据强度。

## Level 1 — Constraint / Contract Composition

只根据：

```text
requires / provides
semantic contract
provider policy
cardinality
lifecycle
read / write constraints
```

判断候选图在逻辑上是否可满足。

它证明：

> **理论组合闭合。**

## Level 2 — Minimal Emergence Proof

运行 Seam-only / Minimal Realization World。

它证明：

> **真实业务语义在最小规模下能够沿候选组合发生，并产生预期结果。**

## Level 3 — Full Runtime / Behavioral Proof

把真实 Capability、真实 I/O、真实存储、真实并发、真实模型和真实外部环境接回。

它证明：

> **完整现实实现兑现了前两层已经证明的组合。**

禁止用 Level 1 或 Level 2 冒充 Level 3。

---

# 13. 决策十二：Solver 优先在可执行边界空间探索，而不是直接理解完整程序

Executable Semantic Seam 将复杂程序压缩成求解器可处理的结构：

```text
Capability Manifest
+
Seam Contract
+
Minimal Realization
+
Constraints
```

Solver 可以低成本搜索：

```text
哪些能力可以闭合
哪些 Provider 冲突
哪些依赖缺失
哪些组合形成环
哪些组合满足目标输出
哪些新能力只缺一个最小语义缺口
```

推荐漏斗：

```text
大量候选组合
↓
Constraint Solve
↓
少量合法候选
↓
Minimal Emergence Proof
↓
少量真实成立候选
↓
Full Runtime Proof
```

因此：

> **影子世界负责便宜探索“什么能够成立”；真实世界负责昂贵证明“完整实现真的成立”。**

---

# 14. 决策十三：Seam 在运行故障时负责显影断裂边界

Executable Semantic Seam 的价值不止存在于设计、Standalone 和组合验证阶段。

因为同一个 Seam 在正式运行中本来就知道自己的两侧是否存在真实参与者，所以当真实链路发生**硬掉线 / 拓扑断裂**时，它可以自然从 Pass-through 角色退回 Source 或 Sink / Probe 角色。

例如正常链路：

```text
A ─ X1 ─ B ─ X2 ─ C
```

如果 B 整体失联：

```text
A ─ X1   ×   B   ×   X2 ─ C
```

那么两侧 Seam 会得到互补观察：

```text
X1
→ downstream_missing = B
→ 从 Pass-through 退为 Sink / Probe

X2
→ upstream_missing = B
→ 从 Pass-through 退为 Diagnostic Source
```

X2 此时允许启动自己的 Minimal Realization，向下游发出一个**语义真实但诊断来源显式**的最小实践。

这样做的目的不是让系统假装 B 仍然正常，而是：

> **让故障后的剩余链路继续携带一个可识别的最小真实信号，从而观察故障之后的下游是否仍然成立，并把断裂位置显影出来。**

因此，Minimal Realization 应主动朝“易诊断、易追踪、易显影”的方向设计，而不是只满足“随便产生一个合法值”。

推荐至少携带可机器识别的诊断来源：

```text
semantic_payload = 合法的最小真实业务值
provenance = synthetic_diagnostic
seam_id = X2
reason = upstream_missing
expected_provider = B
trace_id = ...
observed_at = ...
```

其中：

```text
semantic_payload
→ 必须继续满足该 Seam 的真实业务语义

synthetic_diagnostic provenance
→ 必须明确说明它不是现实 Provider 的正式业务产物
```

正式原则：

> **Seam 在正常状态负责连接；在断裂状态负责显影。**

## 14.1 硬掉线可以由相邻 Seam 自动夹逼故障位置

如果某个 Capability 整体消失，其前后两个 Seam 通常能够形成一对互补证据：

```text
上游 Seam：下游端消失
下游 Seam：上游端消失
```

二者共同出现时，可以把故障范围直接夹逼到这个 Capability 或其连接边界，而无需先从全局日志中猜测。

如果只有一侧链路断裂，则只有对应一侧 Seam 改变角色，故障范围仍可以缩小到该连接边界。

因此运行时可以把 Seam 的拓扑角色变化本身作为一等诊断事实：

```text
PASS_THROUGH
→ SOURCE_DIAGNOSTIC

PASS_THROUGH
→ SINK_DIAGNOSTIC
```

这类变化必须可观察、可追踪、可关联，而不能静默发生。

## 14.2 Diagnostic Minimal Realization 只能显影故障，不能掩盖故障

这是硬约束。

Seam 在真实 Provider 缺失时产生的最小实践，不得静默冒充真实数据继续进入正式事实链。

禁止：

```text
真实采集 / Provider 已掉线
↓
Seam 自动补最小实践
↓
上层把它当真实世界事实持久化
↓
用户看到“系统仍然正常”
```

必须：

```text
Minimal Realization
=
真实语义
+
显式 synthetic_diagnostic 来源
+
不可冒充正式事实权威
```

对于 DCF 的 Reality Canon、Evidence、用户确认事实等硬事实层：

> **Diagnostic Minimal Realization 不得在没有显式转换与证据标记的情况下写入正式事实。**

它的职责是保持**诊断链路**活着，而不是保持**业务假象**活着。

## 14.3 半故障 / 软故障不能靠拓扑角色切换自动接管

另一类故障是：

```text
A → X1 → B → X2 → C
```

B 的连接仍然存在，但内部行为已经异常，例如：

```text
收到输入但不产生输出
产生非法输出
死锁
内部规则执行错误
超时
状态损坏
```

此时 X1、X2 从拓扑看仍然“两端连接”，因此 Seam **不得仅凭猜测自动切换到 Minimal Realization 并替代 B**。

否则可能把真正的业务故障掩盖掉。

这时 Seam 的职责退回为边界观测点：

```text
X1
→ 记录：合法输入已经进入 B

X2
→ 记录：对应输出缺失 / 非法 / 未在契约允许窗口出现
```

如果两侧证据能够关联，就可以把故障范围从“整条系统链”缩小为：

> **B 的内部行为或 B 与相邻边界之间。**

然后由 B 自身的：

```text
错误状态
健康检查
内部诊断
结构化日志 / trace
行为断言
```

继续下钻。

因此形成清晰分工：

```text
拓扑断裂 / 真实端消失
→ Seam 自动显影并可启用 Diagnostic Minimal Realization

连接仍在但行为错误
→ Seam 负责夹逼故障边界
→ Capability 自身负责解释内部故障
```

“无输出”是否构成异常必须由具体 Semantic Contract 的时序、基数和生命周期规则决定，不能由 Seam 使用统一固定 timeout 粗暴判断。

## 14.4 最小实践因此同时承担四个阶段的同一份真值

Minimal Realization 不再只是测试夹具。

它在不同阶段承担的是同一份最小真实语义：

```text
设计期
→ 把边界语义做成可执行对象

Standalone 施工期
→ 补齐缺失环境

能力组合探索期
→ 组成 Minimal Emergence Proof

运行故障期
→ 在真实端消失时形成 Diagnostic Minimal Realization，显影断点并测试剩余链路
```

因此最小实践的长期设计目标应该同时满足：

```text
业务语义真实
规模足够小
来源可识别
传播可追踪
故障时易显影
不得冒充现实事实
```

这使 Seam 成为一种长期存在的**可执行边界真值 + 运行诊断测试点**，而不是完成单元测试后即可丢弃的 Mock。

---

# 15. 施工纪律

以后逐项 Capability 施工，默认顺序调整为：

```text
1. 明确 Capability 的独立用户行为
2. 明确 requires / provides
3. 识别与相邻世界的 Semantic Seam
4. 先定义最小共享语义契约
5. 为 Seam 实现最小真实实践与 Probe
6. 用 Seam 补齐缺失环境，使 Capability Standalone PASS
7. 实现 Capability 自身正式业务
8. Composite Runtime 解析真实 Provider，自动退出 standalone-only 实现
9. Capability 源码不因组合修改
10. 对候选组合先运行 Minimal Emergence Proof
11. 通过后再进入完整现实组合验收
```

如果新增 Capability 必须修改旧 Capability，或者必须新增专用：

```text
AtoBAdapter
ABCController
CapabilityPairMapper
```

默认视为架构警报，应先检查是否存在：

```text
未显式化的共享语义
错误 Capability 边界
泄漏的内部数据结构
缺失的 Provider policy
Composer 业务化
```

---

# 16. 错误组合与负控制

以下必须继续作为常设拒绝条件：

## 16.1 语义假重叠

```text
Schema 相同
但语义 / 来源 / 证据 / 生命周期不同
→ REJECT
```

## 16.2 多运行权威

```text
single-provider Seam
同时存在多个 authoritative providers
→ REJECT
```

## 16.3 Fixture 泄漏到正式运行

```text
已有真实 Provider
但 standalone-only Minimal Realization 仍参与正式业务写入
→ REJECT
```

## 16.4 Mock 冒充最小真实实践

```text
只传字符串 / nonce
却声明 MINIMAL_EMERGENCE_PASS
→ REJECT
```

允许 token continuity test 作为诊断工具，但不得冒充最小真实能力涌现证明。

## 16.5 Diagnostic Minimal Realization 冒充现实事实

```text
provenance = synthetic_diagnostic
却被当作真实 Provider 产物写入 Reality Canon / 正式 Evidence
→ REJECT
```

故障显影数据必须保持来源标签和证据层级，不得通过“系统仍能产生合法 Schema”来掩盖真实 Provider 已失效这一事实。

---

# 17. 对旧 ADR 的关系

本 ADR **不删除** 2026-08-07 的结论：

```text
Capability 保完整
Component 承语义
Composer 选能力
World 定运行
```

它把这句话推进为：

```text
Capability 保持业务独立
Seam 先冻结共享边界
Standalone 用最小真实实践补齐环境
Composite 收敛唯一运行权威
Runtime 用共享 World 吸收执行接缝
Solver 在 Seam World 中探索组合
Seam 在运行断裂时显影故障边界
真实世界做最终兑现
```

旧 ADR 中 Becsy、Bun、Standalone Provider 的具体实现属于当时实验载体；本 ADR 冻结的是更一般的业务语义与施工方法。

---

# 18. Non-decisions

本 ADR 没有决定：

- 最终采用 Bevy ECS 还是 Flecs；
- Ordinary Backend 最终使用哪种语言；
- PostgreSQL 与 ECS Active World 的具体同步边界；
- Surface Contract 的具体传输协议；
- Solver 的最终技术实现；
- 所有 Capability 都必须线性串联；
- 所有业务转换都必须放进 Seam；
- Seam 可以取代完整现实验收；
- Seam 可以自动解释 Capability 内部软故障；
- 所有普通代码都必须写成 ECS System。

---

# Final Principle

DCF 对 Capability 组合的当前正式原则：

> **先把 Capability 边界做成同一份可执行语义接缝；Standalone 时由接缝的最小真实实践补齐缺失环境，Composite 时真实 Provider 自动取得唯一运行权威；多个接缝可以脱离完整程序组成最小真实能力世界，供 Solver 和 AI 低成本探索能力组合与涌现；正式运行发生拓扑断裂时，同一份 Seam 又作为诊断测试点显影故障边界，但不得用诊断最小实践冒充真实业务事实；最终仍由完整现实运行证明兑现。**

压缩表达：

> **Seam First；最小实践保真；组合自动收敛；影子世界探索；断裂自动显影；真实世界兑现。**