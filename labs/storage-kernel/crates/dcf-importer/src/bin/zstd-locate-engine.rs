use anyhow::Result;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, Write};
use std::time::Instant;

/// zstd-full-scan engine
/// Storage: zstd-compressed corpus (256 KiB blocks) + offset table
/// Query: decompress all blocks, brute-force scan for pattern
/// This is the "is an index even needed?" baseline.
/// Modes: build | query | recover | calibrate
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: {} <corpus.bin> <mode: build|open|query|recover|calibrate>", args[0]);
        std::process::exit(1);
    }

    let corpus_path = &args[1];
    let mode = &args[2];
    let store_path = format!("{}.zstd", corpus_path);

    match mode.as_str() {
        "build" => build(corpus_path, &store_path),
        "open" => open_mode(corpus_path),
        "query" => query(corpus_path, &store_path),
        "recover" => recover(corpus_path, &store_path),
        "calibrate" => calibrate(corpus_path, &store_path),
        _ => {
            eprintln!("Unknown mode: {}", mode);
            std::process::exit(1);
        }
    }
}

fn build(corpus_path: &str, store_path: &str) -> Result<()> {
    let data = fs::read(corpus_path)?;
    let input_bytes = data.len();

    let t0 = Instant::now();

    // Compress with zstd level 19, 256 KiB blocks
    let block_size = 256 * 1024;
    let mut compressed_blocks: Vec<Vec<u8>> = Vec::new();
    let mut offsets: Vec<(u64, u64)> = Vec::new(); // (compressed_offset, uncompressed_len)

    let mut offset = 0u64;
    for chunk in data.chunks(block_size) {
        let compressed = zstd::encode_all(chunk, 19)?;
        offsets.push((offset, chunk.len() as u64));
        offset += compressed.len() as u64;
        compressed_blocks.push(compressed);
    }

    // Write store: [num_blocks:u32][offsets...][compressed_blocks...]
    let mut store_data: Vec<u8> = Vec::new();
    let num_blocks = compressed_blocks.len() as u32;
    store_data.extend_from_slice(&num_blocks.to_le_bytes());
    for (comp_off, uncomp_len) in &offsets {
        store_data.extend_from_slice(&comp_off.to_le_bytes());
        store_data.extend_from_slice(&uncomp_len.to_le_bytes());
    }
    for block in &compressed_blocks {
        store_data.extend_from_slice(block);
    }

    let build_ms = t0.elapsed().as_secs_f64() * 1000.0;
    fs::write(store_path, &store_data)?;

    let index_bytes = store_data.len();

    println!(
        "{{\"build_time_ms\":{:.2},\"index_bytes\":{},\"input_bytes\":{},\"text_store_bytes\":{},\"num_blocks\":{}}}",
        build_ms, index_bytes, input_bytes, index_bytes, num_blocks
    );

    Ok(())
}

fn open_mode(corpus_path: &str) -> Result<()> {
    let t0 = Instant::now();
    let data = fs::read(corpus_path)?;
    let open_ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!(
        "{{\"open_time_ms\":{:.4},\"input_bytes\":{}}}",
        open_ms,
        data.len()
    );
    Ok(())
}

fn query(corpus_path: &str, _store_path: &str) -> Result<()> {
    // Load and decompress entire corpus (application-hot)
    let data = fs::read(corpus_path)?;

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let pattern = line?;
        if pattern.is_empty() {
            continue;
        }
        let pat_bytes = pattern.as_bytes();

        let t0 = Instant::now();

        // Brute-force scan with overlapping matches
        let spans = scan_locate(&data, pat_bytes, 0).0;

        let time_us = t0.elapsed().as_secs_f64() * 1_000_000.0;

        // Output JSON
        write!(out, "{{\"query\":\"{}\",\"count\":{},\"time_us\":{:.1},\"spans\":[",
            pattern.replace('"', "\\\""), spans.len(), time_us)?;
        let lim = spans.len().min(10);
        for (i, (s, e)) in spans[..lim].iter().enumerate() {
            if i > 0 {
                write!(out, ",")?;
            }
            write!(out, "{{\"start\":{},\"end\":{}}}", s, e)?;
        }
        writeln!(out, "]}}")?;
    }

    Ok(())
}

fn recover(_corpus_path: &str, store_path: &str) -> Result<()> {
    let store_data = fs::read(store_path)?;

    let t0 = Instant::now();
    let recovered = decompress_store(&store_data)?;
    let recover_ms = t0.elapsed().as_secs_f64() * 1000.0;

    println!(
        "{{\"recover_ms\":{:.2},\"recovered_bytes\":{}}}",
        recover_ms,
        recovered.len()
    );

    Ok(())
}

/// Calibrate mode: read JSON-lines instructions from stdin, one response per line.
/// Ops: count | locate (limit>0 stop early, limit=0 enumerate all) | extract | recover
fn calibrate(corpus_path: &str, store_path: &str) -> Result<()> {
    // Load corpus into memory once (application-hot baseline)
    let data = fs::read(corpus_path)?;
    let store_data = fs::read(store_path)?;

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(&line)?;
        let op = v["op"].as_str().unwrap_or("");

        match op {
            "count" => {
                let pat = v["pattern"].as_str().unwrap_or("").as_bytes().to_vec();
                let t0 = Instant::now();
                let count = scan_count(&data, &pat);
                let time_us = t0.elapsed().as_secs_f64() * 1_000_000.0;
                writeln!(out, "{}", json!({"op": "count", "count": count, "time_us": time_us}))?;
            }
            "locate" => {
                let pat = v["pattern"].as_str().unwrap_or("").as_bytes().to_vec();
                let limit = v["limit"].as_u64().unwrap_or(0) as usize;

                // Timed part: locate (stop early when limit>0)
                let t0 = Instant::now();
                let (spans, _) = scan_locate(&data, &pat, limit);
                let time_us = t0.elapsed().as_secs_f64() * 1_000_000.0;

                // Untimed part: full scan for total (correctness reference)
                let total = if limit == 0 {
                    spans.len()
                } else {
                    scan_count(&data, &pat)
                };

                let mut spans_json = Vec::with_capacity(spans.len());
                for (s, e) in &spans {
                    spans_json.push(json!({"start": s, "end": e}));
                }
                writeln!(out, "{}", json!({
                    "op": "locate",
                    "requested": limit,
                    "total": total,
                    "returned": spans.len(),
                    "time_us": time_us,
                    "spans": spans_json,
                }))?;
            }
            "extract" => {
                let start = v["start"].as_u64().unwrap_or(0) as usize;
                let end = v["end"].as_u64().unwrap_or(0) as usize;
                let end = end.min(data.len());
                if start >= end {
                    writeln!(out, "{}", json!({"op": "extract", "bytes": 0, "time_us": 0}))?;
                    continue;
                }
                let t0 = Instant::now();
                let slice = &data[start..end];
                let time_us = t0.elapsed().as_secs_f64() * 1_000_000.0;
                writeln!(out, "{}", json!({"op": "extract", "bytes": slice.len(), "time_us": time_us}))?;
            }
            "recover" => {
                let t0 = Instant::now();
                let recovered = decompress_store(&store_data)?;
                let time_us = t0.elapsed().as_secs_f64() * 1_000_000.0;

                // SHA-256 verification against the source corpus
                let corpus = fs::read(corpus_path)?;
                let recovered_sha256 = format!("{:x}", Sha256::digest(&recovered));
                let expected_sha256 = format!("{:x}", Sha256::digest(&corpus));
                let sha256_match = recovered.len() == corpus.len()
                    && recovered_sha256 == expected_sha256;
                writeln!(out, "{}", json!({
                    "op": "recover",
                    "bytes": recovered.len(),
                    "corpus_bytes": corpus.len(),
                    "time_us": time_us,
                    "recovered_sha256": recovered_sha256,
                    "expected_sha256": expected_sha256,
                    "sha256_match": sha256_match,
                }))?;
            }
            _ => {
                eprintln!("Unknown op: {}", op);
            }
        }
    }

    Ok(())
}

/// Count overlapping occurrences of pattern in data (no positions recorded).
fn scan_count(data: &[u8], pat: &[u8]) -> usize {
    if pat.is_empty() || pat.len() > data.len() {
        return 0;
    }
    let mut count = 0usize;
    let mut pos = 0usize;
    while pos + pat.len() <= data.len() {
        if &data[pos..pos + pat.len()] == pat {
            count += 1;
        }
        pos += 1;
    }
    count
}

/// Locate overlapping occurrences. limit==0 enumerates all; limit>0 stops after limit.
/// Returns (spans, total_scanned). total_scanned equals spans.len() for full scan.
fn scan_locate(data: &[u8], pat: &[u8], limit: usize) -> (Vec<(usize, usize)>, usize) {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    if pat.is_empty() || pat.len() > data.len() {
        return (spans, 0);
    }
    let max = if limit == 0 { usize::MAX } else { limit };
    let mut pos = 0usize;
    while pos + pat.len() <= data.len() && spans.len() < max {
        if &data[pos..pos + pat.len()] == pat {
            spans.push((pos, pos + pat.len()));
        }
        pos += 1;
    }
    let total = if limit == 0 { spans.len() } else { scan_count(data, pat) };
    (spans, total)
}

/// Decompress every block from the zstd store, in order.
fn decompress_store(store_data: &[u8]) -> Result<Vec<u8>> {
    // Parse store header
    let num_blocks = u32::from_le_bytes(store_data[0..4].try_into()?) as usize;
    let header_size = 4 + num_blocks * 16;

    let mut recovered: Vec<u8> = Vec::new();
    let mut comp_offset = header_size;

    for i in 0..num_blocks {
        let _off = u64::from_le_bytes(store_data[4 + i * 16..4 + i * 16 + 8].try_into()?);
        let uncomp_len = u64::from_le_bytes(store_data[4 + i * 16 + 8..4 + i * 16 + 16].try_into()?) as usize;

        // Find compressed block end (next block start or end of file)
        let next_comp_offset = if i + 1 < num_blocks {
            let next_off = u64::from_le_bytes(store_data[4 + (i + 1) * 16..4 + (i + 1) * 16 + 8].try_into()?) as usize;
            header_size + next_off
        } else {
            store_data.len()
        };

        let compressed_block = &store_data[comp_offset..next_comp_offset];
        let decompressed = zstd::decode_all(compressed_block)?;
        if decompressed.len() != uncomp_len {
            anyhow::bail!("block {} length mismatch: {} != {}", i, decompressed.len(), uncomp_len);
        }
        recovered.extend_from_slice(&decompressed);
        comp_offset = next_comp_offset;
    }

    Ok(recovered)
}
