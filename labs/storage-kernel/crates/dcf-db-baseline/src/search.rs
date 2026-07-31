//! Exact-substring search over the conventional baseline.
//!
//! FTS5 trigram narrows the candidate *records*; exact canonical byte spans are
//! produced by overlapping byte search over the canonical bytes decompressed
//! from the independent zstd block store. Patterns shorter than three Unicode
//! scalars cannot use the trigram candidate layer and take the measured
//! `short_query_full_record_scan` path (scanning record bodies, not a hidden
//! optimization).

use anyhow::Result;
use rusqlite::{Connection, params};

use crate::store::TextBlockStore;

#[derive(Clone, Debug)]
pub struct CanonicalHit {
    pub text_id: String,
    pub start: u64,
    pub end: u64,
    pub conversation_uuid: String,
    pub message_uuid: String,
    pub content_block_ordinal: i64,
    pub content_type: String,
}

#[derive(Clone, Debug)]
pub struct SearchResult {
    pub operation_path: String,
    pub total: usize,
    pub returned: usize,
    pub hits: Vec<CanonicalHit>,
}

/// Count of Unicode scalar values in the pattern.
pub fn unicode_scalars(pattern: &str) -> usize {
    pattern.chars().count()
}

fn overlapping_occurrences(haystack: &[u8], needle: &[u8], base: u64) -> Vec<u64> {
    let mut out = Vec::new();
    if needle.is_empty() || needle.len() > haystack.len() {
        return out;
    }
    let mut i = 0usize;
    while i + needle.len() <= haystack.len() {
        if &haystack[i..i + needle.len()] == needle {
            out.push(base + i as u64);
            i += needle.len();
        } else {
            i += 1;
        }
    }
    out
}

/// Records in canonical order with their stored provenance.
fn records_in_canonical_order(conn: &Connection) -> Result<Vec<(i64, String, String, String, i64, String, u64, u64)>> {
    let mut stmt = conn.prepare(
        "SELECT record_id, text_id, conversation_uuid, message_uuid, \
         content_block_ordinal, content_type, canonical_start, canonical_end \
         FROM records ORDER BY canonical_start",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, u64>(6)?,
            r.get::<_, u64>(7)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn fts_candidate_record_ids(conn: &Connection, pattern: &str) -> Result<Vec<i64>> {
    let expr = crate::schema::fts_match_expr(pattern);
    let mut stmt = conn.prepare(
        "SELECT rowid FROM records_fts WHERE records_fts MATCH ?1",
    )?;
    let rows = stmt.query_map(params![expr], |r| r.get::<_, i64>(0))?;
    let mut ids = Vec::new();
    for r in rows {
        ids.push(r?);
    }
    Ok(ids)
}

/// Run exact search. `limit`: 0 = all occurrences; otherwise cap at `limit`
/// occurrences ordered by canonical position.
pub fn exact_search(store: &mut TextBlockStore, conn: &Connection, pattern: &str, limit: usize) -> Result<SearchResult> {
    let needle = pattern.as_bytes();
    let short = unicode_scalars(pattern) < 3;

    let records = records_in_canonical_order(conn)?;
    let mut hits: Vec<CanonicalHit> = Vec::new();
    let operation_path = if short {
        "short_query_full_record_scan".to_string()
    } else {
        "fts_trigram_verify".to_string()
    };

    if short {
        // Full record-body scan (measured residual, never hidden).
        for (_rid, text_id, conv, msg, ord, ctype, start, end) in &records {
            let body = store.extract(*start, *end)?;
            for pos in overlapping_occurrences(&body, needle, *start) {
                hits.push(CanonicalHit {
                    text_id: text_id.clone(),
                    start: pos,
                    end: pos + needle.len() as u64,
                    conversation_uuid: conv.clone(),
                    message_uuid: msg.clone(),
                    content_block_ordinal: *ord,
                    content_type: ctype.clone(),
                });
            }
        }
    } else {
        // FTS candidates -> exact verification against canonical bytes.
        let candidates = fts_candidate_record_ids(conn, pattern)?;
        let by_id: std::collections::HashMap<i64, &(i64, String, String, String, i64, String, u64, u64)> =
            records.iter().map(|r| (r.0, r)).collect();
        for rid in candidates {
            let Some(r) = by_id.get(&rid) else { continue };
            let body = store.extract(r.6, r.7)?;
            for pos in overlapping_occurrences(&body, needle, r.6) {
                hits.push(CanonicalHit {
                    text_id: r.1.clone(),
                    start: pos,
                    end: pos + needle.len() as u64,
                    conversation_uuid: r.2.clone(),
                    message_uuid: r.3.clone(),
                    content_block_ordinal: r.4,
                    content_type: r.5.clone(),
                });
            }
        }
    }

    hits.sort_by_key(|h| (h.start, h.end));
    let total = hits.len();
    let returned = if limit == 0 { total } else { total.min(limit) };
    hits.truncate(returned);
    Ok(SearchResult {
        operation_path,
        total,
        returned,
        hits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::create_schema;
    use crate::store::{Boundary, TextBlockStore, insert_records};
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;

    fn build_fixture(tag: &str) -> (PathBuf, Connection, TextBlockStore) {
        let dir = std::env::temp_dir().join(format!("dcf-db-search-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("s.db")).unwrap();
        create_schema(&conn).unwrap();
        // corpus: two records separated by a NUL, with a multibyte hit and a
        // quoted-token hit.
        let corpus = "hello 架构 world\x00\"input\" here read_file x".as_bytes().to_vec();
        let pack = dir.join("s.zstpack");
        let mut store = TextBlockStore::build(&corpus, &pack, &conn).unwrap();
        let boundaries = vec![
            Boundary {
                text_id: "t1".into(),
                conversation_uuid: "c1".into(),
                message_uuid: "m1".into(),
                ordinal: 0,
                content_type: "text".into(),
                start: 0,
                end: 18,
            },
            Boundary {
                text_id: "t2".into(),
                conversation_uuid: "c2".into(),
                message_uuid: "m2".into(),
                ordinal: 0,
                content_type: "tool_result".into(),
                start: 19,
                end: 44,
            },
        ];
        insert_records(&mut conn, &mut store, &boundaries).unwrap();
        (dir, conn, store)
    }

    #[test]
    fn exact_locate_returns_canonical_byte_spans() {
        let (_dir, conn, mut store) = build_fixture("locate");
        let r = exact_search(&mut store, &conn, "架构", 0).unwrap();
        assert_eq!(r.total, 1);
        assert_eq!(r.operation_path, "short_query_full_record_scan");
        assert_eq!(r.hits[0].start, 6);
        assert_eq!(r.hits[0].end, 6 + 6);
        assert_eq!(r.hits[0].conversation_uuid, "c1");
        assert_eq!(r.hits[0].content_type, "text");

        let r2 = exact_search(&mut store, &conn, "read_file", 0).unwrap();
        assert_eq!(r2.total, 1);
        assert_eq!(r2.operation_path, "fts_trigram_verify");
        assert_eq!(r2.hits[0].start, 32);

        let r3 = exact_search(&mut store, &conn, "\"input\"", 0).unwrap();
        assert_eq!(r3.total, 1);
        assert_eq!(r3.operation_path, "fts_trigram_verify");
        assert_eq!(r3.hits[0].start, 19);

        // limit semantics: first 2 occurrences in canonical order
        let dir = std::env::temp_dir().join(format!("dcf-db-search-lim2-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut conn2 = Connection::open(dir.join("l.db")).unwrap();
        create_schema(&conn2).unwrap();
        let corpus2 = b"aaXaaXaaZ".to_vec();
        let pack2 = dir.join("l.zstpack");
        let mut store2 = TextBlockStore::build(&corpus2, &pack2, &conn2).unwrap();
        let b2 = vec![Boundary {
            text_id: "t".into(),
            conversation_uuid: "c".into(),
            message_uuid: "m".into(),
            ordinal: 0,
            content_type: "text".into(),
            start: 0,
            end: corpus2.len() as u64,
        }];
        insert_records(&mut conn2, &mut store2, &b2).unwrap();
        let r4 = exact_search(&mut store2, &conn2, "aaX", 2).unwrap();
        assert_eq!(r4.total, 2);
        assert_eq!(r4.returned, 2);
        assert_eq!(r4.hits[0].start, 0);
        assert_eq!(r4.hits[1].start, 3);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&_dir);
    }

    #[test]
    fn short_query_fallback_is_explicitly_reported() {
        let (_dir, conn, mut store) = build_fixture("short");
        let r = exact_search(&mut store, &conn, "x", 0).unwrap();
        assert_eq!(r.operation_path, "short_query_full_record_scan");
        let _ = fs::remove_dir_all(&_dir);
    }
}
