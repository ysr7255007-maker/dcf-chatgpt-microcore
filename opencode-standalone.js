#!/usr/bin/env node
/**
 * opencode-standalone.js — Minimal OpenCode HTTP API tester
 * No external dependencies except Node.js built-ins
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';

const MANIFEST_PATH = '/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/manifest-history-ingest-1785149733982.json';

// HTTP client
function call(method, url, body = null) {
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
        req.setTimeout(30000, () => reject(new Error('Timeout')));
        
        if (body) req.write(body);
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log('='.repeat(70));
    console.log('DCF Phase 5 - OpenCode Standalone Digest (No deps)');
    console.log('='.repeat(70));
    
    // Load manifest and get conversations
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const convos = manifest.per_conversation.filter(c => c.status === 'ok');
    
    console.log(`\nFound ${convos.length} conversations to process\n`);
    
    const results = [];
    
    for (let i = 0; i < convos.length; i++) {
        const c = convos[i];
        const delay = i > 0 ? 2500 : 0;
        
        if (delay > 0) {
            console.log(`⏳ Wait ${delay}ms...\n`);
            await sleep(delay);
        }
        
        console.log(`[${i + 1}/${convos.length}] ${c.conversation_id} - "${c.title}"`);
        console.log(`   Source ID: ${c.source_id}, Messages: ${c.message_count}`);
        
        try {
            // Create session
            console.log('   Creating session...');
            let r = await call('POST', 'http://127.0.0.1:4096/session',
                JSON.stringify({ title: `DCF-Digest-${i+1}` })
            );
            
            if (r.status >= 400) throw new Error(`Session create failed: HTTP ${r.status}`);
            
            const sess = JSON.parse(r.body);
            const sessionId = sess.id;
            console.log(`   ✓ Session: ${sessionId}`);
            
            // Build prompt
            const prompt = `Analyze conversation with source_id="${c.source_id}".

Output format - TWO sections separated by markers:

<<<MARKDOWN>>>
Your analysis summary here...

<<<JSON>>>
[
  {
    "type": "card",
    "title": "Meaningful insight title",
    "summary": "100-300 char summary",
    "evidence": ["Evidence point 1", "Evidence point 2"],
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${c.source_id}"
  },
  {
    "type": "maintenance_task",  
    "task": "Specific actionable task",
    "criteria": ["Criterion 1", "Criterion 2"],
    "risk": "Risk description or null",
    "rollback_plan": "Rollback steps or null",
    "priority": 5,
    "boundary_inherit": "OBSERVE_CURRENT_ONLY",
    "source_conversation": "${c.source_id}"
  }
]

Include cards/tasks only if meaningful insights exist.`;
            
            console.log('   Sending prompt...');
            
            r = await call('POST', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/prompt_async`,
                JSON.stringify({ parts: [{ type: 'text', text: prompt }] })
            );
            
            console.log(`   Prompt sent: HTTP ${r.status}`);
            
            // Poll for completion (max 180s)
            console.log('   Waiting for completion (polling every 5s)...');
            let completed = false;
            let attempts = 0;
            
            while (!completed && attempts < 180) {
                await sleep(5000);
                attempts++;
                
                r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}`);
                if (r.ok) {
                    const info = JSON.parse(r.body);
                    const state = info.state || info.status || '';
                    
                    if (state === 'complete' || state === 'finished' || state === 'idle') {
                        completed = true;
                        console.log(`   ✓ Completed after ${attempts * 5}s (${state})`);
                        
                        // Get messages
                        r = await call('GET', `http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/message`);
                        if (r.ok) {
                            const messages = JSON.parse(r.body);
                            console.log(`   Messages: ${Array.isArray(messages) ? messages.length : 0}`);
                            
                            // Extract products
                            let products = [];
                            let markdown = '';
                            
                            if (Array.isArray(messages)) {
                                for (const m of messages) {
                                    if (m.role === 'assistant' && m.content) {
                                        const content = m.content;
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
                            
                            console.log(`   Products found: ${products.length}`);
                            
                            if (products.length > 0) {
                                console.log('\n   📦 Products:');
                                for (const p of products) {
                                    const type = p.type === 'card' ? 'CARD' : 'TASK';
                                    const title = (p.title || p.task || '').slice(0, 50);
                                    console.log(`      • ${type}: ${title}`);
                                }
                                
                                results.push({
                                    index: i + 1,
                                    conversation_id: c.conversation_id,
                                    source_id: c.source_id,
                                    title: c.title,
                                    status: 'success',
                                    session_id: sessionId,
                                    products,
                                    markdown
                                });
                            } else {
                                console.log('   ⚠ No structured products extracted');
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
                
                if (attempts % 12 === 0) {
                    console.log(`   ... ${attempts * 5}s`);
                }
            }
            
            if (!completed) {
                console.log('   ⏱️ Timeout after 180s');
                results.push({ index: i + 1, conversation_id: c.conversation_id, status: 'timeout' });
            }
            
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            results.push({ index: i + 1, conversation_id: c.conversation_id, status: 'error', error: err.message });
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    
    const success = results.filter(r => r.status === 'success').length;
    const partial = results.filter(r => r.status === 'no_products').length;
    const errors = results.filter(r => r.status === 'error' || r.status === 'timeout').length;
    
    console.log(`Total: ${convos.length}`);
    console.log(`Success: ${success} (${Math.round(success/convos.length*100)}%)`);
    console.log(`No products: ${partial}`);
    console.log(`Errors: ${errors}`);
    
    // Save result
    const outputPath = `/Users/looy/Documents/dcf/seed/docs/evidence/e2e-real/opencode-standalone-${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        total: convos.length,
        success,
        no_products: partial,
        errors,
        per_conversation: results
    }, null, 2), 'utf8');
    
    console.log(`\nResult saved to: ${outputPath}\n`);
    console.log('✅ Done!');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
