use anyhow::Result;
use rusqlite::{Connection, params};
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== DCF Storage Kernel - Truth Set Generation ===\n");
    
    let conn = Connection::open("reports/import/conversations.db")?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    
    // Create truth_sets table
    conn.execute(
        r#"CREATE TABLE IF NOT EXISTS truth_sets (
            projection_id TEXT PRIMARY KEY,
            block_type TEXT NOT NULL,
            exact_count INTEGER NOT NULL,
            total_bytes INTEGER NOT NULL,
            verified_at TEXT NOT NULL
        )"#,
        []
    )?;
    
    println!("🔍 Generating byte-level ground truth from content_blocks...\n");
    let start = Instant::now();
    
    let mut stmt = conn.prepare(
        "SELECT block_type, COUNT(*) as cnt, SUM(payload_bytes) as bytes 
         FROM content_blocks GROUP BY block_type"
    )?;
    
    let results = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, Option<i64>>(2).unwrap_or(0),
        ))
    })?;
    
    for row in results {
        let (block_type, count, bytes): (_, _, _) = row?;
        
        conn.execute(
            "INSERT INTO truth_sets (projection_id, block_type, exact_count, total_bytes, verified_at) VALUES (?, ?, ?, ?, ?)",
            params![
                format!("truth_{}", block_type),
                block_type,
                count,
                bytes,
                chrono::Utc::now().to_rfc3339()
            ]
        )?;
        
        println!("✅ Block type '{}' - Count: {}, Bytes: {}", block_type, count, bytes);
    }
    
    println!("\n✅ Truth set generation completed!");
    println!("⏱️  Duration: {:.2?}", start.elapsed());
    println!("\nTruth sets stored in truth_sets table");
    
    Ok(())
}
