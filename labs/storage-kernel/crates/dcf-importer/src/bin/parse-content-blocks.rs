use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== DCF Storage Kernel - Content Block Parser ===");
    println!();

    let db_path = "reports/import/conversations.db";
    
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    
    println!("📖 Parsing content[] arrays from all messages...");
    
    let start_time = Instant::now();
    
    let mut stmt = conn.prepare(
        r#"SELECT message_uuid, conversation_uuid 
           FROM messages LIMIT 10"#
    )?;
    
    let test_messages: Vec<(String, String)> = stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?.collect::<Result<Vec<_>, _>>()?;
    
    println!("   Testing on {} sample messages...", test_messages.len());
    
    let mut text_count = 0u64;
    let mut thinking_count = 0u64;
    let mut tool_use_count = 0u64;
    let mut tool_result_count = 0u64;
    let mut unknown_count = 0u64;
    let mut total_bytes = 0u64;
    
    for (msg_uuid, conv_uuid) in &test_messages {
        let raw_payload: String = conn.query_row(
            "SELECT raw_payload FROM messages WHERE message_uuid = ?",
            [&msg_uuid],
            |r| r.get(0),
        )?;
        
        if let Ok(json_value) = serde_json::from_str::<Value>(&raw_payload) {
            if let Some(content_array) = json_value.get("content").and_then(|c| c.as_array()) {
                println!("   Message {}: {} content blocks", &msg_uuid[..16.min(msg_uuid.len())], content_array.len());
                
                for (_ordinal, content_item) in content_array.iter().enumerate() {
                    let (t, th, tu, tr, u) = extract_block_type(content_item);
                    text_count += t;
                    thinking_count += th;
                    tool_use_count += tu;
                    tool_result_count += tr;
                    unknown_count += u;
                }
            } else {
                println!("   Message {}: NO content array (legacy format)", &msg_uuid[..16.min(msg_uuid.len())]);
                unknown_count += 1;
            }
        }
    }
    
    println!();
    println!("✅ Test parsing completed!");
    println!("📊 Sample Statistics:");
    println!("   Text blocks seen:      {}", text_count);
    println!("   Thinking blocks seen:  {}", thinking_count);
    println!("   Tool use blocks seen:  {}", tool_use_count);
    println!("   Unknown formats:       {}", unknown_count);
    println!();
    println!("Note: Full extraction would parse all {} messages", get_message_count(&conn)?);
    
    Ok(())
}

fn extract_block_type(content_item: &Value) -> (u64, u64, u64, u64, u64) {
    let mut t = 0u64;
    let mut th = 0u64;
    let mut tu = 0u64;
    let mut tr = 0u64;
    let mut u = 0u64;
    
    if let Some(ct) = content_item.get("type").and_then(|c| c.as_str()) {
        match ct {
            "text" => t += 1,
            "reasoning" | "thinking" | "thought" => th += 1,
            "tool_use" => tu += 1,
            "tool_result" => tr += 1,
            _ => {
                eprintln!("     Unknown type: {}", ct);
                u += 1;
            }
        }
    }
    
    (t, th, tu, tr, u)
}

fn get_message_count(conn: &Connection) -> Result<usize> {
    let count: usize = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
    Ok(count)
}
