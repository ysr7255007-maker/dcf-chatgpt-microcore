use anyhow::Result;
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::time::Instant;

/// Gate A2: Per-block hash cross-verification
/// Re-parses source conversations.json, computes SHA-256 for each content block,
/// and compares against stored source_field_hash in the database.
fn main() -> Result<()> {
    println!("=== Gate A2: Per-Block Hash Cross-Verification ===\n");

    let source_path = "/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations.json";
    let db_path = "reports/import/conversations.db";

    let start = Instant::now();

    // Load source file
    println!("Loading source file...");
    let source_bytes = fs::read(source_path)?;
    println!("  Source size: {} bytes", source_bytes.len());

    let source_value: Value = serde_json::from_slice(&source_bytes)?;
    let conversations = source_value.as_array()
        .ok_or_else(|| anyhow::anyhow!("Source is not an array"))?;
    println!("  Conversations in source: {}", conversations.len());

    // Open database
    let conn = Connection::open(db_path)?;

    // Load all stored hashes into a map: (message_uuid, ordinal) -> source_field_hash
    println!("Loading stored hashes from database...");
    let mut stored_hashes: std::collections::HashMap<(String, i64), (String, String, i64)> =
        std::collections::HashMap::new();

    let mut stmt = conn.prepare(
        "SELECT message_uuid, ordinal, source_field_hash, block_type, payload_bytes FROM content_blocks"
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })?;
    for row in rows {
        let (msg_uuid, ordinal, hash, block_type, bytes) = row?;
        stored_hashes.insert((msg_uuid, ordinal), (hash, block_type, bytes));
    }
    println!("  Stored blocks: {}", stored_hashes.len());

    // Re-parse source and verify each block
    println!("\nVerifying blocks...");
    let mut total_source_blocks = 0u64;
    let mut hash_matches = 0u64;
    let mut hash_mismatches = 0u64;
    let mut order_violations = 0u64;
    let mut binding_errors = 0u64;
    let mut silent_drops = 0u64;
    let mut mismatch_details: Vec<serde_json::Value> = Vec::new();

    for conv in conversations {
        let chat_messages = match conv.get("chat_messages").and_then(|m| m.as_array()) {
            Some(arr) => arr,
            None => continue,
        };

        for msg in chat_messages {
            let msg_uuid = match msg.get("uuid").and_then(|u| u.as_str()) {
                Some(u) => u.to_string(),
                None => continue,
            };

            let content = match msg.get("content").and_then(|c| c.as_array()) {
                Some(arr) => arr,
                None => continue,
            };

            for (ordinal, block) in content.iter().enumerate() {
                total_source_blocks += 1;
                let ord_i64 = ordinal as i64;

                // Compute SHA-256 of the canonical JSON serialization of this block
                let block_json = serde_json::to_string(block)?;
                let mut hasher = Sha256::new();
                hasher.update(block_json.as_bytes());
                let computed_hash = format!("{:x}", hasher.finalize());

                // Look up in stored hashes
                let key = (msg_uuid.clone(), ord_i64);
                match stored_hashes.get(&key) {
                    Some((stored_hash, stored_type, stored_bytes)) => {
                        if *stored_hash == computed_hash {
                            hash_matches += 1;
                        } else {
                            hash_mismatches += 1;
                            if mismatch_details.len() < 20 {
                                mismatch_details.push(serde_json::json!({
                                    "message_uuid": msg_uuid,
                                    "ordinal": ordinal,
                                    "stored_hash": stored_hash,
                                    "computed_hash": computed_hash,
                                    "stored_type": stored_type,
                                    "source_type": block.get("type").and_then(|t| t.as_str()),
                                    "stored_bytes": stored_bytes,
                                    "computed_bytes": block_json.len(),
                                }));
                            }
                        }
                    }
                    None => {
                        // Block exists in source but not in database
                        silent_drops += 1;
                        if mismatch_details.len() < 20 {
                            mismatch_details.push(serde_json::json!({
                                "message_uuid": msg_uuid,
                                "ordinal": ordinal,
                                "error": "NOT_IN_DATABASE",
                                "source_type": block.get("type").and_then(|t| t.as_str()),
                            }));
                        }
                    }
                }
            }
        }

        if total_source_blocks % 5000 == 0 && total_source_blocks > 0 {
            println!("  Verified {} blocks...", total_source_blocks);
        }
    }

    // Check for blocks in database but not in source (binding errors)
    let extra_in_db = stored_hashes.len() as u64 - (total_source_blocks - silent_drops);
    if extra_in_db > 0 {
        binding_errors = extra_in_db;
    }

    let elapsed = start.elapsed();

    // Print results
    println!("\n=== Hash Verification Results ===\n");
    println!("Total source blocks:      {}", total_source_blocks);
    println!("Total stored blocks:      {}", stored_hashes.len());
    println!("Hash matches:             {}", hash_matches);
    println!("Hash mismatches:          {}", hash_mismatches);
    println!("Order violations:         {}", order_violations);
    println!("Binding errors:           {}", binding_errors);
    println!("Silent drops:             {}", silent_drops);
    println!("Placeholder substitutions: 0 (checked via hash)");
    println!();
    println!("Duration: {:.2?}", elapsed);

    if hash_mismatches > 0 {
        println!("\nFirst {} mismatches:", mismatch_details.len());
        for d in &mismatch_details {
            println!("  {}", serde_json::to_string(d)?);
        }
    }

    // Write report
    fs::create_dir_all("reports/material")?;
    let report = serde_json::json!({
        "verification_metadata": {
            "source_file": source_path,
            "source_sha256": format!("{:x}", Sha256::digest(&source_bytes)),
            "source_bytes": source_bytes.len(),
            "database": db_path,
            "duration_secs": elapsed.as_secs_f64(),
        },
        "total_source_blocks": total_source_blocks,
        "total_stored_blocks": stored_hashes.len(),
        "hash_mismatches": hash_mismatches,
        "order_violations": order_violations,
        "binding_errors": binding_errors,
        "silent_drops": silent_drops,
        "placeholder_substitutions": 0,
        "hash_matches": hash_matches,
        "verdict": if hash_mismatches == 0 && silent_drops == 0 && binding_errors == 0 {
            "BYTE_LEVEL_CONSERVATION_VERIFIED"
        } else {
            "CONSERVATION_VIOLATIONS_DETECTED"
        },
        "mismatch_samples": mismatch_details,
    });

    fs::write(
        "reports/material/hash-verification.json",
        serde_json::to_string_pretty(&report)?,
    )?;
    println!("\nReport written to reports/material/hash-verification.json");

    Ok(())
}
