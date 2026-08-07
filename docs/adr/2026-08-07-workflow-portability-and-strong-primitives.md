# ADR（实验分支提案）：外部 Workflow 作为可迁移流程知识，运行时只吸收强原语

日期：2026-08-07  
状态：**Proposed — supported by structural experiment; runtime validation pending**

## Context

此前讨论存在两个容易混淆的问题：

1. n8n / Dify 等社区中已经有大量专业 AI Workflow，DCF 是否应为了利用这些资产绑定其运行时；
2. AI Workflow 是否存在只有某个平台才拥有、复刻成本极高的特殊组件。

`labs/workflow-primitive-mining-v1/` 对 10 个专业 Workflow 样本做了平台无关反编译，并交叉观察 LangGraph JS、Activepieces、Mastra 等运行机制。

## Proposed Decision

在下一轮 Bun+Becsy 运行实验推翻之前，采用以下工作假设：

> **外部 Workflow 首先视为可迁移的流程知识 / Source Language；DCF 不因模板生态规模自动继承其 Runtime。**

> **Workflow Runtime 的选型目标不是“功能最强”或“模板最多”，而是“最适配 Bun + Becsy + DCF 运行主权边界”；外部生态主要作为 Workflow Knowledge（工作流知识）来源。**

> **只有无法由普通 AI / 控制原语低损耗表达、且具有明显工程或状态语义杠杆的机制，才进入“直接采用 / 借机制 / 薄包装”候选。**

当前最强候选为：

```text
durable checkpoint / replay
durable interrupt / resume
resume race + idempotency
subflow state scope
```

AI 角色、Prompt、写作/审阅循环、RAG、分类、参数提取、多 Agent 分工等当前优先视为 Workflow / Recipe 资产，不升级为底层强原语。

## Strategy Closure After Structural Experiment

本轮结构实验已经足以改变后续选型策略，但还不足以冻结具体 Runtime。

后续不再把“社区 Workflow 数量最多的平台”直接等同于“DCF 最合适的 Workflow Runtime”。两类价值正式分开：

```text
Workflow Knowledge
→ 专业人士已经验证过的流程结构、方法论、角色分工、检查点、决策路径
→ 允许从 n8n / Dify / LangGraph / Mastra / 其他生态迁移、重编译、复刻

Workflow Runtime
→ 真正负责流程执行、持久状态、暂停恢复、失败恢复和运行语义的内核
→ 优先选择与 Bun、Becsy World、ExternalOperation 和 DCF 权威边界最自然匹配的实现
```

因此当前策略不是“选择最强大的 Workflow 平台”，而是：

> **选择修改半径最小、主权边界最清楚、能最大程度复用 Bun + Becsy 既有体质的 Workflow 核心；再把外部生态中的 Workflow 知识迁移进来。**

如果某个外部 Workflow 只依赖常见 AI / 控制原语，则优先迁移其语义，不继承其 Runtime。

如果某个外部 Workflow 依赖真正高杠杆、难以低损耗复刻的特殊运行语义，则单独评估该机制是否应：

```text
直接采用
借机制重做
薄包装接入
保留为外部 Provider
```

不得因为单个特殊组件反向绑定整个 Workflow 平台。

## Workflow Knowledge 不是新系统，而是现有证据链上的涌现用途

外部 Workflow 生态不需要新建一个独立“Workflow Knowledge Miner / Workflow Marketplace Manager”系统。

它可以自然复用当前已经收敛的能力链：

```text
外部 Workflow / 模板 / DSL / 文档 / 示例仓库
↓
证据源采集管理
↓
保存原始 Workflow、来源、版本、依赖与可回源锚点
↓
多源证据编译
↓
确定性提取拓扑、节点、参数、依赖、数据流与平台显式语义
↓
AI 开放理解
↓
识别流程目的、角色、隐含阶段、可迁移语义与平台特殊原语
↓
形成“当前 Workflow 内核可接受”的候选流程表示
↓
确定性 schema / contract / unsupported residual 校验
↓
进入当前 Workflow Runtime
```

这条链上各层继续遵守既有职责边界：

```text
证据源采集管理
→ 只负责可靠获得和保存来源事实，不理解工作流意义

多源证据编译
→ 只做来源事实 + 显式规则能够确定推出的结构化转换，不做开放语义猜测

AI
→ 只负责真正需要理解的方法论、意图、角色和语义等开放判断

确定性验证器
→ 负责检查目标 Workflow IR / Runtime contract、依赖可解性、未知原语和不允许的语义降级
```

因此外部 Workflow 可以成为 DCF 的一种普通 Evidence Source（证据来源），而“专业 Workflow 知识矿场”只是现有 Capability 组合后的一个自然用途。

这进一步强化：

> **Workflow Knowledge 的来源生态与 Workflow Runtime 的实现选型可以长期独立演化。**

未来 Runtime 更换时，应优先重新编译 / 重放已有 Workflow Knowledge，而不是重新采集和重新绑定原生态。

同时禁止静默近似：若某个来源 Workflow 的特殊语义无法证明能被当前 Runtime 等价表达，必须显式保留为：

```text
UNSUPPORTED_PRIMITIVE
OPAQUE_EXTENSION
NEEDS_RUNTIME_PROVIDER
```

并保留原始来源与翻译证据，不得让 AI 把“看起来差不多”冒充语义等价。

## Why

10 / 10 样本的主要流程拓扑可以重新表达为平台无关原语；没有观察到某个 n8n / Dify 品牌节点在逻辑上不可替代。

反而是 checkpoint、pause/resume 等越重要的运行机制越在多个框架中独立收敛，说明其强度来自问题结构而不是品牌封闭性。

这意味着：

> **模板生态的网络效应可以被当作“流程知识库”吸收，而不必把 DCF 的运行主权交给同一个平台。**

## Boundary

本 ADR 仍是 Proposed：

```text
结构迁移：有证据
Bun 真运行：未测试
Becsy 主权边界：未测试
跨引擎重放：未测试
crash / resume：未测试
```

因此不得据此把 Workflow Facility 写入当前正式公共设施规范，也不得提前冻结某个 Workflow Runtime。

## Next Gate

下一轮实验不再寻找“功能最全框架”，而是寻找**最适配 DCF 体系的运行核心**。

执行：

```text
Bun + Becsy
× LangGraph JS
× Mastra
× Activepieces durable mechanisms
```

重点验证：

```text
与 Bun 的真实运行亲和度
与 Becsy World 的运行主权边界
ExternalOperation 是否能成为统一外部生命周期
持久 checkpoint / interrupt / resume
进程死亡后的恢复
副作用幂等与重复恢复
subflow state scope
需要多少 DCF glue / adapter
```

用真实进程死亡、pause/resume、subflow state、World lifecycle 证明最终边界后，再决定具体 Workflow Runtime 是否进入 Accepted。

## Capability 16

`现实闭环行动` 保持 `DISCOVERY_DEFERRED`。

本轮只增加假设：未来若 Workflow Facility 成立，其大量流程复杂度可能被吸收；这不是解冻证据。
