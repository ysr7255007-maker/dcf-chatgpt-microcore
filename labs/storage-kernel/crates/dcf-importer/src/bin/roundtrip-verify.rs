use anyhow::Result;
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::time::Instant;

/// Gate A3: Round-trip test
/// Rebuilds message objects from database raw_payload and compares
/// canonical hash against source messages.
fn main() -> Result<()> {
    println!("=== Gate A3: Round-Trip Verification ===\n");

    let source_path = "/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations.json";
    let db_path = "reports/import/conversations.db";

    let start = Instant::now();

    // Load source
    println!("Loading source file...");
    let source_bytes = fs::read(source_path)?;
    let source_value: Value = serde_json::from_slice(&source_bytes)?;
    let conversations = source_value.as_array()
        .ok_or_else(|| anyhow::anyhow!("Source is not an array"))?;

    // Build source message map: uuid -> canonical hash
    println!("Building source message hash map...");
    let mut source_hashes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut source_count = 0u64;

    for conv in conversations {
        let chat_messages = match conv.get("chat_messages").and_then(|m| m.as_array()) {
            Some(arr) => arr,
            None => continue,
        };
        for msg in chat_messages {
            if let Some(uuid) = msg.get("uuid").and_then(|u| u.as_str()) {
                let canonical = serde_json::to_string(msg)?;
                let hash = format!("{:x}", Sha256::digest(canonical.as_bytes()));
                source_hashes.insert(uuid.to_string(), hash);
                source_count += 1;
            }
        }
    }
    println!("  Source messages: {}", source_count);

    // Open database and verify each stored message
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT message_uuid, raw_payload FROM messages")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;

    let mut db_count = 0u64;
    let mut roundtrip_matches = 0u64;
    let mut roundtrip_mismatches = 0u64;
    let mut missing_in_db = 0u64;
    let mut mismatch_samples: Vec<serde_json::Value> = Vec::new();

    for row in rows {
        let (msg_uuid, raw_payload) = row?;
        db_count += 1;

        // Compute hash of stored raw_payload
        let stored_hash = format!("{:x}", Sha256::digest(raw_payload.as_bytes()));

        match source_hashes.get(&msg_uuid) {
            Some(source_hash) => {
                if *source_hash == stored_hash {
                    roundtrip_matches += 1;
                } else {
                    roundtrip_mismatches += 1;
                    if mismatch_samples.len() < 10 {
                        mismatch_samples.push(serde_json::json!({
                            "message_uuid": msg_uuid,
                            "source_hash": source_hash,
                            "stored_hash": stored_hash,
                        }));
                    }
                }
            }
            None => {
                missing_in_db += 1;
            }
        }
    }

    // Check source messages not in database
    let not_in_db = source_count - (roundtrip_matches + roundtrip_mismatches);

    let elapsed = start.elapsed();

    println!("\n=== Round-Trip Results ===\n");
    println!("Source messages:        {}", source_count);
    println!("Database messages:      {}", db_count);
    println!("Round-trip matches:     {}", roundtrip_matches);
    println!("Round-trip mismatches:  {}", roundtrip_mismatches);
    println!("Source not in DB:       {}", not_in_db);
    println!("DB not in source:       {}", missing_in_db);
    println!();
    println!("Duration: {:.2?}", elapsed);

    if roundtrip_mismatches > 0 {
        println!("\nMismatch samples:");
        for s in &mismatch_samples {
            println!("  {}", serde_json::to_string(s)?);
        }
    }

    // Write report
    fs::create_dir_all("reports/material")?;
    let report = serde_json::json!({
        "roundtrip_metadata": {
            "source_file": source_path,
            "database": db_path,
            "duration_secs": elapsed.as_secs_f64(),
        },
        "source_messages": source_count,
        "database_messages": db_count,
        "roundtrip_matches": roundtrip_matches,
        "roundtrip_mismatches": roundtrip_mismatches,
        "source_not_in_db": not_in_db,
        "db_not_in_source": missing_in_db,
        "verdict": if roundtrip_mismatches == 0 && not_in_db == 0 {
            "MESSAGE_LEVEL_ROUNDTRIP_VERIFIED"
        } else {
            "ROUNDTRIP_VIOLATIONS_DETECTED"
        },
        "mismatch_samples": mismatch_samples,
    });

    fs::write(
        "reports/material/roundtrip-result.json",
        serde_json::to_string_pretty(&report)?,
    )?;
    println!("\nReport written to reports/material/roundtrip-result.json");

    Ok(())
}
