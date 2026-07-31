use anyhow::Result;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::time::Instant;

/// Export full_trace projection:
/// text + thinking + tool_use + tool_result in original message/block order.
/// - thinking: full content (NOT placeholder)
/// - tool_use: complete serialized input
/// - tool_result: complete serialized content
/// - unknown blocks: included with type marker, NOT silently dropped
/// - Separator: NUL (0x00) between messages
fn main() -> Result<()> {
    println!("=== Export Full Trace Projection ===\n");

    let db_path = "reports/import/conversations.db";
    let out_dir = "reports/second-matrix/corpus";
    fs::create_dir_all(out_dir)?;

    let conn = Connection::open(db_path)?;
    let start = Instant::now();

    // Get all content blocks ordered by message time then ordinal
    let mut stmt = conn.prepare(
        "SELECT cb.message_uuid, cb.ordinal, cb.block_type, cb.raw_payload,
                c.created_at as conv_time, m.created_at as msg_time
         FROM content_blocks cb
         JOIN messages m ON cb.message_uuid = m.message_uuid
         JOIN conversations c ON m.conversation_uuid = c.conversation_uuid
         ORDER BY c.created_at, m.created_at, cb.ordinal"
    )?;

    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;

    let mut out_file = fs::File::create(format!("{}/full_trace.bin", out_dir))?;
    let mut hasher = Sha256::new();
    let mut total_bytes = 0u64;
    let mut text_count = 0u64;
    let mut thinking_count = 0u64;
    let mut tool_use_count = 0u64;
    let mut tool_result_count = 0u64;
    let mut unknown_count = 0u64;
    let mut message_count = 0u64;
    let mut current_msg: Option<String> = None;

    for row in rows {
        let (msg_uuid, _ordinal, block_type, raw_payload) = row?;

        // NUL separator between messages
        if current_msg.as_ref() != Some(&msg_uuid) {
            if current_msg.is_some() {
                out_file.write_all(&[0u8])?;
                hasher.update(&[0u8]);
                total_bytes += 1;
            }
            current_msg = Some(msg_uuid);
            message_count += 1;
        }

        // Parse the raw_payload JSON to extract the actual content
        let block_value: serde_json::Value = serde_json::from_str(&raw_payload)?;

        // Extract the text content based on block type
        let content_bytes: Vec<u8> = match block_type.as_str() {
            "text" => {
                text_count += 1;
                let text = block_value.get("text").and_then(|t| t.as_str()).unwrap_or("");
                text.as_bytes().to_vec()
            }
            "thinking" | "reasoning" => {
                thinking_count += 1;
                // Full thinking content - NOT a placeholder
                let thinking = block_value.get("thinking")
                    .or_else(|| block_value.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                thinking.as_bytes().to_vec()
            }
            "tool_use" => {
                tool_use_count += 1;
                // Complete serialized tool input
                let name = block_value.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let input = block_value.get("input");
                let input_str = input.map(|i| serde_json::to_string(i).unwrap_or_default()).unwrap_or_default();
                format!("[tool_use:{}]\n{}", name, input_str).into_bytes()
            }
            "tool_result" => {
                tool_result_count += 1;
                // Complete serialized tool result content
                let content = block_value.get("content");
                let result_str = if let Some(c) = content {
                    if let Some(s) = c.as_str() {
                        s.to_string()
                    } else {
                        serde_json::to_string(c).unwrap_or_default()
                    }
                } else {
                    String::new()
                };
                format!("[tool_result]\n{}", result_str).into_bytes()
            }
            _ => {
                // Unknown blocks: include with type marker, NOT silently dropped
                unknown_count += 1;
                format!("[{}]\n{}", block_type, raw_payload).into_bytes()
            }
        };

        // Replace NUL bytes in content
        let clean_bytes: Vec<u8> = content_bytes.iter()
            .flat_map(|&b| if b == 0 { vec![0xEF, 0xBF, 0xBD] } else { vec![b] })
            .collect();

        out_file.write_all(&clean_bytes)?;
        hasher.update(&clean_bytes);
        total_bytes += clean_bytes.len() as u64;

        // Newline separator between blocks within same message
        out_file.write_all(b"\n")?;
        hasher.update(b"\n");
        total_bytes += 1;
    }

    // Final NUL
    out_file.write_all(&[0u8])?;
    hasher.update(&[0u8]);
    total_bytes += 1;

    let dataset_sha256 = format!("{:x}", hasher.finalize());
    let elapsed = start.elapsed();

    println!("Messages:          {}", message_count);
    println!("Text blocks:       {}", text_count);
    println!("Thinking blocks:   {}", thinking_count);
    println!("Tool use blocks:   {}", tool_use_count);
    println!("Tool result blocks:{}", tool_result_count);
    println!("Unknown blocks:    {}", unknown_count);
    println!("Total bytes:       {}", total_bytes);
    println!("Dataset SHA-256:   {}", dataset_sha256);
    println!("Duration:          {:.2?}", elapsed);

    // Write manifest
    let manifest = serde_json::json!({
        "dataset_id": "full_trace",
        "description": "Full trace: text + thinking + tool_use + tool_result in original order",
        "source": "reports/import/conversations.db content_blocks",
        "block_types_included": ["text", "thinking", "reasoning", "tool_use", "tool_result", "token_budget", "flag"],
        "thinking_handling": "full_content_not_placeholder",
        "tool_handling": "complete_serialized_input_and_result",
        "unknown_handling": "included_with_type_marker",
        "separator": "NUL (0x00) between messages, newline between blocks",
        "dataset_sha256": dataset_sha256,
        "input_bytes": total_bytes,
        "message_count": message_count,
        "block_counts": {
            "text": text_count,
            "thinking": thinking_count,
            "tool_use": tool_use_count,
            "tool_result": tool_result_count,
            "unknown": unknown_count,
            "total": text_count + thinking_count + tool_use_count + tool_result_count + unknown_count,
        },
        "generated_at": chrono::Utc::now().to_rfc3339(),
    });

    fs::write(
        format!("{}/full_trace.manifest.json", out_dir),
        serde_json::to_string_pretty(&manifest)?,
    )?;

    println!("\nWritten: {}/full_trace.bin", out_dir);
    println!("Written: {}/full_trace.manifest.json", out_dir);

    Ok(())
}
