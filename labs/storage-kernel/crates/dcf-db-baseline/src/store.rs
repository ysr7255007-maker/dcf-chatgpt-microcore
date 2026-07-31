//! Independent zstd text block store (`.zstpack`).
//!
//! The canonical projection is split into nominal 256 KiB chunks; each chunk is
//! independently compressed with zstd level 19 and appended to a single
//! `.zstpack` file. `text_blocks` in SQLite is the block directory
//! (canonical range, frame offset/len, hash). A small application-hot
//! decompressed-block cache is used only after `open` (never during `build`).

use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use crate::schema::BLOCK_SIZE;

#[derive(Clone, Debug)]
pub struct BlockMeta {
    pub block_id: i64,
    pub canonical_start: u64,
    pub canonical_end: u64,
    pub compressed_offset: u64,
    pub compressed_len: u64,
    pub uncompressed_len: u64,
    pub sha256: String,
}

pub struct TextBlockStore {
    pack_path: PathBuf,
    blocks: Vec<BlockMeta>,
    cache: HashMap<i64, Vec<u8>>,
    cache_order: Vec<i64>,
    cache_capacity: usize,
}

const CACHE_CAPACITY: usize = 12;

impl TextBlockStore {
    /// Compress `input` into fixed chunks and write the `.zstpack` + directory.
    pub fn build(input: &[u8], pack_path: &Path, conn: &Connection) -> Result<Self> {
        let mut pack = File::create(pack_path)
            .with_context(|| format!("create {}", pack_path.display()))?;
        let mut blocks: Vec<BlockMeta> = Vec::new();
        let mut offset: u64 = 0;
        let mut block_id: i64 = 0;
        let mut pos = 0usize;
        while pos < input.len() {
            let end = (pos + BLOCK_SIZE).min(input.len());
            let chunk = &input[pos..end];
            let compressed = zstd::stream::encode_all(Cursor::new(chunk), 19)
                .context("zstd level 19 compression")?;
            pack.write_all(&compressed)?;
            blocks.push(BlockMeta {
                block_id,
                canonical_start: pos as u64,
                canonical_end: end as u64,
                compressed_offset: offset,
                compressed_len: compressed.len() as u64,
                uncompressed_len: chunk.len() as u64,
                sha256: hex::encode(Sha256::digest(chunk)),
            });
            offset += compressed.len() as u64;
            block_id += 1;
            pos = end;
        }
        pack.flush()?;
        drop(pack);

        for b in &blocks {
            conn.execute(
                "INSERT INTO text_blocks (block_id, canonical_start, canonical_end, \
                 compressed_offset, compressed_len, uncompressed_len, sha256) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![b.block_id, b.canonical_start, b.canonical_end,
                        b.compressed_offset, b.compressed_len, b.uncompressed_len, b.sha256],
            )?;
        }

        let mut store = Self::open(pack_path, conn)?;
        store.blocks = blocks;
        Ok(store)
    }

    /// Append new canonical bytes after the current corpus end. Existing blocks
    /// are never rewritten: the appended bytes begin a fresh block at the old
    /// corpus end (blocks after an append boundary may be shorter than 256 KiB).
    pub fn append(&mut self, input: &[u8], conn: &Connection) -> Result<()> {
        if input.is_empty() {
            return Ok(());
        }
        let start_off = self
            .blocks
            .last()
            .map(|b| b.canonical_end)
            .unwrap_or(0);
        let mut pack = fs::OpenOptions::new()
            .append(true)
            .open(&self.pack_path)
            .with_context(|| format!("open append {}", self.pack_path.display()))?;
        let mut offset: u64 = self.blocks.last().map(|b| b.compressed_offset + b.compressed_len).unwrap_or(0);
        let mut block_id: i64 = self.blocks.last().map(|b| b.block_id + 1).unwrap_or(0);
        let mut pos = 0usize;
        while pos < input.len() {
            let end = (pos + BLOCK_SIZE).min(input.len());
            let chunk = &input[pos..end];
            let compressed = zstd::stream::encode_all(Cursor::new(chunk), 19)
                .context("zstd append compression")?;
            pack.write_all(&compressed)?;
            let meta = BlockMeta {
                block_id,
                canonical_start: start_off + pos as u64,
                canonical_end: start_off + end as u64,
                compressed_offset: offset,
                compressed_len: compressed.len() as u64,
                uncompressed_len: chunk.len() as u64,
                sha256: hex::encode(Sha256::digest(chunk)),
            };
            conn.execute(
                "INSERT INTO text_blocks (block_id, canonical_start, canonical_end, \
                 compressed_offset, compressed_len, uncompressed_len, sha256) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![meta.block_id, meta.canonical_start, meta.canonical_end,
                        meta.compressed_offset, meta.compressed_len, meta.uncompressed_len,
                        meta.sha256],
            )?;
            self.blocks.push(meta);
            offset += compressed.len() as u64;
            block_id += 1;
            pos = end;
        }
        pack.flush()?;
        Ok(())
    }

    pub fn open(pack_path: &Path, conn: &Connection) -> Result<Self> {
        let mut stmt = conn.prepare(
            "SELECT block_id, canonical_start, canonical_end, compressed_offset, \
             compressed_len, uncompressed_len, sha256 FROM text_blocks ORDER BY block_id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(BlockMeta {
                block_id: r.get(0)?,
                canonical_start: r.get(1)?,
                canonical_end: r.get(2)?,
                compressed_offset: r.get(3)?,
                compressed_len: r.get(4)?,
                uncompressed_len: r.get(5)?,
                sha256: r.get(6)?,
            })
        })?;
        let mut blocks = Vec::new();
        for r in rows {
            blocks.push(r?);
        }
        Ok(TextBlockStore {
            pack_path: pack_path.to_path_buf(),
            blocks,
            cache: HashMap::new(),
            cache_order: Vec::new(),
            cache_capacity: CACHE_CAPACITY,
        })
    }

    pub fn block_count(&self) -> usize {
        self.blocks.len()
    }

    /// (first_block_id, last_block_id) covering canonical range [start, end).
    pub fn block_range(&self, start: u64, end: u64) -> (i64, i64) {
        let first = self
            .blocks
            .iter()
            .find(|b| b.canonical_end > start)
            .map(|b| b.block_id)
            .unwrap_or(0);
        let last = self
            .blocks
            .iter()
            .rev()
            .find(|b| b.canonical_start < end)
            .map(|b| b.block_id)
            .unwrap_or(first);
        (first, last)
    }

    pub fn corpus_bytes(&self) -> u64 {
        self.blocks.last().map(|b| b.canonical_end).unwrap_or(0)
    }

    fn read_frame(&mut self, meta: &BlockMeta) -> Result<Vec<u8>> {
        if let Some(cached) = self.cache.get(&meta.block_id) {
            return Ok(cached.clone());
        }
        let mut file = File::open(&self.pack_path)
            .with_context(|| format!("open {}", self.pack_path.display()))?;
        use std::io::Seek;
        file.seek(std::io::SeekFrom::Start(meta.compressed_offset))?;
        let mut frame = vec![0u8; meta.compressed_len as usize];
        file.read_exact(&mut frame)?;
        let data = zstd::stream::decode_all(Cursor::new(&frame))
            .context("zstd frame decode")?;
        if data.len() != meta.uncompressed_len as usize {
            anyhow::bail!("block {} length mismatch", meta.block_id);
        }
        if self.cache.contains_key(&meta.block_id) {
            return Ok(data);
        }
        self.cache.insert(meta.block_id, data.clone());
        self.cache_order.push(meta.block_id);
        while self.cache_order.len() > self.cache_capacity {
            let victim = self.cache_order.remove(0);
            self.cache.remove(&victim);
        }
        Ok(data)
    }

    /// Extract canonical bytes [start, end) by decompressing only intersecting blocks.
    pub fn extract(&mut self, start: u64, end: u64) -> Result<Vec<u8>> {
        if start >= end {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity((end - start) as usize);
        let metas: Vec<BlockMeta> = self
            .blocks
            .iter()
            .filter(|m| m.canonical_end > start && m.canonical_start < end)
            .cloned()
            .collect();
        for meta in metas {
            let data = self.read_frame(&meta)?;
            let lo = start.saturating_sub(meta.canonical_start) as usize;
            let hi = (end.min(meta.canonical_end) - meta.canonical_start) as usize;
            out.extend_from_slice(&data[lo..hi]);
        }
        Ok(out)
    }

    /// Recover the full canonical projection by concatenating all blocks in order.
    pub fn recover_all(&mut self) -> Result<Vec<u8>> {
        let mut out = Vec::with_capacity(self.corpus_bytes() as usize);
        let metas = self.blocks.clone();
        for meta in metas {
            let data = self.read_frame(&meta)?;
            out.extend_from_slice(&data);
        }
        Ok(out)
    }

    pub fn pack_bytes(&self) -> u64 {
        fs::metadata(&self.pack_path)
            .map(|m| m.len())
            .unwrap_or(0)
    }

    /// Recompute each block hash from the pack; returns block ids that mismatch.
    pub fn verify_block_hashes(&mut self) -> Result<Vec<i64>> {
        let mut bad = Vec::new();
        let metas = self.blocks.clone();
        for meta in metas {
            let data = self.read_frame(&meta)?;
            let h = hex::encode(Sha256::digest(&data));
            if h != meta.sha256 {
                bad.push(meta.block_id);
            }
        }
        Ok(bad)
    }
}

/// Record boundaries fed to the builder: provenance + canonical span.
#[derive(Clone, Debug)]
pub struct Boundary {
    pub text_id: String,
    pub conversation_uuid: String,
    pub message_uuid: String,
    pub ordinal: i64,
    pub content_type: String,
    pub start: u64,
    pub end: u64,
}

/// Populate `records` and `records_search_content` (FTS triggers fire).
/// Returns number of records inserted.
pub fn insert_records(conn: &mut Connection, store: &mut TextBlockStore, boundaries: &[Boundary]) -> Result<usize> {
    // Decompress all record bodies before opening the write transaction to
    // avoid lock contention between the store's read handle and the writer.
    let mut prepared: Vec<(Boundary, Vec<u8>)> = Vec::with_capacity(boundaries.len());
    for b in boundaries {
        let content = store.extract(b.start, b.end)?;
        prepared.push((b.clone(), content));
    }
    let tx = conn.transaction()?;
    let mut inserted = 0usize;
    for (b, content) in &prepared {
        let (first, last) = store.block_range(b.start, b.end);
        tx.execute(
            "INSERT INTO records (text_id, conversation_uuid, message_uuid, \
             content_block_ordinal, content_type, canonical_start, canonical_end, \
             text_store_block_first, text_store_block_last) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![b.text_id, b.conversation_uuid, b.message_uuid, b.ordinal,
                    b.content_type, b.start, b.end, first, last],
        )?;
        let record_id = tx.last_insert_rowid();
        let searchable = String::from_utf8_lossy(content).into_owned();
        tx.execute(
            "INSERT INTO records_search_content (record_id, searchable_text) VALUES (?1,?2)",
            params![record_id, searchable],
        )?;
        inserted += 1;
    }
    tx.commit()?;
    Ok(inserted)
}

/// Load boundaries from the shared JSON-lines contract file.
pub fn load_boundaries(path: &Path) -> Result<Vec<Boundary>> {
    let text = fs::read_to_string(path)
        .with_context(|| format!("read {}", path.display()))?;
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(line)
            .with_context(|| format!("boundary line {}", i + 1))?;
        out.push(Boundary {
            text_id: v["text_id"].as_str().unwrap_or_default().to_string(),
            conversation_uuid: v["conversation_uuid"].as_str().unwrap_or_default().to_string(),
            message_uuid: v["message_uuid"].as_str().unwrap_or_default().to_string(),
            ordinal: v["ordinal"].as_i64().unwrap_or(0),
            content_type: v["type"].as_str().unwrap_or_default().to_string(),
            start: v["start"].as_u64().unwrap_or(0),
            end: v["end"].as_u64().unwrap_or(0),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{SCHEMA_VERSION, create_schema};
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dcf-db-baseline-test-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn extract_crosses_zstd_block_boundary() {
        let dir = temp_dir("cross");
        let mut conn = Connection::open(dir.join("t.db")).unwrap();
        create_schema(&conn).unwrap();
        let mut data = Vec::new();
        // 256 KiB + 1 byte so the span straddles the block boundary.
        data.extend_from_slice(&vec![b'a'; BLOCK_SIZE]);
        data.extend_from_slice(b"XYZ0123456789");
        let pack = dir.join("t.zstpack");
        let mut store = TextBlockStore::build(&data, &pack, &conn).unwrap();
        let got = store.extract(BLOCK_SIZE as u64 - 8, BLOCK_SIZE as u64 + 12).unwrap();
        assert_eq!(got, b"aaaaaaaaXYZ012345678");
        // span fully inside second block
        let got2 = store.extract(BLOCK_SIZE as u64 + 1, BLOCK_SIZE as u64 + 4).unwrap();
        assert_eq!(got2, b"YZ0");
        // recovery reproduces the input
        let rec = store.recover_all().unwrap();
        assert_eq!(rec, data);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_extends_without_rewriting_old_blocks() {
        let dir = temp_dir("append");
        let mut conn = Connection::open(dir.join("a.db")).unwrap();
        create_schema(&conn).unwrap();
        let mut data = Vec::new();
        data.extend_from_slice(&vec![b'a'; BLOCK_SIZE / 2]);
        let pack = dir.join("a.zstpack");
        let mut store = TextBlockStore::build(&data, &pack, &conn).unwrap();
        let old_count = store.block_count();
        let old_pack_bytes = store.pack_bytes();
        store.append(b"hello appended world", &conn).unwrap();
        assert_eq!(store.block_count(), old_count + 1);
        assert!(store.pack_bytes() > old_pack_bytes);
        let tail = store.extract(data.len() as u64, data.len() as u64 + 20).unwrap();
        assert_eq!(tail, b"hello appended world");
        let rec = store.recover_all().unwrap();
        let mut expected = data.clone();
        expected.extend_from_slice(b"hello appended world");
        assert_eq!(rec, expected);
        let _ = fs::remove_dir_all(&dir);
    }
}
