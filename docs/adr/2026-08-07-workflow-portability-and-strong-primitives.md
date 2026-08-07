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

> **只有无法由普通 AI / 控制原语低损耗表达、且具有明显工程或状态语义杠杆的机制，才进入“直接采用 / 借机制 / 薄包装”候选。**

当前最强候选为：

```text
durable checkpoint / replay
durable interrupt / resume
resume race + idempotency
subflow state scope
```

AI 角色、Prompt、写作/审阅循环、RAG、分类、参数提取、多 Agent 分工等当前优先视为 Workflow / Recipe 资产，不升级为底层强原语。

## Why

10 / 10 样本的主要流程拓扑可以重新表达为平台无关原语；没有观察到某个 n8n / Dify 品牌节点在逻辑上不可替代。

反而是 checkpoint、pause/resume 等越重要的运行机制越在多个框架中独立收敛，说明其强度来自问题结构而不是品牌封闭性。

## Boundary

本 ADR 仍是 Proposed：

```text
结构迁移：有证据
Bun 真运行：未测试
Becsy 主权边界：未测试
跨引擎重放：未测试
crash / resume：未测试
```

因此不得据此把 Workflow Facility 写入当前正式公共设施规范。

## Next Gate

执行：

```text
Bun + Becsy
× LangGraph JS
× Mastra
× Activepieces durable mechanisms
```

用真实进程死亡、pause/resume、subflow state、World lifecycle 证明最终边界后，再决定是否 Accepted。

## Capability 16

`现实闭环行动` 保持 `DISCOVERY_DEFERRED`。

本轮只增加假设：未来若 Workflow Facility 成立，其大量流程复杂度可能被吸收；这不是解冻证据。
