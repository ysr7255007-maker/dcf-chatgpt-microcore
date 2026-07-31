        -- Thinking blocks (preserved for material conservation)
        CREATE TABLE IF NOT EXISTS thinking_blocks (
            thinking_id TEXT PRIMARY KEY,
            content_block_id TEXT NOT NULL REFERENCES content_blocks(block_id),
            raw_thinking TEXT NOT NULL,
            bytes INTEGER NOT NULL
        );

        -- Tool calls
        CREATE TABLE IF NOT EXISTS tool_calls (
            call_id TEXT PRIMARY KEY,
            content_block_id TEXT NOT NULL REFERENCES content_blocks(block_id),
            tool_name TEXT,
            tool_arguments TEXT,
            tool_result TEXT,
            is_executed INTEGER DEFAULT 0,
            execution_time_ms INTEGER
        );

        -- Attachments
        CREATE TABLE IF NOT EXISTS attachments (
            attachment_id TEXT PRIMARY KEY,
            message_uuid TEXT NOT NULL REFERENCES messages(message_uuid),
            file_name TEXT,
            mime_type TEXT,
            size_bytes INTEGER,
            extraction_status TEXT
        );

        -- File references  
        CREATE TABLE IF NOT EXISTS file_refs (
            ref_id TEXT PRIMARY KEY,
            message_uuid TEXT NOT NULL REFERENCES messages(message_uuid),
            referenced_by TEXT NOT NULL,
            source_message_uuid TEXT REFERENCES messages(message_uuid)
        );

        -- Citations
        CREATE TABLE IF NOT EXISTS citations (
            citation_id TEXT PRIMARY KEY,
            source_message_uuid TEXT REFERENCES messages(message_uuid),
            target_message_uuid TEXT REFERENCES messages(message_uuid),
            citation_type TEXT
        );

        -- Import anomalies (exception conservation - do not guess fix!)
        CREATE TABLE IF NOT EXISTS import_anomalies (
            anomaly_id TEXT PRIMARY KEY,
            anomaly_type TEXT NOT NULL,  -- dangling_parent | unmatched_tool_result | missing_tool_use | unknown_content | missing_file | design_chat_schema
            conversation_uuid TEXT,
            message_uuid TEXT,
            block_id TEXT,
            description TEXT NOT NULL,
            raw_evidence TEXT,
            detected_at TEXT NOT NULL,
            
            FOREIGN KEY (conversation_uuid) REFERENCES conversations(conversation_uuid),
            FOREIGN KEY (message_uuid) REFERENCES messages(message_uuid),
            FOREIGN KEY (block_id) REFERENCES content_blocks(block_id)
        );

        -- Create indexes for performance
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_uuid);
        CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_uuid);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_message ON content_blocks(message_uuid);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_type ON content_blocks(block_type);
        CREATE INDEX IF NOT EXISTS idx_anomalies_type ON import_anomalies(anomaly_type);
        
        -- Statistics table for material conservation tracking
        CREATE TABLE IF NOT EXISTS import_statistics (
            stat_key TEXT PRIMARY KEY,
            stat_value INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#
    )?;
    
    Ok(())
}

/// Register artifacts from registration.json into the database
pub fn register_artifacts(conn: &Connection, manifest_path: &str) -> Result<()> {
    let content = fs::read_to_string(manifest_path)?;
    let registrations: Vec<ArtifactRegistrationRecord> = serde_json::from_str(&content)?;
    
    let now = Utc::now().to_rfc3339();
    
    for reg in registrations {
        conn.execute(
            r#"
           