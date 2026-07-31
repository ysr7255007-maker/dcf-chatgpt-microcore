import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      event_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      ended_at TEXT,
      context_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_ref TEXT,
      source_file TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facts_time ON facts(start_ms, end_ms);
    CREATE INDEX IF NOT EXISTS idx_facts_kind_time ON facts(kind, start_ms);

    CREATE TABLE IF NOT EXISTS anchors (
      anchor_id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      before_event_id TEXT NOT NULL,
      after_event_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      pivot_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      chain_start_ms INTEGER NOT NULL,
      chain_end_ms INTEGER NOT NULL,
      chain_action_count INTEGER NOT NULL,
      detector_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(before_event_id) REFERENCES facts(event_id),
      FOREIGN KEY(after_event_id) REFERENCES facts(event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_anchors_time ON anchors(start_ms, end_ms);

    CREATE TABLE IF NOT EXISTS bundles (
      bundle_id TEXT PRIMARY KEY,
      anchor_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      source_digest TEXT NOT NULL,
      output_path TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      prompt_view TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      UNIQUE(anchor_id, version),
      FOREIGN KEY(anchor_id) REFERENCES anchors(anchor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bundles_anchor ON bundles(anchor_id, version DESC);

    CREATE TABLE IF NOT EXISTS bundle_members (
      bundle_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      relation TEXT NOT NULL,
      PRIMARY KEY(bundle_id, event_id),
      FOREIGN KEY(bundle_id) REFERENCES bundles(bundle_id),
      FOREIGN KEY(event_id) REFERENCES facts(event_id)
    );
  `);
  return db;
}
