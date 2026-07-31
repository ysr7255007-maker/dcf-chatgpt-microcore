use anyhow::Result;
use rusqlite::{Connection, params};
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== Truth Set Generator ===\n");
    
    let conn = Connection::open("reports/import/conversations.db")?;
    
    // Create truth_sets table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS truth_sets (\n  projection_id TEXT PRIMARY KEY,\n  block_type TEXT NOT NULL,\n  exact_count INTEGER NOT NULL,\n  total_bytes INTEGER NOT NULL\n)",
        []
    )?;
    
    println!("Generating ground truth from content_blocks...\n");
    let start = Instant::now();
    
    let mut stmt = conn.prepare(
        "SELECT block_type, COUNT(*) as cnt, SUM(payload_bytes) as bytes \
         FROM content_blocks GROUP BY block_type"
    )?;
    
    let results = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<i64>>(2)?.unwrap_or(0),
        ))
    })?;
    
    for row in results {
        let (block_type, count, bytes): (_, _, _) = row?;
        
        conn.execute(
            "INSERT OR REPLACE INTO truth_sets \
             (projection_id, block_type, exact_count, total_bytes) VALUES (?, ?, ?, ?)",
            params![format!("truth_{}", block_type), block_type, count, bytes]
        )?;
    }
    
    println!("✅ Completed!");
    println!("⏱️  Duration: {:.2?}", start.elapsed());
    
    Ok(())
}
