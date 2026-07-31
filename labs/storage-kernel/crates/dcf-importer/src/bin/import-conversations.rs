use anyhow::{Context, Result};
use dcf_importer::{init_database, register_artifacts};
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn main() -> Result<()> {
    println!("=== DCF Storage Kernel - Conversation Importer ===");
    println!();

    let data_dir = "/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000";
    let json_file = format!("{}/conversations.json", data_dir);
    let db_path = "reports/import/conversations.db";
    
    // Create import output directory
    fs::create_dir_all("reports/import")?;
    
    // Remove existing database if exists (for clean reimport)
    let _ = fs::remove_file(db_path);
    
    // Open SQLite database
    let conn = Connection::open(db_path)?;
    
    // Enable foreign keys (IMPORTANT! Must be done BEFORE init_database)
    conn.execute_batch("PRAGMA foreign_keys = ON").context("Failed to enable foreign keys")?;
    
    // Verify FK is enabled
    let fk_enabled: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    if !fk_enabled {
        eprintln!("⚠️  WARNING: Foreign keys are NOT ENABLED!");
        eprintln!("   This means data integrity cannot be guaranteed.");
    }
    println!("   Foreign keys enabled: {}", fk_enabled);
    
    // Initialize schema
    println!("🔧 Initializing database schema...");
    init_database(&conn)?;
    
    // Register artifacts from Task 2.1
    let manifest_path = "reports/artifacts/registration.json";
    if PathBuf::from(manifest_path).exists() {
        println!("📋 Registering artifacts from registration.json...");
        register_artifacts(&conn, manifest_path)?;
        println!("✅ Artifacts registered");
    } else {
        eprintln!("⚠️  Manifest not found at: {}", manifest_path);
    }
    
    // Load and parse JSON (this is a 156MB single-line JSON array)
    println!("\n📖 Loading conversations.json...");
    let content = fs::read_to_string(&json_file)?;
    println!("   Loaded {} bytes", content.len());
    
    // Parse as JSON array of conversations
    let root = serde_json::from_str::<Value>(&content)?;
    let conversations = root.as_array().expect("Root must be array");
    
    println!("   Found {} conversations", conversations.len());
    
    // Process each conversation
    let start_time = std::time::Instant::now();
    
    for (conv_idx, conv_value) in conversations.iter().enumerate() {
        if conv_idx % 100 == 0 {
            println!("   Processing conversation {}/{}", conv_idx, conversations.len());
        }
        
        let conv_uuid = conv_value["uuid"].as_str().unwrap_or("unknown");
        let created_at = conv_value["created_at"].as_str().unwrap_or("");
        
        // Get chat messages array (ChatGPT uses 'chat_messages' not'messages')
        let chat_messages = conv_value.get("chat_messages").and_then(|m| m.as_array());
        let msg_count = chat_messages.as_ref().map(|v| v.len()).unwrap_or(0);
        
        // Insert conversation first (before inserting messages)
        conn.execute(
            r#"INSERT OR REPLACE INTO conversations 
               (conversation_uuid, created_at, source_blob_sha256, message_count)
               VALUES (?, ?, 'a0fa4eb8449ee5ea08e8f48b1ab3d9c61653df2d9454ee79953c9a0e3e11a786', ?)"#,
            rusqlite::params![conv_uuid, created_at, msg_count],
        )?;
        
        // Insert each message
        if let Some(msg_array) = chat_messages {
            for msg_value in msg_array {
                insert_message(&conn, msg_value, conv_uuid)?;
            }
        }
    }
    
    let elapsed = start_time.elapsed();
    
    // Compute statistics
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM conversations")?;
    let conv_count: usize = stmt.query_row([], |r| r.get(0))?;
    
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM messages")?;
    let msg_count: usize = stmt.query_row([], |r| r.get(0))?;
    
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM content_blocks")?;
    let block_count: usize = stmt.query_row([], |r| r.get(0))?;
    
    println!();
    println!("✅ Import completed successfully!");
    println!();
    println!("📊 Statistics:");
    println!("   Conversations: {}", conv_count);
    println!("   Messages: {}", msg_count);
    println!("   Content Blocks: {}", block_count);
    println!("\n⏱️  Total time: {:.2?}", elapsed);
    println!();
    
    Ok(())
}

fn insert_message(
    conn: &Connection,
    msg_value: &Value,
    conv_uuid: &str,) -> anyhow::Result<()> {
    let msg_uuid = msg_value["uuid"].as_str().unwrap_or("unknown").to_string();
    let parent_uuid = msg_value["parent_message_uuid"]
        .as_str()
        .map(|s| s.to_string());
    let sender = msg_value["sender"].as_str().unwrap_or("").to_string();
    let created_at = msg_value["created_at"].as_str().unwrap_or("");
    
    // Compute content hash and save raw payload
    let content_json = serde_json::to_string(msg_value)?;
    let mut hasher = Sha256::new();
    hasher.update(content_json.as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());
    
    conn.execute(
        r#"INSERT INTO messages 
           (message_uuid, conversation_uuid, parent_message_uuid, sender, created_at, content_hash, raw_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        rusqlite::params![
            msg_uuid,
            conv_uuid,
            parent_uuid,
            sender,
            created_at,
            content_hash,
            content_json
        ],
    )?;
    
    Ok(())
}