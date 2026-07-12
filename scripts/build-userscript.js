'use strict';

const fs = require('fs');
const path = require('path');
const { VERSION } = require('../src/core/constants');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { hash } = require('../src/core/utils');

const root = path.resolve(__dirname, '..');
const modules = [
  'src/core/utils.js',
  'src/core/constants.js',
  'src/core/resources.js',
  'src/core/projection.js',
  'src/core/state.js',
  'src/core/artifacts.js',
  'src/core/receipts.js',
  'src/core/transactions.js',
  'src/runtime/storage.js',
  'src/runtime/effects.js',
  'src/runtime/commands.js',
  'src/host/chatgpt.js',
  'src/modules/standard-packages.js',
  'src/modules/ammo.js',
  'src/modules/catalog.js',
  'src/modules/package-manager.js',
  'src/modules/maintenance.js',
  'src/ui/app.js',
  'src/index.js'
];

function canonical(fromId, request) {
  if (!request.startsWith('.')) return request;
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), request));
  if (!resolved.endsWith('.js')) resolved += '.js';
  return resolved;
}

function transform(id, source) {
  return source.replace(/require\((['"])([^'"]+)\1\)/g, (_match, _quote, request) => `require(${JSON.stringify(canonical(id, request))})`);
}

const moduleTable = modules.map((id) => {
  const source = transform(id, fs.readFileSync(path.join(root, id), 'utf8'));
  return `${JSON.stringify(id)}:function(module,exports,require){\n${source}\n}`;
}).join(',\n');

const header = `// ==UserScript==\n// @name         DCF ChatGPT Microcore\n// @namespace    https://chatgpt.com/\n// @version      ${VERSION}\n// @description  DCF phase-one architecture: single authoritative state, unified transactions, bounded reply intake, deterministic packages, receipts and viewport containment.\n// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.meta.js\n// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.user.js\n// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore\n// @match        https://chatgpt.com/*\n// @match        https://chat.openai.com/*\n// @grant        GM_setClipboard\n// @grant        GM_getValue\n// @grant        GM_setValue\n// @grant        GM_deleteValue\n// @grant        GM_listValues\n// @grant        GM_addStyle\n// @grant        GM_registerMenuCommand\n// @grant        GM_notification\n// @grant        GM_xmlhttpRequest\n// @connect      raw.githubusercontent.com\n// @run-at       document-idle\n// ==/UserScript==\n`;

const runtime = `(function(){'use strict';\nconst modules={\n${moduleTable}\n};\nconst cache={};\nfunction require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}\nrequire('src/index.js');\n})();\n`;

fs.writeFileSync(path.join(root, 'dcf-chatgpt-microcore.user.js'), header + runtime);
fs.writeFileSync(path.join(root, 'dcf-chatgpt-microcore.meta.js'), header);

const packageDir = path.join(root, 'catalog', 'packages');
fs.mkdirSync(packageDir, { recursive: true });
const catalog = { schema: 'dcf.catalog.v1', generated_by_version: VERSION, packages: [] };
for (const pack of STANDARD_PACKS) {
  const filename = `${pack.pack_id}/${pack.revision}.json`;
  const absolute = path.join(packageDir, pack.pack_id, `${pack.revision}.json`);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(pack, null, 2)}\n`);
  catalog.packages.push({
    package_id: pack.pack_id,
    revision: pack.revision,
    channel: 'stable',
    hash: hash(pack),
    url: `https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/catalog/packages/${filename}`
  });
}
fs.writeFileSync(path.join(root, 'catalog', 'index.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, version: VERSION, modules: modules.length, bytes: fs.statSync(path.join(root, 'dcf-chatgpt-microcore.user.js')).size, catalog_packages: catalog.packages.length }, null, 2));
