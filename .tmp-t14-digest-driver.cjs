#!/usr/bin/env node
/**
 * Task #14 driver: serially trigger AI digest for the 9 ingested conversations.
 * - conversation_id = internal source_id (matches boundary_relations.source_id / raw_events.source_id)
 * - material_text assembled from REAL raw_events rows (ai-digest _assembleMaterial is a stub that does not read DB)
 * - strictly serial, 2s throttle between triggers
 * Output: JSON results to stdout (captured to file by caller).
 */
const { execFileSync } = require('child_process');

const DB = '/Users/looy/.dcf/dcf.db';
const BASE = 'http://127.0.0.1:8472';

// 9 OK conversations from manifest-history-ingest-1785149733982.json (index 9 failed ingest, excluded)
const CONVERSATIONS = [
    { index: 1, source_id: 'X87SN5DDP0M8VMY60HB9WV9QXG', conversation_id: '6a66f4de-4c70-83ee-9d08-b48170aa2eb2', title: '代码复述请求' },
    { index: 2, source_id: '4XGB9AMVCA581D5G3TSEW9M9QB', conversation_id: '6a66cf7a-4578-83ee-9fc5-0667ebb707ea', title: '复述代码请求' },
    { index: 3, source_id: 'NM1EQT5YN588DNMP513ZQW27X9', conversation_id: '6a66cea1-9f00-83ee-8800-2a2c67de6a7c', title: '原样复述代码' },
    { index: 4, source_id: '2NRZWK01M21RFJ10P5B5DX1CGC', conversation_id: '6a66c949-c530-83ee-8423-1a92369af12f', title: '复述代码请求' },
    { index: 5, source_id: '1NYHK37HYRCSY1TXKT9SYQZNTR', conversation_id: '6a66c884-6950-83ee-9811-c9c3bd22fd2d', title: '原样复述代码' },
    { index: 6, source_id: 'N9X0ZFGCKXQCNYKBW67FB7DC3Q', conversation_id: '6a66c5ec-c874-83ee-b4fb-5efc54dd556e', title: '原样复述代码' },
    { index: 7, source_id: 'C96FZ58R70566JWY0677KKH03R', conversation_id: '6a66a466-a078-83ee-a5e6-aa4a98fee472', title: '代码复述请求' },
    { index: 8, source_id: 'C0YP615V5AV8X83WAK4ZB8TYSP', conversation_id: '6a669c6b-402c-83e8-b67b-68f558120faa', title: '原样复述代码' },
    { index: 10, source_id: '2Y1FS2TT4AXSB0QJ651RBBYT56', conversation_id: '6a65c2cf-f560-83ee-82ff-c8897cce7803', title: 'Cantus模型定价分析工作' }
];

function sqliteJson(sql) {
    const out = execFileSync('sqlite3', ['-json', DB, sql], { encoding: 'utf8' }).trim();
    return out ? JSON.parse(out) : [];
}

function assembleMaterial(sourceId, title) {
    const rows = sqliteJson(
        `SELECT event_id, event_type, payload_json FROM raw_events ` +
        `WHERE source_id = '${sourceId}' AND event_type IN ('conversation.message.sent','conversation.message.received') ` +
        `ORDER BY created_at ASC, sequence_number ASC;`
    );
    const lines = [`对话标题: ${title}`, ''];
    const eventIds = [];
    for (const r of rows) {
        eventIds.push(r.event_id);
        let p = {};
        try { p = JSON.parse(r.payload_json); } catch (_) {}
        const role = p.role || (r.event_type === 'conversation.message.sent' ? 'user' : 'assistant');
        lines.push(`[${role}] ${p.text || '(空)'}`);
    }
    return { material: lines.join('\n'), eventIds, messageCount: rows.length };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const results = [];
    for (const conv of CONVERSATIONS) {
        const { material, eventIds, messageCount } = assembleMaterial(conv.source_id, conv.title);
        const startedAt = new Date().toISOString();
        let httpStatus = null, body = null, error = null;
        try {
            const resp = await fetch(`${BASE}/rpc/ai/digest/trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: conv.source_id,
                    event_ids: eventIds,
                    material_text: material
                }),
                signal: AbortSignal.timeout(120000)
            });
            httpStatus = resp.status;
            body = await resp.json();
        } catch (e) {
            error = e.message;
        }
        const rec = {
            index: conv.index,
            source_id: conv.source_id,
            conversation_id: conv.conversation_id,
            title: conv.title,
            message_events_used: messageCount,
            event_ids: eventIds,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            http_status: httpStatus,
            response: body,
            error
        };
        results.push(rec);
        console.error(`[#${conv.index}] ${conv.source_id} http=${httpStatus} success=${body?.result?.success} level=${body?.result?.source_level} products=${JSON.stringify(body?.result?.products || null)} err=${body?.result?.error || error || 'none'}`);
        await sleep(2000); // serial throttle per project spec
    }
    console.log(JSON.stringify(results, null, 2));
})();
