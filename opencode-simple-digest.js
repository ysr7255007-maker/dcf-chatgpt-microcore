#!/usr/bin/env node
/**
 * opencode-simple-digest.js — Minimal Phase 5 OpenCode digest (no external deps)
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'better-sqlite3';

const DB_PATH = path.join(process.env.HOME || '.', '.dcf', 'dcf.db');
const MANIFEST_PATH = '/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/manifest-history-ingest-1785149733982.json';

// Simple HTTP client
function httpCall(method, url, body = null) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;
        const options = {
            method,
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            headers: { 'Content-Type': 'application/json' }
        };
        
        if (body) {
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }
        
        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        
        req.on('error', reject);
        req.setTimeout(30000, () => reject(new Error('Request timeout')));
        
        if (body) req.write(body);
        req.end();
    });
}

// Simple ULID generator
function generateULID() {
    const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const time = Date.now().toString(36).toUpperCase().padStart(10, '0');
    let random = '';
    for (let i = 0; i < 16; i++) random += chars[Math.floor(Math.random() * chars.length)];
    return `U${time}${random}`;
}

// Assemble material from raw_events
function assembleMaterial(db, conversationId) {
    try {
        const rows = db.prepare(`
            SELECT event_type, payload_json, created_at
            FROM raw_events
            WHERE source_id = ?
            ORDER BY created_at
        `).all(conversationId);
        
        if (!rows || rows.length === 0) return 'No events found.';
        
        let text = `Conversation: ${conversationId}\n\nEvents: ${rows.length}\n${'='.repeat(60)}\n\n`;
        
        for (const row of rows) {
            text += `[${row.created_at}] ${row.event_type}\n`;
            if (row.payload_json) {
                try {
                    const p = JSON.parse(row.payload_json);
                    if (row.event_type.includes('message')) {
                        text += `  → Role: ${p.role || '?'}, Content: ${(p.content || '').slice(0, 300)}\n`;
                    } else {
                        text += `  → ${JSON.stringify(p).slice(0, 200)}\n`;
                    }
                } catch (_) {
                    text += `  → ${row.payload_json.slice(0, 150)}\n`;
                }
            }
            text += '\n';
        }
        return text;
    } catch (err) {
        return `Error assembling material: ${err.message}`;
    }
}

// Main function
async function main() {
    console.log('DCF Phase 5 - OpenCode Digest (Simple Mode)\n');
    
    // Load manifest
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const conversations = manifest.per_conversation.filter(c => c.status === 'ok').map(c => ({
        id: c.conversation_id,
        title: c.title,
        source_id: c.source_id,
        message_count: c.message_count
    }));
    
    console.log(`Found ${conversations.length} conversations to process\n`);
    
    // Open DB
    const db = sqlite3.default(DB_PATH);
    
    const results = [];
    
    for (let i = 0; i < conversations.length; i++) {
        const conv = conversations[i];
        const delayMs = i > 0 ? 2500 : 0;
        
        if (delayMs > 0) {
            console.log(`⏳ Waiting ${delayMs}ms...\n`);
            await new Promise(r => setTimeout(r, delayMs));
        }
        
        console.log(`[${i + 1}/${conversations.length}] Processing: ${conv.id} (${conv.title})`);
        
        try {
            // Assemble material
            const material = assembleMaterial(db, conv.source_id);
            console.log(`   Material: ${material.length} chars`);
            
            // Create session
            const sessionIdRes = await httpCall('POST', 'http://127.0.0.1:4096/session', 
                JSON.stringify({ title: `DCF: ${conv.title}` })
            );
            
            if (sessionIdRes.status >= 400) {
                throw new Error(`Session create failed: HTTP ${sessionIdRes.status}`);
            }
            
            const sessionData = JSON.parse(sessionIdRes.body);
            const sessionId = sessionData.id;
            console.log(`   Session: ${sessionId}`);
            
            // Generate task ID and nonce
            const taskId = `dcf-oc-${generateULID()}`;
            const nonce = crypto.randomBytes(16).toString('hex');
            
            // Build prompt
            const prompt = `Analyze this conversation and extract structured insights.

Format your response as two separate sections:

<<<MARKDOWN>>>
Human-readable summary of your analysis...

<<<JSON>>>
[
  {
    "type": "card",
    "title": "Card Title",
    "summary": "Brief summary (100-300 chars)",
    "evidence": ["Evidence item 1", "Evidence item 2"],
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${conv.source_id}"
  },
  {
    "type": "maintenance_task",
    "task": "Task description",
    "criteria": ["Criteria 1", "Criteria 2"],
    "risk": "Risk description (optional)",
    "rollback_plan": "Rollback plan (optional)",
    "priority": 5,
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${conv.source_id}"
  }
]

Note: Include at least one card or maintenance_task product if meaningful insights exist.`;
            
            console.log('   Sending prompt...');
            
            // Send message
            const msgRes = await httpCall('POST', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/prompt_async`,
                JSON.stringify({ parts: [{ type: 'text', text: prompt }] })
            );
            
            if (msgRes.status !== 204 && msgRes.status >= 400) {
                throw new Error(`Message send failed: HTTP ${msgRes.status}`);
            }
            console.log(`   Prompt sent (status: ${msgRes.status})`);
            
            // Poll for completion
            console.log('   Waiting for completion...');
            let completed = false;
            let attempts = 0;
            
            while (!completed && attempts < 180) {
                await new Promise(r => setTimeout(r, 5000));
                attempts++;
                
                const statusRes = await httpCall('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}`);
                if (statusRes.ok) {
                    const info = JSON.parse(statusRes.body);
                    const state = info.state || info.status || '';
                    
                    if (state === 'complete' || state === 'finished' || state === 'idle') {
                        completed = true;
                        console.log(`   ✓ Completed after ${attempts * 5}s`);
                        
                        // Get messages
                        const msgsRes = await httpCall('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/message`);
                        if (msgsRes.ok) {
                            const messages = JSON.parse(msgsRes.body);
                            
                            // Find assistant messages with JSON
                            let products = [];
                            if (Array.isArray(messages)) {
                                for (const m of messages) {
                                    if (m.role === 'assistant' && m.content) {
                                        const content = m.content;
                                        const jsonMatch = content.match(/<<<JSON>>>\s*([\s\S]*?)$/);
                                        if (jsonMatch) {
                                            try {
                                                const parsed = JSON.parse(jsonMatch[1].trim());
                                                if (Array.isArray(parsed)) {
                                                    products = parsed;
                                                    break;
                                                }
                                            } catch (_) {}
                                        }
                                    }
                                }
                            }
                            
                            console.log(`   Found ${products.length} products`);
                            
                            // Insert into DB
                            let cardsInserted = 0;
                            let tasksInserted = 0;
                            
                            for (const p of products) {
                                if (p.type === 'card') {
                                    const cardId = generateULID();
                                    db.prepare(`
                                        INSERT OR REPLACE INTO ai_cards 
                                        (card_id, title, summary, evidence_json, boundary_inherit, 
                                         source_conversation, source_event_ids, markdown_body, json_body, attribution_state,
                                         created_at, updated_at)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                                    `).run(
                                        cardId,
                                        (p.title || '').slice(0, 40),
                                        (p.summary || '').slice(0, 500),
                                        JSON.stringify(p.evidence || []),
                                        p.boundary_inherit || 'OBSERVE_CURRENT_ONLY',
                                        conv.source_id,
                                        null,
                                        content.slice(0, content.indexOf('<<<JSON>>>')),
                                        JSON.stringify(p, null, 2),
                                        'ai_proposed'
                                    );
                                    cardsInserted++;
                                } else if (p.type === 'maintenance_task') {
                                    const taskIdVal = generateULID();
                                    db.prepare(`
                                        INSERT OR REPLACE INTO ai_maintenance_tasks
                                        (task_id, task, criteria_json, risk, rollback_plan, priority,
                                         boundary_inherit, source_conversation, source_event_ids, markdown_body,
                                         json_body, attribution_state, created_at, updated_at)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                                    `).run(
                                        taskIdVal,
                                        (p.task || '').slice(0, 500),
                                        JSON.stringify(p.criteria || []),
                                        p.risk || null,
                                        p.rollback_plan || null,
                                        typeof p.priority === 'number' ? Math.max(1, Math.min(9, p.priority)) : 5,
                                        p.boundary_inherit || 'OBSERVE_CURRENT_ONLY',
                                        conv.source_id,
                                        null,
                                        content.slice(0, content.indexOf('<<<JSON>>>')),
                                        JSON.stringify(p, null, 2),
                                        'ai_proposed'
                                    );
                                    tasksInserted++;
                                }
                            }
                            
                            // Create digest job
                            const jobId = generateULID();
                            db.prepare(`
                                INSERT OR REPLACE INTO digest_jobs
                                (job_id, conversation_id, event_ids_json, status, source_level, error_message, products_json, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                            `).run(jobId, conv.source_id, null, 'done', 'opencode', null, JSON.stringify(products));
                            
                            console.log(`   ✓ Inserted ${cardsInserted} cards, ${tasksInserted} tasks`);
                            
                            results.push({
                                index: i + 1,
                                conversation_id: conv.id,
                                source_id: conv.source_id,
                                title: conv.title,
                                status: 'success',
                                session_id: sessionId,
                                task_id: taskId,
                                nonce: nonce,
                                products,
                                cards_inserted: cardsInserted,
                                tasks_inserted: tasksInserted
                            });
                        }
                    }
                }
                
                if (attempts % 12 === 0) {
                    console.log(`   ... ${attempts * 5}s`);
                }
            }
            
            if (!completed) {
                console.log('   ⏱️ Timeout');
                results.push({ index: i + 1, conversation_id: conv.id, status: 'timeout' });
            }
            
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            results.push({ index: i + 1, conversation_id: conv.id, status: 'error', error: err.message });
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    
    const success = results.filter(r => r.status === 'success').length;
    console.log(`Total: ${conversations.length}, Success: ${success}, Errors: ${conversations.length - success}`);
    
    const resultManifest = {
        task: 'Phase 5 OpenCode digest',
        timestamp: new Date().toISOString(),
        total: conversations.length,
        success,
        per_conversation: results
    };
    
    const outputPath = `/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/opencode-digest-${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(resultManifest, null, 2));
    console.log(`Result saved to: ${outputPath}\n`);
    
    db.close();
    console.log('✅ Done!');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
