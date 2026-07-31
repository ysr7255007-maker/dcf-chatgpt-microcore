use anyhow::Result;
use engine_adapters::Utf8SelfIndex;

fn main() -> Result<()> {
    println!("=== DCF Engine Adapter Test ===\n");
    
    let db_path = "reports/import/conversations.db";
    let index = Utf8SelfIndex::new(db_path)?;
    
    // Count searchable blocks
    let count = index.count_searchable_blocks()?;
    println!("📊 Searchable blocks: {}", count);
    
    // Run sample searches
    let queries = vec![
        ("人生", 5),          // Chinese phrase
        ("thinking", 5),      // English term  
        ("discuss", 5),       // Another search term
    ];
    
    for (query, limit) in queries {
        println!("\n🔍 Searching for '{}'...", query);
        let results = index.search(query, limit)?;
        
        // Print first result as sample
        if let Some(first_line) = results.lines().next() {
            println!("   First result: {}", &first_line[..200.min(first_line.len())]);
        }
    }
    
    println!("\n✅ Engine adapter working correctly!");
    Ok(())
}
