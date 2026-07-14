'use strict';

const fs = require('fs');
const path = require('path');
const { VERSION } = require('../src-next/survival/constants');

const root = path.resolve(__dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name.endsWith('.js') ? [path.relative(root, absolute).replace(/\\/g, '/')] : [];
  });
}
const modules = walk(path.join(root, 'src-next')).sort((a, b) => a.localeCompare(b));

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

const header = `// ==UserScript==
// @name         DCF ChatGPT Next (Review)
// @namespace    https://chatgpt.com/
// @version      ${VERSION}
// @description  Direct DCF rewrite: minimal survival box plus complete first-party plugin set.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore/pull/21
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==
`;
const runtime = `(function(){'use strict';
const modules={
${moduleTable}
};
const cache={};
function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF Next module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}
require('src-next/index.js');
})();
`;
fs.writeFileSync(path.join(root, 'dcf-chatgpt-next.user.js'), header + runtime);
fs.writeFileSync(path.join(root, 'dcf-chatgpt-next.meta.js'), header);
console.log(JSON.stringify({ ok: true, version: VERSION, modules: modules.length, bytes: fs.statSync(path.join(root, 'dcf-chatgpt-next.user.js')).size }, null, 2));
