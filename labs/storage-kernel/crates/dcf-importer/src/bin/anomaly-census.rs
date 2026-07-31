use anyhow::Result;
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::Instant;

/// Gate A1: Complete anomaly census
/// Scans ALL messages and records EVERY anomaly (not samples)
fn main() -> Result<()> {
    println!("=== Gate A1: Complete Anomaly Census ===\n");

    let conn = Connection::open("reports/import/conversations.db")?;
    let start = Instant::now();

    // Collect all message UUIDs for dangling parent detection
    let mut all_msg_uuids: HashSet<String> = HashSet::new();
    let mut stmt = conn.prepare("SELECT message_uuid FROM messages")?;
    let uuids = stmt.query_map([], |r| r.get::<_, String>(0))?;
    for u in uuids {
        all_msg_uuids.insert(u?);
    }
    println!("Loaded {} message UUIDs for reference", all_msg_uuids.len());

    // Anomaly counters
    let mut dangling_parent: Vec<(String, String, String)> = Vec::new(); // (msg_uuid, conv_uuid, parent_uuid)
    let mut tool_result_without_use_id: Vec<(String, String)> = Vec::new(); // (msg_uuid, block info)
    let mut tool_use_without_result: Vec<(String, String)> = Vec::new(); // (msg_uuid, tool_use_id)
    let mut tool_result_error: Vec<(String, String)> = Vec::new(); // (msg_uuid, tool_name)
    let mut unknown_content_type: Vec<(String, String)> = Vec::new(); // (msg_uuid, type)
    let mut missing_content_array: Vec<String> = Vec::new(); // msg_uuid

    // Collect all tool_use IDs and tool_result tool_use_ids for cross-reference
    let mut all_tool_use_ids: HashSet<String> = HashSet::new();
    let mut all_tool_result_use_ids: HashSet<String> = HashSet::new();

    // Known content types
    let known_types: HashSet<&str> = [
        "text", "thinking", "tool_use", "tool_result",
        "token_budget", "flag", "reasoning",
    ].iter().cloned().collect();

    // Scan all messages
    let mut stmt = conn.prepare(
        "SELECT message_uuid, conversation_uuid, raw_payload FROM messages"
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;

    let mut total_messages = 0u64;
    let mut total_blocks = 0u64;

    for row in rows {
        let (msg_uuid, conv_uuid, raw_payload) = row?;
        total_messages += 1;

        let msg: Value = match serde_json::from_str(&raw_payload) {
            Ok(v) => v,
            Err(_) => {
                unknown_content_type.push((msg_uuid.clone(), "PARSE_ERROR".to_string()));
                continue;
            }
        };

        // Check dangling parent
        if let Some(parent) = msg.get("parent_message_uuid").and_then(|p| p.as_str()) {
            let parent_str = parent.to_string();
            // Placeholder UUID is also anomalous
            if parent_str == "00000000-0000-4000-8000-000000000000"
                || (!parent_str.is_empty() && !all_msg_uuids.contains(&parent_str))
            {
                dangling_parent.push((msg_uuid.clone(), conv_uuid.clone(), parent_str));
            }
        }

        // Check content array
        let content = match msg.get("content").and_then(|c| c.as_array()) {
            Some(arr) => arr,
            None => {
                missing_content_array.push(msg_uuid.clone());
                continue;
            }
        };

        for block in content {
            total_blocks += 1;
            let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("MISSING");

            // Unknown content type
            if !known_types.contains(block_type) && block_type != "MISSING" {
                unknown_content_type.push((msg_uuid.clone(), block_type.to_string()));
            }

            // Tool use: collect ID
            if block_type == "tool_use" {
                if let Some(id) = block.get("id").and_then(|i| i.as_str()) {
                    all_tool_use_ids.insert(id.to_string());
                }
            }

            // Tool result checks
            if block_type == "tool_result" {
                // Check for missing tool_use_id
                match block.get("tool_use_id").and_then(|i| i.as_str()) {
                    Some(id) if !id.is_empty() => {
                        all_tool_result_use_ids.insert(id.to_string());
                    }
                    _ => {
                        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                        tool_result_without_use_id.push((msg_uuid.clone(), name.to_string()));
                    }
                }

                // Check for error results
                if block.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false) {
                    let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                    tool_result_error.push((msg_uuid.clone(), name.to_string()));
                }
            }
        }

        if total_messages % 2000 == 0 {
            println!("  Processed {} messages...", total_messages);
        }
    }

    // Tool use without result: tool_use IDs that have no matching tool_result
    for use_id in &all_tool_use_ids {
        if !all_tool_result_use_ids.contains(use_id) {
            tool_use_without_result.push(("cross-ref".to_string(), use_id.clone()));
        }
    }

    let elapsed = start.elapsed();

    // Print summary
    println!("\n=== Anomaly Census Results ===\n");
    println!("Total messages scanned: {}", total_messages);
    println!("Total content blocks scanned: {}", total_blocks);
    println!();
    println!("dangling_parent:              {}", dangling_parent.len());
    println!("tool_result_without_use_id:   {}", tool_result_without_use_id.len());
    println!("tool_use_without_result:      {}", tool_use_without_result.len());
    println!("tool_result_error:            {}", tool_result_error.len());
    println!("unknown_content_type:         {}", unknown_content_type.len());
    println!("missing_content_array:        {}", missing_content_array.len());
    println!();
    println!("Duration: {:.2?}", elapsed);

    // Write ALL anomalies to import_anomalies table
    conn.execute("DELETE FROM import_anomalies", [])?;

    let mut anomaly_id = 0u64;
    let now = chrono::Utc::now().to_rfc3339();

    for (msg_uuid, conv_uuid, parent_uuid) in &dangling_parent {
        anomaly_id += 1;
        conn.execute(
            "INSERT INTO import_anomalies (anomaly_id, anomaly_type, conversation_uuid, message_uuid, description, raw_evidence, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("anom-{:08x}", anomaly_id),
                "dangling_parent",
                conv_uuid,
                msg_uuid,
                format!("Parent {} not found in message set", parent_uuid),
                parent_uuid,
                &now,
            ],
        )?;
    }

    for (msg_uuid, name) in &tool_result_without_use_id {
        anomaly_id += 1;
        conn.execute(
            "INSERT INTO import_anomalies (anomaly_id, anomaly_type, message_uuid, description, raw_evidence, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("anom-{:08x}", anomaly_id),
                "tool_result_without_use_id",
                msg_uuid,
                format!("Tool result '{}' has no tool_use_id", name),
                name,
                &now,
            ],
        )?;
    }

    for (_, use_id) in &tool_use_without_result {
        anomaly_id += 1;
        conn.execute(
            "INSERT INTO import_anomalies (anomaly_id, anomaly_type, description, raw_evidence, detected_at) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("anom-{:08x}", anomaly_id),
                "tool_use_without_result",
                format!("Tool use ID {} has no matching result", use_id),
                use_id,
                &now,
            ],
        )?;
    }

    for (msg_uuid, name) in &tool_result_error {
        anomaly_id += 1;
        conn.execute(
            "INSERT INTO import_anomalies (anomaly_id, anomaly_type, message_uuid, description, raw_evidence, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("anom-{:08x}", anomaly_id),
                "tool_result_error",
                msg_uuid,
                format!("Tool result '{}' reported is_error=true", name),
                name,
                &now,
            ],
        )?;
    }

    for (msg_uuid, ctype) in &unknown_content_type {
        anomaly_id += 1;
        conn.execute(
            "INSERT INTO import_anomalies (anomaly_id, anomaly_type, message_uuid, description, raw_evidence, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("anom-{:08x}", anomaly_id),
                "unknown_content_type",
                msg_uuid,
                format!("Unknown content type: {}", ctype),
                ctype,
                &now,
            ],
        )?;
    }

    for msg_uuid in &missing_content_array {
        anomaly_id += 1;
        conn.execute(
            "INSERT INTO import_anomalies (anomaly_id, anomaly_type, message_uuid, description, detected_at) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("anom-{:08x}", anomaly_id),
                "missing_content_array",
                msg_uuid,
                "Message has no content[] array",
                &now,
            ],
        )?;
    }

    println!("\nWrote {} anomalies to import_anomalies table", anomaly_id);

    // Write JSON report
    fs::create_dir_all("reports/material")?;
    let report = serde_json::json!({
        "census_metadata": {
            "generated_at": &now,
            "total_messages_scanned": total_messages,
            "total_content_blocks_scanned": total_blocks,
            "duration_secs": elapsed.as_secs_f64(),
        },
        "anomaly_counts": {
            "dangling_parent": dangling_parent.len(),
            "tool_result_without_use_id": tool_result_without_use_id.len(),
            "tool_use_without_result": tool_use_without_result.len(),
            "tool_result_error": tool_result_error.len(),
            "unknown_content_type": unknown_content_type.len(),
            "missing_content_array": missing_content_array.len(),
            "total": anomaly_id,
        },
        "cross_reference": {
            "total_tool_use_ids": all_tool_use_ids.len(),
            "total_tool_result_use_ids": all_tool_result_use_ids.len(),
        }
    });

    fs::write(
        "reports/material/anomaly-census.json",
        serde_json::to_string_pretty(&report)?,
    )?;
    println!("Report written to reports/material/anomaly-census.json");

    Ok(())
}
