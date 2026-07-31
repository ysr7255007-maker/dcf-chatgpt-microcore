pub mod utf8_self_index;

pub use utf8_self_index::Utf8SelfIndex;

use anyhow::Result;

/// External Engine Protocol - JSON-lines based communication
pub trait SearchEngine {
    /// Search for query and return results as JSON-lines string
    fn search(&self, query: &str, limit: usize) -> Result<String>;
    
    /// Get count of searchable blocks
    fn count_searchable_blocks(&self) -> Result<usize>;
}

impl SearchEngine for Utf8SelfIndex {
    fn search(&self, query: &str, limit: usize) -> Result<String> {
        self.search(query, limit)
    }

    fn count_searchable_blocks(&self) -> Result<usize> {
        self.count_searchable_blocks()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_protocol() {
        let db_path = "reports/import/conversations.db";
        let index = Utf8SelfIndex::new(db_path).expect("Failed to open database");
        
        let count = index.count_searchable_blocks().expect("Failed to count blocks");
        assert!(count > 0, "Should have searchable blocks");
        println!("Found {} searchable blocks", count);
    }
}