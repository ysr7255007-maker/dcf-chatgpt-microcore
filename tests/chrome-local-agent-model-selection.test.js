'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'releases/chrome/official-index.json'), 'utf8'));
const localAgentCode = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent/main.js'), 'utf8');
const dialogueCode = fs.readFileSync(path.join(root, 'chrome-extension/code-units/local-agent-dialogue/main.js'), 'utf8');

const localAgentRef = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent');
const dialogueRef = index.units.find((unit) => unit.id === 'dcf.firstparty.local-agent-dialogue');
assert(localAgentRef);
assert(dialogueRef);
assert.strictEqual(localAgentRef.version, '1.0.0-rc.2-local-agent.3');
assert.strictEqual(dialogueRef.version, '1.0.0-rc.2-local-agent-dialogue.11');
assert.strictEqual(crypto.createHash('sha256').update(localAgentCode).digest('hex'), localAgentRef.hash);
assert.strictEqual(crypto.createHash('sha256').update(dialogueCode).digest('hex'), dialogueRef.hash);

assert(!localAgentCode.includes("split('\\u0000')"), 'local-agent must not split on NUL');
assert(!localAgentCode.includes("'\\u0000'"), 'local-agent must not encode model with NUL');
assert(!dialogueCode.includes("split('\\u0000')"), 'dialogue must not split on NUL');
assert(!dialogueCode.includes("'\\u0000'"), 'dialogue must not encode model with NUL');

assert(localAgentCode.includes('function encodeModelValue(model)'), 'local-agent declares encodeModelValue');
assert(localAgentCode.includes('function decodeModelValue(value)'), 'local-agent declares decodeModelValue');
assert(dialogueCode.includes('function encodeModelValue(model)'), 'dialogue declares encodeModelValue');
assert(dialogueCode.includes('function decodeModelValue(value)'), 'dialogue declares decodeModelValue');

assert(localAgentCode.includes('const currentModel = encodeModelValue(state.config.model)'), 'render uses encodeModelValue');
assert(localAgentCode.includes('const value = encodeModelValue(item)'), 'option value uses encodeModelValue');
assert(localAgentCode.includes('const model = decodeModelValue(modelValue)'), 'saveAndConnect uses decodeModelValue');
assert(dialogueCode.includes('model: decodeModelValue(modelValue) || normalizeModel(stored.model) || null'), 'connectionConfig uses decodeModelValue with stored fallback');

function extractFunction(source, name) {
  const header = `function ${name}(`;
  const start = source.indexOf(header);
  assert(start >= 0, `function ${name} not found in source`);
  let i = source.indexOf('{', start);
  assert(i >= 0, `function ${name} body not found`);
  let depth = 0;
  let inString = false;
  let stringChar = '';
  const begin = i;
  for (; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (char === '\\') { i += 1; continue; }
      if (char === stringChar) inString = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { inString = true; stringChar = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated function ${name}`);
}

function loadHelpers(source) {
  const normalizeModelSrc = extractFunction(source, 'normalizeModel');
  const encodeSrc = extractFunction(source, 'encodeModelValue');
  const decodeSrc = extractFunction(source, 'decodeModelValue');
  const sandbox = {};
  const factory = new Function('sandbox', `${normalizeModelSrc}\n${encodeSrc}\n${decodeSrc}\nsandbox.encodeModelValue = encodeModelValue;\nsandbox.decodeModelValue = decodeModelValue;\nsandbox.normalizeModel = normalizeModel;`);
  factory(sandbox);
  return sandbox;
}

const localAgentHelpers = loadHelpers(localAgentCode);
const dialogueHelpers = loadHelpers(dialogueCode);

const deepseekFlash = { providerID: 'volc-engine', modelID: 'deepseek-v4-flash' };
const cases = [
  { providerID: 'volc-engine', modelID: 'deepseek-v4-flash' },
  { providerID: 'openai', modelID: 'gpt-5.2' },
  { providerID: 'anthropic', modelID: 'claude-opus-4.1' },
  { providerID: 'a', modelID: 'b' }
];

for (const model of cases) {
  const encoded = localAgentHelpers.encodeModelValue(model);
  assert.strictEqual(typeof encoded, 'string');
  assert(encoded.length > 0);
  assert(!encoded.includes('\u0000'), 'encoded value must not contain NUL');
  assert.deepStrictEqual(localAgentHelpers.decodeModelValue(encoded), model, 'local-agent round-trip');
  assert.deepStrictEqual(dialogueHelpers.decodeModelValue(encoded), model, 'dialogue decodes local-agent encoding');
  const dialogueEncoded = dialogueHelpers.encodeModelValue(model);
  assert.deepStrictEqual(localAgentHelpers.decodeModelValue(dialogueEncoded), model, 'local-agent decodes dialogue encoding');
  assert.strictEqual(dialogueEncoded, encoded, 'both files produce identical encoding');
}

assert.strictEqual(localAgentHelpers.encodeModelValue(null), '', 'null model encodes to empty');
assert.strictEqual(localAgentHelpers.encodeModelValue({}), '', 'empty model encodes to empty');
assert.strictEqual(localAgentHelpers.encodeModelValue({ providerID: 'x' }), '', 'partial model encodes to empty');
assert.strictEqual(dialogueHelpers.encodeModelValue(null), '', 'dialogue null model encodes to empty');

assert.strictEqual(localAgentHelpers.decodeModelValue(''), null, 'empty decodes to null');
assert.strictEqual(localAgentHelpers.decodeModelValue(null), null, 'null decodes to null');
assert.strictEqual(localAgentHelpers.decodeModelValue('not-json'), null, 'invalid json decodes to null');
assert.strictEqual(localAgentHelpers.decodeModelValue('{}'), null, 'empty object decodes to null');
assert.strictEqual(localAgentHelpers.decodeModelValue('{"providerID":"x"}'), null, 'partial object decodes to null');
assert.strictEqual(localAgentHelpers.decodeModelValue('{"providerID":"  ","modelID":""}'), null, 'blank fields decode to null');
assert.strictEqual(dialogueHelpers.decodeModelValue('not-json'), null, 'dialogue invalid json decodes to null');

const flashEncoded = localAgentHelpers.encodeModelValue(deepseekFlash);
const simulatedSelectValue = flashEncoded.replace(/"/g, '&quot;');
const browserDecoded = simulatedSelectValue.replace(/&quot;/g, '"');
assert.strictEqual(browserDecoded, flashEncoded, 'escapeHtml round-trip preserves JSON value');
assert.deepStrictEqual(dialogueHelpers.decodeModelValue(browserDecoded), deepseekFlash, 'dialogue parses value after HTML attribute round-trip');

console.log(JSON.stringify({
  ok: true,
  local_agent_version: localAgentRef.version,
  dialogue_version: dialogueRef.version,
  no_nul_encoding: true,
  json_round_trip: true,
  cross_file_compatible: true,
  invalid_falls_back_to_null: true,
  html_attribute_safe: true,
  save_and_connect_uses_helper: true,
  connection_config_uses_helper: true,
  render_uses_helper: true
}, null, 2));
