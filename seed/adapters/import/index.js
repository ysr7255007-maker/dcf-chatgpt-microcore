#!/usr/bin/env node

/**
 * DataSource Import Framework — Central Data Ingestion Hub
 * 
 * Architecture Philosophy: Complexity Black Hole
 * All data source complexity is absorbed into this layer.
 * Downstream consumers see only clean, standardized data.
 * 
 * Four Phases of Data Lifecycle:
 * 1. Discovery   → Detect available data sources
 * 2. Ingestion   → Extract, normalize, deduplicate
 * 3. Storage     → Write to central database with audit trail
 * 4. Exposure    → Query API for downstream consumers
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// SQLite database handling (using better-sqlite3 style interface)
class CentralDatabase {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null; // Will be initialized by caller
    }
    
    /**
     * Initialize database schema (Complexity Black Hole #1: Schema Evolution)
     * All schema migrations are versioned and backward compatible.
     */
    initializeSchema() {
        const sql = `
            -- Core conversations table (complexity black hole)
            CREATE TABLE IF NOT EXISTS conversations_v2 (
                id TEXT PRIMARY KEY,           -- ULID (time-ordered unique ID)
                version INTEGER DEFAULT 1,     -- Optimistic locking
                
                -- Content fields
                title TEXT NOT NULL,
                summary TEXT,
                first_message_text TEXT NOT NULL,
                last_message_text TEXT,
                
                -- Turn statistics
                total_turns INTEGER NOT NULL DEFAULT 0,
                user_turns INTEGER NOT NULL,
                ai_turns INTEGER NOT NULL,
                
                -- Time dimensions (three timestamps serve different purposes)
                created_at DATETIME NOT NULL,      -- Original creation time from source
                updated_at DATETIME NOT NULL,      -- Last modification time in source
                imported_at DATETIME NOT NULL,     -- When we ingested this record
                
                -- Source identification (triple key for deduplication)
                source_type TEXT NOT NULL CHECK(source_type IN ('cli-tool', 'web-extension', 'manual-import', 'deeplink-draft')),
                source_name TEXT NOT NULL,         -- e.g., "claude-cli", "chatgpt-web"
                source_id TEXT,                    -- Source's internal ID
                source_origin TEXT,                -- Additional origin context
                
                -- Metadata (JSONB for extensibility)
                metadata TEXT NOT NULL DEFAULT '{}',
                
                -- Visibility & quality flags
                is_starred BOOLEAN DEFAULT FALSE,
                is_sensitive BOOLEAN DEFAULT FALSE,
                marked_as_duplicate BOOLEAN DEFAULT FALSE,
                exclusion_reason TEXT,
                
                -- Pre-computed analytics (performance optimization)
                topic_cluster_id TEXT,
                popularity_score REAL DEFAULT 0,
                content_hash TEXT,               -- SHA256 for fuzzy duplicate detection
                
                -- Index helpers for performance
                search_fts_id INTEGER              -- For FTS5 virtual table
            );
            
            -- Artifacts table (generated products)
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('card', 'task', 'ammo', 'note')),
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,           -- JSON or text content
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'generated', 'published', 'archived')),
                
                generation_info TEXT,            -- JSON: model used, prompt snapshot, etc.
                
                created_at DATETIME NOT NULL,
                generated_at DATETIME,
                
                references_conversation_ids TEXT DEFAULT '[]',  -- JSON array
                
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                
                INDEX idx_artifact_conv_type(conversation_id, type, status)
            );
            
            -- Performance indexes (pre-computed for common queries)
            CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations_v2(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations_v2(source_type, source_name);
            CREATE INDEX IF NOT EXISTS idx_conv_imported ON conversations_v2(imported_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_unique ON conversations_v2(source_type, source_name, source_id);
            CREATE INDEX IF NOT EXISTS idx_conv_starred ON conversations_v2(is_starred, created_at DESC);
            
            -- Deduplication tracking table (soft duplicates)
            CREATE TABLE IF NOT EXISTS duplicate_trails (
                primary_id TEXT PRIMARY KEY,          -- The surviving record
                duplicate_id TEXT NOT NULL,           -- The discarded record
                detected_at DATETIME NOT NULL,
                resolution_method TEXT NOT NULL,      -- 'latest-wins', 'merge', 'skip'
                notes TEXT,
                
                FOREIGN KEY (primary_id) REFERENCES conversations_v2(id),
                FOREIGN KEY (duplicate_id) REFERENCES conversations_v2(id)
            );
            
            -- Migration history (schema evolution tracking)
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME NOT NULL,
                description TEXT NOT NULL,
                checksum TEXT                         -- SHA256 of migration script
            );
            
            -- Record initial schema version
            INSERT OR IGNORE INTO schema_migrations (version, applied_at, description, checksum)
            VALUES (1, datetime('now'), 'Initial schema with conversations_v2 and artifacts tables', '');
        `;
        
        this.db.exec(sql);
    }
    
    /**
     * Checksum for data integrity verification
     */
    computeContentHash(messages) {
        const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
        const json = JSON.stringify(sorted);
        return crypto.createHash('sha256').update(json).digest('hex');
    }
}

// Export centralized imports
module.exports = {
    CentralDatabase,
    
    // Adapter registry pattern
    adapters: new Map(),
    
    registerAdapter(type, adapterClass) {
        this.adapters.set(type, adapterClass);
    },
    
    getAdapter(type) {
        return this.adapters.get(type);
    }
};
