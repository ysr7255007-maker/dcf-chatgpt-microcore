#!/usr/bin/env node
/**
 * opencode-legacy-digest.js — Phase 5: Use OpenCode HTTP API to digest legacy conversations
 * 
 * Reads 9 historical conversations from manifest, dispatches OpenCode tasks serially,
 * parses results into cards/maintenance_tasks, inserts into ai_cards and ai_maintenance_tasks.
 * 
 * Requirements:
 *   - Node 18+
 *   - OpenCode server running at http://127.0.0.1:4096
 *   - ~/.dcf/dcf.db with raw_events table containing conversation events
 * 
 * Usage:
 *   node opencode-legacy-digest.js
 */

import { OpenCodeBridge } from './seed/adapters/opencode/bridge.mjs';
import sqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(process.env.HOME || '.', '.dcf', 'dcf.db');
const MANIFEST_PATH = path.join(__dirname, 'seed/docs/evidence/e2e-real/manifest-history-ingest-1785149733982.json');

// OpenCode bridge instance (no auth for now)
const openCode = new OpenCodeBridge({
    baseURL: 'http://127.0.0.1:4096',
    username: 'opencode',
    password: null
});

// Generate ULID (simple placeholder - in production use proper ULID lib)
function generateULID() {
    const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let id = '';
    for (let i = 0; i < 26; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return `U${id.slice(0, 25)}`;
}

// Parse card or maintenance_task product
function parseProduct(product) {
    if (!product || !product.type) return null;

    const base = {
        boundary_inherit: 'OBSERVE_CURRENT_ONLY', // default for legacy ingestion
        attribution_state: 'ai_proposed'
    };

    if (product.type === 'card') {
        return {
            ...base,
            card_id: generateULID(),
            title: product.title?.slice(0, 40) || 'Untitled Card',
            summary: product.summary?.slice(0, 500) || 'No summary',
            evidence_json: JSON.stringify(product.evidence || []),
            source_conversation: product.source_conversation || '',
            source_event_ids: null,
            markdown_body: product.markdown || null,
            json_body: JSON.stringify(product, null, 2)
        };
    } else if (product.type === 'maintenance_task') {
        return {
            ...base,
            task_id: generateULID(),
            task: product.task?.slice(0, 500) || 'No task description',
            criteria_json: JSON.stringify(product.criteria || []),
            risk: product.risk || null,
            rollback_plan: product.rollback_plan || null,
            priority: typeof product.priority === 'number' ? Math.max(1, Math.min(9, product.priority)) : 5,
            source_conversation: product.source_conversation || '',
            source_event_ids: null,
            markdown_body: product.markdown || null,
            json_body: JSON.stringify(product, null, 2)
        };
    }
    return null;
}

// Ingest products into DB
function ingestProducts(db, convId, products, sessionInfo) {
    const insertedCards = [];
    const insertedTasks = [];

    for (const p of products) {
        const data = parseProduct(p);
        if (!data) continue;

        if (data.card_id) {
            db.prepare(`
                INSERT OR REPLACE INTO ai_cards 
                (card_id, title, summary, evidence_json, boundary_inherit, source_conversation, 
                 source_event_ids, markdown_body, json_body, attribution_state, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).run(
                data.card_id, data.title, data.summary, data.evidence_json, 
                data.boundary_inherit, data.source_conversation, data.source_event_ids,
                data.markdown_body, data.json_body
            );
            insertedCards.push(data.card_id);
        } else if (data.task_id) {
            db.prepare(`
                INSERT OR REPLACE INTO ai_maintenance_tasks
                (task_id, task, criteria_json, risk, rollback_plan, priority, boundary_inherit,
                 source_conversation, source_event_ids, markdown_body, json_body, attribution_state, 
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).run(
                data.task_id, data.task, data.criteria_json, data.risk, data.rollback_plan,
                data.priority, data.boundary_inherit, data.source_conversation, data.source_event_ids,
                data.markdown_body, data.json_body, data.attribution_state
            );
            insertedTasks.push(data.task_id);
        }
    }

    // Create a digest job entry
    const jobId = generateULID();
    db.prepare(`
        INSERT OR REPLACE INTO digest_jobs
        (job_id, conversation_id, event_ids_json, status, source_level, error_message, products_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(jobId, convId, null, 'done', 'opencode', null, JSON.stringify([...insertedCards, ...insertedTasks]));

    return { cards: insertedCards, tasks: insertedTasks, jobId };
}

// Assemble material text from raw_events
function assembleMaterial(db, conversationId) {
    const rows = db.prepare(`
        SELECT event_type, payload_json, created_at
        FROM raw_events
        WHERE source_id = ?
        ORDER BY created_at
    `).all(conversationId);

    if (rows.length === 0) return 'No events found for this conversation.';

    let text = `Conversation ID: ${conversationId}\n\n`;
    text += `Events count: ${rows.length}\n`;
    text += '='.repeat(60) + '\n\n';

    for (const row of rows) {
        text += `[${row.created_at}] ${row.event_type}\n`;
        if (row.payload_json) {
            try {
                const payload = JSON.parse(row.payload_json);
                // Extract relevant fields based on event type
                if (row.event_type.includes('message')) {
                    text += `  → Role: ${payload.role || 'unknown'}\n`;
                    text += `  → Content: ${(payload.content || '').slice(0, 500)}\n`;
                } else if (row.event_type.includes('baseline')) {
                    text += `  → ${JSON.stringify(payload, null, 2)}\n`;
                } else {
                    text += `  → ${payload.text || JSON.stringify(payload).slice(0, 200)}\n`;
                }
            } catch (_) {
                text += `  → ${row.payload_json.slice(0, 200)}\n`;
            }
        }
        text += '\n';
    }

    return text;
}

// Main digestion loop
async function main() {
    console.log('='.repeat(80));
    console.log('DCF Legacy Conversation Digest via OpenCode HTTP API');
    console.log('='.repeat(80));

    // Load manifest
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const conversations = manifest.per_conversation.filter(c => c.status === 'ok').map(c => ({
        id: c.conversation_id,
        title: c.title,
        url: c.url,
        source_id: c.source_id,
        message_count: c.message_count
    }));

    console.log(`Found ${conversations.length} conversations to digest.\n`);

    // Open database
    const dbPath = path.resolve(DB_PATH);
    console.log(`Database: ${dbPath}`);
    const db = sqlite3.default(dbPath);

    // Results tracking
    const results = [];

    // Process each conversation serially with ≥2s interval
    for (let i = 0; i < conversations.length; i++) {
        const conv = conversations[i];
        const delayMs = i > 0 ? 2500 : 0; // 2.5s between conversations
        
        if (delayMs > 0) {
            console.log(`\n⏳ Waiting ${delayMs}ms before next conversation...\n`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log(`Processing [${i + 1}/${conversations.length}]: ${conv.id} (${conv.title})`);
        console.log('='.repeat(80));

        try {
            // Step 1: Assemble material
            console.log('\n📦 Assembling material from raw_events...');
            const material = assembleMaterial(db, conv.source_id);
            console.log(`   Material length: ${material.length} chars, ${material.split('\n').length} lines`);

            // Step 2: Dispatch task to OpenCode
            console.log('\n🚀 Dispatching to OpenCode...');
            const taskId = `dcf-oc-${generateULID()}`;
            const nonce = require('crypto').randomBytes(16).toString('hex');
            const outputPath = path.join('/tmp', `dcf-opencode-${taskId}.json`);
            
            // Build the full prompt with output contract
            const prompt = `Please analyze the following conversation and extract structured insights as JSON products.

=== DCF 标准化输出契约 ===
请在任务完成后将结果以 JSON 格式写入文件：${outputPath}

JSON Schema:
{
  "task_id": "${taskId}",
  "nonce": "${nonce}",
  "status": "completed" | "failed",
  "products": [
    {
      "type": "card" | "maintenance_task",
      "title": "...",
      "summary": "...",
      "evidence": ["..."],
      "boundary_inherit": "OBSERVE_CURRENT_ONLY",
      "source_conversation": "${conv.source_id}"
    }
  ],
  "evidence": {
    "session_id": "<your OpenCode session id>",
    "messages_count": <number>,
    "error": null | "<error message if failed>"
  }
}

注意：
- nonce 必须为 ${nonce}，否则结果将被拒绝入库
- task_id 必须为 ${taskId}
- 如果任务失败，status 设为 "failed"，evidence.error 填写原因
- products 可以为空数组（无结构化产物时），但字段必须存在
=== END DCF 标准化输出契约 ===

=== 对话材料 ===
${material}
=== END 对话材料 ===`;

            console.log(`   Prompt length: ${prompt.length} chars`);
            
            // Call OpenCode API directly (same as bridge.mjs)
            const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
            const http = await fetch();
            
            // Create session
            let sessionRes = await http(`${openCode.baseURL}/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: `DCF Digest: ${conv.title}` })
            });
            
            if (!sessionRes.ok) {
                throw new Error(`Failed to create session: HTTP ${sessionRes.status}`);
            }
            
            const sessionData = await sessionRes.json();
            const sessionId = sessionData.id || sessionData.session_id;
            console.log(`   Session created: ${sessionId}`);
            
            // Send prompt via prompt_async
            let msgRes = await http(`${openCode.baseURL}/session/${encodeURIComponent(sessionId)}/prompt_async`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] })
            });
            
            if (!msgRes.ok && msgRes.status !== 204) {
                throw new Error(`Failed to send message: HTTP ${msgRes.status}`);
            }
            console.log(`   Message sent (status: ${msgRes.status})`);
            
            // Poll for completion (up to 180s)
            console.log('\n⏰ Waiting for completion (polling every 5s)...');
            let completed = false;
            let attempts = 0;
            const maxAttempts = 180 / 5;
            
            while (!completed && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                attempts++;
                
                const statusRes = await http(`${openCode.baseURL}/session/${encodeURIComponent(sessionId)}`);
                if (statusRes.ok) {
                    const sessionInfo = await statusRes.json();
                    const state = sessionInfo.state || sessionInfo.status || 'unknown';
                    
                    if (state === 'complete' || state === 'finished' || state === 'idle') {
                        completed = true;
                        console.log(`   ✅ Completed after ${attempts * 5}s (${state})`);
                        
                        // Read messages
                        const msgRes2 = await http(`${openCode.baseURL}/session/${encodeURIComponent(sessionId)}/message`);
                        if (msgRes2.ok) {
                            const messages = await msgRes2.json();
                            console.log(`   Messages count: ${Array.isArray(messages) ? messages.length : 'N/A'}`);
                            
                            // Look for result in assistant messages
                            let resultText = null;
                            if (Array.isArray(messages)) {
                                for (const m of messages) {
                                    if (m.role === 'assistant' && m.content) {
                                        // Try to extract JSON from assistant response
                                        const content = m.content;
                                        const jsonMatch = content.match(/<<<JSON>>>\s*([\s\S]*?)$/) || 
                                                       content.match(/\{[\s\S]*\}/);
                                        if (jsonMatch) {
                                            try {
                                                const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                                                if (parsed.products && Array.isArray(parsed.products)) {
                                                    resultText = JSON.stringify(parsed, null, 2);
                                                    break;
                                                }
                                            } catch (_) {}
                                        }
                                    }
                                }
                            }
                            
                            if (resultText) {
                                // Write result to output_path
                                fs.writeFileSync(outputPath, resultText, 'utf8');
                                console.log(`   📄 Result written to ${outputPath}`);
                                
                                // Parse and insert products
                                console.log('\n📊 Parsing products...');
                                const resultData = JSON.parse(resultText);
                                
                                if (resultData.status === 'completed' && resultData.products) {
                                    const ingestResult = ingestProducts(db, conv.source_id, resultData.products, sessionInfo);
                                    console.log(`   ✓ Inserted ${ingestResult.cards.length} cards, ${ingestResult.tasks.length} tasks`);
                                    
                                    results.push({
                                        index: i + 1,
                                        conversation_id: conv.id,
                                        source_id: conv.source_id,
                                        title: conv.title,
                                        status: 'success',
                                        session_id: sessionId,
                                        task_id: taskId,
                                        nonce: nonce,
                                        output_path: outputPath,
                                        products: resultData.products,
                                        cards_inserted: ingestResult.cards.length,
                                        tasks_inserted: ingestResult.tasks.length,
                                        jobs_created: ingestResult.jobId
                                    });
                                } else {
                                    console.log(`   ⚠ Task status was not 'completed'. Full result logged.`);
                                    results.push({
                                        index: i + 1,
                                        conversation_id: conv.id,
                                        source_id: conv.source_id,
                                        title: conv.title,
                                        status: 'partial',
                                        session_id: sessionId,
                                        task_id: taskId,
                                        reason: 'Task returned incomplete result',
                                        result: resultData
                                    });
                                }
                            } else {
                                console.log(`   ⚠ No structured result found in conversation`);
                                results.push({
                                    index: i + 1,
                                    conversation_id: conv.id,
                                    source_id: conv.source_id,
                                    title: conv.title,
                                    status: 'no_products',
                                    session_id: sessionId,
                                    task_id: taskId,
                                    reason: 'OpenCode did not produce structured JSON products'
                                });
                            }
                        }
                    }
                }
                
                if (attempts % 12 === 0) {
                    console.log(`   ... (${attempts * 5}s elapsed)`);
                }
            }
            
            if (!completed) {
                console.log(`   ⏱️ Timeout after 180s`);
                results.push({
                    index: i + 1,
                    conversation_id: conv.id,
                    source_id: conv.source_id,
                    title: conv.title,
                    status: 'timeout',
                    session_id: sessionId,
                    task_id: taskId,
                    reason: 'Timeout waiting for OpenCode completion'
                });
            }
            
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            results.push({
                index: i + 1,
                conversation_id: conv.id,
                source_id: conv.source_id,
                title: conv.title,
                status: 'error',
                error: err.message
            });
        }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    
    const successCount = results.filter(r => r.status === 'success').length;
    const partialCount = results.filter(r => r.status === 'partial').length;
    const timeoutCount = results.filter(r => r.status === 'timeout').length;
    const errorCount = results.filter(r => r.status === 'error' || r.status === 'no_products').length;
    
    console.log(`Total processed: ${conversations.length}`);
    console.log(`Success (cards+tasks): ${successCount}`);
    console.log(`Partial (incomplete result): ${partialCount}`);
    console.log(`Timeout: ${timeoutCount}`);
    console.log(`Error/no products: ${errorCount}`);
    
    // Save manifest
    const resultManifest = {
        task: 'Phase 5: OpenCode main channel digest of legacy conversations',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        total: conversations.length,
        success: successCount,
        partial: partialCount,
        timeout: timeoutCount,
        errors: errorCount,
        per_conversation: results
    };
    
    const outputPath = path.join(__dirname, 'seed/docs/evidence/e2e-real', `opencode-digest-result-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(resultManifest, null, 2), 'utf8');
    console.log(`\n📄 Result manifest saved to: ${outputPath}`);
    
    db.close();
    console.log('\n✅ Done!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
