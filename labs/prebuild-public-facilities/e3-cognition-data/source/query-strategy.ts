/**
 * E3 — 极薄 Query Strategy（任务书 §7.7）。
 *
 * 立场：Query Strategy 组合 Engines，而不重新拥有索引。
 * 本文件不建表、不写数据，只组合已存在引擎的查询结果。
 */
import type { CognitionAuthority } from "./authority.ts";
import type { DerivedWorld } from "./derived.ts";

export interface Hit {
  objectId: string;
  score: number;
}

export interface StrategyOptions {
  k?: number;
  /** 时间窗约束（temporal constraint）：只保留该窗口内有修订的对象。 */
  timeWindow?: { from: number; to: number };
  /** 语义引力场最小形态：以种子对象的锚点邻域对候选加权（架构验证，不追求算法完整）。 */
  gravitySeeds?: string[];
}

/** Reciprocal Rank Fusion：多路召回按排名融合，不假设可比分数。 */
export function rrf(ranks: Hit[][], kConst = 60): Hit[] {
  const fused = new Map<string, number>();
  for (const ranking of ranks) {
    ranking.forEach((hit, rank) => {
      fused.set(hit.objectId, (fused.get(hit.objectId) ?? 0) + 1 / (kConst + rank + 1));
    });
  }
  return [...fused.entries()]
    .map(([objectId, score]) => ({ objectId, score }))
    .sort((a, b) => b.score - a.score);
}

function toObjectRanking(hits: { objectId: string }[], limit: number): Hit[] {
  const seen = new Map<string, number>();
  for (const hit of hits) {
    if (!seen.has(hit.objectId)) seen.set(hit.objectId, seen.size);
    if (seen.size >= limit * 2) break;
  }
  return [...seen.entries()].map(([objectId, rank]) => ({ objectId, score: 1 / (rank + 1) }));
}

export class QueryStrategy {
  constructor(
    private authority: CognitionAuthority,
    private derived: DerivedWorld,
  ) {}

  /** Lexical + Dense + Temporal constraint + RRF。 */
  async hybrid(query: string, options: StrategyOptions = {}): Promise<Hit[]> {
    const k = options.k ?? 5;
    const dense = toObjectRanking(await this.derived.denseQuery(query, k * 4), k * 4);
    const lexical = toObjectRanking(await this.derived.ftsQuery(query, k * 4), k * 4);
    let fused = rrf([dense, lexical]);

    if (options.timeWindow) {
      const allowed = new Set(
        this.authority.temporalQuery(options.timeWindow.from, options.timeWindow.to),
      );
      fused = fused.filter((hit) => allowed.has(hit.objectId));
    }

    if (options.gravitySeeds && options.gravitySeeds.length > 0) {
      // 最小语义引力场：与种子对象存在显式关系的候选获得邻域加权。
      // 只证明"它可以作为一个 Query Strategy 存在"，不追求完整算法。
      const neighbors = new Set<string>();
      for (const seed of options.gravitySeeds) {
        for (const dst of this.authority.relationshipQuery(seed, "related")) {
          neighbors.add(dst);
        }
      }
      fused = fused
        .map((hit) => ({ ...hit, score: hit.score * (neighbors.has(hit.objectId) ? 1.5 : 1) }))
        .sort((a, b) => b.score - a.score);
    }
    return fused.slice(0, k);
  }
}
