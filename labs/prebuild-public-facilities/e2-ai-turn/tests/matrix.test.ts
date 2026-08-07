/**
 * E2 — 能力矩阵：同一 DCF AI Turn Request 在三条路径上的真实行为。
 * 纪律：先写真值。每个组合记录 PASS / FAIL / UNSUPPORTED，不修改结果伪装通过。
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { makeA1, makeA2, makeA3, type TurnRoute } from "../source/routes.ts";

async function envKey(): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const text = await readFile(new URL("../../.env.local", import.meta.url), "utf8");
  const match = text.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  if (!match) throw new Error("DEEPSEEK_API_KEY not available");
  return match[1].trim();
}

const matrix: Record<string, Record<string, { status: string; detail: string }>> = {};
let apiKey = "";

function record(route: string, capability: string, status: string, detail: string): void {
  matrix[capability] = matrix[capability] ?? {};
  matrix[capability][route] = { status, detail: detail.slice(0, 300) };
}

async function guard(
  route: TurnRoute,
  capability: string,
  fn: () => Promise<{ status: string; detail: string }>,
): Promise<void> {
  try {
    const result = await fn();
    record(route.key, capability, result.status, result.detail);
  } catch (error) {
    record(route.key, capability, "FAIL", String(error));
  }
}

afterAll(async () => {
  await mkdir(new URL("../results/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../results/e2-matrix.json", import.meta.url),
    JSON.stringify({ generated_at: new Date().toISOString(), model: "deepseek-v4-flash", matrix }, null, 2),
  );
});

describe("E2 能力矩阵（deepseek-v4-flash，三路对比）", () => {
  test("M0 准备凭据与 routes", async () => {
    apiKey = await envKey();
    expect(apiKey.length).toBeGreaterThan(10);
  }, 30000);

  test("M1 普通 generate + usage + reasoning 观察", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey), makeA3()];
    for (const route of routes) {
      await guard(route, "generate", async () => {
        const outcome = await route.generate(
          { prompt: "What is 27*43? Answer with only the number.", maxOutputTokens: 2048 },
          apiKey,
        );
        const hasUsage = outcome.usage !== null && outcome.usage.totalTokens > 0;
        const mentions = /1161/.test(outcome.text) || /1161/.test(outcome.reasoningText);
        return {
          status: outcome.text.length > 0 || outcome.reasoningText.length > 0 ? "PASS" : "FAIL",
          detail: `text=${JSON.stringify(outcome.text.slice(0, 80))} reasoning=${outcome.reasoningText.length}B usage=${JSON.stringify(outcome.usage)} answer_ok=${mentions} finish=${outcome.finishReason}`,
        };
      });
    }
  }, 300000);

  test("M2 stream（delta 到达 + 最终一致）", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey), makeA3()];
    for (const route of routes) {
      await guard(route, "stream", async () => {
        let deltas = 0;
        const outcome = await route.stream(
          { prompt: "Count from 1 to 20, one number per line.", maxOutputTokens: 2048 },
          apiKey,
          () => deltas++,
        );
        return {
          status: deltas > 1 && outcome.text.length > 0 ? "PASS" : "FAIL",
          detail: `deltas=${deltas} finalLen=${outcome.text.length} finish=${outcome.finishReason}`,
        };
      });
    }
  }, 300000);

  test("M3 abort/cancel（执行中取消）", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey), makeA3()];
    for (const route of routes) {
      await guard(route, "abort", async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 600);
        try {
          await route.generate(
            {
              prompt: "Write a 2000 word essay about the history of typography.",
              maxOutputTokens: 8192,
              abortSignal: controller.signal,
            },
            apiKey,
          );
          return { status: "OBSERVED", detail: "completed before abort (too fast); recorded" };
        } catch (error) {
          const message = String(error);
          const aborted = /abort|cancel/i.test(message) || controller.signal.aborted;
          return {
            status: aborted ? "PASS" : "FAIL",
            detail: `error=${message.slice(0, 160)}`,
          };
        }
      });
    }
  }, 300000);

  test("M4 structured output（含非法输出处理）", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey), makeA3()];
    const schema = z.object({ capital: z.string(), population_estimate: z.number() });
    for (const route of routes) {
      await guard(route, "structured_output", async () => {
        if (route.key === "A3") {
          return { status: "NOT_IMPLEMENTED", detail: "A3 为极小对照，不承担 structured output 实现（任务书纪律）" };
        }
        try {
          const outcome = await route.generate(
            {
              prompt: "Return the capital of France and a rough population estimate.",
              maxOutputTokens: 2048,
              structured: schema,
            },
            apiKey,
          );
          const value = outcome.structured as { capital?: string } | undefined;
          const ok = value && typeof value === "object" && typeof value.capital === "string";
          return {
            status: ok ? "PASS" : "FAIL",
            detail: `structured=${JSON.stringify(outcome.structured).slice(0, 160)} text=${JSON.stringify(outcome.text.slice(0, 60))}`,
          };
        } catch (error) {
          return { status: "FAIL", detail: String(error) };
        }
      });
    }
  }, 300000);

  test("M5 tool call + tool 执行失败（A1/A2）", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey)];
    for (const route of routes) {
      await guard(route, "tool_call", async () => {
        try {
          const outcome = await route.generate(
            {
              prompt: "Use the add tool to compute 1234 + 5678. Then answer with only the number.",
              maxOutputTokens: 2048,
              withTool: true,
            },
            apiKey,
          );
          return {
            status: "OBSERVED",
            detail: `text=${JSON.stringify(outcome.text.slice(0, 100))} finish=${outcome.finishReason}`,
          };
        } catch (error) {
          return { status: "FAIL", detail: String(error) };
        }
      });
      await guard(route, "tool_execution_failure", async () => {
        try {
          const outcome = await route.generate(
            {
              prompt: "Use the add tool to compute 1 + 2.",
              maxOutputTokens: 2048,
              withTool: true,
              toolShouldFail: true,
            },
            apiKey,
          );
          return {
            status: "OBSERVED",
            detail: `survived; finish=${outcome.finishReason} text=${JSON.stringify(outcome.text.slice(0, 80))}`,
          };
        } catch (error) {
          return { status: "OBSERVED", detail: `error-surfaced=${String(error).slice(0, 160)}` };
        }
      });
    }
    record("A3", "tool_call", "NOT_IMPLEMENTED", "A3 极小对照不承担 tool loop");
    record("A3", "tool_execution_failure", "NOT_IMPLEMENTED", "A3 极小对照不承担 tool loop");
  }, 600000);

  test("M6 provider error（非法模型 ID 的错误表面）", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey)];
    for (const route of routes) {
      await guard(route, "provider_error", async () => {
        try {
          const badRoute =
            route.key === "A1"
              ? { ...route, generate: route.generate }
              : route;
          // 直接用错误模型 ID 构造请求（不污染正式 route）
          const { generateText } = await import("ai");
          const { createDeepSeek } = await import("@ai-sdk/deepseek");
          const { createOpenAI } = await import("@ai-sdk/openai");
          const model =
            route.key === "A1"
              ? createDeepSeek({ apiKey })("deepseek-no-such-model")
              : createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey }).responses("deepseek-no-such-model");
          await generateText({ model, prompt: "hi", maxOutputTokens: 64 });
          return { status: "FAIL", detail: "expected provider error but call succeeded" };
        } catch (error) {
          return {
            status: "PASS",
            detail: `classified error: ${String(error).slice(0, 200)}`,
          };
        }
      });
    }
  }, 180000);

  test("M7 raw metadata escape hatch", async () => {
    const routes = [makeA1(apiKey), makeA2(apiKey), makeA3()];
    for (const route of routes) {
      await guard(route, "escape_hatch", async () => {
        const outcome = await route.generate(
          { prompt: "Reply with exactly one word: meta.", maxOutputTokens: 1024 },
          apiKey,
        );
        const has = outcome.rawMetadata !== undefined && outcome.rawMetadata !== null;
        return {
          status: has ? "PASS" : "FAIL",
          detail: `rawMetadata keys=${has ? Object.keys(outcome.rawMetadata as object).slice(0, 10).join(",") : "none"}`,
        };
      });
    }
  }, 300000);

  test("M8 矩阵完整性（所有组合都有记录）", async () => {
    const capabilities = [
      "generate",
      "stream",
      "abort",
      "structured_output",
      "tool_call",
      "tool_execution_failure",
      "provider_error",
      "escape_hatch",
    ];
    for (const capability of capabilities) {
      expect(matrix[capability], `capability ${capability} missing`).toBeDefined();
    }
    // A1/A2 必须覆盖全部；A3 至少覆盖 generate/stream/abort/escape_hatch
    for (const capability of ["generate", "stream", "abort", "escape_hatch"]) {
      expect(matrix[capability].A3, `A3 ${capability} missing`).toBeDefined();
    }
  });
});
