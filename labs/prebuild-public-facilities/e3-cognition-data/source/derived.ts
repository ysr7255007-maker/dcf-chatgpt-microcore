/**
 * E3 — Derived Retrieval（LanceDB embedded）。
 *
 * 立场（任务书 §7.4）：本层永远是 Derived Retrieval——
 * 可整体删除、可从 SQLite Authority 重建；正式历史权威不经过这里。
 */
import * as lancedb from "@lancedb/lancedb";
import { writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getEmbedder } from "./embed.ts";
import type { CognitionAuthority } from "./authority.ts";

export interface DerivedChunk {
  chunkId: string;
  objectId: string;
  revisionId: string;
  /** 来源 span（稳定锚点引用）：byte offset 对，相对 revision 文本。 */
  startOff: number;
  endOff: number;
  text: string;
  /** 派生配方版本（重建可追溯）。 */
  recipe: string;
}

export const CHUNK_RECIPE = "fixed-600-overlap-100-v1";

/** 固定 chunk 切分（baseline 策略；语义/AI 策略在 7.6 子实验对比）。 */
export function chunkText(objectId: string, revisionId: string, text: string): DerivedChunk[] {
  const size = 600;
  const overlap = 100;
  const chunks: DerivedChunk[] = [];
  let start = 0;
  let i = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push({
      chunkId: `${revisionId}:c${i}`,
      objectId,
      revisionId,
      startOff: start,
      endOff: end,
      text: text.slice(start, end),
      recipe: CHUNK_RECIPE,
    });
    if (end >= text.length) break;
    start = end - overlap;
    i++;
  }
  return chunks;
}

export class DerivedWorld {
  private db!: lancedb.Connection;
  private table!: lancedb.Table;
  readonly uri: string;
  private tableName = "chunks";

  constructor(uri: string) {
    this.uri = uri;
  }

  async open(): Promise<void> {
    this.db = await lancedb.connect(this.uri);
    const names = await this.db.tableNames();
    if (names.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName);
    }
  }

  get isOpen(): boolean {
    return this.table !== undefined;
  }

  /**
   * 从权威层全量重建派生索引。
   * interruptAfter 用于"半途中断"破坏实验：写入 N 条后抛出，模拟 kill。
   */
  async rebuild(
    authority: CognitionAuthority,
    opts?: { interruptAfter?: number },
  ): Promise<{ chunks: number; interrupted: boolean }> {
    const rows = authority.db
      .prepare(
        `SELECT r.revision_id, r.object_id, r.text FROM revisions r
         JOIN (SELECT object_id, MAX(ordinal) m FROM revisions GROUP BY object_id) l
           ON r.object_id = l.object_id AND r.ordinal = l.m`,
      )
      .all() as { revision_id: string; object_id: string; text: string }[];

    const allChunks: DerivedChunk[] = [];
    for (const row of rows) {
      allChunks.push(...chunkText(row.object_id, row.revision_id, row.text));
    }
    const embed = await getEmbedder();
    const texts = allChunks.map((c) => c.text);
    const vectors = await embed(texts);

    const records = allChunks.map((c, i) => ({
      chunk_id: c.chunkId,
      object_id: c.objectId,
      revision_id: c.revisionId,
      start_off: c.startOff,
      end_off: c.endOff,
      text: c.text,
      recipe: c.recipe,
      vector: vectors[i],
    }));

    // 重建 = 删除旧表 + 写入（派生世界没有"就地修补权威"的路径）
    const names = await this.db.tableNames();
    if (names.includes(this.tableName)) {
      await this.db.dropTable(this.tableName);
    }

    const interruptAfter = opts?.interruptAfter ?? Infinity;
    const batch = 64;
    let written = 0;
    // 构建状态清单：任何时刻都能回答"索引是否 complete/fresh"（禁止表面 healthy）。
    const writeManifest = async (state: "building" | "complete" | "interrupted") => {
      await writeFile(
        join(this.uri, "build-manifest.json"),
        JSON.stringify({
          state,
          expectedChunks: records.length,
          writtenChunks: written,
          recipe: CHUNK_RECIPE,
          at: new Date().toISOString(),
        }, null, 2),
      );
    };
    await writeManifest("building");
    for (let i = 0; i < records.length; i += batch) {
      const slice = records.slice(i, i + batch);
      if (!this.table || written === 0) {
        this.table = await this.db.createTable(this.tableName, slice, { mode: "overwrite" });
      } else {
        await this.table.add(slice);
      }
      written += slice.length;
      if (written >= interruptAfter) {
        await writeManifest("interrupted");
        return { chunks: written, interrupted: true };
      }
    }
    await this.table.createIndex("text", {
      config: lancedb.Index.fts(),
      replace: true,
    });
    await writeManifest("complete");
    return { chunks: written, interrupted: false };
  }

  async rowCount(): Promise<number> {
    if (!this.table) return 0;
    return this.table.countRows();
  }

  /** 完整删除派生数据（同连接内表级删除；SQLite 权威不受影响）。 */
  async destroy(): Promise<void> {
    const names = await this.db.tableNames();
    if (names.includes(this.tableName)) {
      await this.db.dropTable(this.tableName);
    }
    this.table = undefined as unknown as lancedb.Table;
    await rm(join(this.uri, "build-manifest.json"), { force: true });
  }

  /** 向量检索（dense engine）。 */
  async denseQuery(query: string, k: number): Promise<{ chunkId: string; objectId: string; score: number }[]> {
    const embed = await getEmbedder();
    const [vec] = await embed([query]);
    const results = await this.table.query().nearestTo(vec).limit(k).toArray();
    return results.map((r) => ({
      chunkId: String(r.chunk_id),
      objectId: String(r.object_id),
      score: Number(r._distance ?? 0),
    }));
  }

  /** Lance FTS 检索（lexical engine 之一；与 SQLite 权威层 FTS 无关）。 */
  async ftsQuery(query: string, k: number): Promise<{ chunkId: string; objectId: string; score: number }[]> {
    try {
      const results = await this.table
        .query()
        .where(`text MATCHES '${query.replace(/'/g, "''")}'`)
        .limit(k)
        .toArray();
      return results.map((r) => ({
        chunkId: String(r.chunk_id),
        objectId: String(r.object_id),
        score: Number(r.score ?? 0),
      }));
    } catch {
      return [];
    }
  }

  async close(): Promise<void> {
    // lancedb connection 无显式 close；依赖进程退出
  }
}
