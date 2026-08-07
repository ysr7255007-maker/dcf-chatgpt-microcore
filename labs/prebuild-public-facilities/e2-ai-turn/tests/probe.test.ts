/**
 * E2 — 运行时探针（计划 [修订3]）：
 *   /v1/models 只证明模型 ID 存在；/v1/responses 的 wire format 必须独立探针。
 * 探针结果是 A2/A3 路径的开工前提，如实记录原始响应形状。
 */
import { describe, expect, test } from "bun:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";

async function envKey(): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const text = await readFile(new URL("../../.env.local", import.meta.url), "utf8");
  const match = text.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  if (!match) throw new Error("DEEPSEEK_API_KEY not available");
  return match[1].trim();
}

export { envKey };

describe("E2 运行时探针", () => {
  test("P1 /v1/models 核实模型 ID（不证明 wire format）", async () => {
    const key = await envKey();
    const response = await fetch("https://api.deepseek.com/v1/models", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { data: { id: string }[] };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("deepseek-v4-pro");
  }, 30000);

  test("P2 /v1/responses 最小 wire 探针（真值）", async () => {
    const key = await envKey();
    const response = await fetch("https://api.deepseek.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        input: "Reply with exactly one word: pong",
        max_output_tokens: 1024,
      }),
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as Record<string, unknown>;
    // Responses wire 形状核心字段
    expect(body.object).toBe("response");
    expect(Array.isArray(body.output)).toBe(true);
    expect(typeof body.usage).toBe("object");
    await mkdir(new URL("../results/", import.meta.url), { recursive: true });
    await writeFile(
      new URL("../results/probe-responses-shape.json", import.meta.url),
      JSON.stringify(
        {
          top_level_keys: Object.keys(body).sort(),
          status: body.status,
          output_item_types: (body.output as { type: string }[]).map((o) => o.type),
          usage: body.usage,
        },
        null,
        2,
      ),
    );
  }, 60000);
});
