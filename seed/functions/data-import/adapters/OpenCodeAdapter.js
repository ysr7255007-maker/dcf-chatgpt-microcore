#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/OpenCodeAdapter.js
 *
 * OpenCode 数据源适配器
 *
 * 真实存储：~/.local/share/opencode/opencode.db（SQLite，WAL 模式）
 * 关键表：
 *   session(id, title, directory, time_created, time_updated, agent, model)
 *   message(id, session_id, time_created, data JSON: {role, time, agent, model})
 *   part(id, message_id, session_id, time_created, data JSON: {type:"text", text})
 * 只取 part.data.type === 'text' 的文本片段，按时间拼接为对话。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { promisify } = require('util');

const OPENCODE_DB = path.join(process.env.HOME || process.env.USERPROFILE, '.local', 'share', 'opencode', 'opencode.db');

class OpenCodeAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'OpenCode (opencode.db)';
        this.sourceName = 'opencode';
        this.dbPath = OPENCODE_DB;
        this.db = null;
    }

    async detectPresence() {
        if (!fs.existsSync(this.dbPath)) return false;
        console.log(`[OpenCodeAdapter] Found database at: ${this.dbPath}`);
        return true;
    }

    async initialize() {
        if (this.db) return;
        this.db = await new Promise((resolve, reject) => {
            const d = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) =>
                err ? reject(new Error(`Failed to open OpenCode DB: ${err.message}`)) : resolve(d));
        });
        this._all = promisify(this.db.all.bind(this.db));
    }

    async listSources({ limit = 100, since = null } = {}) {
        let sql = `SELECT id, title, directory, time_created, time_updated FROM session`;
        const params = [];
        if (since) {
            sql += ' WHERE time_updated >= ?';
            params.push(new Date(since).getTime());
        }
        sql += ' ORDER BY time_updated DESC LIMIT ?';
        params.push(limit);

        const rows = await this._all(sql, params);
        return rows.map(r => ({
            id: r.id,
            name: r.title || r.id,
            createdAt: new Date(r.time_created),
            updatedAt: new Date(r.time_updated),
            messageCount: null
        }));
    }

    async fetchConversation(sessionId) {
        if (!this.db) throw new Error('Adapter not initialized');

        const session = await new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM session WHERE id = ?', [sessionId], (err, row) =>
                err ? reject(err) : resolve(row));
        });
        if (!session) throw new Error(`Session ${sessionId} not found`);

        // message.data JSON 里有 role；part.data JSON 里有 type/text
        const rows = await this._all(`
            SELECT m.id as message_id, m.time_created as msg_ts, m.data as msg_data,
                   p.time_created as part_ts, p.data as part_data
            FROM message m
            LEFT JOIN part p ON p.message_id = m.id
            WHERE m.session_id = ?
            ORDER BY m.time_created ASC, p.time_created ASC
        `, [sessionId]);

        // 聚合：message role + 其 text parts
        const messages = [];
        let current = null;
        for (const row of rows) {
            let msgData = null;
            try { msgData = row.msg_data ? JSON.parse(row.msg_data) : null; } catch (_) {}
            const role = msgData?.role === 'user' ? 'user' : msgData?.role === 'assistant' ? 'assistant' : null;

            if (!current || current.message_id !== row.message_id) {
                if (current && current.role && current.content) messages.push(current);
                current = {
                    message_id: row.message_id,
                    role,
                    content: '',
                    timestamp: row.msg_ts || null
                };
            }
            if (row.part_data) {
                try {
                    const partData = JSON.parse(row.part_data);
                    if (partData?.type === 'text' && typeof partData.text === 'string') {
                        current.content += (current.content ? '\n' : '') + partData.text;
                    }
                } catch (_) {}
            }
        }
        if (current && current.role && current.content) messages.push(current);

        const cleaned = messages.filter(m => m.content.trim());
        if (cleaned.length === 0) throw new Error(`Session ${sessionId} has no text messages`);

        return this._toRecord(session, cleaned);
    }

    _toRecord(session, messages) {
        const userMsgs = messages.filter(m => m.role === 'user');
        const aiMsgs = messages.filter(m => m.role === 'assistant');
        const firstUser = userMsgs[0];
        const lastAi = aiMsgs[aiMsgs.length - 1];

        return {
            id: generateUlid(),
            title: (session.title || firstUser?.content || session.id).slice(0, 80),
            summary: null,
            first_message_text: firstUser?.content || '',
            last_message_text: lastAi?.content || '',
            total_turns: messages.length,
            user_turns: userMsgs.length,
            ai_turns: aiMsgs.length,
            created_at: new Date(session.time_created),
            updated_at: new Date(session.time_updated),
            imported_at: new Date(),
            source_type: this.type,
            source_name: this.sourceName,
            source_id: session.id,
            source_origin: session.directory || null,
            content_hash: computeContentHash(messages),
            metadata: JSON.stringify({
                source_specific: {
                    type: 'opencode',
                    session_id: session.id,
                    directory: session.directory,
                    agent: session.agent,
                    model: session.model
                }
            }),
            is_starred: false,
            is_sensitive: false,
            marked_as_duplicate: false,
            popularity_score: 0
        };
    }

    async close() {
        if (this.db) {
            await promisify(this.db.close.bind(this.db))();
            this.db = null;
        }
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function computeContentHash(messages) {
    const sorted = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const canonical = sorted.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || 0 }));
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function generateUlid() {
    const timestamp = Date.now();
    const randomness = crypto.randomBytes(8).toString('hex');
    return timestamp.toString(36) + randomness.substring(0, 13);
}

module.exports = OpenCodeAdapter;
