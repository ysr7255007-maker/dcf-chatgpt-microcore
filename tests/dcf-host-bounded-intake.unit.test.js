'use strict';

const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../src/host/chatgpt'), 'utf8');

assert(!source.includes("observe(doc.body"), 'host adapter observes document.body directly');
assert(!source.includes('return doc.body'), 'host adapter falls back to observing the whole body');
assert(source.includes('scheduleRootAttach'), 'host adapter lacks bounded root attachment retry');
assert(!source.includes('document.body.innerText'), 'host adapter reads full page text');
assert(!source.includes('querySelectorAll(config'), 'host adapter performs unbounded message-list query');
assert(source.includes('mutation.addedNodes'), 'host adapter does not consume mutation-local added nodes');
assert(source.includes('activeObserver.observe(normalized'), 'host adapter does not isolate the active reply');
assert(source.includes("characterData: true"), 'active reply streaming changes are not observed');
assert(source.includes('findRecentAssistantNodes(root, recoveryCount)'), 'bounded recovery path missing');
assert(source.includes('hardVisitLimit'), 'recovery traversal lacks a hard bound');
assert(source.includes("return doc.querySelector('main')"), 'host adapter does not bind to a stable bounded root');
assert(!source.includes('cursor.querySelector'), 'root discovery scans growing conversation subtrees');

console.log(JSON.stringify({ ok: true, no_body_observer: true, mutation_local_discovery: true, active_reply_only: true, bounded_recovery: true }, null, 2));
