'use strict';

const fs = require('fs');
const path = require('path');
const { CORE_REVIEW_VERSION } = require('../src-next/experimental/core-review-constants');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src-next/experimental');
const userPath = path.join(root, 'dcf-chatgpt-next-core-review.user.js');
const metaPath = path.join(root, 'dcf-chatgpt-next-core-review.meta.js');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name.endsWith('.js') ? [path.relative(root, absolute).replace(/\\/g, '/')] : [];
  });
}
function canonical(fromId, request) {
  if (!request.startsWith('.')) return request;
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), request));
  if (!resolved.endsWith('.js')) resolved += '.js';
  return resolved;
}
function transform(id, source) {
  return source.replace(/require\((['"])([^'"]+)\1\)/g, (_match, _quote, request) => `require(${JSON.stringify(canonical(id, request))})`);
}

function buildCoreReview() {
  const modules = walk(sourceRoot).sort((a, b) => a.localeCompare(b));
  const moduleTable = modules.map((id) => {
    const source = transform(id, fs.readFileSync(path.join(root, id), 'utf8'));
    return `${JSON.stringify(id)}:function(module,exports,require){\n${source}\n}`;
  }).join(',\n');
  const header = `// ==UserScript==
// @name         DCF ChatGPT Next Core Review
// @namespace    https://chatgpt.com/
// @version      ${CORE_REVIEW_VERSION}
// @description  Experimental minimal survival core for real plugin-pack and dynamic-loading acceptance.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next-core-review.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next-core-review.user.js
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
// @connect      127.0.0.1
// @connect      localhost
// @sandbox      DOM
// @run-at       document-idle
// ==/UserScript==
`;
  const runtime = `(function(){'use strict';
const modules={
${moduleTable}
};
const cache={};
function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF Core Review module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}
require('src-next/experimental/core-review.js');
})();
`;
  fs.writeFileSync(userPath, header + runtime);
  fs.writeFileSync(metaPath, header);
  return { ok: true, version: CORE_REVIEW_VERSION, modules: modules.length, bytes: fs.statSync(userPath).size };
}

if (require.main === module) console.log(JSON.stringify(buildCoreReview(), null, 2));
module.exports = { walk, canonical, transform, buildCoreReview };
