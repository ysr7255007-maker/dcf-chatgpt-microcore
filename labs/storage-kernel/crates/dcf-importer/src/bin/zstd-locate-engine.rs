use anyhow::Result;
use std::fs;
use std::io::{BufRead, Write};
use std::time::Instant;

/// UTF-8 Locate-only + zstd engine
/// Storage: zstd-compressed corpus (256 KiB blocks) + offset table
/// Query: decompress all blocks, brute-force scan for pattern
/// This is the "is an index even needed?" baseline.
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: {} <corpus.bin> <mode: build|query|recover>", args[0]);
        std::process::exit(1);
    }

    let corpus_path = &args[1];
    let mode = &args[2];
    let store_path = format!("{}.zstd", corpus_path);

    match mode.as_str() {
        "build" => build(corpus_path, &store_path),
        "query" => query(corpus_path, &store_path),
        "recover" => recover(corpus_path, &store_path),
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

fn query(corpus_path: &str, store_path: &str) -> Result<()> {
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
        let mut spans: Vec<(usize, usize)> = Vec::new();
        let mut search_from = 0;
        while search_from + pat_bytes.len() <= data.len() {
            if let Some(pos) = data[search_from..]
                .windows(pat_bytes.len())
                .position(|w| w == pat_bytes)
            {
                let abs_pos = search_from + pos;
                spans.push((abs_pos, abs_pos + pat_bytes.len()));
                search_from = abs_pos + 1;
            } else {
                break;
            }
        }

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

fn recover(corpus_path: &str, store_path: &str) -> Result<()> {
    let store_data = fs::read(store_path)?;

    let t0 = Instant::now();

    // Parse store header
    let num_blocks = u32::from_le_bytes(store_data[0..4].try_into()?) as usize;
    let header_size = 4 + num_blocks * 16;

    let mut recovered: Vec<u8> = Vec::new();
    let mut comp_offset = header_size;

    for i in 0..num_blocks {
        let base = 4 + i * 16;
        let _off = u64::from_le_bytes(store_data[base..base + 8].try_into()?);
        let uncomp_len = u64::from_le_bytes(store_data[base + 8..base + 16].try_into()?) as usize;

        // Find compressed block end (next block start or end of file)
        let next_comp_offset = if i + 1 < num_blocks {
            let next_base = 4 + (i + 1) * 16;
            let next_off = u64::from_le_bytes(store_data[next_base..next_base + 8].try_into()?) as usize;
            header_size + next_off
        } else {
            store_data.len()
        };

        let compressed_block = &store_data[comp_offset..next_comp_offset];
        let decompressed = zstd::decode_all(compressed_block)?;
        recovered.extend_from_slice(&decompressed);
        comp_offset = next_comp_offset;
    }

    let recover_ms = t0.elapsed().as_secs_f64() * 1000.0;

    println!(
        "{{\"recover_ms\":{:.2},\"recovered_bytes\":{}}}",
        recover_ms,
        recovered.len()
    );

    Ok(())
}
