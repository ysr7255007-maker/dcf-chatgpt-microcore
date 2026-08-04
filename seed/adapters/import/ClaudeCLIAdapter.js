#!/usr/bin/env node

/**
 * Claude CLI Data Source Adapter
 * 
 * Handles all complexity of reading Claude Code CLI session databases.
 * Abstracts away SQLite file location, schema details, and normalization.
 * 
 * Complexity Black Hole Principle: All Claude-specific complexity is
 * absorbed here; downstream consumers see only clean standardized records.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

class ClaudeCLIDatabaseAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Claude CLI Database Adapter';
        this.sourceName = 'claude-cli';
        this.db = null;
    }
    
    /**
     * Detect if Claude CLI database exists (auto-detection)
     */
    async detectPresence() {
        const possiblePaths = [
            path.join(os.homedir(), '.claude/sessions.db'),
            path.join(os.homedir(), '.claude/data/workspaces/*/sessions.json'),
            path.join(os.homedir(), '.claude/db.sqlite'),
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
     * Initialize SQLite connection (complexity absorption #2)
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
     * List available sessions (metadata only, for discovery)
     */
    async listSources(options = {}) {
        const { limit = 100, since = null } = options;
        
        let query = `
            SELECT 
                id as session_id,
                title,
                created_at,
                updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) as message_count
            FROM sessions
            WHERE status = 'completed'
        `;
        
        const params = [];
        
        if (since) {
            query += ' AND created_at >= ?';
            params.push(new Date(since).toISOString());
        }
        
        query += ` ORDER BY created_at DESC LIMIT ?`;
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
     * Fetch and normalize a single conversation (complexity absorption #3)
     * All data transformation happens here - downstream sees only clean records.
     */
    async fetchConversation(sessionId) {
        if (!this.db) {
            throw new Error('Adapter not initialized. Call initialize() first.');
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
                
                // Fetch all messages for this session
                const messages = await this.getMessagesForSession(sessionId);
                
                // Extract and normalize content
                const normalized = this.normalizeToConversationRecord(session, messages);
                
                resolve(normalized);
            });
        });
    }
    
    /**
     * Internal: Get messages for a session (SQLite complexity hidden)
     */
    async getMessagesForSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    id,
                    role,
                    content,
                    timestamp,
                    metadata
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
     * Normalize raw Claude data into standardized ConversationRecord
     * (Complexity absorption: All normalization logic in one place)
     */
    normalizeToConversationRecord(session, messages) {
        const userMessages = messages.filter(m => m.role === 'user');
        const aiMessages = messages.filter(m => m.role === 'assistant');
        
        // Extract first/last message for quick preview
        const firstMsg = userMessages[0];
        const lastMsg = aiMessages[aiMessages.length - 1];
        
        // Compute content hash for fuzzy duplicate detection
        const contentHash = this.computeContentHash(messages);
        
        // Build metadata
        const metadata = {
            source_specific: {
                type: 'claude-cli',
                session_id: session.id,
                workspace_path: session.workspace_path || process.cwd(),
                model_used: session.model_id,
                tool_calls_made: extractToolCalls(messages)
            },
            content_analysis: {
                estimated_tokens_user: estimateTokens(userMessages),
                estimated_tokens_ai: estimateTokens(aiMessages),
                has_code_blocks: messages.some(m => m.content?.includes('```')),
                language_detected: detectLanguage(messages[0]?.content || ''),
                avg_response_time_seconds: computeAvgResponseTime(messages)
            }
        };
        
        return {
            id: generateULID(),          // New ULID for our system
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
            
            // Source identification
            source_type: this.type,
            source_name: this.sourceName,
            source_id: session.id,
            source_origin: session.workspace_path,
            
            // Content hash for duplicate detection
            content_hash: contentHash,
            
            // Metadata
            metadata: JSON.stringify(metadata),
            
            // Quality flags (default values)
            is_starred: false,
            is_sensitive: false,
            marked_as_duplicate: false,
            popularity_score: 0
        };
    }
    
    /**
     * Compute SHA256 hash of all messages (for fuzzy duplicate detection)
     */
    computeContentHash(messages) {
        const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
        const json = JSON.stringify(sorted.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp
        })));
        return crypto.createHash('sha256').update(json).digest('hex');
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

// Helper functions (complexity absorption #4)
function estimateTokens(texts) {
    // Rough estimate: 1 token ≈ 4 characters for English/Chinese
    return Math.ceil(texts.join('').length / 4);
}

function detectLanguage(text) {
    if (!text) return 'unknown';
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN';
    return 'en-US';
}

function extractToolCalls(messages) {
    const toolPatterns = [
        /\(edit|write|create|delete|read|shell|search/,
        /\[Tool Use/
    ];
    
    return messages.flatMap(msg => {
        if (!msg.content) return [];
        const content = msg.content;
        return toolPatterns.some(p => p.test(content)) ? [msg.role] : [];
    });
}

function computeAvgResponseTime(messages) {
    const timestamps = messages
        .filter(m => m.role === 'assistant')
        .map(m => new Date(m.timestamp));
    
    if (timestamps.length < 2) return null;
    
    const diffs = [];
    for (let i = 1; i < timestamps.length; i++) {
        diffs.push((timestamps[i] - timestamps[i-1]) / 1000);
    }
    
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

function generateULID() {
    // Simple ULID generator (for testing)
    const timestamp = Date.now();
    const randomness = crypto.randomBytes(8);
    return timestamp.toString(36) + randomness.toString('hex').substring(0, 13);
}

module.exports = ClaudeCLIDatabaseAdapter;
