use anyhow::Result;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

/// UTF-8 Self Index Adapter - Basic implementation that reads from SQLite
pub struct Utf8SelfIndex {
    conn: Connection,
}

impl Utf8SelfIndex {
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        Ok(Self { conn })
    }

    /// Search for query string in content blocks (UTF-8 based)
    pub fn search(&self, query: &str, limit: usize) -> Result<String> {
        let results = self.search_impl(query, limit)?;
        
        // Output as JSON-lines format for external engine protocol
        let output = results.iter().map(|h| {
            serde_json::to_string(h).unwrap_or_default()
        }).collect::<Vec<_>>().join("\n");
        
        Ok(output)
    }

    /// Core search implementation returning hits
    fn search_impl(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut stmt = self.conn.prepare(
            "SELECT block_id, block_type, raw_payload FROM content_blocks \
             WHERE block_type IN ('text', 'thinking') AND \
             instr(raw_payload, ?) > 0 ORDER BY CASE block_type \
               WHEN 'text' THEN 0 ELSE 1 END LIMIT ?"
        )?;

        let hits: Vec<SearchHit> = stmt
            .query_map(params![query, limit], |row| {
                let block_id: String = row.get(0)?;
                let block_type: String = row.get(1)?;
                let raw_payload: String = row.get(2)?;

                // Find query position for span calculation
                let position = raw_payload.find(query).unwrap_or(0);
                
                // Simple snippet without complex UTF-8 handling
                let start = if position > 128 { position - 128 } else { 0 };
                let end = (position + 256).min(raw_payload.len());
                
                let snippet = if start > 0 && end < raw_payload.len() {
                    format!("...{}...", &raw_payload[start..end])
                } else if start > 0 {
                    format!("...{}", &raw_payload[start..])
                } else {
                    format!("{}", &raw_payload[..end])
                };

                Ok(SearchHit {
                    text_id: block_id.clone(),
                    block_type,
                    canonical_span: CanonicalSpan {
                        start: position,
                        end: position + query.len(),
                        bytes: query.len() as u64,
                    },
                    snippet,
                    payload_sha256: format!("{:x}", Sha256::digest(raw_payload.as_bytes())),
                })
            })?
           