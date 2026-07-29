#!/usr/bin/env node
'use strict';
/**
 * Wave 2 acceptance driver — 真实跑一次 digest→归纳，产出含 source 追溯的卡片候选。
 *
 * 使用真实本地 Ollama（qwen3:0.6b）+ 合法 local-only 配置（mutex-compliant）。
 * 数据流：raw_events → 材料 → LLM 调用 → 卡片候选（带 source_id 追溯）→ 候选表。
 * 候选 attribution_state=ai_proposed，不覆盖原件、不自动成为用户立场（上位秩序）。
 * 证据落档 docs/acceptance/web-capture/wave2-ai-digest-evidence.json。
 */
const path = require('path');
const fs = require('fs');
const { CompanionDB } = require('../seed/companion/db');
const { EventProcessor } = require('../seed/companion/events');
const { AIDigestEngine } = require('../seed/companion/ai-digest');
const { generateULID } = require('../seed/companion/ulid');

const CONFIG_PATH = process.env.DCF_AI_CONFIG || '/tmp/dcf-ai-test/ai-config.json';
const DB_PATH = '/tmp/dcf-ai-test/wave2-digest.db';
const EVIDENCE_PATH = path.join(__dirname, '..', 'docs', 'acceptance', 'web-capture', 'wave2-ai-digest-evidence.json');

async function main() {
    try { fs.unlinkSync(DB_PATH); } catch (_) {}
    const db = new CompanionDB(DB_PATH);
    await db.initialize();
    const eventProcessor = new EventProcessor(db);

    const conversationId = generateULID();

    // Seed a real conversation into raw_events (user + assistant turns).
    const events = [
        {
            event_id: generateULID(),
            source_id: conversationId,
            event_type: 'conversation.message.sent',
            sequence_number: 1,
            payload_json: { role: 'user', text: 'DCF 的三层架构是什么？请简述观察职责归属。' }
        },
        {
            event_id: generateULID(),
            source_id: conversationId,
            event_type: 'conversation.message.received',
            sequence_number: 2,
            payload_json: { role: 'assistant', text: 'DCF 三层架构：Core（纯内核事件总线）、Functions（模块化能力）、Target Adapter（观察与目标平台交互）。观察职责属于 Target Adapter，如 seed/adapters/chrome 负责从网页读取对话并送入 companion。' }
        }
    ];

    const ingestedIds = [];
    for (const ev of events) {
        const result = await eventProcessor.ingestEvent(ev);
        if (result && result.success) ingestedIds.push(ev.event_id);
        else console.error('ingest failed:', result && result.error);
    }
    console.log('Seeded events:', ingestedIds.length, JSON.stringify(ingestedIds));

    const engine = new AIDigestEngine({ db, eventProcessor, configPath: CONFIG_PATH });
    const status = engine.getStatus();
    console.log('AI status:', JSON.stringify(status));

    const enq = engine.enqueueDigest(conversationId, ingestedIds);
    console.log('Enqueued job:', JSON.stringify(enq));

    const material = events.map((e) => `[Source ID: ${e.event_id}] ${e.payload_json.role}: ${e.payload_json.text}`).join('\n');

    const job = { job_id: enq.job_id, conversation_id: conversationId, event_ids: ingestedIds };
    console.log('\nRunning digest via local Ollama... (may take 10-60s)');
    const t0 = Date.now();
    const result = await engine.runDigest(job, material);
    const elapsed = Date.now() - t0;

    console.log('Digest result:', JSON.stringify({
        success: result.success,
        source_level: result.source_level,
        product_count: (result.products || []).length,
        error: result.error || null,
        elapsed_ms: elapsed
    }));

    const cards = db.getAiCardsByConversation(conversationId) || [];
    const tasks = (db.getAiMaintenanceTasksByConversation
        ? db.getAiMaintenanceTasksByConversation(conversationId)
        : []) || [];
    const products = [...cards, ...tasks];

    const checks = {
        ai_status_reported: !!status.level,
        ai_status_honest_local: status.level === 'local' && status.indicator === '🔵',
        digest_ran_real_model: result.success === true && (result.source_level === 'local' || result.source_level === 'api'),
        product_produced: products.length > 0,
        source_conversation_traced: products.some(p => p.source_conversation === conversationId),
        source_event_ids_traced: products.some(p => {
            const s = p.source_event_ids;
            if (!s) return false;
            try { const arr = JSON.parse(s); return Array.isArray(arr) && arr.length > 0; } catch { return false; }
        }),
        candidate_not_user_stance: products.every(p => p.attribution_state === 'ai_proposed')
    };
    const passed = Object.values(checks).every(Boolean);

    const evidence = {
        wave: 2,
        at: new Date().toISOString(),
        config_path: CONFIG_PATH,
        ai_status: status,
        conversation_id: conversationId,
        seeded_event_ids: ingestedIds,
        digest: {
            success: result.success,
            source_level: result.source_level,
            product_count: products.length,
            elapsed_ms: elapsed,
            error: result.error || null
        },
        products: products.map(p => ({
            type: p.card_id ? 'card' : 'maintenance_task',
            id: p.card_id || p.task_id,
            title: p.title || p.task,
            summary: p.summary || null,
            source_conversation: p.source_conversation,
            source_event_ids: p.source_event_ids,
            attribution_state: p.attribution_state
        })),
        checks,
        passed
    };

    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));

    console.log('\n=== CHECKS ===');
    for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'} — evidence: ${EVIDENCE_PATH}`);

    if (db.close) db.close();
    process.exitCode = passed ? 0 : 1;
}

main().catch(err => {
    console.error('Driver error:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
});
