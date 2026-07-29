#!/usr/bin/env node
/**
 * final-opencode-digest.js — Phase 5 OpenCode digest WITH material injection
 * Reads real conversation data from SQLite and injects into OpenCode prompt
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DB_PATH = path.join(process.env.HOME || '.', '.dcf', 'dcf.db');
const MANIFEST_PATH = '/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/manifest-history-ingest-1785149733982.json';

// Get events from SQLite using sqlite3 CLI
function getEvents(conversationId) {
    try {
        const sql = `SELECT event_type, payload_json, created_at 
                     FROM raw_events 
                     WHERE source_id = ? 
                     ORDER BY created_at`;
        const result = execSync(`sqlite3 -json "${DB_PATH}" "$sql" "${conversationId}"`, { encoding: 'utf8' });
        return JSON.parse(result);
    } catch (err) {
        console.error(`Error querying DB: ${err.message}`);
        return [];
    }
}

// Assemble material text from events
function assembleMaterial(events) {
    let text = '=== Conversation Material ===\n\n';
    
    for (const e of events) {
        text += `[${e.created_at}] ${e.event_type}\n`;
        
        if (e.event_type.includes('message')) {
            try {
                const p = JSON.parse(e.payload_json);
                text += `Role: ${p.role}\nContent: ${(p.content || '').slice(0, 800)}\n`;
            } catch (_) {
                text += `${e.payload_json}\n`;
            }
        } else if (e.event_type.includes('baseline')) {
            text += `Baseline established\n`;
        } else {
            text += `${e.payload_json?.slice(0, 300) || ''}\n`;
        }
        text += '\n';
    }
    
    text += '=== End Material ===\n';
    return text;
}

// HTTP client
function call(method, url, body = null) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const https = await import('https');
        const http = await import('http');
        const transport = parsed.protocol === 'https:' ? https.default : http.default;
        
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
        req.setTimeout(30000, () => reject(new Error('Timeout')));
        
        if (body) req.write(body);
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Simple ULID
function generateULID() {
    const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const time = Date.now().toString(36).toUpperCase().padStart(10, '0');
    let rand = '';
    for (let i = 0; i < 16; i++) rand += chars[Math.floor(Math.random() * chars.length)];
    return `U${time}${rand}`;
}

async function main() {
    console.log('='.repeat(70));
    console.log('DCF Phase 5 - Final OpenCode Digest (WITH Material Injection)');
    console.log('='.repeat(70));
    
    // Load manifest
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const convos = manifest.per_conversation.filter(c => c.status === 'ok');
    
    console.log(`\nFound ${convos.length} conversations to process`);
    
    const results = [];
    
    for (let i = 0; i < convos.length; i++) {
        const c = convos[i];
        const delay = i > 0 ? 2500 : 0;
        
        if (delay > 0) {
            console.log(`\n⏳ Wait ${delay}ms...\n`);
            await sleep(delay);
        }
        
        console.log(`\n[${i + 1}/${convos.length}] ${c.conversation_id}`);
        console.log(`   Title: ${c.title}`);
        
        try {
            // Step 1: Get events from SQLite
            console.log('   📦 Reading from SQLite...');
            const events = getEvents(c.source_id);
            console.log(`   Found ${events.length} events`);
            
            if (events.length === 0) {
                throw new Error('No events found in database');
            }
            
            // Step 2: Assemble material
            const material = assembleMaterial(events);
            console.log(`   Material length: ${material.length} chars`);
            
            // Step 3: Create session
            console.log('   🚀 Creating OpenCode session...');
            let r = await call('POST', 'http://127.0.0.1:4096/session',
                JSON.stringify({ title: `DCF-Digest-${i+1}-${c.title.slice(0, 20)}` })
            );
            
            if (r.status >= 400) throw new Error(`Session failed: HTTP ${r.status}`);
            
            const sess = JSON.parse(r.body);
            const sessionId = sess.id;
            console.log(`   Session: ${sessionId}`);
            
            // Step 4: Build prompt with full material
            const prompt = `You are a knowledge extraction system. Analyze the conversation material below and extract structured insights as JSON products.

=== CONVERSATION MATERIAL (source_id=${c.source_id}) ===
${material}

=== EXTRACTION TASK ===
Based on this material, create JSON products in this EXACT format:

<<<MARKDOWN>>>
## Analysis Summary
Provide a concise markdown summary of the conversation content, highlighting key points and insights.

<<<JSON>>>
[
  {
    "type": "card",
    "title": "<= 40 char insightful title>",
    "summary": "<= 300 char meaningful summary extracted from the material>",
    "evidence": ["Evidence quote 1 from material", "Evidence quote 2"],
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${c.source_id}"
  },
  {
    "type": "maintenance_task",
    "task": "<= Actionable task description derived from material>",
    "criteria": ["Criterion 1", "Criterion 2"],
    "risk": "Potential risk or null if minimal risk",
    "rollback_plan": "How to rollback or null if not needed",
    "priority": 5,
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${c.source_id}"
  }
]

Rules:
1. Extract ONLY from provided material—do not fabricate
2. At least one card OR one maintenance_task if material supports it
3. Evidence/criteria MUST be direct quotes or clear references to the material
4. Use exact field names and structure above
5. Return BOTH <<<MARKDOWN>>> AND <<<JSON>>> sections

Begin analysis now.`;
            
            console.log('   Sending to OpenCode...');
            
            r = await call('POST', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/prompt_async`,
                JSON.stringify({ parts: [{ type: 'text', text: prompt }] })
            );
            
            console.log(`   Prompt sent: HTTP ${r.status}`);
            
            // Poll for completion
            console.log('   ⏰ Waiting for response (polling every 8s)...');
            let completed = false;
            let attempts = 0;
            let lastState = '';
            
            while (!completed && attempts < 200) {
                await sleep(8000);
                attempts++;
                
                r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}`);
                if (r.ok) {
                    const info = JSON.parse(r.body);
                    const state = info.state || info.status || info.mode || 'unknown';
                    
                    if (state !== lastState) {
                        lastState = state;
                        console.log(`      [${attempts * 8}s] State: ${state}, Tokens: ${info.tokens?.input || 0}/${info.tokens?.output || 0}`);
                    }
                    
                    if (state === 'complete' || state === 'finished' || state === 'idle') {
                        completed = true;
                        console.log(`   ✓ Completed after ${attempts * 8}s (${state})`);
                        
                        // Get messages
                        r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/message`);
                        if (r.ok) {
                            const messages = JSON.parse(r.body);
                            
                            // Extract assistant message content
                            let markdown = '';
                            let products = [];
                            
                            if (Array.isArray(messages)) {
                                for (const m of messages) {
                                    if (m.info?.role === 'assistant') {
                                        const parts = m.parts || [];
                                        let content = '';
                                        
                                        for (const part of parts) {
                                            if (part.type === 'text' && part.text) {
                                                content += part.text + '\n';
                                            }
                                        }
                                        
                                        // Parse MARKDOWN and JSON markers
                                        const mdIdx = content.indexOf('<<<MARKDOWN>>>');
                                        const jsonIdx = content.indexOf('<<<JSON>>>');
                                        
                                        if (mdIdx !== -1 && jsonIdx !== -1 && jsonIdx > mdIdx) {
                                            markdown = content.slice(mdIdx + 14, jsonIdx).trim();
                                            
                                            try {
                                                const jsonStr = content.slice(jsonIdx + 10).trim();
                                                const parsed = JSON.parse(jsonStr);
                                                if (Array.isArray(parsed)) {
                                                    products = parsed;
                                                    break;
                                                } else if (parsed && typeof parsed === 'object') {
                                                    products = [parsed];
                                                    break;
                                                }
                                            } catch (_) {}
                                        }
                                    }
                                }
                            }
                            
                            console.log(`   Products extracted: ${products.length}`);
                            
                            if (products.length > 0) {
                                console.log('\n   📋 Products:');
                                for (const p of products) {
                                    const type = p.type === 'card' ? 'CARD' : 'TASK';
                                    const id = p.type === 'card' ? p.title : p.task;
                                    console.log(`      • ${type}: ${id?.slice(0, 50) || 'N/A'}`);
                                }
                                
                                // Insert into DB
                                console.log('\n   💾 Inserting into database...');
                                
                                const ulids = {};
                                for (const p of products) {
                                    if (p.type === 'card') {
                                        ulids[p.summary] = generateULID();
                                    } else if (p.type === 'maintenance_task') {
                                        ulids[p.task] = generateULID();
                                    }
                                }
                                
                                for (const p of products) {
                                    const ulid = Object.values(ulids).find(id => true); // placeholder
                    
                                    if (p.type === 'card') {
                                        const cardId = ulids[p.summary] || generateULID();
                                        execSync(`sqlite3 "${DB_PATH}" \`
                                            INSERT OR REPLACE INTO ai_cards 
                                            (card_id, title, summary, evidence_json, boundary_inherit, 
                                             source_conversation, source_event_ids, markdown_body, json_body, attribution_state,
                                             created_at, updated_at)
                                            VALUES ('${cardId}', '${(p.title || '').replace(/'/g, "''").slice(0, 40)}', 
                                                     '${(p.summary || '').replace(/'/g, "''").slice(0, 500)}', 
                                                     '${JSON.stringify(p.evidence || [])}',
                                                     '${p.boundary_inherit || 'OBSERVE_CURRENT_ONLY'}',
                                                     '${c.source_id}', NULL, '${(markdown || '').replace(/'/g, "''")}',
                                                     '${JSON.stringify(p).replace(/'/g, "''")}',
                                                     'ai_proposed', datetime('now'), datetime('now'))\`;
                                        `);
                                        console.log(`     ✓ Card: ${cardId.slice(0, 10)}`);
                                    } else if (p.type === 'maintenance_task') {
                                        const taskId = generateULID();
                                        execSync(`sqlite3 "${DB_PATH}" \`
                                            INSERT OR REPLACE INTO ai_maintenance_tasks
                                            (task_id, task, criteria_json, risk, rollback_plan, priority,
                                             boundary_inherit, source_conversation, source_event_ids, markdown_body,
                                             json_body, attribution_state, created_at, updated_at)
                                            VALUES ('${taskId}', '${(p.task || '').replace(/'/g, "''").slice(0, 500)}', 
                                                     '${JSON.stringify(p.criteria || [])}',
                                                     '${(p.risk || '').replace(/'/g, "''")}',
                                                     '${(p.rollback_plan || '').replace(/'/g, "''")}',
                                                     ${typeof p.priority === 'number' ? Math.max(1, Math.min(9, p.priority)) : 5},
                                                     '${p.boundary_inherit || 'OBSERVE_CURRENT_ONLY'}',
                                                     '${c.source_id}', NULL, '${(markdown || '').replace(/'/g, "''")}',
                                                     '${JSON.stringify(p).replace(/'/g, "''")}',
                                                     'ai_proposed', datetime('now'), datetime('now'))\`;
                                        `);
                                        console.log(`     ✓ Task: ${taskId.slice(0, 10)}`);
                                    }
                                }
                                
                                // Create digest job
                                const jobId = generateULID();
                                execSync(`sqlite3 "${DB_PATH}" \`
                                    INSERT OR REPLACE INTO digest_jobs
                                    (job_id, conversation_id, event_ids_json, status, source_level, error_message, products_json, created_at, updated_at)
                                    VALUES ('${jobId}', '${c.source_id}', NULL, 'done', 'opencode', NULL, '${JSON.stringify(products)}', datetime('now'), datetime('now'))\`;
                                `);
                                console.log(`     ✓ Job: ${jobId.slice(0, 10)}`);
                                
                                results.push({
                                    index: i + 1,
                                    conversation_id: c.conversation_id,
                                    source_id: c.source_id,
                                    title: c.title,
                                    status: 'success',
                                    session_id: sessionId,
                                    events_count: events.length,
                                    products,
                                    tokens_used: JSON.parse(r.body)?.tokens || {}
                                });
                            } else {
                                console.log('   ⚠ No structured products');
                                results.push({
                                    index: i + 1,
                                    conversation_id: c.conversation_id,
                                    source_id: c.source_id,
                                    title: c.title,
                                    status: 'no_products',
                                    session_id: sessionId,
                                    reason: 'OpenCode did not output expected JSON format'
                                });
                            }
                        }
                    }
                }
                
                if (attempts % 10 === 0) {
                    console.log(`   ... ${attempts * 8}s`);
                }
            }
            
            if (!completed) {
                console.log('   ⏱️ Timeout');
                results.push({
                    index: i + 1,
                    conversation_id: c.conversation_id,
                    source_id: c.source_id,
                    title: c.title,
                    status: 'timeout',
                    session_id: sessionId
                });
            }
            
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            results.push({
                index: i + 1,
                conversation_id: c.conversation_id,
                source_id: c.source_id,
                title: c.title,
                status: 'error',
                error: err.message
            });
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(70));
    
    const success = results.filter(r => r.status === 'success').length;
    const partial = results.filter(r => r.status === 'no_products').length;
    const errors = results.filter(r => r.status === 'error' || r.status === 'timeout').length;
    
    console.log(`Total: ${convos.length}`);
    console.log(`Success: ${success} (${Math.round(success/convos.length*100)}%)`);
    console.log(`No products: ${partial}`);
    console.log(`Errors/Timeout: ${errors}`);
    
    // Save report
    const reportPath = `/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/opencode-phase5-final-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify({
        task: 'Phase 5 OpenCode digest with material injection',
        timestamp: new Date().toISOString(),
        total: convos.length,
        success,
        no_products: partial,
        errors,
        per_conversation: results
    }, null, 2), 'utf8');
    
    console.log(`\n📄 Report saved to: ${reportPath}\n`);
    console.log('✅ Done!');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
