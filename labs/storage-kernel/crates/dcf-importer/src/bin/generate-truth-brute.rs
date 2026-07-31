use anyhow::Result;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::time::Instant;

/// Step 3: Generate query set + brute-force truth values
/// Scans legacy_message_text.bin for each query pattern,
/// producing exact count and all byte spans.
fn main() -> Result<()> {
    println!("=== Generate Brute-Force Truth Sets ===\n");

    let corpus_path = "reports/first-matrix/corpus/legacy_message_text.bin";
    let out_dir = "reports/first-matrix/truth";
    fs::create_dir_all(out_dir)?;

    let start = Instant::now();

    // Load corpus
    let corpus = fs::read(corpus_path)?;
    println!("Corpus loaded: {} bytes", corpus.len());

    // Split into texts by NUL separator for text_id assignment
    let mut text_offsets: Vec<(usize, usize)> = Vec::new(); // (start, end) of each text
    let mut text_start = 0;
    for (i, &b) in corpus.iter().enumerate() {
        if b == 0 {
            if i > text_start {
                text_offsets.push((text_start, i));
            }
            text_start = i + 1;
        }
    }
    if text_start < corpus.len() {
        text_offsets.push((text_start, corpus.len()));
    }
    println!("Texts: {}", text_offsets.len());

    // Define query set
    let queries: Vec<(&str, &str, Vec<&str>)> = vec![
        // (query_id, query_string, tags)
        ("zh-high-freq-1", "需要", vec!["visible_text", "zh", "high_freq"]),
        ("zh-high-freq-2", "可以", vec!["visible_text", "zh", "high_freq"]),
        ("zh-high-freq-3", "建议", vec!["visible_text", "zh", "high_freq"]),
        ("zh-low-freq-long", "工程复杂度与收益的平衡", vec!["visible_text", "zh", "low_freq"]),
        ("en-identifier-1", "FM-index", vec!["visible_text", "en", "identifier"]),
        ("en-identifier-2", "read_file", vec!["tool_call", "ascii", "identifier"]),
        ("code-path", "/Users/", vec!["tool_call", "path"]),
        ("json-field", "\"role\"", vec!["raw_json", "structure"]),
        ("absent-sentinel", "DCF_ABSENT_SENTINEL_X9Z_7Q", vec!["negative"]),
        ("tool-name", "tool_use", vec!["tool_call", "ascii"]),
        ("en-reasoning", "The key constraint", vec!["reasoning", "en"]),
        ("zh-medium", "实际上", vec!["visible_text", "zh", "medium_freq"]),
        ("uuid-pattern", "019c5541", vec!["structure", "uuid"]),
        ("thinking-marker", "[thinking]", vec!["thinking", "marker"]),
    ];

    // Additional: find a single-result query and a long-message-tail query
    // Single result: use a very specific substring from the corpus
    let single_query = if corpus.len() > 1000 {
        // Take 30 bytes from near the end of the longest text
        let longest = text_offsets.iter().max_by_key(|(s, e)| e - s).unwrap();
        let tail_start = longest.1.saturating_sub(200);
        let sample_end = (tail_start + 30).min(longest.1);
        String::from_utf8_lossy(&corpus[tail_start..sample_end]).to_string()
    } else {
        "UNIQUE_TAIL_QUERY".to_string()
    };

    let mut all_queries: Vec<(String, String, Vec<String>)> = queries.iter()
        .map(|(id, q, tags)| (id.to_string(), q.to_string(), tags.iter().map(|t| t.to_string()).collect()))
        .collect();

    // Add single-result query (from tail of longest message)
    if !single_query.is_empty() && single_query.len() >= 8 {
        all_queries.push((
            "long-msg-tail".to_string(),
            single_query.clone(),
            vec!["visible_text".to_string(), "tail".to_string(), "single_or_rare".to_string()],
        ));
    }

    // Brute-force scan for each query
    let mut out_file = fs::File::create(format!("{}/truth-sets.jsonl", out_dir))?;
    let mut total_queries = 0;

    for (query_id, query_str, tags) in &all_queries {
        let query_bytes = query_str.as_bytes();
        if query_bytes.is_empty() {
            continue;
        }

        // Find all occurrences (allowing overlaps)
        let mut spans: Vec<Value> = Vec::new();
        let mut search_from = 0;

        while search_from + query_bytes.len() <= corpus.len() {
            if let Some(pos) = corpus[search_from..].windows(query_bytes.len())
                .position(|w| w == query_bytes)
            {
                let abs_pos = search_from + pos;

                // Determine which text_id this falls in
                let text_id = text_offsets.iter()
                    .position(|(s, e)| abs_pos >= *s && abs_pos < *e)
                    .unwrap_or(0);

                spans.push(json!({
                    "text_id": format!("text-{:06}", text_id),
                    "start": abs_pos,
                    "end": abs_pos + query_bytes.len(),
                }));

                search_from = abs_pos + 1; // allow overlapping matches
            } else {
                break;
            }
        }

        let count = spans.len();
        total_queries += 1;

        let truth_entry = json!({
            "query_id": query_id,
            "query_str": query_str,
            "query_bytes_hex": hex::encode(query_bytes),
            "tags": tags,
            "expected_count": count,
            "expected_spans": spans,
        });

        writeln!(out_file, "{}", serde_json::to_string(&truth_entry)?)?;

        println!("  {} : count={}", query_id, count);
    }

    let elapsed = start.elapsed();
    println!("\nTotal queries: {}", total_queries);
    println!("Duration: {:.2?}", elapsed);
    println!("Written: {}/truth-sets.jsonl", out_dir);

    Ok(())
}
