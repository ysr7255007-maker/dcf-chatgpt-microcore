#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/ClaudeCodeAdapter.js
 *
 * Claude Code CLI 数据源适配器（重写版，替代失效的 ClaudeCLIAdapter）
 *
 * 真实存储：~/.claude/projects/<project-slug>/<session-uuid>.jsonl
 * 每个 .jsonl 文件 = 一个会话；每行一个 JSON 事件。
 * 对话行：{"type":"user"|"assistant", "message":{"role","content"}, "timestamp", "sessionId"}
 * content 可能是 string 或 [{type:"text",text}] 数组。
 *
 * Complexity Black Hole：JSONL 解析、content 多形态、project slug 还原，全部在此吸收。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLAUDE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects');

class ClaudeCodeAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Claude Code (projects/*.jsonl)';
        this.sourceName = 'claude-code';
        this.sessionsDir = CLAUDE_DIR;
        this._files = []; // [{filePath, sessionId, projectSlug, mtimeMs}]
    }

    async detectPresence() {
        if (!fs.existsSync(this.sessionsDir)) return false;
        const files = this._scanFiles();
        if (files.length === 0) return false;
        console.log(`[ClaudeCodeAdapter] Found ${files.length} session file(s) under ${this.sessionsDir}`);
        return true;
    }

    async initialize() {
        this._files = this._scanFiles();
    }

    _scanFiles() {
        const out = [];
        let projects = [];
        try { projects = fs.readdirSync(this.sessionsDir, { withFileTypes: true }); } catch (_) { return out; }
        for (const p of projects) {
            if (!p.isDirectory()) continue;
            const projDir = path.join(this.sessionsDir, p.name);
            let entries = [];
            try { entries = fs.readdirSync(projDir, { withFileTypes: true }); } catch (_) { continue; }
            for (const e of entries) {
                if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
                const fp = path.join(projDir, e.name);
                let st = null;
                try { st = fs.statSync(fp); } catch (_) { continue; }
                out.push({
                    filePath: fp,
                    sessionId: e.name.replace(/\.jsonl$/, ''),
                    projectSlug: p.name,
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
            name: `${f.projectSlug}/${f.sessionId.slice(0, 8)}`,
            createdAt: new Date(f.mtimeMs),
            updatedAt: new Date(f.mtimeMs),
            messageCount: null
        }));
    }

    async fetchConversation(sessionId) {
        const meta = this._files.find(f => f.sessionId === sessionId) || this._scanFiles().find(f => f.sessionId === sessionId);
        if (!meta) throw new Error(`Session ${sessionId} not found under ${this.sessionsDir}`);

        const raw = fs.readFileSync(meta.filePath, 'utf8');
        const messages = [];
        for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            let ev;
            try { ev = JSON.parse(line); } catch (_) { continue; }
            if (ev.type !== 'user' && ev.type !== 'assistant') continue;
            const role = ev.message?.role || ev.type;
            if (role !== 'user' && role !== 'assistant') continue;
            const text = extractText(ev.message?.content);
            if (!text) continue;
            messages.push({
                role,
                content: text,
                timestamp: ev.timestamp ? Date.parse(ev.timestamp) : null
            });
        }
        if (messages.length === 0) throw new Error(`Session ${sessionId} has no user/assistant messages`);

        return this._toRecord(meta, messages);
    }

    _toRecord(meta, messages) {
        const userMsgs = messages.filter(m => m.role === 'user');
        const aiMsgs = messages.filter(m => m.role === 'assistant');
        const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort((a, b) => a - b);
        const firstUser = userMsgs[0];
        const lastAi = aiMsgs[aiMsgs.length - 1];

        const stat = fs.statSync(meta.filePath);
        const createdAt = timestamps.length ? new Date(timestamps[0]) : new Date(stat.birthtimeMs || stat.mtimeMs);
        const updatedAt = timestamps.length ? new Date(timestamps[timestamps.length - 1]) : new Date(stat.mtimeMs);

        return {
            id: generateUlid(),
            title: (firstUser?.content || meta.sessionId).slice(0, 80),
            summary: null,
            first_message_text: firstUser?.content || '',
            last_message_text: lastAi?.content || '',
            total_turns: messages.length,
            user_turns: userMsgs.length,
            ai_turns: aiMsgs.length,
            created_at: createdAt,
            updated_at: updatedAt,
            imported_at: new Date(),
            source_type: this.type,
            source_name: this.sourceName,
            source_id: meta.sessionId,
            source_origin: meta.projectSlug,
            content_hash: computeContentHash(messages),
            metadata: JSON.stringify({
                source_specific: {
                    type: 'claude-code',
                    session_id: meta.sessionId,
                    project_slug: meta.projectSlug,
                    file_path: meta.filePath
                }
            }),
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
function extractText(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(b => (b && typeof b === 'object') ? (b.text || b.content || '') : String(b || ''))
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

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

module.exports = ClaudeCodeAdapter;
