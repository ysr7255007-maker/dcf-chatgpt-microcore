#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/CursorAdapter.js
 *
 * Cursor IDE 数据源适配器
 *
 * 存储侦察结论（2026-07 macOS Cursor 实测）：
 *   - 会话元数据：~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 *     ItemTable['composer.composerHeaders'] → [{composerId, name, createdAt, lastUpdatedAt, ...}]
 *   - 会话索引：globalStorage/conversation-search.db → conversations(id, title, updated_at)
 *   - 对话内容（bubbleId 前缀）存在 workspaceStorage 各目录下 state.vscdb 的 cursorDiskKV，
 *     但新版 Cursor 对话内容云同步，本机常为空——此时如实报错，不伪造内容。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const CURSOR_BASE = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Cursor', 'User');
const GLOBAL_STORAGE_DB = path.join(CURSOR_BASE, 'globalStorage', 'state.vscdb');
const WORKSPACE_STORAGE_DIR = path.join(CURSOR_BASE, 'workspaceStorage');

class CursorAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Cursor IDE (composer headers)';
        this.sourceName = 'cursor';
        this._headers = [];
    }

    async detectPresence() {
        if (!fs.existsSync(GLOBAL_STORAGE_DB)) return false;
        console.log(`[CursorAdapter] Found globalStorage at: ${GLOBAL_STORAGE_DB}`);
        return true;
    }

    async initialize() {
        this._headers = await this._readComposerHeaders();
    }

    _openReadonly(dbPath) {
        return new Promise((resolve, reject) => {
            const d = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) =>
                err ? reject(err) : resolve(d));
        });
    }

    async _readComposerHeaders() {
        const db = await this._openReadonly(GLOBAL_STORAGE_DB);
        try {
            const row = await new Promise((resolve, reject) => {
                db.get("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'", (err, r) =>
                    err ? reject(err) : resolve(r));
            });
            if (!row || !row.value) return [];
            const parsed = JSON.parse(row.value);
            const arr = Array.isArray(parsed) ? parsed : (parsed.allComposers || []);
            return arr
                .filter(h => h && h.composerId && h.composerId !== 'empty-state-draft')
                .map(h => ({
                    composerId: h.composerId,
                    name: h.name || null,
                    createdAt: h.createdAt || null,
                    lastUpdatedAt: h.lastUpdatedAt || h.createdAt || null,
                    isArchived: Boolean(h.isArchived)
                }))
                .sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));
        } finally {
            db.close();
        }
    }

    async listSources({ limit = 100, since = null } = {}) {
        if (this._headers.length === 0) {
            this._headers = await this._readComposerHeaders();
        }
        let headers = this._headers.filter(h => !h.isArchived);
        if (since) {
            const sinceMs = new Date(since).getTime();
            headers = headers.filter(h => (h.lastUpdatedAt || 0) >= sinceMs);
        }
        return headers.slice(0, limit).map(h => ({
            id: h.composerId,
            name: h.name || h.composerId.slice(0, 12),
            createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
            updatedAt: h.lastUpdatedAt ? new Date(h.lastUpdatedAt) : new Date(),
            messageCount: null
        }));
    }

    async fetchConversation(composerId) {
        // 在各 workspaceStorage 的 cursorDiskKV 中找 bubbleId:<composerId>:* 内容
        const bubbles = await this._findBubbles(composerId);
        if (bubbles.length === 0) {
            throw new Error(
                `Cursor conversation ${composerId} content not available locally ` +
                `(cloud-synced; bubbleId:* not found in any workspaceStorage). Honest skip.`
            );
        }

        const messages = bubbles
            .map(b => ({
                role: b.type === 'user' || b.type === 1 ? 'user' : 'assistant',
                content: b.text || '',
                timestamp: b.timestamp || null
            }))
            .filter(m => m.content.trim());
        if (messages.length === 0) {
            throw new Error(`Cursor conversation ${composerId} has no text bubbles locally`);
        }

        const header = this._headers.find(h => h.composerId === composerId);
        return this._toRecord(composerId, header, messages);
    }

    async _findBubbles(composerId) {
        let workspaces = [];
        try { workspaces = fs.readdirSync(WORKSPACE_STORAGE_DIR, { withFileTypes: true }); } catch (_) { return []; }

        for (const ws of workspaces) {
            if (!ws.isDirectory()) continue;
            const dbPath = path.join(WORKSPACE_STORAGE_DIR, ws.name, 'state.vscdb');
            if (!fs.existsSync(dbPath)) continue;

            let db;
            try { db = await this._openReadonly(dbPath); } catch (_) { continue; }
            try {
                const rows = await new Promise((resolve, reject) => {
                    db.all(
                        "SELECT key, value FROM cursorDiskKV WHERE key LIKE ? ORDER BY key ASC",
                        [`bubbleId:${composerId}:%`],
                        (err, r) => err ? reject(err) : resolve(r || [])
                    );
                });
                if (rows.length > 0) {
                    return rows.map(r => {
                        try { return JSON.parse(r.value); } catch (_) { return {}; }
                    });
                }
            } catch (_) {
                // cursorDiskKV 不存在或查询失败，继续下一个 workspace
            } finally {
                db.close();
            }
        }
        return [];
    }

    _toRecord(composerId, header, messages) {
        const userMsgs = messages.filter(m => m.role === 'user');
        const aiMsgs = messages.filter(m => m.role === 'assistant');
        const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort((a, b) => a - b);
        const firstUser = userMsgs[0];
        const lastAi = aiMsgs[aiMsgs.length - 1];

        return {
            id: generateUlid(),
            title: (header?.name || firstUser?.content || composerId).slice(0, 80),
            summary: null,
            first_message_text: firstUser?.content || '',
            last_message_text: lastAi?.content || '',
            total_turns: messages.length,
            user_turns: userMsgs.length,
            ai_turns: aiMsgs.length,
            created_at: timestamps.length ? new Date(timestamps[0]) : new Date(header?.createdAt || Date.now()),
            updated_at: timestamps.length ? new Date(timestamps[timestamps.length - 1]) : new Date(header?.lastUpdatedAt || Date.now()),
            imported_at: new Date(),
            source_type: this.type,
            source_name: this.sourceName,
            source_id: composerId,
            source_origin: null,
            content_hash: computeContentHash(messages),
            metadata: JSON.stringify({
                source_specific: { type: 'cursor', composer_id: composerId, name: header?.name || null }
            }),
            is_starred: false,
            is_sensitive: false,
            marked_as_duplicate: false,
            popularity_score: 0
        };
    }

    async close() { this._headers = []; }
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

module.exports = CursorAdapter;
