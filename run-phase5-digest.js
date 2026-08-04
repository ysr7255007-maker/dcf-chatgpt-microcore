#!/usr/bin/env node
/**
 * run-phase5-digest.js — Final OpenCode Phase 5 implementation
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';

const DB_PATH = process.env.HOME + '/.dcf/dcf.db';
const MANIFEST_PATH = '/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/manifest-history-ingest-1785149733982.json';

// Simple HTTP client
async function call(method, url, body = null) {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    
    const options = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        headers: {'Content-Type': 'application/json'}
    };
    
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    
    return new Promise((resolve, reject) => {
        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({status: res.statusCode, body: data}));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => reject(new Error('Request timeout')));
        if (body) req.write(body);
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function generateULID() {
    const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const time = Date.now().toString(36).toUpperCase().padStart(10, '0');
    let rand = '';
    for (let i = 0; i < 16; i++) rand += chars[Math.floor(Math.random() * chars.length)];
    return `U${time}${rand}`;
}

// Get events using sqlite3 CLI
function getEvents(sourceId) {
    try {
        // Use raw query mode and parse manually to avoid shell escaping issues
        const result = execSync(`sqlite3 "${DB_PATH}" "SELECT event_type, payload_json, created_at FROM raw_events WHERE source_id='${sourceId}' ORDER BY created_at"`, {encoding: 'utf8'});
        if (!result.trim()) return [];
        
        // Parse pipe-delimited output and reconstruct JSON objects
        const lines = result.trim().split('\n');
        const events = [];
        for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 2) {
                const eventType = parts[0];
                const payloadJson = parts[1];
                const createdAt = parts[2] || null;
                events.push({event_type: eventType, payload_json: payloadJson, created_at: createdAt});
            }
        }
        return events;
    } catch (err) {
        console.error(`Error: ${err.message}`);
        return [];
    }
}

// Assemble material from events
function assembleMaterial(events) {
    let text = `\n=== Conversation Material (source_id=${events[0]?.source_id || 'N/A'}) ===\n\n`;
    
    for (const e of events) {
        text += `[${e.created_at || 'N/A'}] ${e.event_type}\n`;
        
        try {
            const p = JSON.parse(e.payload_json);
            if (e.event_type.includes('message')) {
                // Field name is 'text' not 'content' in DCF events
                text += `  Role: ${p.role}\n  Text: ${(p.text || '').slice(0, 800)}\n`;
            } else if (e.event_type.includes('baseline')) {
                text += `  Baseline established\n`;
            } else {
                text += `  ${JSON.stringify(p).slice(0, 300)}\n`;
            }
        } catch (_) {
            text += `  ${e.payload_json?.slice(0, 200) || ''}\n`;
        }
        text += '\n';
    }
    
    text += '=== End Material ===\n';
    return text;
}

// Insert into ai_cards
function insertCard(cardId, title, summary, evidence, boundary, sourceConv, markdown, productsJson) {
    const safeTitle = title.replace(/'/g, "''").slice(0, 40);
    const safeSummary = summary.replace(/'/g, "''").slice(0, 500);
    const safeMarkdown = (markdown || '').replace(/'/g, "''");
    
    const sql = `INSERT OR REPLACE INTO ai_cards 
                 (card_id, title, summary, evidence_json, boundary_inherit, 
                  source_conversation, source_event_ids, markdown_body, json_body, attribution_state,
                  created_at, updated_at)
                 VALUES ('${cardId}', '${safeTitle}', '${safeSummary}', 
                         '${JSON.stringify(evidence)}', '${boundary}', 
                         '${sourceConv}', NULL, '${safeMarkdown}', 
                         '${productsJson}', 'ai_proposed', datetime('now'), datetime('now'))`;
    
    execSync(`sqlite3 "${DB_PATH}" "${sql}"`);
}

// Insert into ai_maintenance_tasks  
function insertTask(taskId, taskText, criteria, risk, rollback, priority, boundary, sourceConv, markdown, productsJson) {
    const safeTask = taskText.replace(/'/g, "''").slice(0, 500);
    const safeRisk = (risk || '').replace(/'/g, "''");
    const safeRollback = (rollback || '').replace(/'/g, "''");
    const safeMarkdown = (markdown || '').replace(/'/g, "''");
    
    const sql = `INSERT OR REPLACE INTO ai_maintenance_tasks
                 (task_id, task, criteria_json, risk, rollback_plan, priority,
                  boundary_inherit, source_conversation, source_event_ids, markdown_body,
                  json_body, attribution_state, created_at, updated_at)
                 VALUES ('${taskId}', '${safeTask}', '${JSON.stringify(criteria)}',
                         '${safeRisk}', '${safeRollback}', ${Math.max(1, Math.min(9, priority||5))},
                         '${boundary}', '${sourceConv}', NULL, '${safeMarkdown}',
                         '${productsJson}', 'ai_proposed', datetime('now'), datetime('now'))`;
    
    execSync(`sqlite3 "${DB_PATH}" "${sql}"`);
}

// Create digest job
function createDigestJob(jobId, conversationId, status, products) {
    const sql = `INSERT OR REPLACE INTO digest_jobs
                 (job_id, conversation_id, event_ids_json, status, source_level, error_message, products_json, created_at, updated_at)
                 VALUES ('${jobId}', '${conversationId}', NULL, '${status}', 'opencode', NULL, 
                         '${JSON.stringify(products)}', datetime('now'), datetime('now'))`;
    execSync(`sqlite3 "${DB_PATH}" "${sql}"`);
}

async function main() {
    console.log('='.repeat(70));
    console.log('DCF Phase 5 - OpenCode Production Digest');
    console.log('='.repeat(70));
    
    // Load manifest
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const convos = manifest.per_conversation.filter(c => c.status === 'ok');
    
    console.log(`\nFound ${convos.length} conversations to process\n`);
    
    const results = [];
    const startTime = Date.now();
    
    for (let i = 0; i < convos.length; i++) {
        const c = convos[i];
        const delay = i > 0 ? 2500 : 0;
        
        if (delay > 0) {
            console.log(`\n⏳ Waiting ${delay}ms before next...\n`);
            await sleep(delay);
        }
        
        console.log(`\n[${i+1}/${convos.length}] Processing: ${c.conversation_id}`);
        console.log(`   Source ID: ${c.source_id}`);
        
        try {
            // Step 1: Get events
            console.log('   📦 Reading from SQLite...');
            const events = getEvents(c.source_id);
            console.log(`   Events: ${events.length}`);
            
            if (events.length === 0) {
                throw new Error('No events found in database');
            }
            
            // Step 2: Assemble material
            const material = assembleMaterial(events);
            console.log(`   Material length: ${material.length} chars`);
            
            // Step 3: Create session
            console.log('   🚀 Creating OpenCode session...');
            let r = await call('POST', 'http://127.0.0.1:4096/session',
                JSON.stringify({title: `DCF-Digest-${i+1}`}));
            
            if (r.status >= 400) throw new Error(`Session failed: HTTP ${r.status}`);
            
            const sess = JSON.parse(r.body);
            const sessionId = sess.id;
            console.log(`   Session: ${sessionId}`);
            
            // Step 4: Build prompt
            const prompt = `You are a knowledge extraction system. Analyze this conversation and extract structured insights as JSON products.

CONVERSATION MATERIAL:
====================
${material}

EXTRACTION FORMAT:
==================
Respond with TWO sections separated by markers:

<<<MARKDOWN>>>
Provide a concise analysis summary here (100-300 words)

<<<JSON>>>
[
  {
    "type": "card",
    "title": "Short insightful title (≤40 chars)",
    "summary": "100-300 char summary extracted from material",
    "evidence": ["Direct quote or fact from material", "Another evidence point"],
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${c.source_id}"
  },
  {
    "type": "maintenance_task",
    "task": "Specific actionable task description",
    "criteria": ["Acceptance criterion 1", "Criterion 2"],
    "risk": "Risk assessment or null",
    "rollback_plan": "How to rollback or null",
    "priority": 5,
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${c.source_id}"
  }
]

RULES:
- Extract ONLY from provided material, do not fabricate
- Include at least one card OR task if material supports it
- Evidence/criteria MUST reference the actual material
- Use EXACT field names and structure
- Return BOTH <<<MARKDOWN>>> AND <<<JSON>>> sections

Begin analysis now.`;
            
            console.log('   Sending prompt...');
            r = await call('POST', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/prompt_async`,
                JSON.stringify({parts: [{type: 'text', text: prompt}]}));
            
            console.log(`   Prompt sent: HTTP ${r.status}`);
            
            // Poll for completion (up to 200 × 8s = 1600s)
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
                        const tokens = info.tokens || {};
                        console.log(`      [${attempts*8}s] State: ${state}, Input: ${tokens.input||0}, Output: ${tokens.output||0}`);
                    }
                    
                    if (state === 'complete' || state === 'finished' || state === 'idle') {
                        completed = true;
                        console.log(`   ✓ Completed after ${attempts*8}s (${state})`);
                        
                        // Get messages and extract products
                        r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/message`);
                        if (r.ok) {
                            const messages = JSON.parse(r.body);
                            
                            let markdown = '';
                            let products = [];
                            
                            if (Array.isArray(messages)) {
                                for (const m of messages) {
                                    if (m.info?.role === 'assistant') {
                                        let content = '';
                                        for (const part of (m.parts || [])) {
                                            if (part.type === 'text' && part.text) {
                                                content += part.text + '\n';
                                            }
                                        }
                                        
                                        const mdIdx = content.indexOf('<<<MARKDOWN>>>');
                                        const jsonIdx = content.indexOf('<<<JSON>>>');
                                        
                                        if (mdIdx !== -1 && jsonIdx !== -1 && jsonIdx > mdIdx) {
                                            markdown = content.slice(mdIdx + 14, jsonIdx).trim();
                                            
                                            try {
                                                const jsonStr = content.slice(jsonIdx + 10).trim();
                                                const parsed = JSON.parse(jsonStr);
                                                if (Array.isArray(parsed)) {
                                                    products = parsed;
                                                } else if (parsed && typeof parsed === 'object') {
                                                    products = [parsed];
                                                }
                                                break;
                                            } catch (_) {}
                                        }
                                    }
                                }
                            }
                            
                            console.log(`   Products extracted: ${products.length}`);
                            
                            if (products.length > 0) {
                                console.log('\n   📋 Products:');
                                
                                // Insert each product
                                for (const p of products) {
                                    const ulid = generateULID();
                                    
                                    if (p.type === 'card') {
                                        insertCard(ulid, p.title, p.summary, p.evidence, 
                                                   p.boundary_inherit || 'OBSERVE_CURRENT_ONLY',
                                                   c.source_id, markdown, JSON.stringify(p));
                                        console.log(`     ✓ Card: ${ulid.slice(0,10)}`);
                                    } else if (p.type === 'maintenance_task') {
                                        insertTask(ulid, p.task, p.criteria, p.risk, p.rollback_plan,
                                                   p.priority, p.boundary_inherit || 'OBSERVE_CURRENT_ONLY',
                                                   c.source_id, markdown, JSON.stringify(p));
                                        console.log(`     ✓ Task: ${ulid.slice(0,10)}`);
                                    }
                                }
                                
                                // Create digest job
                                createDigestJob(generateULID(), c.source_id, 'done', products);
                                console.log(`   ✓ Digest job created`);
                                
                                results.push({
                                    index: i + 1,
                                    conversation_id: c.conversation_id,
                                    source_id: c.source_id,
                                    title: c.title,
                                    status: 'success',
                                    session_id: sessionId,
                                    events_count: events.length,
                                    products_count: products.length,
                                    products,
                                    tokens: JSON.parse(r.body)?.tokens || {}
                                });
                            } else {
                                console.log('   ⚠ No structured products');
                                results.push({
                                    index: i + 1,
                                    conversation_id: c.conversation_id,
                                    source_id: c.source_id,
                                    title: c.title,
                                    status: 'no_products',
                                    session_id: sessionId
                                });
                            }
                        }
                    }
                }
                
                if (attempts % 10 === 0) {
                    console.log(`   ... ${attempts*8}s elapsed`);
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
    
    const total = convos.length;
    const success = results.filter(r => r.status === 'success').length;
    const noProducts = results.filter(r => r.status === 'no_products').length;
    const errors = results.filter(r => r.status === 'error' || r.status === 'timeout').length;
    
    console.log(`Total processed: ${total}`);
    console.log(`Success: ${success} (${Math.round(success/total*100)}%)`);
    console.log(`No products: ${noProducts}`);
    console.log(`Errors/Timeout: ${errors}`);
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`Duration: ${duration} minutes`);
    
    // Save report
    const reportPath = `/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/opencode-phase5-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify({
        task: 'Phase 5 OpenCode production digest',
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        total,
        success,
        no_products: noProducts,
        errors,
        duration_minutes: parseFloat(duration),
        per_conversation: results
    }, null, 2), 'utf8');
    
    console.log(`\n📄 Report saved to: ${reportPath}\n`);
    console.log('✅ Done!');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
