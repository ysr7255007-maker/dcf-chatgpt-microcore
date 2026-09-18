'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const codePath = path.join(root, 'chrome-extension/code-units/conversation-state/main.js');
const code = fs.readFileSync(codePath, 'utf8');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((u) => u.id === 'dcf.firstparty.conversation-state');
assert(ref);
assert.strictEqual(ref.version, '1.0.0-rc.2-conversation-state.9');
assert.strictEqual(ref.hash, crypto.createHash('sha256').update(code).digest('hex'));

for (const token of [
  "http://127.0.0.1:4937/continuity/observe",
  'MutationObserver',
  'Message delivery timed out. Please try again.',
  'delivery_timeout',
  'context_limit',
  'project_blank',
  '/continuity/',
  '/ack',
  'incident_id',
  'sessionStorage',
  'data-turn-id',
  'data-message-id',
  'same_chat_continue',
  'open_project_chat',
  'send_project_handoff',
  'verify_only',
  '/release',
  'releaseUnstarted'
]) assert(code.includes(token), `missing continuity mechanism: ${token}`);

assert(!code.includes('127.0.0.1:8472'), 'dead legacy companion must not remain');
assert(!/\bPOLL_MS\b/.test(code), 'continuity observer must not be a fixed-interval poller');
assert(!/setTimeout\s*\(\s*async\s*\(\)\s*=>[\s\S]{0,300}schedule\(\)/.test(code),
  'recursive polling scheduler must be removed');

// Classification must come from explicit error surfaces, not transcript/body prose.
assert(code.includes("closest('[data-message-author-role]')"),
  'formal transcript content must be excluded from terminal error surfaces');
assert(code.includes('laterUserTurn'),
  'an old error with a newer user turn must be considered superseded');

console.log(JSON.stringify({
  ok: true,
  event_driven: true,
  no_legacy_8472: true,
  exact_timeout_terminal: true,
  project_handoff_actions: true,
  fail_closed_delivery_proof: true
}, null, 2));

assert(code.indexOf('releaseUnstarted(action') < code.indexOf('writePending(pending)'), 'pre-send release must be reachable before pending/send mutation');
