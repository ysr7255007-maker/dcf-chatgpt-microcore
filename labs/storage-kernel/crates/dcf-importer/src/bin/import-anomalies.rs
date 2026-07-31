use anyhow::Result;
use rusqlite::Connection;
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== DCF Storage Kernel - Anomaly Detection ===");
    println!();

    let db_path = "reports/import/conversations.db";
    
    let conn = Connection::open(db_path)?;
    
    // Detect various anomaly types
    let start_time = Instant::now();
    
    // 1. Dangling parent references
    let dangling_count: i64 = conn.query_row(
        r#"SELECT COUNT(*) FROM messages 
           WHERE parent_message_uuid IS NOT NULL 
             AND parent_message_uuid != ''
             AND parent_message_uuid NOT IN (SELECT message_uuid FROM messages)"#
        , [], |r| r.get(0))?;
    
    if dangling_count > 0 {
        println!("⚠️  Found {} dangling_parent anomalies", dangling_count);
        
        // Record first 10 examples
        let mut stmt = conn.prepare(
            r#"SELECT message_uuid, conversation_uuid, parent_message_uuid 
               FROM messages 
               WHERE parent_message_uuid IS NOT NULL 
                 AND parent_message_uuid != ''
                 AND parent_message_uuid NOT IN (SELECT message_uuid FROM messages)
               LIMIT 10"#
        )?;
        
        let anomalies: Vec<(String, String, String)> = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?
            ))
        })?.collect::<Result<Vec<_>, _>>()?;
        
        println!("   Sample anomalies:");
        for (msg_uuid, conv_uuid, parent_uuid) in &anomalies {
            println!("     - {}: parent={} (conv={})", msg_uuid, parent_uuid, conv_uuid);
        }
        
        // Insert into import_anomalies table
        for (msg_uuid, conv_uuid, parent_uuid) in &anomalies {
            conn.execute(
                r#"INSERT INTO import_anomalies 
                   (anomaly_type, conversation_uuid, message_uuid, description, detected_at)
                   VALUES (?, ?, ?, ?, ?)"#
                , rusqlite::params![
                    "dangling_parent",
                    conv_uuid,
                    msg_uuid,
                    format!("Message {} references non-existent parent {}", msg_uuid, parent_uuid),
                    chrono::Utc::now().to_rfc3339()
                ]
            )?;
        }
        
        println!("   ✓ Recorded {} sample anomalies to import_anomalies", anomalies.len());
    } else {
        println!("✅ No dangling_parent anomalies found");
    }
    
    let elapsed = start_time.elapsed();
    
    // Summary statistics
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM import_anomalies")?;
    let total_anomalies: usize = stmt.query_row([], |r| r.get(0))?;
    
    println!();
    println!("✅ Anomaly detection completed!");
    println!("📊 Total anomalies recorded: {}", total_anomalies);
    println!("⏱️  Duration: {:.2?}", elapsed);
    println!();
    
    Ok(())
}
