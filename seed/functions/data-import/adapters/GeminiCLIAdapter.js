#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/GeminiCLIAdapter.js
 *
 * Gemini CLI 数据源适配器
 *
 * 存储：~/.gemini/tmp/<project-hash>/chats/session-*.json
 * 格式：[{role:"user"|"model", parts:[{text}], ...}]（Google GenAI 内容格式）
 * 本机当前无数据；按官方格式实现，detectPresence 如实返回 false。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GEMINI_TMP = path.join(process.env.HOME || process.env.USERPROFILE, '.gemini', 'tmp');

class GeminiCLIAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Gemini CLI (tmp/*/chats/*.json)';
        this.sourceName = 'gemini-cli';
        this._files = [];
    }

    async detectPresence() {
        const files = this._scanFiles();
        if (files.length === 0) return false;
        console.log(`[GeminiCLIAdapter] Found ${files.length} chat file(s)`);
        return true;
    }

    async initialize() {
        this._files = this._scanFiles();
    }

    _scanFiles() {
        const out = [];
        if (!fs.existsSync(GEMINI_TMP)) return out;
        let projects = [];
        try { projects = fs.readdirSync(GEMINI_TMP, { withFileTypes: true }); } catch (_) { return out; }
        for (const p of projects) {
            if (!p.isDirectory()) continue;
            const chatsDir = path.join(GEMINI_TMP, p.name, 'chats');
            if (!fs.existsSync(chatsDir)) continue;
            let entries = [];
            try { entries = fs.readdirSync(chatsDir, { withFileTypes: true }); } catch (_) { continue; }
            for (const e of entries) {
                if (!e.isFile() || !e.name.endsWith('.json')) continue;
                const fp = path.join(chatsDir, e.name);
                let st = null;
                try { st = fs.statSync(fp); } catch (_) { continue; }
                out.push({
                    filePath: fp,
                    sessionId: e.name.replace(/\.json$/, ''),
                    projectHash: p.name,
                    mtimeMs: st.mtimeMs
                });
            }
        }
        out.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return out;
    }

    async listSources({ limit = 100, since = null } = {}) {
        if (this._files.length === 0) this._files = this._scanFiles();
        let files = this._files;
        if (since) {
            const sinceMs = new Date(since).getTime();
            files = files.filter(f => f.mtimeMs >= sinceMs);
        }
        return files.slice(0, limit).map(f => ({
            id: f.sessionId,
            name: `gemini/${f.sessionId}`,
            createdAt: new Date(f.mtimeMs),
            updatedAt: new Date(f.mtimeMs),
            messageCount: null
        }));
    }

    async fetchConversation(sessionId) {
        const meta = this._files.find(f => f.sessionId === sessionId) || this._scanFiles().find(f => f.sessionId === sessionId);
        if (!meta) throw new Error(`Gemini session ${sessionId} not found`);

        const raw = JSON.parse(fs.readFileSync(meta.filePath, 'utf8'));
        const entries = Array.isArray(raw) ? raw : (raw.messages || raw.history || []);

        const messages = entries
            .map(e => {
                const roleRaw = e.role || e.type || '';
                const role = roleRaw === 'user' ? 'user' : (roleRaw === 'model' || roleRaw === 'gemini' || roleRaw === 'assistant') ? 'assistant' : null;
                if (!role) return null;
                let text = '';
                if (Array.isArray(e.parts)) {
                    text = e.parts.map(p => (typeof p === 'string' ? p : p?.text || '')).filter(Boolean).join('\n');
                } else if (typeof e.content === 'string') {
                    text = e.content;
                } else if (typeof e.text === 'string') {
                    text = e.text;
                }
                if (!text.trim()) return null;
                return { role, content: text, timestamp: e.timestamp ? Date.parse(e.timestamp) : (e.createTime ? Date.parse(e.createTime) : null) };
            })
            .filter(Boolean);

        if (messages.length === 0) throw new Error(`Gemini session ${sessionId} has no messages`);

        const stat = fs.statSync(meta.filePath);
        const userMsgs = messages.filter(m => m.role === 'user');
        const aiMsgs = messages.filter(m => m.role === 'assistant');
        const firstUser = userMsgs[0];
        const lastAi = aiMsgs[aiMsgs.length - 1];
        const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort((a, b) => a - b);

        return {
            id: generateUlid(),
            title: (firstUser?.content || sessionId).slice(0, 80),
            summary: null,
            first_message_text: firstUser?.content || '',
            last_message_text: lastAi?.content || '',
            total_turns: messages.length,
            user_turns: userMsgs.length,
            ai_turns: aiMsgs.length,
            created_at: timestamps.length ? new Date(timestamps[0]) : new Date(stat.birthtimeMs || stat.mtimeMs),
            updated_at: timestamps.length ? new Date(timestamps[timestamps.length - 1]) : new Date(stat.mtimeMs),
            imported_at: new Date(),
            source_type: this.type,
            source_name: this.sourceName,
            source_id: sessionId,
            source_origin: meta.projectHash,
            content_hash: computeContentHash(messages),
            metadata: JSON.stringify({ source_specific: { type: 'gemini-cli', session_id: sessionId, file_path: meta.filePath } }),
            is_starred: false,
            is_sensitive: false,
            marked_as_duplicate: false,
            popularity_score: 0
        };
    }

    async close() { this._files = []; }
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

module.exports = GeminiCLIAdapter;
