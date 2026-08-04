#!/usr/bin/env node

/**
 * seed/functions/data-import/adapters/CodexAdapter.js
 *
 * Codex CLI / Codex Desktop 数据源适配器
 *
 * 真实存储：~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<ts>-<session-uuid>.jsonl
 * 每个 rollout 文件 = 一个会话；每行一个 JSON 事件：
 *   - {"type":"session_meta","payload":{"session_id","timestamp","cwd","originator"}}
 *   - {"type":"event_msg","payload":{"type":"user_message","message":"..."}}
 *   - {"type":"response_item","payload":{"type":"message","role":"user"|"assistant"|"developer",
 *        "content":[{"type":"input_text"|"output_text","text":"..."}]}}
 * developer 角色为系统指令（权限说明等），一律过滤。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODEX_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.codex', 'sessions');

class CodexAdapter {
    constructor() {
        this.type = 'cli-tool';
        this.name = 'Codex CLI/Desktop (rollout-*.jsonl)';
        this.sourceName = 'codex-cli';
        this.sessionsDir = CODEX_DIR;
        this._files = [];
    }

    async detectPresence() {
        if (!fs.existsSync(this.sessionsDir)) return false;
        const files = this._scanFiles();
        if (files.length === 0) return false;
        console.log(`[CodexAdapter] Found ${files.length} rollout file(s) under ${this.sessionsDir}`);
        return true;
    }

    async initialize() {
        this._files = this._scanFiles();
    }

    _scanFiles() {
        const out = [];
        const walk = (dir, depth) => {
            if (depth > 4) return;
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
            for (const e of entries) {
                const fp = path.join(dir, e.name);
                if (e.isDirectory()) { walk(fp, depth + 1); continue; }
                if (!e.isFile() || !e.name.startsWith('rollout-') || !e.name.endsWith('.jsonl')) continue;
                let st = null;
                try { st = fs.statSync(fp); } catch (_) { continue; }
                // rollout-<ts>-<uuid>.jsonl → uuid 是最后一段
                const m = e.name.match(/rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
                out.push({
                    filePath: fp,
                    sessionId: m ? m[1] : e.name.replace(/\.jsonl$/, ''),
                    mtimeMs: st.mtimeMs
                });
            }
        };
        walk(this.sessionsDir, 0);
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
            name: `codex/${f.sessionId.slice(0, 8)}`,
            createdAt: new Date(f.mtimeMs),
            updatedAt: new Date(f.mtimeMs),
            messageCount: null
        }));
    }

    async fetchConversation(sessionId) {
        const meta = this._files.find(f => f.sessionId === sessionId) || this._scanFiles().find(f => f.sessionId === sessionId);
        if (!meta) throw new Error(`Session ${sessionId} not found under ${this.sessionsDir}`);

        const raw = fs.readFileSync(meta.filePath, 'utf8');
        let cwd = null;
        let originator = null;
        const transcript = [];   // response_item 主通道
        const fallbackUser = []; // event_msg 备用通道

        for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            let ev;
            try { ev = JSON.parse(line); } catch (_) { continue; }
            const ts = ev.timestamp ? Date.parse(ev.timestamp) : null;

            if (ev.type === 'session_meta') {
                cwd = ev.payload?.cwd || null;
                originator = ev.payload?.originator || null;
                continue;
            }
            if (ev.type === 'event_msg' && ev.payload?.type === 'user_message') {
                const text = typeof ev.payload.message === 'string' ? ev.payload.message : '';
                if (text.trim()) fallbackUser.push({ role: 'user', content: text, timestamp: ts });
                continue;
            }
            if (ev.type === 'response_item' && ev.payload?.type === 'message') {
                const role = ev.payload.role;
                if (role !== 'user' && role !== 'assistant') continue; // 过滤 developer/system
                const text = extractContentText(ev.payload.content);
                if (!text) continue;
                transcript.push({ role, content: text, timestamp: ts });
            }
        }

        // 主通道无 user 消息时，用 event_msg 补足 user 侧
        let messages = transcript;
        if (!transcript.some(m => m.role === 'user') && fallbackUser.length > 0) {
            messages = [...transcript, ...fallbackUser].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        if (messages.length === 0) throw new Error(`Session ${sessionId} has no user/assistant messages`);

        return this._toRecord(meta, messages, { cwd, originator });
    }

    _toRecord(meta, messages, extra) {
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
            source_origin: extra.cwd || null,
            content_hash: computeContentHash(messages),
            metadata: JSON.stringify({
                source_specific: {
                    type: 'codex-cli',
                    session_id: meta.sessionId,
                    cwd: extra.cwd,
                    originator: extra.originator,
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
function extractContentText(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter(b => b && (b.type === 'input_text' || b.type === 'output_text' || b.type === 'text'))
            .map(b => b.text || '')
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

module.exports = CodexAdapter;
