#!/usr/bin/env node

/**
 * seed/core/repository/index.js — DCF Central Repository (SQLite)
 * 
 * Design Principles:
 *   - 中央库访问：唯一合法的 DB 入口，所有 CRUD 经由此层
 *   - Schema 复用：沿用 DataImporter 已验证的 conversations_v2/artifacts schema
 *   - 复杂度消解：查重与筛选交给 SQL（关系代数让渡 SQLite）
 *   - 事务安全：serialize() + begin/commit 保证原子性
 * 
 * Usage:
 *   const { repo } = require('./repository');
 *   await repo.initialize(dbPath);
 *   const convos = await repo.conversations.query({ since, limit });
 */

const sqlite3 = require('sqlite3');
const { promisify } = require('util');

class Repository {
    constructor() {
        this.db = null;
        this.dbPath = null;
        this.initialized = false;
    }

    /**
     * Initialize database connection and ensure schema (idempotent: singleton)
     */
    async initialize(dbPath) {
        if (this.initialized) {
            if (dbPath && dbPath !== this.dbPath) {
                throw new Error(`Repository already initialized with ${this.dbPath}, cannot re-initialize with ${dbPath}`);
            }
            return;
        }
        this.dbPath = dbPath;
        
        return new Promise((resolve, reject) => {
            const openFlags = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
            this.db = new sqlite3.Database(this.dbPath, openFlags, (err) => {
                if (err) {
                    reject(new Error(`Failed to open database: ${err.message}`));
                    return;
                }
                
                console.log(`[Repository] Connected to ${this.dbPath}`);
                
                setImmediate(async () => {
                    try {
                        await this._ensureSchema();
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
     * Create all necessary tables if not exist (idempotent)
     */
    async _ensureSchema() {
        const sql = `
            -- Core conversations table (identical to DataImporter schema)
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
            
            -- Artifacts table
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
            
            -- Duplicate trails (audit table)
            CREATE TABLE IF NOT EXISTS duplicate_trails (
                primary_id TEXT PRIMARY KEY,
                duplicate_id TEXT NOT NULL,
                detected_at DATETIME NOT NULL,
                resolution_method TEXT NOT NULL,
                notes TEXT,
                FOREIGN KEY (primary_id) REFERENCES conversations_v2(id),
                FOREIGN KEY (duplicate_id) REFERENCES conversations_v2(id)
            );
            
            -- Migration tracking
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME NOT NULL,
                description TEXT NOT NULL,
                checksum TEXT
            );
            
            -- Performance indexes
            CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations_v2(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations_v2(source_type, source_name);
            CREATE INDEX IF NOT EXISTS idx_conv_imported ON conversations_v2(imported_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_unique ON conversations_v2(source_type, source_name, source_id);
            CREATE INDEX IF NOT EXISTS idx_conv_starred ON conversations_v2(is_starred, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_artifact_conv_type ON artifacts(conversation_id, type, status);
            
            -- Initial migration record
            INSERT OR IGNORE INTO schema_migrations (version, applied_at, description, checksum)
            VALUES (1, datetime('now'), 'Initial schema with conversations_v2, artifacts, duplicate_trails', '');
        `;
        
        const run = promisify(this.db.run.bind(this.db));
        const statements = sql.split(';').filter(s => s.trim());
        
        for (const stmt of statements) {
            try {
                await run(stmt.trim()).catch(() => {}); // Ignore errors on CREATE IF NOT EXISTS
            } catch (err) {
                console.error('[Repository] Schema error:', err.message);
                throw err;
            }
        }
        
        console.log('[Repository] Schema ensured');
    }

    /**
     * Conversations query layer
     */
    get conversations() {
        const repo = this; // capture for closures
        return {
            /**
             * Find by triple key (source_type, source_name, source_id)
             */
            findBySource: (sourceType, sourceName, sourceId) => {
                return new Promise((resolve, reject) => {
                    repo.db.get(
                        'SELECT * FROM conversations_v2 WHERE source_type = ? AND source_name = ? AND source_id = ?',
                        [sourceType, sourceName, sourceId],
                        (err, row) => err ? reject(err) : resolve(row)
                    );
                });
            },

            /**
             * Find by ULID ID
             */
            findById: (id) => {
                return new Promise((resolve, reject) => {
                    repo.db.get('SELECT * FROM conversations_v2 WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row));
                });
            },

            /**
             * Query with filters (date range, keyword, starred)
             */
            query: ({ startDate, endDate, keyword, minTurns, isStarred, limit = 50 } = {}) => {
                let sql = 'SELECT * FROM conversations_v2 WHERE 1=1';
                const params = [];

                if (startDate) {
                    sql += ' AND created_at >= ?';
                    params.push(startDate);
                }
                if (endDate) {
                    sql += ' AND created_at <= ?';
                    params.push(endDate);
                }
                if (keyword) {
                    sql += ' AND (title LIKE ? OR first_message_text LIKE ?)';
                    params.push(`%${keyword}%`, `%${keyword}%`);
                }
                if (typeof minTurns === 'number') {
                    sql += ' AND total_turns >= ?';
                    params.push(minTurns);
                }
                if (typeof isStarred === 'boolean') {
                    sql += ' AND is_starred = ?';
                    params.push(isStarred ? 1 : 0);
                }

                sql += ' ORDER BY created_at DESC LIMIT ?';
                params.push(limit);

                return new Promise((resolve, reject) => {
                    repo.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
                });
            },

            /**
             * 集合运算批量入库（查重归位问题体质）
             * 一条 INSERT-SELECT 完成过滤 + 三元组反连接 + content_hash 反连接
             * @param {Array} records — ConversationRecord[]
             * @param {Object} [filters] — { keyword?, minTurns? } 下推 SQL
             * @returns {Promise<{inserted: number, duplicatesSkipped: number}>}
             */
            insertConversationBatch: async (records, filters = {}) => {
                if (!repo.db) {
                    throw new Error('Repository not initialized');
                }
                if (!Array.isArray(records) || records.length === 0) {
                    return { inserted: 0, duplicatesSkipped: 0 };
                }

                return new Promise((resolve, reject) => {
                    repo.db.serialize(async () => {
                        try {
                            await repo.beginTransaction();

                            // Step 1: staging 临时表（先 DROP 再 CREATE，避免跨调用残留）
                            await repo.executeSql('DROP TABLE IF EXISTS _incoming_conversations', []);
                            await repo.executeSql(`
                                CREATE TEMP TABLE _incoming_conversations (
                                    id TEXT,
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
                                    source_type TEXT NOT NULL,
                                    source_name TEXT NOT NULL,
                                    source_id TEXT,
                                    source_origin TEXT,
                                    metadata TEXT NOT NULL DEFAULT '{}',
                                    is_starred BOOLEAN DEFAULT FALSE,
                                    is_sensitive BOOLEAN DEFAULT FALSE,
                                    marked_as_duplicate BOOLEAN DEFAULT FALSE,
                                    topic_cluster_id TEXT,
                                    popularity_score REAL DEFAULT 0,
                                    content_hash TEXT
                                )
                            `, []);

                            // Step 2: 批量 staging
                            const insertStmt = `
                                INSERT INTO _incoming_conversations (
                                    id, title, summary, first_message_text, last_message_text,
                                    total_turns, user_turns, ai_turns,
                                    created_at, updated_at, imported_at,
                                    source_type, source_name, source_id, source_origin,
                                    metadata, is_starred, is_sensitive, marked_as_duplicate,
                                    topic_cluster_id, popularity_score, content_hash
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `;
                            const run = promisify(repo.db.run.bind(repo.db));
                            for (const r of records) {
                                await run(insertStmt, [
                                    r.id, r.title, r.summary || null, r.first_message_text, r.last_message_text || null,
                                    r.total_turns, r.user_turns, r.ai_turns,
                                    r.created_at.toISOString(), r.updated_at.toISOString(), r.imported_at.toISOString(),
                                    r.source_type, r.source_name, r.source_id || null, r.source_origin || null,
                                    r.metadata || '{}', r.is_starred || false, r.is_sensitive || false,
                                    r.marked_as_duplicate || false, r.topic_cluster_id || null,
                                    r.popularity_score || 0, r.content_hash || null
                                ]);
                            }

                            // Step 3: 批内按三元组去重（GROUP BY 后保留每批第一条）
                            // 注：stagedRows 仅用于审计参考，skipped 语义 = 原始批次 - 实际入库
                            const stagedRows = await repo.executeSql(`
                                SELECT * FROM _incoming_conversations
                                GROUP BY source_type, source_name, source_id
                                HAVING MIN(created_at) = created_at
                            `, []);
                            void stagedRows;

                            // Step 4: 构造 filters 下推 SQL
                            let filterSql = '';
                            const filterParams = [];
                            if (filters.keyword) {
                                filterSql += ` AND (i.title LIKE ? OR i.first_message_text LIKE ?)`;
                                filterParams.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
                            }
                            if (typeof filters.minTurns === 'number') {
                                filterSql += ` AND i.total_turns >= ?`;
                                filterParams.push(filters.minTurns);
                            }

                            // Step 5: 一条 INSERT-SELECT 完成过滤 + 反连接去重
                            const insertSql = `
                                INSERT INTO conversations_v2 (
                                    id, title, summary, first_message_text, last_message_text,
                                    total_turns, user_turns, ai_turns,
                                    created_at, updated_at, imported_at,
                                    source_type, source_name, source_id, source_origin,
                                    metadata, is_starred, is_sensitive, marked_as_duplicate,
                                    topic_cluster_id, popularity_score, content_hash,
                                    search_fts_id
                                )
                                SELECT 
                                    i.id, i.title, i.summary, i.first_message_text, i.last_message_text,
                                    i.total_turns, i.user_turns, i.ai_turns,
                                    i.created_at, i.updated_at, i.imported_at,
                                    i.source_type, i.source_name, i.source_id, i.source_origin,
                                    i.metadata, i.is_starred, i.is_sensitive, i.marked_as_duplicate,
                                    i.topic_cluster_id, i.popularity_score, i.content_hash,
                                    NULL
                                FROM _incoming_conversations i
                                WHERE 1=1 ${filterSql}
                                  AND NOT EXISTS (
                                      SELECT 1 FROM conversations_v2 c
                                      WHERE c.source_type = i.source_type 
                                        AND c.source_name = i.source_name 
                                        AND c.source_id = i.source_id
                                  )
                                  AND NOT EXISTS (
                                      SELECT 1 FROM conversations_v2 c
                                      WHERE i.content_hash IS NOT NULL 
                                        AND c.content_hash = i.content_hash
                                  )
                                GROUP BY i.source_type, i.source_name, i.source_id
                            `;

                            const inserted = await repo._runChanges(insertSql, filterParams);

                            // Step 6: 计算 duplicatesSkipped（原始批次 - 实际入库）
                            // 语义：skipped = staged(原始) − changes()，包含重复 + 被 filters 排除的
                            const duplicatesSkipped = records.length - inserted;

                            // Step 7: 审计 duplicate_trails（反向 INSERT-SELECT）
                            if (duplicatesSkipped > 0) {
                                await repo.executeSql(`
                                    INSERT OR IGNORE INTO duplicate_trails (primary_id, duplicate_id, detected_at, resolution_method, notes)
                                    SELECT c.id, i.id, datetime('now'), 'skip', 'Batch import duplicate (triple key or content_hash)'
                                    FROM _incoming_conversations i
                                    JOIN conversations_v2 c ON 
                                        (c.source_type = i.source_type AND c.source_name = i.source_name AND c.source_id = i.source_id)
                                        OR (i.content_hash IS NOT NULL AND c.content_hash = i.content_hash)
                                `, []);
                            }

                            // Step 8: 清理临时表
                            await repo.executeSql('DROP TABLE IF EXISTS _incoming_conversations', []);

                            await repo.commitTransaction();

                            console.log(`[Repository] Batch insert: ${inserted} inserted, ${duplicatesSkipped} duplicates skipped`);
                            resolve({ inserted, duplicatesSkipped });
                        } catch (err) {
                            await repo.rollbackTransaction().catch(() => {});
                            reject(err);
                        }
                    });
                });
            },

            /**
             * 保留单条 upsert 接口（向后兼容，内部走批量逻辑）
             */
            upsertConversation: (record) => {
                return repo.conversations.insertConversationBatch([record]).then(result => ({
                    id: record.id,
                    changes: result.inserted
                }));
            }
        };
    }

    /**
     * Artifacts CRUD operations
     */
    get artifacts() {
        const repo = this;
        return {
            findById: (id) => {
                return new Promise((resolve, reject) => {
                    repo.db.get('SELECT * FROM artifacts WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row));
                });
            },

            findByConversation: (conversationId, type = null) => {
                let sql = 'SELECT * FROM artifacts WHERE conversation_id = ?';
                const params = [conversationId];
                if (type) {
                    sql += ' AND type = ?';
                    params.push(type);
                }
                sql += ' ORDER BY created_at DESC';

                return new Promise((resolve, reject) => {
                    repo.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
                });
            },

            insert: (artifact) => {
                return new Promise((resolve, reject) => {
                    const sql = `
                        INSERT INTO artifacts (id, conversation_id, type, title, summary, content, status, generation_info, created_at, generated_at, references_conversation_ids)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    const params = [
                        artifact.id, artifact.conversation_id, artifact.type, artifact.title,
                        artifact.summary, artifact.content, artifact.status || 'draft',
                        artifact.generation_info || null, artifact.created_at.toISOString(),
                        artifact.generated_at ? artifact.generated_at.toISOString() : null,
                        typeof artifact.references_conversation_ids === 'string' 
                            ? artifact.references_conversation_ids 
                            : JSON.stringify(artifact.references_conversation_ids || [])
                    ];

                    repo.db.run(sql, params, function(err) {
                        if (err) return reject(err);
                        resolve({ id: artifact.id, changes: this.changes });
                    });
                });
            }
        };
    }

    /**
     * Duplicate trail logging
     */
    get duplicates() {
        const repo = this;
        return {
            log: (primaryId, duplicateId, method = 'skip', notes = null) => {
                return new Promise((resolve, reject) => {
                    const sql = `
                        INSERT OR REPLACE INTO duplicate_trails (primary_id, duplicate_id, detected_at, resolution_method, notes)
                        VALUES (?, ?, datetime('now'), ?, ?)
                    `;
                    repo.db.run(sql, [primaryId, duplicateId, method, notes], function(err) {
                        if (err) return reject(err);
                        resolve({ primary_id: primaryId });
                    });
                });
            }
        };
    }

    /**
     * Execute raw SQL query (for complex reports)
     */
    async executeSql(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
        });
    }

    /**
     * Execute a write SQL and return the number of changes (for INSERT/UPDATE/DELETE)
     */
    async _runChanges(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            });
        });
    }

    /**
     * Health check stats (via SQL aggregation)
     */
    async stats() {
        try {
            const counts = await this.executeSql(`
                SELECT
                    (SELECT COUNT(*) FROM conversations_v2) as total_conversations,
                    (SELECT COUNT(*) FROM artifacts) as total_artifacts,
                    (SELECT COUNT(*) FROM conversations_v2 WHERE marked_as_duplicate = 1) as duplicates
            `, []);
            return counts[0] || {};
        } catch (err) {
            console.error('[Repository] Health check failed:', err.message);
            throw err;
        }
    }

    /**
     * Begin a write transaction (for bulk imports)
     */
    async beginTransaction() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION', (err) => err ? reject(err) : resolve());
            });
        });
    }

    /**
     * Commit a write transaction
     */
    async commitTransaction() {
        return new Promise((resolve, reject) => {
            this.db.run('COMMIT', (err) => err ? reject(err) : resolve());
        });
    }

    /**
     * Rollback a write transaction
     */
    async rollbackTransaction() {
        return new Promise((resolve, reject) => {
            this.db.run('ROLLBACK', (err) => err ? reject(err) : resolve());
        });
    }

    /**
     * Close database connection
     */
    async close() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    this.db = null;
                    this.initialized = false;
                    err ? reject(err) : resolve();
                });
            });
        }
    }
}

// Export singleton instance
const repo = new Repository();

module.exports = {
    repo
};
