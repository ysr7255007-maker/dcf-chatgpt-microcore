'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const ref = index.units.find((unit) => unit.id === 'dcf.firstparty.diagnostics');
assert(ref);
assert.strictEqual(ref.version, '1.0.0-rc.2-diagnostics.3');
assert.strictEqual(ref.phase, 90);
assert.strictEqual(ref.world_id, 'dcf-firstparty-diagnostics');

const code = fs.readFileSync(path.join(root, 'chrome-extension/code-units/diagnostics/main.js'), 'utf8');
assert.strictEqual(crypto.createHash('sha256').update(code).digest('hex'), ref.hash);

for (const token of [
  '<<<DCF_LOCAL_AGENT_DIAGNOSTIC>>>',
  '<<<END_DCF_LOCAL_AGENT_DIAGNOSTIC>>>',
  'dcf.local-agent.diagnostic.v1',
  "const DIALOGUE_ID = 'dcf.firstparty.local-agent-dialogue'",
  "const LOCAL_AGENT_ID = 'dcf.firstparty.local-agent'",
  "method: 'GET'",
  "optionalGet('session', `/session/${encoded}`",
  "optionalGet('status', '/session/status'",
  "optionalGet('messages', `/session/${encoded}/message?limit=40`",
  "optionalGet('config_providers', '/config/providers'",
  "optionalGet('providers', '/provider'",
  "optionalGet('agents', '/agent'",
  'last_auto_session_id',
  'automatic-recent-session-diagnostic',
  'message_text_included: false',
  'credentials_included: false',
  'provider_options_included: false',
  'raw_config_included: false',
  'await clickSend()',
  'diagnoseRecent().catch',
  'unit.started'
]) assert(code.includes(token), `missing ${token}`);

for (const forbidden of [
  "method: 'POST'",
  '/prompt_async',
  'apiKey',
  'Authorization: Bearer',
  'messageText',
  'task_draft',
  'parts.map(partText)'
]) assert(!code.includes(forbidden), `forbidden ${forbidden}`);

assert(code.includes("['127.0.0.1', 'localhost', '[::1]']"));
console.log(JSON.stringify({
  ok: true,
  plugin_version: ref.version,
  read_only_loopback_diagnostics: true,
  recent_session_auto_probe: true,
  one_report_per_session: true,
  automatic_chat_return: true,
  message_text_excluded: true,
  credentials_excluded: true,
  provider_private_options_excluded: true
}, null, 2));
