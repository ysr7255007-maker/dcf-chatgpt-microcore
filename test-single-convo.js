#!/usr/bin/env node
import { execSync } from 'child_process';

const DB_PATH = process.env.HOME + '/.dcf/dcf.db';
const CONV_ID = 'X87SN5DDP0M8VMY60HB9WV9QXG';

// Get events
console.log('Getting events...');
const result = execSync(`sqlite3 -json "${DB_PATH}" "SELECT event_type, payload_json, created_at FROM raw_events WHERE source_id='${CONV_ID}' ORDER BY created_at"`, {encoding: 'utf8'});
const events = JSON.parse(result);
console.log('Events count:', events.length);

// Assemble material
let material = `Source ID: ${CONV_ID}\n\n`;
for (const e of events) {
    if (e.event_type.includes('message')) {
        const p = JSON.parse(e.payload_json);
        material += `[${p.created_at}] Role: ${p.role} - Content: ${(p.content || '').slice(0, 200)}\n`;
    }
}
material += '\n===END===\n';
console.log('Material length:', material.length);
console.log('\n--- Sample Material ---');
console.log(material.slice(0, 1000));
