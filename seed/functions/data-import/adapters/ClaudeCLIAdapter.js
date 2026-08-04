#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/ClaudeCLIAdapter.js
 * 
 * Claude CLI Data Source Adapter — migrated from seed/adapters/import/
 * 
 * All complexity is absorbed here; downstream consumers see only clean records.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

class ClaudeCLIAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Claude CLI Database Adapter';
        this.sourceName = 'claude-cli';
        this.dbPath = null;
        this.db = null;
    }

    /**
     * Detect if Claude CLI database exists
     */
    async detectPresence() {
        const possiblePaths = [
            path.join(process.env.HOME || process.env.USERPROFILE, '.claude/sessions.db'),
            path.join(process.env.HOME || process.env.USERPROFILE, '.claude/db.sqlite'),
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                console.log(`[ClaudeCLIAdapter] Found database at: ${p}`);
                this.dbPath = p;
                return true;
            }
        }

        console.warn('[ClaudeCLIAdapter] No Claude CLI database found');
        return false;
    }

    /**
     * Initialize SQLite connection
     */
    async initialize() {
        if (!this.dbPath) {
            throw new Error('Claude CLI database path not detected');
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    reject(new Error(`Failed to open Claude DB: ${err.message}`));
                } else {
                    console.log(`[ClaudeCLIAdapter] Connected to ${this.dbPath}`);
                    resolve();
                }
            });
        });
    }

    /**
     * List available sessions
     */
    async listSources(options = {}) {
        const { limit = 100, since = null } = options;

        let query = `
            SELECT id as session_id, title, created_at, updated_at,
                   (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) as message_count
            FROM sessions
            WHERE status = 'completed'
        `;
        const params = [];

        if (since) {
            query += ' AND created_at >= ?';
            params.push(new Date(since).toISOString());
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows.map(row => ({
                        id: row.session_id,
                        name: row.title,
                        createdAt: new Date(row.created_at),
                        updatedAt: new Date(row.updated_at),
                        messageCount: row.message_count
                    })));
                }
            });
        });
    }

    /**
     * Fetch and normalize a single conversation
     */
    async fetchConversation(sessionId) {
        if (!this.db) {
            throw new Error('Adapter not initialized');
        }

        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], async (err, session) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!session) {
                    reject(new Error(`Session ${sessionId} not found`));
                    return;
                }

                const messages = await this.getMessagesForSession(sessionId);
                const normalized = this.normalizeToConversationRecord(session, messages);
                resolve(normalized);
            });
        });
    }

    /**
     * Get messages for a session
     */
    async getMessagesForSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT id, role, content, timestamp, metadata
                FROM messages
                WHERE session_id = ?
                ORDER BY timestamp ASC
            `, [sessionId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Normalize to ConversationRecord schema
     */
    normalizeToConversationRecord(session, messages) {
        const userMessages = messages.filter(m => m.role === 'user');
        const aiMessages = messages.filter(m => m.role === 'assistant');

        const firstMsg = userMessages[0];
        const lastMsg = aiMessages[aiMessages.length - 1];

        const contentHash = this.computeContentHash(messages);

        const metadata = JSON.stringify({
            source_specific: {
                type: 'claude-cli',
                session_id: session.id,
                workspace_path: session.workspace_path || process.cwd(),
                model_used: session.model_id
            },
            content_analysis: {
                estimated_tokens_user: userMessages.length * 50,
                estimated_tokens_ai: aiMessages.length * 100,
                has_code_blocks: messages.some(m => m.content?.includes('```')),
                language_detected: /[\u4e00-\u9fa5]/.test(firstMsg?.content || '') ? 'zh-CN' : 'en-US'
            }
        });

        return {
            id: this.generateUlid(),
            title: session.title,
            summary: session.summary || null,
            first_message_text: firstMsg?.content || '',
            last_message_text: lastMsg?.content || '',
            total_turns: messages.length,
            user_turns: userMessages.length,
            ai_turns: aiMessages.length,
            created_at: new Date(session.created_at),
            updated_at: new Date(session.updated_at),
            imported_at: new Date(),
            source_type: this.type,
            source_name: this.sourceName,
            source_id: session.id,
            source_origin: session.workspace_path || null,
            content_hash: contentHash,
            metadata,
            is_starred: false,
            is_sensitive: false,
            marked_as_duplicate: false,
            popularity_score: 0
        };
    }

    /**
     * Compute SHA256 hash for duplicate detection
     */
    computeContentHash(messages) {
        const sorted = [...messages].sort((a, b) => {
            const tsA = a.timestamp || a.created_at || 0;
            const tsB = b.timestamp || b.created_at || 0;
            return tsA - tsB;
        });

        const canonical = sorted.map(m => ({
            role: m.role || 'unknown',
            content: m.content || m.text || '',
            timestamp: m.timestamp || m.created_at || Date.now()
        }));

        return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    }

    /**
     * Generate ULID-like ID
     */
    generateUlid() {
        const timestamp = Date.now();
        const randomness = crypto.randomBytes(8).toString('hex');
        return timestamp.toString(36) + randomness.substring(0, 13);
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

module.exports = ClaudeCLIAdapter;
