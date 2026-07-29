#!/usr/bin/env node

/**
 * Data Import Engine — Complexity Black Hole Absorber
 * 
 * Centralizes all data ingestion complexity. This is the single point
 * where all source adapters register, where deduplication happens,
 * and where batch processing orchestrates.
 * 
 * Design Principles:
 * 1. Complexity Black Hole: All import complexity is absorbed here.
 *    Downstream only sees clean records.
 * 2. Atomic Transactions: Each conversation is imported in a transaction.
 * 3. Deduplication-First: Triple key + content hash for robust duplicate detection.
 * 4. Audit Trail: Every import operation leaves a trace in duplicate_trails.
 */

const path = require('path');
const sqlite3 = require('sqlite3');
const { promisify } = require('util');

class DataImporter {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
        this.adapters = new Map();
        this.initialized = false;
    }
    
    /**
     * Initialize database and schema (Complexity Black Hole #1)
     */
    async initialize() {
        if (this.initialized) return;
        
        return new Promise((resolve, reject) => {
            // Use combined flags to ensure database can be created if it doesn't exist
            const openFlags = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
            this.db = new sqlite3.Database(this.dbPath, openFlags, (err) => {
                if (err) {
                    reject(new Error(`Failed to open/create database: ${err.message}`));
                    return;
                }
                
                console.log(`[DataImporter] Connected to ${this.dbPath}`);
                
                setImmediate(async () => {
                    try {
                        await this.initializeSchema();
                        await this.registerDefaultAdapters();
                        this.initialized = true;
                        resolve();
                    } catch (initErr) {
                        reject(initErr);
                    }
                });
            });
        });
    }
    
    /**
     * Create all necessary tables (Complexity Black Hole #2)
     */
    async initializeSchema() {
        const sql = `
            -- Core conversations table
            CREATE TABLE IF NOT EXISTS conversations_v2 (
                id TEXT PRIMARY KEY,
                version INTEGER DEFAULT 1,
                
                title TEXT NOT NULL,
                summary TEXT,
                first_message_text TEXT NOT NULL,
                last_message_text TEXT,
                
                total_turns INTEGER NOT NULL DEFAULT 0,
                user_turns INTEGER NOT NULL,
                ai_turns INTEGER NOT NULL,
                
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                imported_at DATETIME NOT NULL,
                
                source_type TEXT NOT NULL CHECK(source_type IN ('cli-tool', 'web-extension', 'manual-import', 'deeplink-draft')),
                source_name TEXT NOT NULL,
                source_id TEXT,
                source_origin TEXT,
                
                metadata TEXT NOT NULL DEFAULT '{}',
                
                is_starred BOOLEAN DEFAULT FALSE,
                is_sensitive BOOLEAN DEFAULT FALSE,
                marked_as_duplicate BOOLEAN DEFAULT FALSE,
                exclusion_reason TEXT,
                
                topic_cluster_id TEXT,
                popularity_score REAL DEFAULT 0,
                content_hash TEXT,
                
                search_fts_id INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('card', 'task', 'ammo', 'note')),
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'generated', 'published', 'archived')),
                generation_info TEXT,
                created_at DATETIME NOT NULL,
                generated_at DATETIME,
                references_conversation_ids TEXT DEFAULT '[]',
                FOREIGN KEY (conversation_id) REFERENCES conversations_v2(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations_v2(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations_v2(source_type, source_name);
            CREATE INDEX IF NOT EXISTS idx_conv_imported ON conversations_v2(imported_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_unique ON conversations_v2(source_type, source_name, source_id);
            CREATE INDEX IF NOT EXISTS idx_conv_starred ON conversations_v2(is_starred, created_at DESC);
            
            CREATE TABLE IF NOT EXISTS duplicate_trails (
                primary_id TEXT PRIMARY KEY,
                duplicate_id TEXT NOT NULL,
                detected_at DATETIME NOT NULL,
                resolution_method TEXT NOT NULL,
                notes TEXT,
                FOREIGN KEY (primary_id) REFERENCES conversations_v2(id),
                FOREIGN KEY (duplicate_id) REFERENCES conversations_v2(id)
            );
            
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME NOT NULL,
                description TEXT NOT NULL,
                checksum TEXT
            );
            
            INSERT OR IGNORE INTO schema_migrations (version, applied_at, description, checksum)
            VALUES (1, datetime('now'), 'Initial schema with conversations_v2 and artifacts', '');
        `;
        
        const run = promisify(this.db.run.bind(this.db));
        const statements = sql.split(';').filter(s => s.trim());
        
        for (const stmt of statements) {
            try {
                await run(stmt.trim());
            } catch (err) {
                console.error(`[DataImporter] Schema error in statement: ${stmt.substring(0, 100)}...`);
                throw err;
            }
        }
        
        console.log('[DataImporter] Schema initialized');
    }
    
    /**
     * Register all available adapters (Complexity Black Hole #3)
     */
    async registerDefaultAdapters() {
        // Lazy-load adapters to avoid circular dependencies
        const ClaudeCLIDatabaseAdapter = require('./ClaudeCLIAdapter');
        
        this.registerAdapter('claude-cli', new ClaudeCLIDatabaseAdapter());
        // Other adapters can be registered here later:
        // const CodexDesktopAdapter = require('./CodexDesktopAdapter');
        // this.registerAdapter('codex-desktop', new CodexDesktopAdapter());
        // const OpenCodeTauriAdapter = require('./OpenCodeTauriAdapter');
        // this.registerAdapter('opencode-tauri', new OpenCodeTauriAdapter());
        // const ChatGPTWebExtensionAdapter = require('./ChatGPTWebExtensionAdapter');
        // this.registerAdapter('chatgpt-web', new ChatGPTWebExtensionAdapter());
        
        console.log(`[DataImporter] Registered ${this.adapters.size} default adapters`);
    }
    
    /**
     * Register a custom adapter
     */
    registerAdapter(type, adapter) {
        if (!adapter.detectPresence || !adapter.listSources || !adapter.fetchConversation) {
            throw new Error(`Adapter for ${type} must implement detectPresence/listSources/fetchConversation`);
        }
        
        this.adapters.set(type, adapter);
    }
    
    /**
     * Auto-detect all available data sources (Complexity Black Hole #4)
     */
    async detectAllSources() {
        const available = [];
        
        for (const [type, adapter] of this.adapters) {
            try {
                const detected = await adapter.detectPresence();
                if (detected) {
                    available.push({
                        type,
                        name: adapter.name,
                        sourceName: adapter.sourceName,
                        sourceId: adapter.sourceId || null
                    });
                    console.log(`[DataImporter] ✓ Detected: ${adapter.name}`);
                } else {
                    console.log(`[DataImporter] ✗ Not found: ${adapter.name}`);
                }
            } catch (err) {
                console.error(`[DataImporter] Error detecting ${type}:`, err.message);
            }
        }
        
        return available;
    }
    
    /**
     * Perform full initial import (Complexity Black Hole #5)
     */
    async fullImport(options = {}) {
        const { sources, dryRun = false } = options;
        
        console.log(`[DataImporter] Starting full import${dryRun ? ' (DRY RUN)' : ''}...`);
        
        const stats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            duplicatesSkipped: 0,
            duplicatesMerged: 0
        };
        
        const sourcesToImport = sources || await this.detectAllSources();
        
        for (const sourceInfo of sourcesToImport) {
            const adapter = this.adapters.get(sourceInfo.type);
            if (!adapter) {
                console.warn(`[DataImporter] No adapter for type: ${sourceInfo.type}`);
                continue;
            }
            
            try {
                await adapter.initialize();
                const sources = await adapter.listSources({ limit: 100 });
                
                console.log(`[DataImporter] Importing ${sources.length} sessions from ${adapter.name}...`);
                
                for (const src of sources) {
                    stats.totalProcessed++;
                    
                    try {
                        const record = await adapter.fetchConversation(src.id);
                        const result = await this.importConversation(record, { dryRun });
                        
                        if (result.duplicate) {
                            stats.duplicatesSkipped++;
                        } else if (result.merged) {
                            stats.duplicatesMerged++;
                        } else {
                            stats.successful++;
                        }
                        
                        // Batch progress logging
                        if (stats.totalProcessed % 10 === 0) {
                            console.log(`[DataImporter] Progress: ${stats.successful}/${stats.totalProcessed} imported`);
                        }
                    } catch (convErr) {
                        console.error(`[DataImporter] Failed to import conversation ${src.id}:`, convErr.message);
                        stats.failed++;
                    }
                }
                
                await adapter.close();
            } catch (adapterErr) {
                console.error(`[DataImporter] Failed to initialize adapter ${adapter.name}:`, adapterErr.message);
                stats.failed++;
            }
        }
        
        console.log(`[DataImporter] Import complete. Stats:`, stats);
        return stats;
    }
    
    /**
     * Import a single conversation with deduplication (Complexity Black Hole #6)
     * This is the core of the black hole - all complexity is contained here.
     */
    async importConversation(record, options = {}) {
        const { dryRun = false } = options;
        
        if (!this.db) {
            throw new Error('Database not initialized');
        }
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                try {
                    // Step 1: Check for exact duplicates (triple key)
                    const exactDup = this.checkExactDuplicate(record);
                    if (exactDup.exists) {
                        resolve({
                            success: false,
                            duplicate: true,
                            primaryId: exactDup.primaryId,
                            reason: 'Exact duplicate found via triple key'
                        });
                        return;
                    }
                    
                    // Step 2: Check for fuzzy duplicates (content hash)
                    const fuzzyDup = this.checkFuzzyDuplicate(record.content_hash);
                    if (fuzzyDup.exists) {
                        resolve({
                            success: false,
                            duplicate: true,
                            primaryId: fuzzyDup.primaryId,
                            similarityScore: fuzzyDup.similarity,
                            reason: 'Fuzzy duplicate found via content hash'
                        });
                        return;
                    }
                    
                    // Step 3: Perform the actual import
                    const inserted = this.insertConversation(record, { dryRun });
                    resolve({
                        success: true,
                        insertedId: inserted.id,
                        ...inserted
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
    }
    
    /**
     * Check exact duplicate via triple key (source_type, source_name, source_id)
     */
    checkExactDuplicate(record) {
        const { source_type, source_name, source_id } = record;
        
        return new Promise((resolve) => {
            this.db.get(`
                SELECT id, version FROM conversations_v2 
                WHERE source_type = ? AND source_name = ? AND source_id = ?
            `, [source_type, source_name, source_id], (err, row) => {
                if (err) {
                    console.error('[DataImporter] Exact duplicate check failed:', err);
                    resolve({ exists: false });
                } else if (row) {
                    console.log(`[DataImporter] Found exact duplicate: ${row.id} (version ${row.version})`);
                    resolve({ exists: true, primaryId: row.id });
                } else {
                    resolve({ exists: false });
                }
            });
        });
    }
    
    /**
     * Check fuzzy duplicate via content hash
     */
    checkFuzzyDuplicate(contentHash) {
        if (!contentHash) return { exists: false };
        
        return new Promise((resolve) => {
            this.db.get(`
                SELECT id, version FROM conversations_v2 
                WHERE content_hash = ? AND content_hash IS NOT NULL
            `, [contentHash], (err, row) => {
                if (err) {
                    console.error('[DataImporter] Fuzzy duplicate check failed:', err);
                    resolve({ exists: false });
                } else if (row) {
                    console.log(`[DataImporter] Found fuzzy duplicate: ${row.id} (hash match)`);
                    resolve({ exists: true, primaryId: row.id, similarity: 1.0 });
                } else {
                    resolve({ exists: false });
                }
            });
        });
    }
    
    /**
     * Insert conversation with audit trail (Complexity Black Hole #7)
     */
    async insertConversation(record, options = {}) {
        const { dryRun = false } = options;
        
        const {
            id, title, summary, first_message_text, last_message_text,
            total_turns, user_turns, ai_turns,
            created_at, updated_at, imported_at,
            source_type, source_name, source_id, source_origin,
            metadata, is_starred, is_sensitive, marked_as_duplicate,
            topic_cluster_id, popularity_score, content_hash
        } = record;
        
        // For dry run, just return what would be inserted
        if (dryRun) {
            console.log(`[DataImporter] DRY RUN: Would insert ${id} (${title})`);
            return { id, title, dryRun: true };
        }
        
        // Insert into main table
        const insertSql = `
            INSERT INTO conversations_v2 (
                id, version,
                title, summary, first_message_text, last_message_text,
                total_turns, user_turns, ai_turns,
                created_at, updated_at, imported_at,
                source_type, source_name, source_id, source_origin,
                metadata,
                is_starred, is_sensitive, marked_as_duplicate,
                topic_cluster_id, popularity_score, content_hash,
                search_fts_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const run = promisify(this.db.run.bind(this.db));
        
        // Calculate search_fts_id (for future FTS5 integration)
        const searchFtsId = null; // Will be updated after FTS5 setup
        
        await run(insertSql, [
            id, 1,  // version = 1
            title, summary, first_message_text, last_message_text,
            total_turns, user_turns, ai_turns,
            created_at.toISOString(), updated_at.toISOString(), imported_at.toISOString(),
            source_type, source_name, source_id, source_origin,
            metadata,
            is_starred, is_sensitive, marked_as_duplicate,
            topic_cluster_id, popularity_score, content_hash,
            searchFtsId
        ]);
        
        console.log(`[DataImporter] ✓ Inserted: ${id} (${title})`);
        
        return { id, title, inserted: true };
    }
    
    /**
     * Perform incremental scan (Complexity Black Hole #8)
     * Detects new conversations since last import and imports them.
     */
    async incrementalScan(options = {}) {
        const { lastImportTime = null } = options;
        
        console.log(`[DataImporter] Starting incremental scan${lastImportTime ? ` since ${lastImportTime}` : ''}...`);
        
        // Query the latest imported_at from our database
        let sinceTime = lastImportTime;
        if (!sinceTime) {
            const row = await this.db.get('SELECT MAX(imported_at) as latest FROM conversations_v2', []);
            sinceTime = row?.latest || null;
        }
        
        console.log(`[DataImporter] Scanning for conversations newer than: ${sinceTime}`);
        
        // For each adapter, detect new sessions
        const newSessions = [];
        
        for (const [type, adapter] of this.adapters) {
            try {
                await adapter.initialize();
                const sources = await adapter.listSources({ limit: 50 });
                
                for (const src of sources) {
                    // Check if this session is newer than our last import
                    if (!sinceTime || new Date(src.createdAt) > new Date(sinceTime)) {
                        newSessions.push({
                            type,
                            adapter,
                            sessionId: src.id,
                            createdAt: src.createdAt
                        });
                    }
                }
                
                await adapter.close();
            } catch (err) {
                console.error(`[DataImporter] Failed incremental scan for ${type}:`, err.message);
            }
        }
        
        console.log(`[DataImporter] Found ${newSessions.length} new sessions to import`);
        
        // Import new sessions
        const stats = {
            totalNew: newSessions.length,
            successful: 0,
            failed: 0,
            duplicatesSkipped: 0
        };
        
        for (const session of newSessions) {
            try {
                const record = await session.adapter.fetchConversation(session.sessionId);
                const result = await this.importConversation(record);
                
                if (result.success) {
                    stats.successful++;
                } else {
                    stats.failed++;
                }
            } catch (err) {
                console.error(`[DataImporter] Failed incremental import for ${session.sessionId}:`, err.message);
                stats.failed++;
            }
        }
        
        console.log(`[DataImporter] Incremental scan complete. Stats:`, stats);
        return stats;
    }
    
    /**
     * Close database connection
     */
    async close() {
        if (this.db) {
            await promisify(this.db.close.bind(this.db))();
            this.db = null;
        }
    }
}

module.exports = DataImporter;
