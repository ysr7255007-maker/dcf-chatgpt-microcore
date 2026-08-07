# E2 — AI SDK Core × AI Turn Facility 实验

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》§6。

## 研究问题

Vercel AI SDK Core 是否吸收了足够多的 Provider/stream/tool/structured output/
reasoning/metadata 工程坑，使 DCF 没必要重新实现完整 AI Harness；同时 DCF 是否
仍保留自己的 AI Turn 语义与 provider-specific escape hatch。

## 三路对比（计划 [修订3]）

| 路径 | 结构 | wire |
| --- | --- | --- |
| A1 | `@ai-sdk/deepseek@3.0.24` 官方 Provider | chat/completions |
| A2 | `@ai-sdk/openai@4.0.33` + custom baseURL + `.responses()` | responses |
| A3 | raw HTTP（真值/对照，保持极小） | responses |

核心 `ai@7.0.55`。模型 `deepseek-v4-flash`（/v1/models 核实）。
开工前对 `/v1/responses` 做了独立 wire 探针（results/probe-responses-shape.json），
不依赖 /v1/models 推断 wire format。
未使用 `@ai-sdk/openai-compatible` 指向 Responses endpoint（计划禁止项）。

## 运行

```bash
bun install
bun test tests/    # probe(2) + matrix(9)；matrix 结果写入 results/e2-matrix.json
```

## 关键结果（两次独立复跑 11/11）

- generate/stream/abort/usage/structured output/tool call/tool 失败/provider error/escape hatch：
  A1 与 A2 全部 PASS（详见 results/e2-matrix.json 真值）；
- **换 Provider 上层零改动**：同一 `@ai-sdk/openai` 结构指向本机 Ollama（qwen3:0.6b）
  直接产出正确结果（scratch/second-provider.ts）；
- 差异如实记录：A2（responses）经 SDK 标准字段暴露的 reasoning 为空，
  A1 可见 reasoning 文本（reasoning 暴露形态是路径差异，见 failures F1）；
- structured output 必须使用 `Output.object({schema})`（v7 API 形态，见 failures F2）。

裁决见 [decision.md](./decision.md)。
