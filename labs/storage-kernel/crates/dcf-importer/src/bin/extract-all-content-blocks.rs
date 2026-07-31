use anyhow::Result;
use rusqlite::{Connection, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== DCF Storage Kernel - Full Content Block Extraction ===");
    
    let conn = Connection::open("reports/import/conversations.db")?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    
    println!("📖 Extracting ALL content[] blocks from messages...");
    let start = Instant::now();
    
    // Fixed: Use proper String types for SQLite retrieval
    let mut stmt = conn.prepare(
        "SELECT message_uuid, raw_payload FROM messages"
    )?;
    let iter = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?
        ))
    })?;
    
    let (mut txt, mut thk, mut tu, mut tr, mut unk) = (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut bytes = 0u64;
    let mut idx = 0u64;
    
    for row in iter {
        let (msg_uuid, payload) = row?;
        
        if let Ok(json) = serde_json::from_str::<Value>(&payload) {
            if let Some(arr) = json.get("content").and_then(|c| c.as_array()) {
                for (ord, item) in arr.iter().enumerate() {
                    idx += 1;
                    let item_str = serde_json::to_string(item).unwrap();
                    bytes += item_str.len() as u64;
                    
                    if let Some(ty) = item.get("type").and_then(|v| v.as_str()) {
                        match ty {
                            "text" => txt += 1,
                            "reasoning" | "thinking" | "thought" => thk += 1,
                            "tool_use" => tu += 1,
                            "tool_result" => tr += 1,
                            _ => { eprintln!("Unknown: {}", ty); unk += 1; }
                        }
                        
                        let bid = format!("cb-{}-{idx:08x}", &msg_uuid[..8.min(msg_uuid.len())]);
                        let ph = format!("{:x}", Sha256::digest(item_str.as_bytes()));
                        
                        conn.execute(
                            "INSERT INTO content_blocks \
                             (block_id, message_uuid, ordinal, block_type, raw_payload, payload_bytes, source_field_hash, source_blob_sha256, source_json_pointer) \
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            params![bid, msg_uuid, ord, ty, item_str, item_str.len() as u64, ph, 
                                   "a0fa4eb8449ee5ea08e8f48b1ab3d9c61653df2d9454ee79953c9a0e3e11a786",
                                   format!("/content[{}]", ord)],
                        )?;
                    }
                }
            } else {
                unk += 1;
                bytes += payload.len() as u64;
            }
        }
        
        if idx % 1000 == 0 {
            println!("   Processed {} blocks...", idx);
        }
    }
    
    let elapsed = start.elapsed();
    println!("\n✅ Extraction completed!");
    println!("📊 Statistics:");
    println!("   Text:         {}", txt);
    println!("   Thinking:     {}", thk);
    println!("   Tool use:     {}", tu);
    println!("   Tool result:  {}", tr);
    println!("   Unknown:      {}", unk);
    println!("   Total bytes:  {:.2} MB", bytes as f64 / 1_048_576.0);
    println!("Duration:       {:.2?}", elapsed);
    
    Ok(())
}
