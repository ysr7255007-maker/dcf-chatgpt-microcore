# E2 失败路径与坑清单

## F1 — Responses 路径的 reasoning 暴露形态与 chat 路径不同

- 现象：同一模型同一 prompt，A1（chat/completions）经 SDK `reasoning` 字段返回推理文本，
  A2（responses）该字段为空；而 A3 raw 读取 responses 的 output 中 reasoning 项真实存在。
- 结论：推理内容没有丢，是 SDK 在 responses provider 上的暴露位置不同
  （可能在 providerMetadata/content parts）。
- 教训：DCF 的 AI Turn 契约如果依赖 reasoning，必须在 thin adapter 层做显式归一
  （从 providerMetadata/raw 提取），不能假设 SDK 标准字段在所有 wire 上同形。

## F2 — structured output 的 API 形态是 Output.object，不是裸 zod schema

- 现象：`output: zodSchema` 直接报 `parseCompleteOutput is not a function`（运行时 TypeError，
  非类型错误，容易漏到生产）。
- 解决：`Output.object({ schema })` 包装后 A1/A2 均 PASS。
- 教训：AI SDK 大版本（v7）的 output API 与旧文档/直觉不一致；
  DCF thin layer 的价值之一就是隔离这类上游 API 形态变化。

## F3 — tool 执行失败不会使 generateText 抛错

- 现象：注入 tool execute 抛错后，两条 SDK 路径都正常返回（finish=stop），
  模型收到工具错误并自行解释。
- 结论：这是 SDK 的 agentic loop 语义（错误回灌模型）；DCF 若需要"工具失败即任务失败"，
  必须在 thin layer 显式定义，不能依赖 SDK 默认行为。

## F4 — provider 错误表面良好但信息来自服务端文案

- 非法模型 ID 被分类为 `AI_APICallError`，错误文案来自 DeepSeek 服务端
  （"supported API model names are ..."）。SDK 完成了错误类型化，
  但具体诊断仍绑定 provider 文案 → DCF 不应把文案当作稳定契约。

## F5 — 第二 Provider 覆盖等级说明

- LM Studio 未安装、无 OpenAI Key；本机发现 Ollama（qwen3:0.6b，OpenAI-compatible）。
- 已用同一 `@ai-sdk/openai` 结构零改动切换成功 → 双真实 Provider 成立
  （DeepSeek 官方 wire + 本机 OpenAI-compatible）。
- 未覆盖：闭源大厂官方 provider 的差异（如 OpenAI/Anthropic 原生 SDK 路径）
  记为 `SECOND_PROVIDER_LOCAL_ONLY`。
