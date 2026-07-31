//! Conventional database baseline CLI.
//!
//!   dcf-db-baseline <corpus.bin> <boundaries.jsonl> <out-dir> <mode> [options]
//!
//! Modes: build | open | calibrate | recover | storage | verify |
//!        append | rebuild-fts | integrity

use anyhow::{Context, Result, bail};
use clap::Parser;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use dcf_db_baseline::protocol::run_calibrate;
use dcf_db_baseline::schema::{SCHEMA_VERSION, create_schema, probe_trigram};
use dcf_db_baseline::store::{TextBlockStore, insert_records, load_boundaries};

#[derive(Parser, Debug)]
#[command(name = "dcf-db-baseline", about = "Conventional DB baseline engine")]
struct Args {
    /// Canonical projection corpus bytes
    corpus: PathBuf,
    /// Shared projection boundaries JSON-lines (provenance + canonical spans)
    boundaries: PathBuf,
    /// Output directory holding db + zstpack
    out_dir: PathBuf,
    /// Mode: build|open|calibrate|recover|storage|verify|append|rebuild-fts|integrity
    mode: String,
    /// Append corpus (mode=append)
    #[arg(long)]
    append_corpus: Option<PathBuf>,
    /// Append boundaries (mode=append)
    #[arg(long)]
    append_boundaries: Option<PathBuf>,
}

fn db_path(out: &Path) -> PathBuf {
    out.join("baseline.db")
}
fn pack_path(out: &Path) -> PathBuf {
    out.join("text.zstpack")
}
fn manifest_path(out: &Path) -> PathBuf {
    out.join("manifest.json")
}

fn open_conn(out: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path(out)).context("open sqlite db")?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    Ok(conn)
}

fn build_impl(corpus_path: &Path, boundaries_path: &Path, out: &Path) -> Result<()> {
    fs::create_dir_all(out)?;
    // fresh build: remove any previous artifacts so the measurement is clean
    for stale in ["baseline.db", "baseline.db-wal", "baseline.db-shm", "text.zstpack", "manifest.json"] {
        let p = out.join(stale);
        if p.exists() {
            fs::remove_file(&p).with_context(|| format!("remove stale {}", p.display()))?;
        }
    }
    let t0 = Instant::now();
    let corpus = fs::read(corpus_path).with_context(|| format!("read {}", corpus_path.display()))?;
    let boundaries = load_boundaries(boundaries_path)?;
    if boundaries.is_empty() {
        bail!("no boundaries loaded");
    }
    // structural validation of the boundary contract
    let mut prev_end = 0u64;
    for b in &boundaries {
        if b.start < prev_end || b.end < b.start {
            bail!(
                "boundary overlap/invalid for {}: start={} end={} prev_end={}",
                b.text_id, b.start, b.end, prev_end
            );
        }
        if b.end > corpus.len() as u64 {
            bail!("boundary {} exceeds corpus", b.text_id);
        }
        prev_end = b.start;
    }
    let corpus_sha = hex::encode(Sha256::digest(&corpus));

    let mut conn = open_conn(out)?;
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    create_schema(&conn)?;
    probe_trigram(&conn)?;
    conn.execute(
        "INSERT INTO dataset_manifest (dataset_id, projection_sha256, projection_bytes, schema_version) \
         VALUES ('leverage-v1-dataset', ?1, ?2, ?3)",
        rusqlite::params![corpus_sha, corpus.len() as i64, SCHEMA_VERSION],
    )?;
    conn.execute_batch("COMMIT;")?;

    let mut store = TextBlockStore::build(&corpus, &pack_path(out), &conn)?;
    let records = insert_records(&mut conn, &mut store, &boundaries)?;
    drop(store);
    drop(conn);

    fs::write(
        manifest_path(out),
        serde_json::to_string_pretty(&serde_json::json!({
            "architecture": "conventional_db",
            "dataset_id": "leverage-v1-dataset",
            "projection_sha256": corpus_sha,
            "projection_bytes": corpus.len(),
            "schema_version": SCHEMA_VERSION,
            "zstd_level": 19,
            "block_size": 262144,
            "record_count": records,
            "boundary_count": boundaries.len(),
        }))?,
    )?;

    let elapsed_ms = t0.elapsed().as_secs_f64() * 1e3;
    let res = serde_json::json!({
        "build_time_ms": elapsed_ms,
        "corpus_bytes": corpus.len(),
        "record_count": records,
        "db_bytes": fs::metadata(db_path(out)).map(|m| m.len()).unwrap_or(0),
        "zstpack_bytes": fs::metadata(pack_path(out)).map(|m| m.len()).unwrap_or(0),
        "projection_sha256": corpus_sha,
    });
    println!("{}", res);
    Ok(())
}

fn open_impl(out: &Path) -> Result<()> {
    let t0 = Instant::now();
    let conn = open_conn(out)?;
    let store = TextBlockStore::open(&pack_path(out), &conn)?;
    let open_ms = t0.elapsed().as_secs_f64() * 1e3;
    let res = serde_json::json!({
        "open_time_ms": open_ms,
        "db_bytes": fs::metadata(db_path(out)).map(|m| m.len()).unwrap_or(0),
        "zstpack_bytes": store.pack_bytes(),
        "block_count": store.block_count(),
        "corpus_bytes": store.corpus_bytes(),
    });
    println!("{}", res);
    Ok(())
}

fn storage_impl(out: &Path) -> Result<()> {
    let conn = open_conn(out)?;
    let store = TextBlockStore::open(&pack_path(out), &conn)?;
    let mut files = Vec::new();
    for (_name, p) in [
        ("baseline.db", db_path(out)),
        ("text.zstpack", pack_path(out)),
        ("manifest.json", manifest_path(out)),
    ] {
        files.push(serde_json::json!({
            "path": format!("{}", p.display()),
            "bytes": fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            "required": true,
        }));
    }
    // stable WAL treatment: report WAL/SHM sizes if present
    for suffix in ["-wal", "-shm"] {
        let p = out.join(format!("baseline.db{}", suffix));
        if p.exists() {
            files.push(serde_json::json!({
                "path": format!("{}", p.display()),
                "bytes": fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
                "required": true,
            }));
        }
    }
    let res = serde_json::json!({
        "architecture": "conventional_db",
        "components": files,
        "db_bytes": fs::metadata(db_path(out)).map(|m| m.len()).unwrap_or(0),
        "zstpack_bytes": store.pack_bytes(),
    });
    println!("{}", res);
    Ok(())
}

fn recover_impl(out: &Path) -> Result<()> {
    let t0 = Instant::now();
    let conn = open_conn(out)?;
    let mut store = TextBlockStore::open(&pack_path(out), &conn)?;
    let recovered = store.recover_all()?;
    let elapsed_ms = t0.elapsed().as_secs_f64() * 1e3;
    let sha = hex::encode(Sha256::digest(&recovered));
    let res = serde_json::json!({
        "architecture": "conventional_db",
        "elapsed_ms": elapsed_ms,
        "bytes": recovered.len(),
        "corpus_bytes": store.corpus_bytes(),
        "recovered_sha256": sha,
        "recovery_semantics": "byte_exact",
    });
    println!("{}", res);
    Ok(())
}

fn verify_impl(out: &Path, boundaries_path: &Path) -> Result<()> {
    let conn = open_conn(out)?;
    let boundaries = load_boundaries(boundaries_path)?;
    let mut store = TextBlockStore::open(&pack_path(out), &conn)?;

    let mut stmt = conn.prepare(
        "SELECT text_id, conversation_uuid, message_uuid, content_block_ordinal, \
         content_type, canonical_start, canonical_end FROM records ORDER BY canonical_start",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, u64>(5)?,
            r.get::<_, u64>(6)?,
        ))
    })?;
    let mut db_records = Vec::new();
    for r in rows {
        db_records.push(r?);
    }

    let mut problems: Vec<String> = Vec::new();
    if db_records.len() != boundaries.len() {
        problems.push(format!(
            "record count mismatch: db={} boundaries={}",
            db_records.len(),
            boundaries.len()
        ));
    }
    for (i, b) in boundaries.iter().enumerate() {
        if let Some(d) = db_records.get(i) {
            if d.0 != b.text_id || d.3 != b.ordinal || d.4 != b.content_type
                || d.5 != b.start || d.6 != b.end || d.1 != b.conversation_uuid
                || d.2 != b.message_uuid
            {
                problems.push(format!("record {} provenance mismatch", i));
                break;
            }
        }
    }

    let recovered = store.recover_all()?;
    let recovered_sha = hex::encode(Sha256::digest(&recovered));
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(manifest_path(out))?)?;
    let expected = manifest["projection_sha256"].as_str().unwrap_or("").to_string();
    let sha_match = recovered_sha == expected;

    let fts_count: i64 = conn.query_row(
        "SELECT count(*) FROM records_fts",
        [],
        |r| r.get(0),
    )?;

    let ok = problems.is_empty() && sha_match;
    let res = serde_json::json!({
        "architecture": "conventional_db",
        "ok": ok,
        "problems": problems,
        "records_in_db": db_records.len(),
        "records_in_boundaries": boundaries.len(),
        "recovered_sha256": recovered_sha,
        "expected_sha256": expected,
        "sha256_match": sha_match,
        "fts_rows": fts_count,
        "pack_bytes": store.pack_bytes(),
    });
    println!("{}", res);
    if !ok {
        std::process::exit(1);
    }
    Ok(())
}

fn append_impl(out: &Path, corpus_path: &Path, boundaries_path: &Path) -> Result<()> {
    let corpus = fs::read(corpus_path).with_context(|| format!("read {}", corpus_path.display()))?;
    let boundaries = load_boundaries(boundaries_path)?;
    let t0 = Instant::now();
    let mut conn = open_conn(out)?;
    let mut store = TextBlockStore::open(&pack_path(out), &conn)?;
    let base_bytes = store.corpus_bytes();
    store.append(&corpus, &conn)?;
    let records = insert_records(&mut conn, &mut store, &boundaries)?;
    let elapsed_ms = t0.elapsed().as_secs_f64() * 1e3;
    let res = serde_json::json!({
        "architecture": "conventional_db",
        "append_bytes": corpus.len(),
        "append_records": records,
        "elapsed_ms": elapsed_ms,
        "base_corpus_bytes": base_bytes,
        "new_corpus_bytes": store.corpus_bytes(),
        "db_bytes": fs::metadata(db_path(out)).map(|m| m.len()).unwrap_or(0),
        "zstpack_bytes": store.pack_bytes(),
    });
    println!("{}", res);
    Ok(())
}

fn rebuild_fts_impl(out: &Path) -> Result<()> {
    let t0 = Instant::now();
    let conn = open_conn(out)?;
    conn.execute_batch(
        "DROP TABLE IF EXISTS records_fts;
         CREATE VIRTUAL TABLE records_fts USING fts5(
             searchable_text,
             content='records_search_content',
             content_rowid='record_id',
             tokenize='trigram'
         );
         INSERT INTO records_fts(records_fts) VALUES('rebuild');",
    )?;
    let elapsed_ms = t0.elapsed().as_secs_f64() * 1e3;
    let fts_count: i64 = conn.query_row("SELECT count(*) FROM records_fts", [], |r| r.get(0))?;
    let res = serde_json::json!({
        "architecture": "conventional_db",
        "elapsed_ms": elapsed_ms,
        "fts_rows": fts_count,
    });
    println!("{}", res);
    Ok(())
}

fn integrity_impl(out: &Path) -> Result<()> {
    let conn = open_conn(out)?;
    let mut store = TextBlockStore::open(&pack_path(out), &conn)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    // verify every block hash against the pack
    let bad_blocks = store.verify_block_hashes()?;
    let ok = integrity == "ok" && bad_blocks.is_empty();
    let res = serde_json::json!({
        "architecture": "conventional_db",
        "integrity_check": integrity,
        "bad_blocks": bad_blocks,
        "ok": ok,
    });
    println!("{}", res);
    if !ok {
        std::process::exit(1);
    }
    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();
    match args.mode.as_str() {
        "build" => build_impl(&args.corpus, &args.boundaries, &args.out_dir),
        "open" => open_impl(&args.out_dir),
        "calibrate" => {
            let conn = open_conn(&args.out_dir)?;
            let mut store = TextBlockStore::open(&pack_path(&args.out_dir), &conn)?;
            let stdout = std::io::stdout();
            let mut out = std::io::BufWriter::new(stdout.lock());
            run_calibrate(&mut store, &conn, &mut out)
        }
        "recover" => recover_impl(&args.out_dir),
        "storage" => storage_impl(&args.out_dir),
        "verify" => verify_impl(&args.out_dir, &args.boundaries),
        "append" => match (&args.append_corpus, &args.append_boundaries) {
            (Some(c), Some(b)) => append_impl(&args.out_dir, c, b),
            _ => bail!("append requires --append-corpus and --append-boundaries"),
        },
        "rebuild-fts" => rebuild_fts_impl(&args.out_dir),
        "integrity" => integrity_impl(&args.out_dir),
        other => bail!("unknown mode: {}", other),
    }
}
