# ADR: Capability 独立世界、共享语义 Component 与运行时接缝吸收

Date: 2026-08-07  
Status: accepted design decision; implementation authority pending synchronization into current specs

## Context

DCF 在进入正式 Capability 施工前，需要回答一个比“模块怎么拆”更基础的问题：

> 如何让每个功能既能独立实现、独立证明，又不会因为独立性在正式运行时付出重复执行、双写、胶水层和深层调用网的代价？

早期拆分把 Capability 理解成 DCF 内部责任节点，容易产生两个问题：

1. 节点虽然边界清楚，但脱离 DCF 后没有独立存在意义；
2. 为了让相邻节点自包含，必须在边界附近重复实现一段功能，随后又需要额外“融合”代码来消除重复。

进一步讨论后形成了新的拆分标准：

- Capability 必须脱离 DCF 语境仍然能解释自己为什么值得存在；
- Capability 不是最终源码模块，而是一个完整、可独立实现和验收的行为窗口；
- 相邻 Capability 为了各自完整，可以有真实功能重叠；
- 输入 / 输出不是人工插入的接口壳，而是 Capability 对世界状态的理解，因此天然属于重叠区的一部分；
- 未来任务涌现不能只依据“输入输出能对上”，还必须拥有共同工程体质和可证明的重组表面。

这把架构问题反向推到共同运行体质上：所有正式 Capability 应当能够在 Bun + Becsy 的独立 World 中完整运行，同时在组合时进入同一个 Composite World。

2026-08-07 的最小实验进一步验证了这一设想。

---

## Decision 1 — Capability 是脱离 DCF 仍然成立的完整软件能力

正式 Capability 不再定义为“DCF 流程中的一段内部责任”。

它必须同时满足：

1. **独立意义**：删除 DCF 语境后，仍能用普通软件需求解释为什么值得存在；
2. **独立实现**：不给它另一个 Capability 的内部实现，也能完成自己的完整行为；
3. **独立验收**：能够在自己的 Standalone World 中被单独证明；
4. **可重组**：能够通过与其他 Capability 共同认识的世界状态进入新的组合。

例如，“Mac 活动记录”不是“现实证据采集层”，而是：

> 自动收集 Mac 系统活动与用户操作痕迹，并整理成人可以直接阅读、回溯和核验的电脑使用记录。

因此，Capability 的名字和意义应优先使用独立产品语言，而不是 DCF 内部架构术语。

---

## Decision 2 — 每个 Capability 以 Standalone Bun + Becsy World 证明完整性

每个 Capability 必须能够独立生成一个最小 Becsy World：

```text
Capability A
└─ Standalone World
   ├─ 自己取得或构造所需输入
   ├─ 自己完成核心处理
   ├─ 自己形成有意义输出
   └─ 自己通过验收
```

Standalone World 是**证明形态**，不是正式产品要求同时运行大量隔离 World。

正式运行时采用 Composite World。

因此：

```text
Capability World = 独立施工 / 独立验收形态
Composite World  = 正式组合运行形态
```

Bun + Becsy 是共同工程体质，不意味着所有业务代码都必须 ECS 化。

SQLite、Solver、AI、macOS 原生能力等仍可作为 Capability 内部的专用实现或薄 Provider；World 保持功能运行主权。

---

## Decision 3 — 重叠首先是共同业务语义，不是人为接口

两个 Capability 如果为了自身完整性都必须理解同一段世界状态，这段共同状态就是真实 overlap。

例如：

```text
Activity Recorder
      ↓
ActivityMaterial
      ↓
Activity Narrative
```

`ActivityMaterial` 不是为了连接两个模块才制造的 DTO。

它表示一个独立业务事实：

> 一段机器活动已经被整理成可理解、带时间、带来源、可以重新核验的操作材料。

因此：

> 接口属性来自重叠语义；机器接口只是共享语义的编码形式。

Shared Semantic Component 必须同时拥有：

```text
数据形状
+
语义契约
```

Schema 可赋值不代表语义可组合。

---

## Decision 4 — 允许重复代码，禁止重复运行权威

为了证明独立性，相邻 Capability 可以各自实现同一 overlap。

例如：

```text
World A
Source A → ActivityMaterial

World B
Source B → ActivityMaterial → Narrative
```

A、B 必须分别独立 PASS。

但是进入 Composite World 后，不要求删除或重构其中一份实现，而是解析该 World 中实际有效的 Provider：

```text
Composite World

Source A
   ↓
ActivityMaterial
   ↓
Narrative
```

B 的 standalone provider 仍保留在源码中，但不被加载。

核心原则：

> **重复代码允许存在；重复运行权威不允许存在。**

这使 Capability 可以永久保持源码级完整，而正式运行路径不承担双写和重复执行成本。

---

## Decision 5 — 默认不再做源码级 Capability Fusion，而做 World Composition

此前的候选流程是：

```text
A 独立实现
B 独立实现
↓
发现 overlap
↓
融合两份重复实现
↓
重新验收 A / B
```

现在默认流程改为：

```text
A Standalone PASS
B Standalone PASS
↓
确认真实 Shared Semantic Component
↓
Composite World 选择唯一 Provider
↓
Becsy 调度共享状态上的 Systems
↓
重新跑 A / B / Composite 验收
```

因此：

> **Capability 保持完整；融合发生在运行世界，而不是默认发生在源码。**

源码级物理融合降级为优化手段，只在以下情况才重新考虑：

- 重复实现造成明确且值得消除的性能成本；
- 必须共享同一个不可拆分的原子事务；
- Shared Component 无法自然表达必要一致性；
- 真实证据表明两套实现长期维护成本高于保留独立性的价值。

---

## Decision 6 — Composer 只选择能力，不承担业务逻辑

DCF 允许一个极薄的 World Composer。

它只负责：

```text
Capability manifests
+
Shared Semantic Component contracts
+
目标 Capability 集合
↓
Provider 解析
语义兼容检查
System / Component defs 选择
```

Composer 不得：

- 转换业务字段；
- 理解 Narrative 内容；
- 拥有业务状态；
- 修复语义不兼容；
- 成为新的 Workflow Engine；
- 通过 case-by-case 规则替代 Capability 自身结构。

实验中的 Composer 为 130 non-empty LOC，预算 200 LOC 内，未出现业务 Glue。

后续 Composer 复杂度必须作为架构健康指标持续观察：

> Capability 数量增长时，Composer 核心算法应基本稳定；如果 Composer 复杂度随 Capability 数量近似线性增长，应视为接缝重新外溢的架构警报。

---

## Decision 7 — Becsy 用 Component 访问关系吸收执行接缝

Capability 之间默认不建立跨 Capability 直接调用网。

优先结构是：

```text
System A
writes X

System B
reads X
```

由 Becsy 根据 Component read/write entitlement 建立 precedence。

2026-08-07 实验在 `defs` 刻意乱序、没有任何 `before/after` 等显式调度约束的情况下，自动形成：

```text
A.Source
→ A.Normalize
→ B.Narrative
```

得到：

```text
AUTO_PRECEDENCE_PASS
```

因此，至少对于可表示成共享状态读写关系的依赖：

> 原本属于模块之间的控制流接缝，可以转换成共同世界状态的读写关系，并由 ECS 调度模型吸收。

显式 schedule 仍保留为真实 writer-writer / 特殊顺序约束的工具，但不是默认连接机制。

---

## Decision 8 — Capability DAG 降级为派生视图，不再是首要架构真相

以前的施工模型要求人工先冻结 Capability DAG。

本实验表明，大量依赖可以从下面两层事实推导：

```text
Capability 层：
requires / provides

运行层：
Component reads / writes
```

因此新的主关系是：

```text
Capability Registry
+
Shared Semantic Components
↓
World Composer
↓
Selected Systems
↓
Becsy precedence
```

Dependency DAG 可以继续生成，用于：

- 可视化；
- 诊断；
- 施工解释；
- 验收报告。

但它应尽量成为**派生产物**，而不是要求人工同时维护的第二份架构真相。

---

## Decision 9 — 任务涌现建立在“共享状态空间”上，而不是跨系统集成上

任务涌现不是“AI 想到了一个新功能”本身。

架构必须允许新 Capability 在不改旧 Capability 的情况下进入现有能力空间。

最小实验中，在 A+B 完成并冻结后，新增此前不存在的 C：

```text
requires:
  ActivityMaterial
  Narrative

provides:
  ActivityDigest
```

结果：

```text
A 不修改
B 不修改
C 加入
ABC Composite World PASS
```

没有新增：

```text
AtoCAdapter
BtoCAdapter
ABCController
```

这证明了任务涌现所需要的最低工程条件真实存在：

> 新能力可以通过既有 Shared Semantic Components 进入共同 World，而不是重新发明一套系统集成结构。

这不等于已经证明“AI 能自动发现任意新任务”；它证明的是新任务一旦被发现，架构拥有低接缝成本的落地空间。

---

## Decision 10 — 错误组合必须在 World 边界被拒绝

两类错误组合被定义为常设负控制。

### 多 Provider 冲突

如果同一个 single-provider Shared Component 同时出现多个运行 Provider：

```text
COMPOSITION_REJECTED
```

必须在 World 创建和业务执行前拒绝。

### 语义假重叠

如果两个 Capability 使用相同 Schema，但一个要求：

```text
evidence-only
```

另一个实际要求：

```text
intent-inferred
```

则：

```text
SEMANTIC_COMPONENT_INCOMPATIBLE
```

必须拒绝。

核心原则：

> **Schema 相同不等于语义相同；错误必须在 World 边界停止传播。**

---

## Experimental Evidence — 2026-08-07

最小实验环境：

```text
macOS darwin 26.5.2
Bun 1.3.14
@lastolivegames/becsy 0.16.0（精确锁定）
```

结果：

```text
ARCHITECTURE_FEASIBLE
```

共：

```text
38 tests
116 assertions
两次连续全量复跑 PASS
8 / 8 hard gates PASS
```

关键证据：

1. A / B Standalone World 各自独立 PASS，源码零交叉 import；
2. overlap 六维语义投影深度相等；
3. Composite AB 中 B 的 standalone provider 零执行；
4. A / B 源码未因组合修改，没有 Adapter / Bridge / Mapper；
5. Becsy 零显式调度得到 `AUTO_PRECEDENCE_PASS`；
6. A / B standalone + AB composite 回归全部 PASS；
7. 新 Capability C 加入时 A / B 一行未改，得到 `EMERGENCE_PATH_PASS`；
8. duplicate provider 与 semantic fake overlap 均在 World 创建前拒绝；
9. Composer 为 130 non-empty LOC，未承担业务转换。

### Evidence provenance

本 ADR 写入时，上述实验报告和机器证据来自 2026-08-07 的本地实验结果；`experiments/capability-world-composition-v1/` 尚未存在于 `main`，因此当前 ADR 不伪造仓库内 evidence link。

后续实验工件进入仓库后，应追加真实 commit / report / trace 引用，但不得因此回写或删除本 ADR 对“当时证据状态”的记录。

---

## Becsy Version / Supply-chain Note

实验确认使用：

```text
@lastolivegames/becsy@0.16.0
```

同时发现 npm `latest` dist-tag 与官方 GitHub 发布线存在不一致：官方仓库存在 2025-03-02 的 `Release 0.16.0`，而 npm `latest` 曾仍指向 0.15.5。

因此后续纪律是：

- 禁止只信 dist-tag；
- 同时核对官方仓库、registry versions / time；
- 正式使用精确锁版本，禁止 `^` / `~`；
- Becsy 当前仍属于 0.x，不能把“上游未来持续维护”作为架构正确性的前提；
- 如果长期采用，应保留冻结版本 / vendor / fork 接管的能力。

这属于供应链维护成本，不改变本实验已经证明的架构机制。

---

## Consequences

### 1. 之前的 Capability 草案不再直接作为施工图

此前的 21 节点、10 Capability 等拆分继续保留为探索历史，但不再直接进入施工。

原因不是其中业务内容失效，而是“正确 Capability”的定义已经改变。

新的 Capability Discovery 必须先回答：

```text
1. 没有 DCF，这个能力为什么仍值得存在？
2. 它如何在独立 Bun+Becsy World 中完整成立？
3. 它 requires / provides 哪些 Shared Semantic Components？
4. 它采用什么问题体质获得结构优势？
```

### 2. create-envelope 的输入模型需要后续调整

Capability Envelope 后续至少需要能够表达：

- Standalone World acceptance；
- requires / provides；
- Shared Semantic Component contract；
- provider policy；
- semantic predicates；
- standalone-only provider；
- composite acceptance；
- negative composition gates。

但本 ADR 不直接修改 Envelope 元格式；应在真实 Capability Discovery 稳定后再更新施工规范。

### 3. “公共层”从真实重叠中生长

不提前设计庞大的：

```text
CommonCore
CommonWorkflow
CommonStorage
CommonEventBus
```

先让 Capability 独立成立，再从反复出现、经过语义等价验证的 overlap 中形成 Shared Semantic Components。

核心原则：

> **抽象不是预测出来的，而是从已经证明成立的重叠里压出来的。**

---

## Non-decisions

本 ADR 没有决定：

- 所有代码必须写成 ECS System；
- 所有外部能力必须由 TypeScript 重写；
- Becsy 多线程执行已经可用；
- macOS 真采集已经验证；
- AI Narrative 已经验证；
- SQLite 正式认知 Schema 已经验证；
- 多设备同步已经解决；
- 完整任务涌现 AI 已经存在；
- Becsy 必须永久不可替换。

本 ADR 冻结的是组合模型和能力边界原则，不是把当前库实现升格成不可替换的最终技术。

---

## Relationship to Existing ADRs

本 ADR **扩展而不否定** `2026-08-04-dcf-design-evolution-and-implementation-closure.md` 的 Decision 5：

> Becsy 是活动计算状态层；功能关系优先通过共同 World 中的数据状态发生，而不是形成深层互调控制网。

本次新发现进一步给出了可施工、可验证的具体形态：

```text
Capability 保完整
Component 承语义
Composer 选能力
World 定运行
```

以及：

> **Capability 不需要彼此“连接”；它们进入共同 World，通过共享的现实状态发生关系。**

---

## Final Principle

DCF 后续 Capability 架构的当前主基调：

> **DCF 的基本建设单位是独立可成立的 Capability；Capability 通过 Shared Semantic Component 描述共同认识的世界状态；World Composer 根据目标选择唯一有效的 Provider 和 Systems；Becsy 根据 Component 的访问关系推导实际执行秩序。Capability 保持源码完整，而运行时只激活目标 World 所需要的最小能力组合。**

压缩表达：

> **Capability 保完整，Component 承语义，Composer 选能力，World 定运行。**
