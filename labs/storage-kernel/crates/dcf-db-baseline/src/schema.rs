//! Persistent schema for the conventional baseline.
//!
//! Creation order (handoff requirement):
//! 1. dataset_manifest
//! 2. records
//! 3. records_search_content
//! 4. records_fts (content='records_search_content')
//! 5. text_blocks
//!
//! FTS5 is only a candidate filter; exact positions are verified against the
//! canonical bytes stored in the independent zstd `.zstpack` file.

use anyhow::{Result, bail};
use rusqlite::Connection;

pub const SCHEMA_VERSION: i64 = 1;
pub const BLOCK_SIZE: usize = 256 * 1024;

pub fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS dataset_manifest (
            dataset_id TEXT PRIMARY KEY,
            projection_sha256 TEXT NOT NULL,
            projection_bytes INTEGER NOT NULL,
            schema_version INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS records (
            record_id INTEGER PRIMARY KEY,
            text_id TEXT NOT NULL,
            conversation_uuid TEXT NOT NULL,
            message_uuid TEXT NOT NULL,
            content_block_ordinal INTEGER NOT NULL,
            content_type TEXT NOT NULL,
            canonical_start INTEGER NOT NULL,
            canonical_end INTEGER NOT NULL,
            text_store_block_first INTEGER NOT NULL,
            text_store_block_last INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS records_canonical_start_idx
            ON records(canonical_start);

        CREATE TABLE IF NOT EXISTS records_search_content (
            record_id INTEGER PRIMARY KEY,
            searchable_text TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
            searchable_text,
            content='records_search_content',
            content_rowid='record_id',
            tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records_search_content BEGIN
            INSERT INTO records_fts(rowid, searchable_text)
            VALUES (new.record_id, new.searchable_text);
        END;
        CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records_search_content BEGIN
            INSERT INTO records_fts(records_fts, rowid, searchable_text)
            VALUES('delete', old.record_id, old.searchable_text);
        END;
        CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records_search_content BEGIN
            INSERT INTO records_fts(records_fts, rowid, searchable_text)
            VALUES('delete', old.record_id, old.searchable_text);
            INSERT INTO records_fts(rowid, searchable_text)
            VALUES (new.record_id, new.searchable_text);
        END;

        CREATE TABLE IF NOT EXISTS text_blocks (
            block_id INTEGER PRIMARY KEY,
            canonical_start INTEGER NOT NULL,
            canonical_end INTEGER NOT NULL,
            compressed_offset INTEGER NOT NULL,
            compressed_len INTEGER NOT NULL,
            uncompressed_len INTEGER NOT NULL,
            sha256 TEXT NOT NULL
        );
        "#,
    )?;
    Ok(())
}

/// Probe that the bundled SQLite really provides the FTS5 trigram tokenizer.
/// Fails loudly instead of silently substituting a full scan.
pub fn probe_trigram(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE temp.__dcf_trigram_probe USING fts5(x, tokenize='trigram');",
    )?;
    conn.execute_batch("DROP TABLE temp.__dcf_trigram_probe;")?;
    Ok(())
}

/// Validate that a `MATCH` string for FTS5 trigram returns a row for a known
/// substring (guards the candidate layer's recall for the tokenizer build).
pub fn trigram_recall_probe(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE temp.__dcf_trigram_recall USING fts5(x, tokenize='trigram');
         INSERT INTO temp.__dcf_trigram_recall(x) VALUES ('hello 架构世界 world'), ('\"input\" here');",
    )?;
    let zh: i64 = conn.query_row(
        "SELECT count(*) FROM temp.__dcf_trigram_recall WHERE x MATCH ?1",
        [fts_match_expr("架构世界")],
        |r| r.get(0),
    )?;
    let quote: i64 = conn.query_row(
        "SELECT count(*) FROM temp.__dcf_trigram_recall WHERE x MATCH ?1",
        [fts_match_expr("\"input\"")],
        |r| r.get(0),
    )?;
    conn.execute_batch("DROP TABLE temp.__dcf_trigram_recall;")?;
    if zh != 1 {
        bail!("trigram recall probe failed: zh row not found (got {})", zh);
    }
    if quote != 1 {
        bail!("trigram recall probe failed: quoted token row not found (got {})", quote);
    }
    Ok(())
}

/// FTS5 MATCH expression for an exact-substring candidate query.
/// The pattern is treated as one quoted phrase; embedded quotes are doubled.
pub fn fts_match_expr(pattern: &str) -> String {
    format!("\"{}\"", pattern.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        create_schema(&c).unwrap();
        c
    }

    #[test]
    fn schema_has_fact_fts_span_and_block_structures() {
        let c = conn();
        let mut names: Vec<String> = Vec::new();
        {
            let mut stmt = c.prepare(
                "SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name",
            )
            .unwrap();
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap();
            for r in rows {
                names.push(r.unwrap());
            }
        }
        for expected in [
            "dataset_manifest",
            "records",
            "records_search_content",
            "records_fts",
            "text_blocks",
            "records_canonical_start_idx",
        ] {
            assert!(names.iter().any(|n| n == expected), "missing {}", expected);
        }
        assert!(probe_trigram(&c).is_ok());
    }

    #[test]
    fn trigram_probe_finds_substrings() {
        let c = conn();
        assert!(trigram_recall_probe(&c).is_ok());
    }
}
