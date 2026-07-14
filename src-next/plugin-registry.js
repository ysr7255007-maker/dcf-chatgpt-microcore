'use strict';

const { shellPlugin } = require('./plugins/shell');
const { chatgptPlugin } = require('./plugins/chatgpt');
const { ammoPlugin } = require('./plugins/ammo');
const { pluginManagerPlugin } = require('./plugins/plugin-manager');
const { appearancePlugin } = require('./plugins/appearance');
const { backupPlugin } = require('./plugins/backup');
const { conversationPerformancePlugin } = require('./plugins/conversation-performance');
const { attributionPlugin } = require('./plugins/attribution');
const { diagnosticsPlugin } = require('./plugins/diagnostics');

function createPluginRegistry(plugins) {
  const values = plugins || [
    shellPlugin(),
    chatgptPlugin(),
    ammoPlugin(),
    conversationPerformancePlugin(),
    attributionPlugin(),
    appearancePlugin(),
    pluginManagerPlugin(),
    backupPlugin(),
    diagnosticsPlugin()
  ];
  const byKey = new Map();
  for (const plugin of values) {
    if (!plugin?.id || !plugin?.version || typeof plugin.start !== 'function') throw new Error('invalid_plugin_definition');
    const key = `${plugin.id}@${plugin.version}`;
    if (byKey.has(key)) throw new Error(`duplicate_plugin:${key}`);
    byKey.set(key, Object.freeze(plugin));
  }
  return {
    get(id, version) { return byKey.get(`${id}@${version}`) || null; },
    list() { return Array.from(byKey.values()); }
  };
}

function defaultManifest(registry) {
  return registry.list().map((plugin) => ({ id: plugin.id, version: plugin.version, enabled: true }));
}

module.exports = { createPluginRegistry, defaultManifest };
