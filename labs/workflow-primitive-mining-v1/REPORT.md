# DCF Workflow 强原语挖掘实验 v1

日期：2026-08-07  
分支：`experiment/workflow-primitive-mining-v1`  
基线：`e9281955daa743ed4265013eac4ee0d0db50ece6`  
状态：**结构实验完成；运行时未验证**

## 0. 研究问题

本实验不回答“哪个 Workflow 产品最好”，而回答两个更基础的问题：

1. n8n / Dify 等成熟社区里的专业 AI Workflow，是否必须依赖原平台运行时才能保留主要价值？
2. 把平台品牌、UI 和节点名称剥掉后，哪些机制仍然无法被普通 `AI Turn + Agent + Tool + State + Branch/Loop/Parallel` 低损耗复刻？

目标是决定 DCF 后续策略究竟应该是：

- 绑定某个 Workflow 生态；
- 自研完整 Workflow Engine；
- 还是把外部 Workflow 当作“流程知识源代码”，只吸收真正不可轻易替代的强原语。

## 1. 证据纪律

本轮证据分层：

- `observed`：官方文档 / 官方 Marketplace / 官方模板页明确描述的流程结构与运行机制；
- `structural_mapped`：把 observed 流程人工反编译到平台无关原语［
- `machine_validated`：`validate.mjs` 验证所有映射只使用冻结候选原语、来源齐全、残差类型合法并生成统计；
- `not_tested`：没有在 Bun + Becsy 中真正执行这些外部 Workflow，也没有证明语义翻译后的真实输出与原平台逐项等价。

因此本报告允许裁决“结构可迁移性”，不允许写成“运行时已经兼容”。

## 2. 样本

样本共 10 个，优先选择真实社区中体现专业流程、递归、Human-in-the-loop、多 Agent、RAG、评测的工作流。

### n8n

1. Recursive Writing & Editing Agents  
   https://n8n.io/workflows/3503-generate-written-content-with-gpt-recursive-writing-and-editing-agents/
2. Phase-based Blog Creation with Specialized Sub-agents  
   https://n8n.io/workflows/10524-phase-based-blog-creation-system-with-specialized-ai-sub-agents/
3. Multi-agent Research with Cross-critique  
   https://n8n.io/workflows/15201-generate-multi-agent-ai-research-reports-with-openai-and-google-sheets/
4. Human Approval Before Sensitive Tool Call  
   https://n8n.io/workflows/13848-production-ai-playbook-human-oversight-exercise-2/
5. Pyragogy Handbook Multi-agent Pipeline  
   https://n8n.io/workflows/4904-pyragogy-ai-driven-handbook-generator-with-multi-agent-orchestration/
6. AI Evaluation: Correctness  
   https://n8n.io/workflows/4271-evaluation-metric-example-correctness-judged-by-ai/
7. Research / Writer / Reviewer + Circuit Breaker  
   https://n8n.io/workflows/16662-run-a-multi-agent-research-and-publishing-pipeline-with-gpt-4o-tavily-and-notion/

### Dify

8. Multi-Question RAG Workflow  
   https://marketplace.dify.ai/template/langgenius/Multi-Question%20RAG%20Workflow?creationType=templates&language=en-US&templateId=d2d2ae92-d95b-4d55-b343-be411c3147d3
9. Human Input: Writing Assistant  
   https://marketplace.dify.ai/template/langgenius/Human%20Input%3A%20Writing%20Assistant?creationType=templates&language=en-US&templateId=646708b7-26d9-44d9-8c8b-e2ebf41d44b6
10. Enterprise AI Project Planner  
    https://marketplace.dify.ai/template/priyanshu/Enterprise%20AI%20Project%20Planner?creationType=templates&language=en-US&templateId=17bad031-9ac8-451c-9f88-8bb30b0cea8f

另用 LangGraph JS、Activepieces、Mastra 的官方运行语义文档对“残差原语”进行独立交叉观察。

## 3. 候选通用原语

本轮没有先照搬任何产品节点，而冻结一个很薄的实验词汇：

```text
AI 专业行为
- ai.turn
- agent.run
- tool.invoke
- structured.output
- retrieve

控制结构
- sequence
- branch
- loop
- parallel
- join
- subflow

世界 / 交互
- state
- human.input
- wait.external

边界
- input
- output
```

这不是最终 DCF Workflow IR，只是本轮用来检验“复杂专业 Workflow 是否真的依赖平台特殊节点”的最小分析工具。

## 4. 机器结果

`node validate.mjs`：

```text
sample_count = 10
topology_portable_count = 10
topology_portable_ratio = 1.0
zero_residual_count = 4
durable_runtime_residual_count = 5
validation_errors = 0
verdict = STRUCTURAL_PORTABILITY_PASS_WITH_STRONG_RUNTIME_RESIDUALS
```

详细机器结果见 `results.json`。

这里的 `10/10` 只表示：

> 样本的主要流程结构与 AI 专业意义可以重新编码成平台无关原语，没有发现某个 n8n / Dify 品牌节点在逻辑上不可替代。

它不表示 DCF 已经具有所有运行保证。

## 5. 被“吃掉”的复杂工作流

### 5.1 递归写作 / 编辑

原流程看起来具有 Writing Agent、Editing Agent、JSON Parser、递归回路。

去品牌以后只剩：

```text
AI Turn（写）
→ AI Turn + Structured Output（审）
→ Branch
→ Loop
```

结论：**流程知识有价值，节点没有结构性不可替代性。**

### 5.2 多 Agent 研究 / 交叉批判 / 综合

去掉 Researcher / Trend Agent / Critic 等角色名称以后只剩：

```text
Parallel Agent Runs
→ Join
→ Cross Review AI Turns
→ Synthesis AI Turn
```

角色、Prompt 与评价标准属于 Recipe / Workflow 资产，不要求继承 n8n Runtime。

### 5.3 Dify Parameter Extractor / Question Classifier

Dify 官方明确说明这两个节点封装复杂 Prompt 和代码逻辑，但其公开接口仍表现为：

```text
LLM
+ instruction
+ class/schema description
+ structured result
```

在 DCF 已有 AI Turn + Structured Output 前提下，本轮未发现它们构成独立结构性原语。

### 5.4 RAG、Guardrail、Circuit Breaker

- RAG：`retrieve + AI/Agent`；
- Guardrail：确定规则 / AI 判定 + branch；
- Circuit Breaker：state counter + branch + bounded loop。

它们可以是高价值 Recipe，但当前没有证据要求成为平台专属运行原语。

## 6. 真正留下的强残差

### 6.1 Durable Interrupt / Resume（持久中断 / 恢复）

这是本轮最明确的强原语。

LangGraph JS：

- `interrupt()` 可在节点内部动态暂停；
- checkpointer 保存图状态；
- `thread_id` 作为持久恢复游标；
- `Command({resume})` 恢复；
- 支持多个并行 interrupt；
- 恢复时节点会从头重跑，因此副作用必须幂等。

来源：  
https://docs.langchain.com/oss/javascript/langgraph/interrupts

Activepieces：

- Waitpoint 持久化暂停状态；
- Webhook / Delay 两种恢复；
- worker restart 后继续；
- resume payload 进入恢复步骤。

来源：  
https://www.activepieces.com/docs/build-pieces/piece-reference/flow-control

Mastra：

- Workflow suspend / resume；
- snapshot 保存步骤状态；
- 可接 Temporal 获得跨 worker restart 的 durable execution。

来源：  
https://mastra.ai/blog/resumeworkflows  
https://mastra.ai/blog/introducing-temporal-workflows

Dify Marketplace 的 Human Input Workflow 同样把“暂停 → 人类反馈 → 继续”做成正式节点，并提供 workflow pause / event resume 相关 API。

**裁决：STRUCTURAL_CONVERGENCE。**

这不是某家 UI 特色；多个系统独立收敛，说明“可持久暂停的人类/外部介入点”本身就是 AI Workflow 的稳定问题结构。

### 6.2 Durable Checkpoint / Replay（持久检查点 / 重放）

Activepieces 的机制尤其有启发性：

- 每个已完成 step 保存 input/output/status；
- crash / deploy / retry 后重新走图；
- 已完成 step 直接 replay saved output；
- 只重新执行最后一个未确认完成的 step。

来源：  
https://www.activepieces.com/docs/install/architecture/durable-execution

LangGraph checkpointer 与 Mastra + Temporal 从不同方向提供同类保证。

**裁决：STRUCTURAL_CONVERGENCE。**

这比普通 `state` 强得多，因为它定义的是“执行历史怎样成为恢复事实”。

### 6.3 Resume-before-pause Race + Idempotency（恢复早于暂停竞态 + 幂等）

Activepieces Waitpoint 明确处理一个很容易被自研漏掉的竞态：

```text
外部 callback 已经到达
但 paused 状态还没完成持久化
```

它通过 waitpoint 行锁、pre-completed row 与唯一约束吸收重复 callback，并保证不会二次恢复。

来源：  
https://www.activepieces.com/docs/install/architecture/waitpoints

**裁决：HIGH_LEVERAGE_ENGINEERING_MECHANISM。**

这是典型“看起来只是等一个 webhook，实际背后是一整套故障语义”的强组件。

### 6.4 Subflow State Scope（子流程状态寿命）

LangGraph 对 subgraph 明确区分：

```text
per-invocation
per-thread
stateless
```

这直接决定：

- 子 Agent 是否保留跨调用记忆；
- 是否支持 interrupt / durable execution；
- 多个调用是否发生 checkpoint namespace 冲突。

来源：  
https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs

**裁决：HIGH_LEVERAGE_SPECIALIZED_SEMANTIC。**

它不是一个“Subflow Node”名称，而是组合工作流时真正必须决定的状态所有权问题。

### 6.5 Evaluation Dataset / Metric Runner（评测数据集 / 指标运行器）

n8n 已把 Evaluation Trigger + Evaluation Metric 做成第一方 Workflow 工具：同一工作流既可以正常运行，也可以从测试数据集触发并把结果和 reference truth 比较成 metric。

来源：  
https://n8n.io/workflows/4271-evaluation-metric-example-correctness-judged-by-ai/  
https://n8n.io/workflows/4268-evaluation-metric-example-check-if-tool-was-called/

本轮判断：

```text
VALUABLE_AI_WORKFLOW_TOOLING_NOT_FOUNDATIONAL
```

它对 DCF 很有价值，但当前看仍可由 Workflow + fixture dataset + evaluator + metrics 组合形成，不像 checkpoint / resume 那样改变整个执行模型。

## 7. “只有他们家才有”的组件有没有？

本轮最重要的负结论：

> **在抽样范围内，没有找到一个高价值 AI Workflow 语义必须绑定某一家平台才能成立。**

相反，越高杠杆的运行语义，越出现跨框架收敛：

```text
LangGraph
Activepieces
Mastra / Temporal
Dify
```

都在不同层次解决 durable state / pause / resume / human input。

这意味着真正强的机制更像“问题本身”，不是平台专利。

平台独特优势主要集中在两类：

1. **工程成熟度**：某家把竞态、恢复、幂等、状态寿命处理得更完整；
2. **生态资产**：n8n / Activepieces 的现实服务 Connector 已封装认证、Webhook、分页、错误语义和长期 API 维护。

第二类非常高杠杆，但更应该归入 Provider / Probe / External Capability 生态，而不是把它们硬塞进 Workflow 核心语义。

## 8. 当前策略裁决

总体裁决：

```text
STRUCTURAL_PORTABILITY_PASS_WITH_STRONG_RUNTIME_RESIDUALS
```

因此当前不建议：

```text
因为 n8n 模板最多
→ 采用 n8n 作为 DCF Workflow Runtime
```

也不建议：

```text
因为外部 DSL 不一致
→ DCF 自己从零设计完整 Workflow Engine
```

更合理的策略是：

```text
外部 Workflow
= Source Language / 专业流程知识

DCF Workflow IR（候选）
= 平台无关语义表示

强运行原语
= 优先吸收成熟轮子 / 成熟机制
```

即：

> **工作流知识可迁移；强运行机制选择性继承。**

## 9. 对 DCF 的直接影响

### 9.1 n8n / Dify 的定位

优先作为：

```text
专业 Workflow 语料库
流程方法论来源
Importer / Translator 的输入语言
```

而不是默认成为运行权威。

Importer 必须保存：

```text
原始 Workflow
来源 / 版本
翻译后的 IR
无法翻译的 residual
证据
```

未知节点不得“猜成差不多”。应显式：

```text
UNSUPPORTED_PRIMITIVE
OPAQUE_EXTENSION
NEEDS_RUNTIME_PROVIDER
```

### 9.2 Workflow IR 不应追求万能 GenericNode

IR 应优先保留稳定意义：

```text
AI Turn / Agent / Tool
Branch / Loop / Parallel
Human Interrupt
Durable State / Checkpoint
Subflow State Scope
External Wait
```

而不是把一切压成：

```text
GenericNode(input, output)
```

否则迁移表面统一，真实语义反而丢失。

### 9.3 Bun + Becsy 的下一步

本轮只证明 Workflow 语义可迁移，尚未证明哪个 Runtime 与 DCF 最契合。

下一轮应做真正的运行实验：

```text
Bun + Becsy World
×
LangGraph JS
Mastra
Activepieces durable mechanisms（至少作为机制对照）
```

硬门禁：

1. Bun 实际运行，而不是“npm 能安装”；
2. Workflow 内部可以拥有专业 step/checkpoint，但 World 仍拥有稳定 run identity / health / lifecycle；
3. 不出现第二套与 Becsy 冲突的 DCF 运行权威；
4. interrupt / resume / crash recovery 用真实进程死亡验证；
5. 同一份平台无关 Workflow fixture 至少在两个候选上重放；
6. 不为了适配候选修改 Capability 业务语义。

## 10. 对现实闭环行动候选的影响

本实验加强了一个假设，但没有足够证据解除冻结：

> 如果通用 Workflow Facility 最终成立，现实闭环行动原先的大量“流程复杂度”可能被 Workflow + Agent Execution + Evidence + Reality Effect 吸收，最终只剩 Workflow Profile / Recipe 或更薄的产品语义。

当前状态仍必须保持：

```text
现实闭环行动 = DISCOVERY_DEFERRED
```

不能因为本轮结构实验就提前晋级或降级。

## 11. 证据状态

```text
真实专业 Workflow 来源：observed
流程语义反编译：structural_mapped
词汇与统计校验：machine_validated（Node v22.16.0）
Bun runtime：not_tested
Becsy integration：not_tested
跨引擎真实重放：not_tested
故障 / crash / resume：not_tested
最终 Workflow Facility 架构：hypothesized
```

因此本轮允许决定“下一步策略”，不允许宣布 Workflow 公共设施已经定型。
