#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/AiderAdapter.js
 *
 * Aider 数据源适配器
 *
 * 存储：项目目录下 .aider.chat.history.md（Markdown 格式的对话历史）
 * 格式：以 `# aider chat started at <ts>` 分段，`#### user:` / `#### assistant:`（或 `## ` 变体）为消息头。
 * 扫描范围：常用代码根目录（~/Documents, ~/Projects, ~/Code, ~/dev 等），深度受限。
 * 本机当前无数据；按官方格式实现，detectPresence 如实返回 false。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCAN_ROOTS = ['Documents', 'Projects', 'Code', 'dev', 'work', 'src']
    .map(d => path.join(process.env.HOME || process.env.USERPROFILE, d));

class AiderAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Aider (.aider.chat.history.md)';
        this.sourceName = 'aider';
        this._files = [];
    }

    async detectPresence() {
        const files = this._scanFiles();
        if (files.length === 0) return false;
        console.log(`[AiderAdapter] Found ${files.length} chat history file(s)`);
        return true;
    }

    async initialize() {
        this._files = this._scanFiles();
    }

    _scanFiles() {
        const out = [];
        const walk = (dir, depth) => {
            if (depth > 3) return;
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
            for (const e of entries) {
                const fp = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name.startsWith('.') && e.name !== '.aider') { /* skip hidden dirs except .aider */ }
                    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
                    walk(fp, depth + 1);
                    continue;
                }
                if (e.isFile() && e.name === '.aider.chat.history.md') {
                    let st = null;
                    try { st = fs.statSync(fp); } catch (_) { continue; }
                    out.push({ filePath: fp, sessionId: fp, projectDir: path.dirname(fp), mtimeMs: st.mtimeMs });
                }
            }
        };
        for (const root of SCAN_ROOTS) {
            if (fs.existsSync(root)) walk(root, 0);
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
            name: `aider/${path.basename(f.projectDir)}`,
            createdAt: new Date(f.mtimeMs),
            updatedAt: new Date(f.mtimeMs),
            messageCount: null
        }));
    }

    async fetchConversation(sessionId) {
        const meta = this._files.find(f => f.sessionId === sessionId) || this._scanFiles().find(f => f.sessionId === sessionId);
        if (!meta) throw new Error(`Aider history ${sessionId} not found`);

        const raw = fs.readFileSync(meta.filePath, 'utf8');
        const messages = parseAiderMarkdown(raw);
        if (messages.length === 0) throw new Error(`Aider history ${sessionId} has no messages`);

        const stat = fs.statSync(meta.filePath);
        const userMsgs = messages.filter(m => m.role === 'user');
        const aiMsgs = messages.filter(m => m.role === 'assistant');
        const firstUser = userMsgs[0];
        const lastAi = aiMsgs[aiMsgs.length - 1];

        return {
            id: generateUlid(),
            title: (firstUser?.content || path.basename(meta.projectDir)).slice(0, 80),
            summary: null,
            first_message_text: firstUser?.content || '',
            last_message_text: lastAi?.content || '',
            total_turns: messages.length,
            user_turns: userMsgs.length,
            ai_turns: aiMsgs.length,
            created_at: new Date(stat.birthtimeMs || stat.mtimeMs),
            updated_at: new Date(stat.mtimeMs),
            imported_at: new Date(),
            source_type: this.type,
            source_name: this.sourceName,
            source_id: meta.filePath, // aider 无 session id，用文件路径做三元组第三键
            source_origin: meta.projectDir,
            content_hash: computeContentHash(messages),
            metadata: JSON.stringify({ source_specific: { type: 'aider', file_path: meta.filePath } }),
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
function parseAiderMarkdown(raw) {
    const messages = [];
    const lines = raw.split('\n');
    let currentRole = null;
    let buffer = [];

    const flush = () => {
        const text = buffer.join('\n').trim();
        if (currentRole && text) {
            messages.push({ role: currentRole, content: text, timestamp: null });
        }
        buffer = [];
    };

    for (const line of lines) {
        const m = line.match(/^#{2,4}\s*(user|assistant)\s*:?\s*$/i);
        if (m) {
            flush();
            currentRole = m[1].toLowerCase() === 'user' ? 'user' : 'assistant';
            continue;
        }
        if (/^#\s+aider chat/i.test(line)) {
            flush();
            currentRole = null;
            continue;
        }
        if (currentRole) buffer.push(line);
    }
    flush();
    return messages;
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

module.exports = AiderAdapter;
