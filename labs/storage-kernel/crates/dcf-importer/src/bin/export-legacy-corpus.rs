use anyhow::Result;
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::time::Instant;

/// Step 2: Export legacy_message_text corpus
/// Replicates the old sandbox body selection logic:
/// - m['text'] is authoritative when present
/// - Otherwise reconstruct from content[] blocks deterministically
fn main() -> Result<()> {
    println!("=== Export Legacy Message Text Corpus ===\n");

    let db_path = "reports/import/conversations.db";
    let out_dir = "reports/first-matrix/corpus";
    fs::create_dir_all(out_dir)?;

    let conn = Connection::open(db_path)?;
    let start = Instant::now();

    // Get all messages ordered by conversation creation time then message creation time
    let mut stmt = conn.prepare(
        "SELECT m.raw_payload, c.created_at as conv_time, m.created_at as msg_time
         FROM messages m
         JOIN conversations c ON m.conversation_uuid = c.conversation_uuid
         ORDER BY c.created_at, m.created_at"
    )?;

    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;

    let mut out_file = fs::File::create(format!("{}/legacy_message_text.bin", out_dir))?;
    let mut text_count = 0u64;
    let mut message_count = 0u64;
    let mut total_bytes = 0u64;
    let mut hasher = Sha256::new();

    for row in rows {
        let (raw_payload, _, _) = row?;
        message_count += 1;

        let msg: Value = serde_json::from_str(&raw_payload)?;

        // Body selection: m['text'] is authoritative when present
        let body = if let Some(text) = msg.get("text").and_then(|t| t.as_str()) {
            if !text.is_empty() {
                text.to_string()
            } else {
                reconstruct_body(msg.get("content"))
            }
        } else {
            reconstruct_body(msg.get("content"))
        };

        if body.is_empty() {
            continue;
        }

        let body_bytes = body.as_bytes();
        // Replace NUL bytes (reserved as separator)
        let clean_bytes: Vec<u8> = body_bytes.iter()
            .flat_map(|&b| if b == 0 { vec![0xEF, 0xBF, 0xBD] } else { vec![b] })
            .collect();

        out_file.write_all(&clean_bytes)?;
        out_file.write_all(&[0u8])?; // NUL separator

        hasher.update(&clean_bytes);
        hasher.update(&[0u8]);

        total_bytes += clean_bytes.len() as u64 + 1;
        text_count += 1;
    }

    let dataset_sha256 = format!("{:x}", hasher.finalize());
    let elapsed = start.elapsed();

    println!("Messages scanned:    {}", message_count);
    println!("Texts exported:      {}", text_count);
    println!("Total bytes:         {}", total_bytes);
    println!("Dataset SHA-256:     {}", dataset_sha256);
    println!("Duration:            {:.2?}", elapsed);

    // Write manifest
    let manifest = serde_json::json!({
        "dataset_id": "legacy_message_text",
        "description": "Platform message.text projection (old sandbox body selection logic)",
        "source": "reports/import/conversations.db messages.raw_payload",
        "body_selection_rule": "m['text'] when present and non-empty; else deterministic reconstruct from content[]",
        "separator": "NUL (0x00)",
        "nul_handling": "NUL in body replaced with U+FFFD (EF BF BD)",
        "dataset_sha256": dataset_sha256,
        "input_bytes": total_bytes,
        "text_count": text_count,
        "message_count": message_count,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    });

    fs::write(
        format!("{}/legacy_message_text.manifest.json", out_dir),
        serde_json::to_string_pretty(&manifest)?,
    )?;

    println!("\nWritten: {}/legacy_message_text.bin", out_dir);
    println!("Written: {}/legacy_message_text.manifest.json", out_dir);

    Ok(())
}

/// Deterministic body reconstruction when m['text'] is absent.
/// Replicates old sandbox _reconstruct_body() logic exactly.
fn reconstruct_body(content: Option<&Value>) -> String {
    let arr = match content.and_then(|c| c.as_array()) {
        Some(a) => a,
        None => return String::new(),
    };

    let mut parts: Vec<String> = Vec::new();
    for block in arr {
        let btype = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match btype {
            "text" => {
                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                    parts.push(t.to_string());
                }
            }
            "thinking" | "reasoning" => {
                parts.push("[thinking]".to_string());
            }
            "tool_use" => {
                let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                parts.push(format!("[tool_use:{}]", name));
                if let Some(input) = block.get("input") {
                    if input.is_object() {
                        // Deterministic JSON serialization with sorted keys
                        if let Ok(s) = serde_json::to_string(input) {
                            parts.push(s);
                        }
                    }
                }
            }
            "tool_result" => {
                parts.push("[tool_result]".to_string());
                if let Some(c) = block.get("content") {
                    if let Some(s) = c.as_str() {
                        parts.push(s.to_string());
                    } else if let Some(arr) = c.as_array() {
                        for cc in arr {
                            if cc.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(t) = cc.get("text").and_then(|t| t.as_str()) {
                                    parts.push(t.to_string());
                                }
                            }
                        }
                    }
                }
            }
            "token_budget" => {
                parts.push("[token_budget]".to_string());
            }
            "flag" => {
                parts.push("[flag]".to_string());
            }
            _ => {}
        }
    }
    parts.join("\n")
}
