'use strict';

const fs = require('fs');
const path = require('path');
const { VERSION } = require('../src-next/survival/constants');

const root = path.resolve(__dirname, '..');
const packPath = path.join(root, 'plugin-packs/official/pack.json');
const CORE_MODULES = [
  'src-next/core/utils.js',
  'src-next/survival/constants.js',
  'src-next/survival/storage.js',
  'src-next/survival/manifest.js',
  'src-next/survival/recovery-ui.js',
  'src-next/survival/loader.js',
  'src-next/plugin-registry.js',
  'src-next/index.js'
];

function loadOfficialPack() {
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  if (pack.schema !== 'dcf.plugin-pack.v1' || pack.id !== 'dcf.official' || !Array.isArray(pack.modules) || !Array.isArray(pack.plugins)) {
    throw new Error('official_plugin_pack_manifest_invalid');
  }
  return pack;
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

function staticRequires(id, source) {
  const found = [];
  source.replace(/require\((['"])([^'"]+)\1\)/g, (_match, _quote, request) => {
    found.push(canonical(id, request));
    return _match;
  });
  return found;
}

function pluginMap(pack) {
  return new Map(pack.plugins.map((plugin) => [`${plugin.id}@${plugin.version}`, plugin]));
}

function selectPlugins(pack, keys) {
  const byKey = pluginMap(pack);
  return keys.map((key) => {
    const plugin = byKey.get(key);
    if (!plugin) throw new Error(`snapshot_plugin_missing:${key}`);
    return plugin;
  });
}

function pluginModuleClosure(pack, selectedPlugins) {
  const allowed = new Set(pack.modules);
  const queue = selectedPlugins.map((plugin) => plugin.entry);
  const result = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (result.has(id)) continue;
    if (!allowed.has(id)) throw new Error(`snapshot_module_not_declared:${id}`);
    const absolute = path.join(root, id);
    if (!fs.existsSync(absolute)) throw new Error(`snapshot_module_missing:${id}`);
    result.add(id);
    const source = fs.readFileSync(absolute, 'utf8');
    for (const dependency of staticRequires(id, source)) if (allowed.has(dependency) && !result.has(dependency)) queue.push(dependency);
  }
  return Array.from(result).sort((a, b) => a.localeCompare(b));
}

function registrySource(selectedPlugins) {
  const imports = selectedPlugins.map((plugin, index) => {
    const local = `factory${index}`;
    return `const { ${plugin.factory}: ${local} } = require(${JSON.stringify(plugin.entry)});`;
  });
  const values = selectedPlugins.map((_plugin, index) => `factory${index}()`).join(',\n    ');
  return `'use strict';\n\n${imports.join('\n')}\n\nfunction createPluginRegistry(plugins) {\n  const values = plugins || [\n    ${values}\n  ];\n  const byKey = new Map();\n  for (const plugin of values) {\n    if (!plugin?.id || !plugin?.version || typeof plugin.start !== 'function') throw new Error('invalid_plugin_definition');\n    const key = \`${'${plugin.id}'}@${'${plugin.version}'}\`;\n    if (byKey.has(key)) throw new Error(\`duplicate_plugin:${'${key}'}\`);\n    byKey.set(key, Object.freeze(plugin));\n  }\n  return {\n    get(id, version) { return byKey.get(\`${'${id}'}@${'${version}'}\`) || null; },\n    list() { return Array.from(byKey.values()); }\n  };\n}\n\nfunction defaultManifest(registry) {\n  return registry.list().map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: true }));\n}\n\nmodule.exports = { createPluginRegistry, defaultManifest };`;
}

function userscriptHeader(options) {
  const {
    name,
    version,
    description,
    updateURL,
    downloadURL,
    includeLocalAgent = false
  } = options;
  return `// ==UserScript==\n// @name         ${name}\n// @namespace    https://chatgpt.com/\n// @version      ${version}\n// @description  ${description}\n// @updateURL    ${updateURL}\n// @downloadURL  ${downloadURL}\n// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore/pull/21\n// @match        https://chatgpt.com/*\n// @match        https://chat.openai.com/*\n// @grant        GM_setClipboard\n// @grant        GM_getValue\n// @grant        GM_setValue\n// @grant        GM_deleteValue\n// @grant        GM_listValues\n// @grant        GM_xmlhttpRequest\n// @connect      raw.githubusercontent.com\n${includeLocalAgent ? '// @connect      127.0.0.1\n// @connect      localhost\n' : ''}// @run-at       document-idle\n// ==/UserScript==\n`;
}

function buildUserscriptArtifact(options) {
  const pack = options.pack || loadOfficialPack();
  const selectedKeys = options.selectedKeys || pack.plugins.map((plugin) => `${plugin.id}@${plugin.version}`);
  const selectedPlugins = selectPlugins(pack, selectedKeys);
  const pluginModules = pluginModuleClosure(pack, selectedPlugins);
  const moduleIds = Array.from(new Set([...CORE_MODULES, ...pluginModules])).sort((a, b) => a.localeCompare(b));
  const virtualRegistry = registrySource(selectedPlugins);
  const moduleTable = moduleIds.map((id) => {
    const source = id === 'src-next/plugin-registry.js' ? virtualRegistry : fs.readFileSync(path.join(root, id), 'utf8');
    return `${JSON.stringify(id)}:function(module,exports,require){\n${transform(id, source)}\n}`;
  }).join(',\n');
  const runtime = `(function(){'use strict';\nconst modules={\n${moduleTable}\n};\nconst cache={};\nfunction require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('DCF Next module not found: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}\nrequire('src-next/index.js');\n})();\n`;
  const header = userscriptHeader({
    ...options,
    version: options.version || VERSION,
    includeLocalAgent: selectedPlugins.some((plugin) => plugin.id === 'dcf.next.local-agent')
  });
  fs.writeFileSync(path.join(root, `${options.outputBase}.user.js`), header + runtime);
  fs.writeFileSync(path.join(root, `${options.outputBase}.meta.js`), header);
  return {
    ok: true,
    version: options.version || VERSION,
    profile: options.profile || 'complete',
    plugins: selectedPlugins.map((plugin) => `${plugin.id}@${plugin.version}`),
    modules: moduleIds.length,
    bytes: fs.statSync(path.join(root, `${options.outputBase}.user.js`)).size
  };
}

function buildNextUserscript() {
  const pack = loadOfficialPack();
  return buildUserscriptArtifact({
    pack,
    outputBase: 'dcf-chatgpt-next',
    name: 'DCF ChatGPT Next (Review)',
    description: 'Minimal survival box plus the explicitly selected DCF official plugin pack.',
    updateURL: 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.meta.js',
    downloadURL: 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.user.js'
  });
}

if (require.main === module) console.log(JSON.stringify(buildNextUserscript(), null, 2));

module.exports = {
  CORE_MODULES,
  loadOfficialPack,
  canonical,
  transform,
  staticRequires,
  selectPlugins,
  pluginModuleClosure,
  registrySource,
  userscriptHeader,
  buildUserscriptArtifact,
  buildNextUserscript
};
