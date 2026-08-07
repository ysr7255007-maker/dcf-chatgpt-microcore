/**
 * E3 — SQLite Authority × 派生认知检索（任务书 §7）。
 * 纪律：先写真值，再跑实现（§12.1）。query truth 在任何检索执行前冻结。
 */
process.env.HF_ENDPOINT ??= "https://hf-mirror.com";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CognitionAuthority } from "../source/authority.ts";
import { DerivedWorld, chunkText } from "../source/derived.ts";
import { QueryStrategy, rrf } from "../source/query-strategy.ts";
import { loadCorpus } from "../source/corpus.ts";
import { EMBEDDING_BACKEND } from "../source/embed.ts";

const DERIVED_DIR = new URL("../derived/main.lance", import.meta.url).pathname;
const AUTHORITY_DB = new URL("../derived/authority.db", import.meta.url).pathname;

/* ---------- 真值（冻结于任何检索之前） ---------- */

interface TruthQuery {
  id: string;
  query: string;
  expectedObject: string;
  kind: "semantic" | "lexical";
}

const QUERY_TRUTH: TruthQuery[] = [
  {
    id: "q1",
    query: "World Composer 的 LOC 预算是多少",
    expectedObject: "doc:adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md",
    kind: "semantic",
  },
  {
    id: "q2",
    query: "哪些内容不属于正式认知权威而必须可以删除重算",
    expectedObject: "doc:current-state.md",
    kind: "semantic",
  },
  {
    id: "q3",
    query: "重复代码允许存在 重复运行权威不允许",
    expectedObject: "doc:adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md",
    kind: "lexical",
  },
  {
    id: "q4",
    query: "为什么不预存所有语义关系而由查询临时计算",
    expectedObject: "doc:spec/2026-08-06-DCF-锚定认知世界与查询求解公共能力规范.md",
    kind: "semantic",
  },
  {
    id: "q5",
    query: "功能包络的正式施工资格如何判定",
    expectedObject: "doc:spec/2026-08-06-DCF-功能包络与施工控制规范.md",
    kind: "semantic",
  },
  {
    id: "q6",
    query: "Capability 脱离 DCF 语境仍然独立的四个条件",
    expectedObject: "doc:adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md",
    kind: "semantic",
  },
  {
    id: "q7",
    query: "查询晋级路线 词法基线 FTS5 中文词法",
    expectedObject: "doc:current-state.md",
    kind: "lexical",
  },
  {
    id: "q8",
    query: "稳定认知对象与不可变修订的第一个样板包络",
    expectedObject: "doc:current-state.md",
    kind: "semantic",
  },
];

const results: Record<string, unknown> = {
  generated_at: new Date().toISOString(),
  embedding_backend: EMBEDDING_BACKEND,
  query_truth: QUERY_TRUTH,
};

let authority: CognitionAuthority;
let derived: DerivedWorld;
let expectedChunkTotal = 0;

function recallAtK(ranked: { objectId: string }[], expected: string, k: number): number {
  return ranked.slice(0, k).some((h) => h.objectId === expected) ? 1 : 0;
}

function evaluate(name: string, perQuery: Record<string, { objectId: string }[]>): void {
  const k = 5;
  let hits = 0;
  let reciprocal = 0;
  for (const truth of QUERY_TRUTH) {
    const ranking = perQuery[truth.id] ?? [];
    hits += recallAtK(ranking, truth.expectedObject, k);
    const idx = ranking.findIndex((h) => h.objectId === truth.expectedObject);
    if (idx >= 0) reciprocal += 1 / (idx + 1);
  }
  results[`engine_${name}`] = {
    recall_at_5: hits / QUERY_TRUTH.length,
    mrr: reciprocal / QUERY_TRUTH.length,
  };
}

beforeAll(async () => {
  // clean state 纪律：每次套件启动自清残留（派生目录与权威 DB 均为运行时产物）
  await rm(new URL("../derived/", import.meta.url), { recursive: true, force: true });
  await mkdir(new URL("../derived/", import.meta.url), { recursive: true });
  await mkdir(new URL("../results/", import.meta.url), { recursive: true });
});

afterAll(async () => {
  await writeFile(
    new URL("../results/e3-results.json", import.meta.url),
    JSON.stringify(results, null, 2),
  );
  authority?.close();
});

describe("E3 认知数据架构", () => {
  test("T1 摄入真实语料进 SQLite 权威（object/revision/不可变）", async () => {
    authority = new CognitionAuthority(AUTHORITY_DB);
    const corpus = await loadCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(14);
    for (const doc of corpus) authority.ingest(doc);
    expect(authority.objectCount()).toBe(corpus.length);
    expect(authority.revisionCount()).toBe(corpus.length);
    // 幂等：重复摄入不产生新修订（内容哈希相同）
    for (const doc of corpus) authority.ingest(doc);
    expect(authority.revisionCount()).toBe(corpus.length);
    results.corpus = { objects: authority.objectCount(), revisions: authority.revisionCount() };
  }, 60000);

  test("T2 派生世界从权威全量构建（SQLite 不动）", async () => {
    const revisionsBefore = authority.revisionCount();
    derived = new DerivedWorld(DERIVED_DIR);
    await derived.open();
    const outcome = await derived.rebuild(authority);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.chunks).toBeGreaterThan(100);
    expect(await derived.rowCount()).toBe(outcome.chunks);
    expectedChunkTotal = outcome.chunks;
    // 派生构建不得触碰权威
    expect(authority.revisionCount()).toBe(revisionsBefore);
    const manifest = JSON.parse(
      await readFile(join(DERIVED_DIR, "build-manifest.json"), "utf8"),
    );
    expect(manifest.state).toBe("complete");
    expect(manifest.expectedChunks).toBe(manifest.writtenChunks);
  }, 900000);

  test("T3 引擎矩阵：structured/exact/temporal/relationship/dense/fts/hybrid", async () => {
    // structured / temporal / relationship（SQLite 权威引擎）
    const specs = authority.structuredQuery("spec");
    expect(specs.length).toBeGreaterThanOrEqual(11);
    const adrs = authority.structuredQuery("adr");
    expect(adrs.length).toBe(2);
    const temporal = authority.temporalQuery(0, Date.now() + 86400000);
    expect(temporal.length).toBe(authority.objectCount());
    authority.addRelation(
      "doc:current-state.md",
      "doc:adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md",
      "related",
      Date.now(),
    );
    const rel = authority.relationshipQuery("doc:current-state.md", "related");
    expect(rel.length).toBe(1);

    // exact/phrase（权威层）
    const exact = authority.exactPhraseQuery("重复运行权威不允许存在");
    expect(exact).toContain(
      "doc:adr/2026-08-07-capability-world-composition-runtime-seam-absorption.md",
    );

    // dense / fts / hybrid（派生引擎 + 策略）
    const perQueryDense: Record<string, { objectId: string }[]> = {};
    const perQueryFts: Record<string, { objectId: string }[]> = {};
    const perQueryHybrid: Record<string, { objectId: string }[]> = {};
    const strategy = new QueryStrategy(authority, derived);
    for (const truth of QUERY_TRUTH) {
      perQueryDense[truth.id] = await derived.denseQuery(truth.query, 10);
      perQueryFts[truth.id] = await derived.ftsQuery(truth.query, 10);
      perQueryHybrid[truth.id] = await strategy.hybrid(truth.query, { k: 10 });
    }
    evaluate("dense", perQueryDense);
    evaluate("lance_fts", perQueryFts);
    evaluate("hybrid_rrf", perQueryHybrid);
    const dense = results.engine_dense as { recall_at_5: number };
    const hybrid = results.engine_hybrid_rrf as { recall_at_5: number };
    // 门禁：真实语料上语义检索必须显著工作（不允许零召回冒充通过）
    expect(dense.recall_at_5).toBeGreaterThanOrEqual(0.5);
    expect(hybrid.recall_at_5).toBeGreaterThanOrEqual(dense.recall_at_5);
  }, 900000);

  test("T4 派生世界破坏实验：全删重建，权威无损", async () => {
    const objectsBefore = authority.objectCount();
    const revisionsBefore = authority.revisionCount();
    const truthText = authority.latestRevisionText("doc:current-state.md");
    // 删除前基线：逐条真值的 dense 命中集合（重建后必须逐条一致）
    const baseline: Record<string, boolean> = {};
    for (const truth of QUERY_TRUTH) {
      const hits = await derived.denseQuery(truth.query, 5);
      baseline[truth.id] = hits.some((h) => h.objectId === truth.expectedObject);
    }
    // 完整删除派生数据（表级；同一连接）
    await derived.destroy();
    expect(await derived.rowCount()).toBe(0); // 派生真空
    // 权威完全无损：对象/revision/锚点文本/不可变历史
    expect(authority.objectCount()).toBe(objectsBefore);
    expect(authority.revisionCount()).toBe(revisionsBefore);
    expect(authority.latestRevisionText("doc:current-state.md")).toBe(truthText);
    // 重建：query truth 的命中集合与删除前逐条一致（确定性恢复）
    const outcome = await derived.rebuild(authority);
    expect(outcome.chunks).toBe(expectedChunkTotal);
    const after: Record<string, boolean> = {};
    for (const truth of QUERY_TRUTH) {
      const hits = await derived.denseQuery(truth.query, 5);
      after[truth.id] = hits.some((h) => h.objectId === truth.expectedObject);
    }
    expect(after).toEqual(baseline);
    results.destruction_full_rebuild = {
      pass: true,
      chunksRestored: outcome.chunks,
      baselineHits: Object.values(baseline).filter(Boolean).length,
      afterHits: Object.values(after).filter(Boolean).length,
    };

    // 变体：文件系统级删除后新连接重建（interrupt 目录）
    const fsDeletedDir = new URL("../derived/fs-delete.lance", import.meta.url).pathname;
    const first = new DerivedWorld(fsDeletedDir);
    await first.open();
    await first.rebuild(authority, { interruptAfter: 30 });
    await rm(fsDeletedDir, { recursive: true, force: true });
    const second = new DerivedWorld(fsDeletedDir);
    await second.open();
    expect(await second.rowCount()).toBe(0); // 删除后真空，无残留权威
    const rebuilt = await second.rebuild(authority);
    expect(rebuilt.chunks).toBe(expectedChunkTotal);
    results.destruction_fs_delete_rebuild = { pass: true };
  }, 1500000);

  test("T5 半途中断：必须可观察 incomplete（禁止表面 healthy）", async () => {
    const interrupted = new DerivedWorld(new URL("../derived/interrupt.lance", import.meta.url).pathname);
    await interrupted.open();
    const outcome = await interrupted.rebuild(authority, { interruptAfter: 50 });
    expect(outcome.interrupted).toBe(true);
    expect(outcome.chunks).toBeLessThan(expectedChunkTotal);
    const manifest = JSON.parse(
      await readFile(
        new URL("../derived/interrupt.lance/build-manifest.json", import.meta.url),
        "utf8",
      ),
    );
    // 关键断言：状态明确为 interrupted，且数字暴露缺口
    expect(manifest.state).toBe("interrupted");
    expect(manifest.writtenChunks).toBeLessThan(manifest.expectedChunks);
    results.destruction_interrupted = { manifest };
  }, 900000);

  test("T6 新 revision + 派生更新失败：权威历史仍然正确", async () => {
    const objectId = "doc:current-state.md";
    const before = authority.revisionHistory(objectId).length;
    const oldText = authority.latestRevisionText(objectId)!;
    authority.ingest({
      objectId,
      kind: "state",
      source: "repo:docs",
      time: Date.now(),
      text: oldText + "\n\n# 追加修订标记 E3-T6\n",
    });
    expect(authority.revisionHistory(objectId).length).toBe(before + 1);
    // 模拟派生索引更新失败（什么都不做）：权威查询仍必须正确
    expect(authority.latestRevisionText(objectId)).toContain("追加修订标记 E3-T6");
    const history = authority.revisionHistory(objectId);
    expect(history.map((h) => h.ordinal)).toEqual([0, 1]);
    // 派生世界对此对象陈旧 —— 用 manifest/行数不变证明它没有假装更新
    expect(await derived.rowCount()).toBe(expectedChunkTotal);
    results.stale_derived_after_new_revision = { pass: true };
    // 恢复：重摄入原文，避免污染后续测试
    authority.ingest({ objectId, kind: "state", source: "repo:docs", time: Date.now(), text: oldText });
  }, 60000);

  test("T7 7.7 Query Strategy 组合验证（temporal + gravity 最小形态）", async () => {
    const strategy = new QueryStrategy(authority, derived);
    // temporal constraint：窗口收紧到未来则无结果（约束真实生效）
    const empty = await strategy.hybrid(QUERY_TRUTH[0].query, {
      k: 5,
      timeWindow: { from: Date.now() + 100000, to: Date.now() + 200000 },
    });
    expect(empty.length).toBe(0);
    // 正常窗口：有结果
    const normal = await strategy.hybrid(QUERY_TRUTH[0].query, {
      k: 5,
      timeWindow: { from: 0, to: Date.now() + 100000 },
    });
    expect(normal.length).toBeGreaterThan(0);
    // 语义引力场最小形态：作为 Query Strategy 存在并消费权威关系，不拥有索引
    const gravity = await strategy.hybrid("Capability World 组合与当前状态", {
      k: 5,
      gravitySeeds: ["doc:current-state.md"],
    });
    expect(gravity.length).toBeGreaterThan(0);
    // RRF 纯函数性质：两路相同排名 → 融合分单调
    const fused = rrf([[{ objectId: "a", score: 0 }], [{ objectId: "a", score: 0 }]]);
    expect(fused[0].objectId).toBe("a");
    results.query_strategy = { temporal_gate: "PASS", gravity_minimal: "PASS" };
  }, 300000);
});
