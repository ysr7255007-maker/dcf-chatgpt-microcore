/**
 * E5 — Action/Evidence 事实权威（bun:sqlite）。
 *
 * 计划 [修订1] 核心边界：
 *   ObservedEffect 是"现实已经发生什么"的事实，落在事实权威；
 *   本文件 **不是** Cognition SQLite Authority，不提供任何把事实"晋级"成
 *   认知对象/修订的路径。未来若需要进入长期认知，必须经过明确的认知形成/
 *   确认过程（本实验显式不实现该步，只登记边界）。
 */
import { Database } from "bun:sqlite";
import type { EvidenceRef, ObservedEffect } from "./contracts.ts";

export class FactAuthority {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS observed_effects (
        effect_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        reality_status TEXT NOT NULL CHECK (reality_status IN ('PASS','FAIL')),
        checks_json TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence_refs (
        evidence_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        occurrence_time INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS layer_boundary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cognition_promotion_path TEXT NOT NULL DEFAULT 'none'
      );
      INSERT OR IGNORE INTO layer_boundary(id, cognition_promotion_path) VALUES (1, 'none');
    `);
  }

  recordEffect(effect: ObservedEffect): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO observed_effects(effect_id, task_id, reality_status, checks_json, observed_at, recorded_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        `effect:${effect.taskId}:${effect.observedAt}`,
        effect.taskId,
        effect.realityStatus,
        JSON.stringify(effect.checks),
        effect.observedAt,
        Date.now(),
      );
  }

  recordEvidence(taskId: string, ref: EvidenceRef): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO evidence_refs(evidence_id, task_id, source_id, occurrence_time, payload) VALUES (?,?,?,?,?)",
      )
      .run(ref.evidenceId, taskId, ref.sourceId, ref.occurrenceTime, ref.payload);
  }

  /* ---- 事实可查询（Structured / Exact） ---- */

  queryEffectByTask(taskId: string): { reality_status: string; checks_json: string } | null {
    return (
      (this.db
        .prepare("SELECT reality_status, checks_json FROM observed_effects WHERE task_id=? ORDER BY observed_at DESC LIMIT 1")
        .get(taskId) as { reality_status: string; checks_json: string } | null) ?? null
    );
  }

  queryEffectsByStatus(status: "PASS" | "FAIL"): { task_id: string }[] {
    return this.db
      .prepare("SELECT task_id FROM observed_effects WHERE reality_status=?")
      .all(status) as { task_id: string }[];
  }

  queryEvidenceByTask(taskId: string): EvidenceRef[] {
    return (
      this.db
        .prepare("SELECT evidence_id, source_id, occurrence_time, payload FROM evidence_refs WHERE task_id=? ORDER BY occurrence_time")
        .all(taskId) as { evidence_id: string; source_id: string; occurrence_time: number; payload: string }[]
    ).map((r) => ({
      evidenceId: r.evidence_id,
      sourceId: r.source_id,
      occurrenceTime: r.occurrence_time,
      payload: r.payload,
    }));
  }

  /** 边界证明：认知晋级路径不存在（恒为 none；任何写入都会违反 CHECK/语义）。 */
  cognitionPromotionPath(): string {
    return (
      (this.db.prepare("SELECT cognition_promotion_path FROM layer_boundary WHERE id=1").get() as {
        cognition_promotion_path: string;
      }).cognition_promotion_path
    );
  }

  close(): void {
    this.db.close();
  }
}
