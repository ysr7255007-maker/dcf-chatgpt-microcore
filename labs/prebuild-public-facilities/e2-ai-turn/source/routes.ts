/**
 * E2 — 三路对比的 DCF AI Turn 契约与 route 实现。
 *
 * 立场（任务书 §6）：
 *   - DCF AI Turn Contract 自有；SDK 只作为可替换下层；
 *   - A1 @ai-sdk/deepseek（原生 Provider）
 *   - A2 @ai-sdk/openai + custom baseURL + .responses()（Responses 路径）
 *   - A3 raw HTTP（真值/对照，保持极小，禁止发展成完整 Harness）
 *   - 禁止使用 @ai-sdk/openai-compatible 指向 Responses endpoint（计划修订3）。
 */
import { generateText, streamText, stepCountIs, tool, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

export interface TurnRequest {
  prompt: string;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  structured?: z.ZodType;
  withTool?: boolean;
  toolShouldFail?: boolean;
}

export interface TurnOutcome {
  text: string;
  reasoningText: string;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  structured: unknown;
  toolExecuted: boolean;
  toolResult: unknown;
  /** escape hatch：provider 原始 metadata（DCF 上层只在显式需要时读取）。 */
  rawMetadata: unknown;
}

export interface TurnRoute {
  key: "A1" | "A2" | "A3";
  description: string;
  wire: string;
  generate(req: TurnRequest, apiKey: string): Promise<TurnOutcome>;
  stream(req: TurnRequest, apiKey: string, onDelta: (t: string) => void): Promise<TurnOutcome>;
}

const MODEL = "deepseek-v4-flash";
const BASE = "https://api.deepseek.com/v1";

function emptyOutcome(): TurnOutcome {
  return {
    text: "",
    reasoningText: "",
    finishReason: "",
    usage: null,
    structured: undefined,
    toolExecuted: false,
    toolResult: undefined,
    rawMetadata: undefined,
  };
}

/** A1 — 官方 DeepSeek Provider（当前走 chat/completions 语义）。 */
export function makeA1(apiKey: string): TurnRoute {
  const provider = createDeepSeek({ apiKey });
  const model = provider(MODEL);
  return {
    key: "A1",
    description: "@ai-sdk/deepseek 官方 Provider",
    wire: "chat/completions",
    generate: async (req) => await runSdk(() => generateText(buildParams(req, model)), req),
    stream: async (req, _key, onDelta) =>
      await runSdkStream(() => streamText(buildParams(req, model)), req, onDelta),
  };
}

/** A2 — @ai-sdk/openai + custom baseURL + 显式 .responses()。 */
export function makeA2(apiKey: string): TurnRoute {
  const provider = createOpenAI({ baseURL: BASE, apiKey });
  const model = provider.responses(MODEL);
  return {
    key: "A2",
    description: "@ai-sdk/openai + baseURL + .responses()",
    wire: "responses",
    generate: async (req) => await runSdk(() => generateText(buildParams(req, model)), req),
    stream: async (req, _key, onDelta) =>
      await runSdkStream(() => streamText(buildParams(req, model)), req, onDelta),
  };
}

function buildParams(req: TurnRequest, model: unknown): Record<string, unknown> {
  let toolExecutedFlag = { executed: false, result: undefined as unknown };
  const params: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    abortSignal: req.abortSignal,
    maxOutputTokens: req.maxOutputTokens,
  };
  if (req.structured) params.output = Output.object({ schema: req.structured });
  if (req.withTool) {
    params.tools = {
      add: tool({
        description: "Add two integers.",
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }: { a: number; b: number }) => {
          toolExecutedFlag.executed = true;
          if (req.toolShouldFail) throw new Error("tool-execution-failure-injected");
          const result = a + b;
          toolExecutedFlag.result = result;
          return result;
        },
      }),
    };
    params.stopWhen = stepCountIs(3);
  }
  (params as { __flag?: unknown }).__flag = toolExecutedFlag;
  return params;
}

async function runSdk(
  call: () => Promise<{
    text: string;
    finishReason: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    output?: unknown;
    providerMetadata?: unknown;
    reasoning?: Array<{ text?: string }>;
  }>,
  req: TurnRequest,
): Promise<TurnOutcome> {
  const result = await call();
  const outcome = emptyOutcome();
  outcome.text = result.text ?? "";
  outcome.finishReason = result.finishReason ?? "";
  outcome.usage = result.usage
    ? {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        totalTokens: result.usage.totalTokens ?? 0,
      }
    : null;
  outcome.structured = result.output;
  outcome.rawMetadata = result.providerMetadata;
  outcome.reasoningText = (result.reasoning ?? [])
    .map((r) => r.text ?? "")
    .join("");
  return outcome;
}

async function runSdkStream(
  call: () => {
    textStream: AsyncIterable<string>;
    finishReason: Promise<string>;
    usage: Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined>;
    output: Promise<unknown>;
    providerMetadata: Promise<unknown>;
  },
  req: TurnRequest,
  onDelta: (t: string) => void,
): Promise<TurnOutcome> {
  const result = call();
  const outcome = emptyOutcome();
  for await (const delta of result.textStream) {
    outcome.text += delta;
    onDelta(delta);
  }
  outcome.finishReason = (await result.finishReason) ?? "";
  const usage = await result.usage;
  outcome.usage = usage
    ? {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      }
    : null;
  outcome.structured = await result.output;
  outcome.rawMetadata = await result.providerMetadata;
  return outcome;
}

/** A3 — raw HTTP Responses（真值/对照；刻意保持极小）。 */
export function makeA3(): TurnRoute {
  return {
    key: "A3",
    description: "raw HTTP /v1/responses（真值/对照）",
    wire: "responses",
    generate: async (req, apiKey) => {
      const response = await fetch(`${BASE}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          input: req.prompt,
          max_output_tokens: req.maxOutputTokens ?? 2048,
        }),
        signal: req.abortSignal,
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(`A3 http ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
      }
      const outcome = emptyOutcome();
      const outputs = (body.output ?? []) as Array<Record<string, unknown>>;
      for (const item of outputs) {
        if (item.type === "message") {
          const content = (item.content ?? []) as Array<Record<string, unknown>>;
          outcome.text += content
            .filter((c) => c.type === "output_text")
            .map((c) => String(c.text ?? ""))
            .join("");
        } else if (item.type === "reasoning") {
          const content = (item.content ?? []) as Array<Record<string, unknown>>;
          outcome.reasoningText += content.map((c) => String(c.text ?? "")).join("");
        }
      }
      outcome.finishReason = String(body.status ?? "unknown");
      const usage = body.usage as Record<string, number> | undefined;
      outcome.usage = usage
        ? {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          }
        : null;
      outcome.rawMetadata = body;
      return outcome;
    },
    stream: async (req, apiKey, onDelta) => {
      // A3 流式对照：最小 SSE 读取（不引入 SDK）
      const response = await fetch(`${BASE}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          input: req.prompt,
          max_output_tokens: req.maxOutputTokens ?? 2048,
          stream: true,
        }),
        signal: req.abortSignal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`A3 stream http ${response.status}`);
      }
      const outcome = emptyOutcome();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload) as Record<string, unknown>;
            if (event.type === "response.output_text.delta") {
              const delta = String(event.delta ?? "");
              outcome.text += delta;
              onDelta(delta);
            } else if (event.type === "response.completed") {
              const resp = event.response as Record<string, unknown> | undefined;
              outcome.finishReason = String(resp?.status ?? "completed");
              const usage = resp?.usage as Record<string, number> | undefined;
              outcome.usage = usage
                ? {
                    inputTokens: usage.input_tokens ?? 0,
                    outputTokens: usage.output_tokens ?? 0,
                    totalTokens: usage.total_tokens ?? 0,
                  }
                : null;
              outcome.rawMetadata = resp;
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
      }
      return outcome;
    },
  };
}
