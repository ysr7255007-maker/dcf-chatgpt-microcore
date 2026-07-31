use anyhow::Result;
use rusqlite::Connection;
use std::time::Instant;

fn main() -> Result<()> {
    println!("=== Query Benchmark Test ===\n");
    
    let conn = Connection::open("reports/import/conversations.db")?;
    
    // Test queries with timing
    let queries = vec![
        ("Text blocks count", "SELECT COUNT(*) FROM content_blocks WHERE block_type = 'text'"),
        ("Thinking blocks count", "SELECT COUNT(*) FROM content_blocks WHERE block_type = 'thinking'"),
        ("Tool use blocks count", "SELECT COUNT(*) FROM content_blocks WHERE block_type = 'tool_use'"),
        ("All content blocks", "SELECT COUNT(*) FROM content_blocks"),
        ("Total bytes text", "SELECT SUM(payload_bytes) FROM content_blocks WHERE block_type = 'text'"),
    ];
    
    for (name, query) in queries {
        let start = Instant::now();
        let result: i64 = conn.query_row(query, [], |r| r.get(0))?;
        let duration = start.elapsed();
        println!("✅ {} - {:?} (result: {})", name, duration, result);
    }
    
    println!("\n✅ All query benchmarks completed!");
    Ok(())
}
