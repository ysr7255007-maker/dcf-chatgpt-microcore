/**
 * E3 — SQLite Authority：正式认知权威的最小实验 schema（任务书 §7.2）。
 *
 * 只表达：object / revision / stable anchor / relation / time / kind/type / source。
 * 不提前设计生产 schema；FTS/embedding/向量全部不属于本层（可删除重算）。
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export interface IngestDoc {
  objectId: string;
  kind: string;
  source: string;
  time: number;
  text: string;
}

export class CognitionAuthority {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS objects (
        object_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        revision_id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL REFERENCES objects(object_id),
        content_hash TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS anchors (
        anchor_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES revisions(revision_id),
        start_off INTEGER NOT NULL,
        end_off INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relations (
        relation_id TEXT PRIMARY KEY,
        src_object TEXT NOT NULL,
        dst_object TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rev_object ON revisions(object_id);
      CREATE INDEX IF NOT EXISTS idx_anchor_rev ON anchors(revision_id);
    `);
  }

  /** 摄入一份文档：新对象创建；内容变化则追加不可变修订（永不覆盖）。 */
  ingest(doc: IngestDoc): { revisionId: string; isNewRevision: boolean } {
    const contentHash = createHash("sha256").update(doc.text).digest("hex");
    this.db
      .prepare("INSERT OR IGNORE INTO objects(object_id, kind, source) VALUES (?,?,?)")
      .run(doc.objectId, doc.kind, doc.source);
    const latest = this.db
      .prepare(
        "SELECT revision_id, content_hash, ordinal FROM revisions WHERE object_id=? ORDER BY ordinal DESC LIMIT 1",
      )
      .get(doc.objectId) as { revision_id: string; content_hash: string; ordinal: number } | null;
    if (latest && latest.content_hash === contentHash) {
      return { revisionId: latest.revision_id, isNewRevision: false };
    }
    const ordinal = latest ? latest.ordinal + 1 : 0;
    const revisionId = `rev:${doc.objectId}:${ordinal}`;
    this.db
      .prepare(
        "INSERT INTO revisions(revision_id, object_id, content_hash, ordinal, created_at, text) VALUES (?,?,?,?,?,?)",
      )
      .run(revisionId, doc.objectId, contentHash, ordinal, doc.time, doc.text);
    return { revisionId, isNewRevision: true };
  }

  addRelation(src: string, dst: string, kind: string, at: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO relations(relation_id, src_object, dst_object, kind, created_at) VALUES (?,?,?,?,?)",
      )
      .run(`rel:${src}:${dst}:${kind}`, src, dst, kind, at);
  }

  latestRevisionText(objectId: string): string | null {
    const row = this.db
      .prepare("SELECT text FROM revisions WHERE object_id=? ORDER BY ordinal DESC LIMIT 1")
      .get(objectId) as { text: string } | null;
    return row?.text ?? null;
  }

  revisionCount(): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM revisions").get() as { c: number }).c;
  }

  objectCount(): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM objects").get() as { c: number }).c;
  }

  /* ---- 权威查询（structured / exact / temporal / relationship） ---- */

  structuredQuery(kind: string): string[] {
    return (
      this.db
        .prepare("SELECT object_id FROM objects WHERE kind=? ORDER BY object_id")
        .all(kind) as { object_id: string }[]
    ).map((r) => r.object_id);
  }

  exactPhraseQuery(phrase: string): string[] {
    const pattern = `%${phrase}%`;
    return (
      this.db
        .prepare(
          `SELECT DISTINCT r.object_id FROM revisions r
           JOIN (SELECT object_id, MAX(ordinal) m FROM revisions GROUP BY object_id) l
             ON r.object_id=l.object_id AND r.ordinal=l.m
           WHERE r.text LIKE ? ORDER BY r.object_id`,
        )
        .all(pattern) as { object_id: string }[]
    ).map((r) => r.object_id);
  }

  temporalQuery(from: number, to: number): string[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT object_id FROM revisions WHERE created_at BETWEEN ? AND ? ORDER BY object_id",
        )
        .all(from, to) as { object_id: string }[]
    ).map((r) => r.object_id);
  }

  relationshipQuery(src: string, kind: string): string[] {
    return (
      this.db
        .prepare("SELECT dst_object FROM relations WHERE src_object=? AND kind=? ORDER BY dst_object")
        .all(src, kind) as { dst_object: string }[]
    ).map((r) => r.dst_object);
  }

  revisionHistory(objectId: string): { revision_id: string; ordinal: number; created_at: number }[] {
    return this.db
      .prepare("SELECT revision_id, ordinal, created_at FROM revisions WHERE object_id=? ORDER BY ordinal")
      .all(objectId) as { revision_id: string; ordinal: number; created_at: number }[];
  }

  close(): void {
    this.db.close();
  }
}
