# E2 裁决

## 裁决

```text
AI_SDK_CORE_ADOPT_WITH_THIN_DCF_LAYER
```

LiteLLM 对照组（候选 C）未触发：三路均未出现路由/账户池/fallback/预算中央化的
明确结构缺口，本轮不引入 gateway。

## 六个关键问题的实验回答

1. **AI SDK 替我们吸收了什么？**
   Provider 差异适配、stream SSE/分帧、abort 信号、usage 归一、structured output 校验、
   tool calling agentic loop（含错误回灌）、错误类型化（AI_APICallError）、
   providerMetadata escape hatch。矩阵 8 项能力在 A1/A2 全 PASS（results/e2-matrix.json）。
2. **仍需要 DCF 自己实现什么？**
   AI Turn 契约（TurnRequest/TurnOutcome 形状）、reasoning 跨 wire 归一（F1）、
   工具失败的任务级语义（F3：SDK 默认不判失败）、Output.object 包装等 API 形态隔离（F2）。
   本轮 thin layer 实测约 60 非空行（routes.ts 中契约+buildParams 部分）。
3. **AI SDK 是否偷偷拥有业务语义？**
   未观察到业务语义侵占；但 tool 错误回灌模型属于"代理行为默认值"，
   DCF 必须显式覆盖而不是继承（F3）。
4. **更换 Provider 时上层 Capability 是否需要变化？**
   不需要。同一 provider 结构指向 DeepSeek 与本机 Ollama，DCF 契约层零改动
   （scratch/second-provider.ts 证据）。
5. **未标准化能力有没有安全 escape hatch？**
   有。providerMetadata/raw body 三路均可得（M7 PASS）；
   A3 证明必要时可整体绕过 SDK。
6. **AI SDK 升级是否迫使 DCF 契约变化？**
   v7 已出现 output API 形态变化（F2）；因为 thin layer 存在，变化被挡在 adapter，
   DCF Turn 契约未动。这正是选择 WITH_THIN_DCF_LAYER 而不是裸 ADOPT 的直接理由。

## A1 vs A2 差异（计划修订3 预期的有价值结论）

- A1（官方 deepseek provider，chat/completions）与 A2（responses）在本轮能力矩阵上
  **功能等价**（8 项全 PASS）；
- 唯一实测差异：reasoning 文本经 SDK 标准字段的暴露位置不同（F1）；
- 结论：V4 新能力走 Responses wire 时，A2 是更稳的路径；A1 并未落后到不可用，
  但 reasoning/新字段的规范化应预期从 responses 侧先来。

## 指标

```text
routes.ts（契约 + 三路 adapter）非空 LOC : 约 220（其中 A3 约 110）
DCF 契约核心（TurnRequest/TurnOutcome）  : 约 30
provider-specific 行为分支               : 0（差异全部由 SDK provider 对象吸收）
两次独立复跑                             : 11/11 × 2
第二 Provider                            : Ollama qwen3:0.6b（SECOND_PROVIDER_LOCAL_ONLY）
```

## 未测项（如实登记）

- `@ai-sdk/deepseek` 是否支持 responses wire（本轮其默认走 chat/completions）；
- cache metadata 的稳定性（usage 中可见 cache 字段但未做命中/未命中受控实验）；
- 网络中断（真实 TCP 层）与 timeout 的区分只做了 abort 代理；
- 多模态/图片输入；reasoning effort 参数化。
