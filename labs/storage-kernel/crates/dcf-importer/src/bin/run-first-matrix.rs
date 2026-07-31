use anyhow::Result;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

/// Step 6: Unified experiment runner - first performance matrix
/// Runs both engines against truth sets with 30 repetitions
fn main() -> Result<()> {
    println!("=== First Performance Matrix ===\n");

    let corpus_path = "reports/first-matrix/corpus/legacy_message_text.bin";
    let truth_path = "reports/first-matrix/truth/truth-sets.jsonl";
    let out_dir = "reports/first-matrix";
    let repetitions = 30;

    // Load truth sets
    let truth_content = fs::read_to_string(truth_path)?;
    let truth_sets: Vec<Value> = truth_content.lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    println!("Loaded {} truth set queries", truth_sets.len());

    // Load corpus for brute-force reference
    let corpus = fs::read(corpus_path)?;
    let input_bytes = corpus.len();

    // Load manifest
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string("reports/first-matrix/corpus/legacy_message_text.manifest.json")?
    )?;
    let dataset_sha256 = manifest["dataset_sha256"].as_str().unwrap_or("unknown");

    // Engine configs
    let engines = vec![
        ("utf8-a1-sdsl", "./reports/first-matrix/bin/utf8-a1-engine"),
        ("utf8-locate-zstd", "target/release/zstd-locate-engine"),
    ];

    let mut results_file = fs::File::create(format!("{}/results.jsonl", out_dir))?;

    for (engine_id, engine_bin) in &engines {
        println!("\n--- Engine: {} ---", engine_id);

        // Build phase (already done, just record storage)
        let (index_bytes, build_time_ms) = if *engine_id == "utf8-a1-sdsl" {
            let idx_path = format!("{}.csa", corpus_path);
            let idx_size = fs::metadata(&idx_path).map(|m| m.len()).unwrap_or(0);
            (idx_size, 3476.55) // from earlier build
        } else {
            let store_path = format!("{}.zstd", corpus_path);
            let store_size = fs::metadata(&store_path).map(|m| m.len()).unwrap_or(0);
            (store_size, 4497.61) // from earlier build
        };

        let bytes_per_input = index_bytes as f64 / input_bytes as f64;

        // Run each query with repetitions
        for truth in &truth_sets {
            let query_str = truth["query_str"].as_str().unwrap_or("");
            let query_id = truth["query_id"].as_str().unwrap_or("");
            let expected_count = truth["expected_count"].as_u64().unwrap_or(0);

            if query_str.is_empty() {
                continue;
            }

            // Run query multiple times
            let mut times_us: Vec<f64> = Vec::new();
            let mut actual_count: u64 = 0;
            let mut correctness = "PASS";

            for _rep in 0..repetitions {
                let output = run_query(engine_bin, corpus_path, query_str)?;
                if let Ok(result) = serde_json::from_str::<Value>(&output) {
                    let count = result["count"].as_u64().unwrap_or(0);
                    let time = result["time_us"].as_f64().unwrap_or(0.0);
                    times_us.push(time);
                    actual_count = count;
                }
            }

            // Check correctness
            if actual_count != expected_count {
                correctness = "FAIL";
            }

            // Compute P50/P95
            times_us.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let p50 = percentile(&times_us, 50.0);
            let p95 = percentile(&times_us, 95.0);

            let result_entry = json!({
                "dataset_id": "legacy_message_text",
                "dataset_sha256": dataset_sha256,
                "input_bytes": input_bytes,
                "engine_id": engine_id,
                "engine_config": if *engine_id == "utf8-a1-sdsl" { "csa_wt_rrr_64_64" } else { "zstd19_256KiB_brute_scan" },
                "query_id": query_id,
                "query_str": query_str,
                "expected_count": expected_count,
                "actual_count": actual_count,
                "correctness_count": correctness,
                "index_bytes": index_bytes,
                "total_required_bytes": index_bytes,
                "bytes_per_input_byte": format!("{:.4}", bytes_per_input),
                "build_time_ms": build_time_ms,
                "locate_p50_us": format!("{:.1}", p50),
                "locate_p95_us": format!("{:.1}", p95),
                "repetitions": repetitions,
                "cache_state": "application-hot",
            });

            writeln!(results_file, "{}", serde_json::to_string(&result_entry)?)?;

            println!("  {} : count={} (expected={}) {} p50={:.0}us p95={:.0}us",
                query_id, actual_count, expected_count, correctness, p50, p95);
        }
    }

    println!("\nResults written to {}/results.jsonl", out_dir);
    Ok(())
}

fn run_query(engine_bin: &str, corpus_path: &str, query: &str) -> Result<String> {
    let mut child = Command::new(engine_bin)
        .args([corpus_path, "query"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    if let Some(stdin) = child.stdin.as_mut() {
        writeln!(stdin, "{}", query)?;
    }
    drop(child.stdin.take());

    let output = child.wait_with_output()?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn percentile(sorted: &[f64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * pct / 100.0).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}
