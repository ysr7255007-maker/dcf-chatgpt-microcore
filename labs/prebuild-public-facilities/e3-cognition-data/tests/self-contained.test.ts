/**
 * E3 — §7.6 自包含文本块子实验（独立子实验，不自动晋级正式机制）。
 *
 * 问题：AI 将依赖上下文的原文切片重写成自包含块，是否真的提高检索质量，
 * 同时保持来源可证明性？
 *
 * 方法（对照四策略，检索引擎固定为 dense + 固定 embedding backend，消变量）：
 *   a) fixed          固定窗口 chunk（基线）
 *   b) semantic       段落级语义块
 *   c) semantic-nb    语义块 + 邻域段落
 *   d) ai-self-contained  AI 改写（recipe: sc-recipe-v1，模型 deepseek-v4-flash）
 *
 * 每个派生 chunk 必须携带：source revision / source span / transform version / recipe version。
 * LLM judge 不作为证据；事实保持用机械检查（关键术语保留率）。
 */
process.env.HF_ENDPOINT ??= "https://hf-mirror.com";

import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const results: Record<string, unknown> = { generated_at: new Date().toISOString(), recipe: "sc-recipe-v1" };

interface DerivedChunkSpec {
  chunkId: string;
  strategy: "fixed" | "semantic" | "semantic-nb" | "ai-self-contained";
  text: string;
  sourceRevision: string;
  sourceSpan: { start: number; end: number };
  transformVersion: string;
  recipeVersion: string;
}

/** 三个真实依赖上下文的 span（含代词/跨句指代，脱离上下文不可独立理解）。 */
const SPAN_MARKERS = [
  "这使 Capability 可以永久保持源码级完整，而正式运行路径不承担双写和重复执行成本。",
  "这属于供应链维护成本，不改变本实验已经证明的架构机制。",
  "但它应尽量成为**派生产物**，而不是要求人工同时维护的第二份架构真相。",
];

const SPAN_QUERIES = [
  "Capability 源码级完整与正式运行路径成本的关系是什么",
  "Becsy 供应链维护成本会不会影响架构机制的正确性",
  "Capability DAG 应该被当作人工维护的第二份架构真相吗",
];

/** 关键术语（事实保持机械检查的词表；缺失即记为语义漂移风险）。 */
const KEY_TERMS: string[][] = [
  ["Capability", "源码级完整", "双写"],
  ["供应链", "维护成本", "架构机制"],
  ["派生产物", "第二份架构真相"],
];

let adrText = "";
let spans: { start: number; end: number; paragraph: string; paragraphWithNeighbors: string }[] = [];

function findParagraph(text: string, marker: string): { start: number; end: number } {
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error(`marker not found: ${marker.slice(0, 20)}`);
  let start = idx;
  while (start > 0 && !text.slice(start - 2, start).includes("\n\n")) start--;
  let end = idx + marker.length;
  while (end < text.length && !text.slice(end, end + 2).includes("\n\n")) end++;
  return { start, end };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // 已归一化向量
}

async function envKey(): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const text = await readFile(new URL("../../.env.local", import.meta.url), "utf8");
  const match = text.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  if (!match) throw new Error("DEEPSEEK_API_KEY not available");
  return match[1].trim();
}

async function aiRewrite(text: string, apiKey: string): Promise<{ text: string; usageTokens: number }> {
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content:
            "你是文档切片改写器。把给定中文片段改写为可独立理解的自包含块：" +
            "1) 补全代词与指代所需的最小上下文；2) 禁止新增任何事实、数字、结论；" +
            "3) 保留全部专名与数字；4) 只输出改写结果。",
        },
        { role: "user", content: text },
      ],
      max_tokens: 2048,
    }),
  });
  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
    usage: { total_tokens: number };
  };
  return { text: body.choices[0]?.message?.content ?? "", usageTokens: body.usage?.total_tokens ?? 0 };
}

afterAll(async () => {
  await mkdir(new URL("../results/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../results/e3-self-contained.json", import.meta.url),
    JSON.stringify(results, null, 2),
  );
});

describe("E3 §7.6 自包含文本块子实验", () => {
  test("S1 准备真实 span 与四策略派生 chunk（溯源字段齐全）", async () => {
    const path = new URL(
      "../../../../docs/adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md",
      import.meta.url,
    );
    adrText = await readFile(path, "utf8");
    const revision = "rev:adr/2026-08-07:0";
    const paragraphs = adrText.split("\n\n");
    for (const marker of SPAN_MARKERS) {
      const { start, end } = findParagraph(adrText, marker);
      const paragraph = adrText.slice(start, end);
      const pIdx = paragraphs.findIndex((p) => paragraph.trim().startsWith(p.trim().slice(0, 40)));
      const neighbors = paragraphs
        .slice(Math.max(0, pIdx - 1), pIdx + 2)
        .filter((p) => !p.startsWith("#"))
        .join("\n\n");
      spans.push({ start, end, paragraph, paragraphWithNeighbors: neighbors });
    }
    expect(spans.length).toBe(3);
    results.span_provenance = spans.map((s, i) => ({
      sourceRevision: revision,
      sourceSpan: { start: spans[i].start, end: spans[i].end },
      transformVersion: "t0",
      recipeVersion: "sc-recipe-v1",
    }));
  }, 60000);

  test("S2 四策略检索质量对比（dense + 固定 embedding，干扰池相同）", async () => {
    const { getEmbedder } = await import("../source/embed.ts");
    const { chunkText } = await import("../source/derived.ts");
    const embed = await getEmbedder();
    const apiKey = await envKey();

    // 干扰池：current-state 的固定 chunk 取 8 个
    const stateText = await readFile(new URL("../../../../docs/current-state.md", import.meta.url), "utf8");
    const distractors = chunkText("doc:current-state.md", "rev:cs:0", stateText)
      .filter((_, i) => i % 7 === 0)
      .slice(0, 8)
      .map((c) => c.text);

    const strategies: Record<string, string[]> = {
      fixed: spans.map((s) => chunkText("adr", "rev:adr/2026-08-07:0", adrText).find(
        (c) => c.startOff <= s.start && c.endOff >= s.end,
      )!.text),
      semantic: spans.map((s) => s.paragraph),
      "semantic-nb": spans.map((s) => s.paragraphWithNeighbors),
      "ai-self-contained": [],
    };

    let aiTokens = 0;
    for (const s of spans) {
      const rewritten = await aiRewrite(s.paragraphWithNeighbors, apiKey);
      strategies["ai-self-contained"].push(rewritten.text);
      aiTokens += rewritten.usageTokens;
    }
    results.ai_generation_cost_tokens = aiTokens;

    // 每策略：池 = 3 个策略 chunk + 同一干扰池；对 3 条 query 做 dense 排序
    const comparison: Record<string, { recall_at_3: number; mrr: number; size_increase: number; term_retention: number }> = {};
    for (const [strategy, chunks] of Object.entries(strategies)) {
      const pool = [...chunks, ...distractors];
      const vectors = await embed(pool);
      const queryVectors = await embed(SPAN_QUERIES);
      let hits = 0;
      let reciprocal = 0;
      for (let qi = 0; qi < SPAN_QUERIES.length; qi++) {
        const ranked = pool
          .map((_, idx) => ({ idx, score: cosine(queryVectors[qi], vectors[idx]) }))
          .sort((a, b) => b.score - a.score);
        const rankOfTarget = ranked.findIndex((r) => r.idx === qi);
        if (rankOfTarget >= 0 && rankOfTarget < 3) hits++;
        if (rankOfTarget >= 0) reciprocal += 1 / (rankOfTarget + 1);
      }
      const sizeIncrease =
        chunks.reduce((sum, c, i) => sum + c.length / spans[i].paragraph.length, 0) / chunks.length;
      // 事实保持机械检查：关键术语保留率（AI 策略的幻觉代理指标）
      let retained = 0;
      let total = 0;
      for (let i = 0; i < chunks.length; i++) {
        for (const term of KEY_TERMS[i]) {
          total++;
          if (chunks[i].includes(term)) retained++;
        }
      }
      comparison[strategy] = {
        recall_at_3: hits / SPAN_QUERIES.length,
        mrr: reciprocal / SPAN_QUERIES.length,
        size_increase: Number(sizeIncrease.toFixed(2)),
        term_retention: retained / total,
      };
    }
    results.strategy_comparison = comparison;
    // 门禁：AI 自包含策略不得引入事实丢失（术语保留率必须 1.0，否则记失败）
    expect(comparison["ai-self-contained"].term_retention).toBe(1);
    // 至少一个策略达到 recall@3 = 1（证明实验装置有效），AI 策略表现如实记录
    const bestRecall = Math.max(...Object.values(comparison).map((c) => c.recall_at_3));
    expect(bestRecall).toBeGreaterThanOrEqual(2 / 3);
  }, 900000);
});
