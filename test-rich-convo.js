#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import { execSync } from 'child_process';

const DB_PATH = process.env.HOME + '/.dcf/dcf.db';
const CONV_ID = '2Y1FS2TT4AXSB0QJ651RBBYT56';

// Get full events
const result = execSync(`sqlite3 "${DB_PATH}" "SELECT event_type, payload_json FROM raw_events WHERE source_id='${CONV_ID}' ORDER BY created_at"`, {encoding: 'utf8'});
const lines = result.trim().split('\n');
const events = [];
for (const line of lines) {
    const idx = line.indexOf('|');
    if (idx > 0) {
        events.push({event_type: line.slice(0, idx), payload_json: line.slice(idx + 1)});
    }
}

console.log(`Events: ${events.length}`);

// Assemble material
let material = '';
for (const e of events) {
    if (e.event_type.includes('message')) {
        try {
            const p = JSON.parse(e.payload_json);
            material += `\n[${p.role.toUpperCase()}]: ${p.text || ''}\n`;
        } catch (_) {}
    }
}

console.log(`Material length: ${material.length} chars`);
console.log('\n--- First 500 chars ---');
console.log(material.slice(0, 500));

// Create session
async function call(method, url, body = null) {
    const parsed = new URL(url);
    return new Promise((resolve, reject) => {
        const options = {
            method,
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            headers: {'Content-Type': 'application/json'}
        };
        
        if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({status: res.statusCode, body: data}));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => reject(new Error('Timeout')));
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

async function main() {
    console.log('\n=== Creating session ===');
    let r = await call('POST', 'http://127.0.0.1:4096/session',
        JSON.stringify({title: 'DCF-Rich-Digest'}));
    
    const sess = JSON.parse(r.body);
    const sessionId = sess.id;
    console.log(`Session: ${sessionId}`);
    
    // Strong prompt
    const prompt = `Analyze the following conversation and extract knowledge products.

=== CONVERSATION MATERIAL ===
${material}
=== END MATERIAL ===

You MUST respond with EXACTLY this format:

<<<MARKDOWN>>>
## Conversation Analysis

[Your analysis here - 100-200 words]

<<<JSON>>>
[
  {
    "type": "card",
    "title": "Brief title (≤40 chars)",
    "summary": "100-300 char summary",
    "evidence": ["Direct quote 1", "Direct quote 2"],
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${CONV_ID}"
  },
  {
    "type": "maintenance_task",
    "task": "Actionable improvement task",
    "criteria": ["Acceptance criterion 1", "Criterion 2"],
    "risk": "Risk or null",
    "rollback_plan": "Rollback or null",
    "priority": 5,
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${CONV_ID}"
  }
]

CRITICAL REQUIREMENTS:
1. You MUST output BOTH <<<MARKDOWN>>> and <<<JSON>>> sections
2. You MUST output at least ONE card AND ONE maintenance_task
3. Extract insights ONLY from the provided material
4. Evidence must be direct quotes from the material
5. The JSON MUST be valid and parseable
6. DO NOT skip the JSON section

Begin:`;

    console.log('Sending prompt...');
    r = await call('POST', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/prompt_async`,
        JSON.stringify({parts: [{type: 'text', text: prompt}]}));
    console.log(`Sent: HTTP ${r.status}`);
    
    // Poll
    console.log('Polling...');
    for (let i = 0; i < 60; i++) {
        await sleep(8000);
        r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}`);
        const info = JSON.parse(r.body);
        const state = info.state || info.status || 'unknown';
        console.log(`  [${(i+1)*8}s] State: ${state}, Output tokens: ${info.tokens?.output || 0}`);
        
        if (state === 'complete' || state === 'finished' || state === 'idle') {
            console.log('\n=== COMPLETED ===');
            
            // Get messages
            r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/message`);
            const messages = JSON.parse(r.body);
            
            let markdown = '';
            let products = [];
            
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
                        } catch (e) {
                            console.log(`  JSON parse error: ${e.message}`);
                        }
                    }
                }
            }
            
            console.log(`\nMarkdown length: ${markdown.length}`);
            console.log(`Products: ${products.length}`);
            
            if (products.length > 0) {
                // Insert into DB
                console.log('\n=== INSERTING INTO DB ===');
                
                for (const p of products) {
                    const ulid = generateULID();
                    const safeText = (s) => (s || '').replace(/'/g, "''");
                    
                    if (p.type === 'card') {
                        execSync(`sqlite3 "${DB_PATH}" "INSERT OR REPLACE INTO ai_cards (card_id, title, summary, evidence_json, boundary_inherit, source_conversation, source_event_ids, markdown_body, json_body, attribution_state, created_at, updated_at) VALUES ('${ulid}', '${safeText(p.title).slice(0, 40)}', '${safeText(p.summary).slice(0, 500)}', '${JSON.stringify(p.evidence || [])}', '${p.boundary_inherit || 'OBSERVE_CURRENT_ONLY'}', '${CONV_ID}', NULL, '${safeText(markdown)}', '${safeText(JSON.stringify(p))}', 'ai_proposed', datetime('now'), datetime('now'))"`);
                        console.log(`  ✓ Card: ${ulid}`);
                    } else if (p.type === 'maintenance_task') {
                        execSync(`sqlite3 "${DB_PATH}" "INSERT OR REPLACE INTO ai_maintenance_tasks (task_id, task, criteria_json, risk, rollback_plan, priority, boundary_inherit, source_conversation, source_event_ids, markdown_body, json_body, attribution_state, created_at, updated_at) VALUES ('${ulid}', '${safeText(p.task).slice(0, 500)}', '${JSON.stringify(p.criteria || [])}', '${safeText(p.risk || '')}', '${safeText(p.rollback_plan || '')}', ${Math.max(1, Math.min(9, p.priority || 5))}, '${p.boundary_inherit || 'OBSERVE_CURRENT_ONLY'}', '${CONV_ID}', NULL, '${safeText(markdown)}', '${safeText(JSON.stringify(p))}', 'ai_proposed', datetime('now'), datetime('now'))"`);
                        console.log(`  ✓ Task: ${ulid}`);
                    }
                }
                
                // Create digest job with opencode source
                const jobId = generateULID();
                execSync(`sqlite3 "${DB_PATH}" "INSERT OR REPLACE INTO digest_jobs (job_id, conversation_id, event_ids_json, status, source_level, error_message, products_json, created_at, updated_at) VALUES ('${jobId}', '${CONV_ID}', NULL, 'done', 'opencode', NULL, '${safeText(JSON.stringify(products))}', datetime('now'), datetime('now'))"`);
                console.log(`  ✓ Job: ${jobId}`);
                
                // Save result
                fs.writeFileSync('/tmp/opencode-success.json', JSON.stringify({
                    session_id: sessionId,
                    conversation_id: CONV_ID,
                    products,
                    markdown
                }, null, 2));
                
                console.log('\n✅ SUCCESS! Products inserted into DB');
            } else {
                console.log('\n⚠ No products extracted');
                // Save raw response for debugging
                let rawResponse = '';
                for (const m of messages) {
                    if (m.info?.role === 'assistant') {
                        for (const part of (m.parts || [])) {
                            if (part.type === 'text' && part.text) {
                                rawResponse += part.text + '\n';
                            }
                        }
                    }
                }
                fs.writeFileSync('/tmp/opencode-raw-response.txt', rawResponse);
                console.log('Raw response saved to /tmp/opencode-raw-response.txt');
            }
            break;
        }
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
