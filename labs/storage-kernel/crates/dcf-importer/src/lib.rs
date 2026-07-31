use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;

/// Initialize SQLite database with required tables for structured fact import
pub fn init_database(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        -- Raw artifacts registry (from Task 2.1)
        CREATE TABLE IF NOT EXISTS raw_artifacts (
            artifact_id TEXT PRIMARY KEY,
            sha256 TEXT NOT NULL UNIQUE,
            original_filename TEXT NOT NULL,
            byte_length INTEGER NOT NULL,
            media_type TEXT,
            source_platform TEXT,
            imported_at TEXT NOT NULL,
            file_path TEXT UNIQUE NOT NULL
        );

        -- Conversations  
        CREATE TABLE IF NOT EXISTS conversations (
            conversation_uuid TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            source_blob_sha256 TEXT NOT NULL REFERENCES raw_artifacts(sha256),
            message_count INTEGER DEFAULT 0
        );

        -- Messages
        CREATE TABLE IF NOT EXISTS messages (
            message_uuid TEXT PRIMARY KEY,
            conversation_uuid TEXT NOT NULL REFERENCES conversations(conversation_uuid),
            parent_message_uuid TEXT,  -- Optional: may point to messages in same conv or be NULL
            sender TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            content_hash TEXT NOT NULL,
            raw_payload TEXT NOT NULL DEFAULT '{}',  -- Full original JSON for material conservation
            
            -- Material conservation: preserve full content structure
            has_content_array INTEGER NOT NULL DEFAULT 1,
            text_block_count INTEGER DEFAULT 0,
            thinking_block_count INTEGER DEFAULT 0,
            tool_use_block_count INTEGER DEFAULT 0,
            tool_result_block_count INTEGER DEFAULT 0,
            unknown_block_count INTEGER DEFAULT 0
        );

        -- Content blocks (extracted from content[])
        CREATE TABLE IF NOT EXISTS content_blocks (
            block_id TEXT PRIMARY KEY,
            message_uuid TEXT NOT NULL REFERENCES messages(message_uuid),
            ordinal INTEGER NOT NULL,
            block_type TEXT NOT NULL,
            raw_payload TEXT NOT NULL,
            payload_bytes INTEGER NOT NULL,
            source_field_hash TEXT NOT NULL,
            source_blob_sha256 TEXT NOT NULL REFERENCES raw_artifacts(sha256),
            source_json_pointer TEXT,
            
            FOREIGN KEY (source_blob_sha256) REFERENCES raw_artifacts(sha256)
        );

        -- Text extraction targets (for search projections)
        CREATE TABLE IF NOT EXISTS text_blocks (
            text_id TEXT PRIMARY KEY,
            content_block_id TEXT NOT NULL REFERENCES content_blocks(block_id),
            canonical_text TEXT NOT NULL
        );

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
            anomaly_type TEXT NOT NULL,
            conversation_uuid TEXT REFERENCES conversations(conversation_uuid),
            message_uuid TEXT REFERENCES messages(message_uuid),
            block_id TEXT REFERENCES content_blocks(block_id),
            description TEXT NOT NULL,
            raw_evidence TEXT,
            detected_at TEXT NOT NULL
        );

        -- Create indexes for performance
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_uuid);
        CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_uuid);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_message ON content_blocks(message_uuid);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_type ON content_blocks(block_type);
        CREATE INDEX IF NOT EXISTS idx_anomalies_type ON import_anomalies(anomaly_type);
        "#
    )?;
    
    Ok(())
}

/// Register artifacts from registration.json into the database
pub fn register_artifacts(conn: &Connection, manifest_path: &str) -> Result<()> {
    use chrono::Utc;
    let content = fs::read_to_string(manifest_path)?;
    let registrations: Vec<ArtifactRegistrationRecord> = serde_json::from_str(&content)?;
    
    let now = Utc::now().to_rfc3339();
    
    for reg in registrations {
        conn.execute(
            r#"
            INSERT OR REPLACE INTO raw_artifacts 
            (artifact_id, sha256, original_filename, byte_length, media_type, source_platform, imported_at, file_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                reg.artifact_id,
                reg.sha256,
                reg.original_filename,
                reg.byte_length,
                reg.media_type,
                reg.source_platform,
                now.clone(),
                reg.file_path
            ],
        )?;
    }
    
    Ok(())
}

#[derive(Debug, Deserialize)]
struct ArtifactRegistrationRecord {
    artifact_id: String,
    sha256: String,
    original_filename: String,
    byte_length: u64,
    media_type: String,
    source_platform: String,
    imported_at: String,
    file_path: String,
}