use anyhow::Result;
use rusqlite::{Connection, params};
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== Query Workload Test ===\n");
    
    let conn = Connection::open("reports/import/conversations.db")?;
    
    // Create query_workloads table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS query_workloads (\n  \
         query_id TEXT PRIMARY KEY,\n  \
         query_type TEXT NOT NULL,\n  \
         sample_query TEXT NOT NULL,\n  \
         expected_count INTEGER NOT NULL\n)",
        [],
    )?;
    
    println!("Testing query performance on content_blocks...\n");
    let start = Instant::now();
    
    // Test 1: Text search query
    let text_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM content_blocks WHERE block_type = 'text'",
        [],
        |r| r.get(0),
    )?;
    println!("✅ Text search - Count: {}", text_count);
    
    // Test 