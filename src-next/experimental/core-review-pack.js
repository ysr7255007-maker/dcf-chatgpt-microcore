'use strict';

const { clone, nowIso } = require('./core-review-storage');
const { sha256Text } = require('./core-review-modules');

async function validatePluginPackBundle(bundle, cryptoObject = globalThis.crypto) {
  if (!bundle || bundle.schema !== 'dcf.plugin-pack.bundle.v1') throw new Error('plugin_pack_bundle_schema_invalid');
  const pack = bundle.pack;
  if (!pack || pack.schema !== 'dcf.plugin-pack.v1' || !pack.id || !pack.version) throw new Error('plugin_pack_manifest_invalid');
  if (!Array.isArray(pack.modules) || !Array.isArray(pack.plugins) || !Array.isArray(pack.resources) || !Array.isArray(bundle.files)) throw new Error('plugin_pack_lists_invalid');
  const files = new Map();
  for (const file of bundle.files) {
    if (!file?.path || typeof file.content !== 'string' || !file.sha256) throw new Error('plugin_pack_file_invalid');
    if (files.has(file.path)) throw new Error(`plugin_pack_duplicate_file:${file.path}`);
    if (await sha256Text(file.content, cryptoObject) !== file.sha256) throw new Error(`plugin_pack_hash_mismatch:${file.path}`);
    files.set(file.path, file);
  }
  for (const path of pack.modules) if (!files.has(path)) throw new Error(`plugin_pack_module_missing:${path}`);
  for (const resource of pack.resources) if (!files.has(resource.path)) throw new Error(`plugin_pack_resource_missing:${resource.path}`);
  const keys = new Set();
  for (const plugin of pack.plugins) {
    const key = `${plugin.id}@${plugin.version}`;
    if (keys.has(key)) throw new Error(`plugin_pack_duplicate_plugin:${key}`);
    keys.add(key);
    if (!pack.modules.includes(plugin.entry)) throw new Error(`plugin_pack_entry_not_module:${plugin.entry}`);
  }
  return { pack: clone(pack), files };
}

async function installPluginPack(bundle, storage, state, cryptoObject = globalThis.crypto) {
  const validated = await validatePluginPackBundle(bundle, cryptoObject);
  for (const id of validated.pack.modules) {
    const file = validated.files.get(id);
    storage.writeModule({ id, content: file.content, sha256: file.sha256, pack_id: validated.pack.id, pack_version: validated.pack.version, installed_at: nowIso() });
  }
  for (const resource of validated.pack.resources) {
    const file = validated.files.get(resource.path);
    storage.writeResource({ id: resource.path, plugin_id: resource.plugin_id, role: resource.role, content: file.content, sha256: file.sha256, pack_id: validated.pack.id, pack_version: validated.pack.version, installed_at: nowIso() });
  }
  state.installed_packs[validated.pack.id] = { id: validated.pack.id, version: validated.pack.version, title: validated.pack.title || validated.pack.id, installed_at: nowIso(), manifest: validated.pack };
  storage.setState(state);
  return clone(state.installed_packs[validated.pack.id]);
}

function pluginCatalog(state) {
  const values = [];
  for (const pack of Object.values(state.installed_packs || {})) {
    for (const plugin of pack.manifest?.plugins || []) values.push({ ...plugin, pack_id: pack.id, pack_version: pack.version });
  }
  return values;
}

function buildSnapshot(state, storage, packId, recommendation) {
  const installed = state.installed_packs?.[packId];
  if (!installed) throw new Error(`plugin_pack_not_installed:${packId}`);
  const pack = installed.manifest;
  const requested = pack.recommended_snapshots?.[recommendation];
  if (!Array.isArray(requested)) throw new Error(`plugin_pack_snapshot_missing:${recommendation}`);
  const catalog = new Map((pack.plugins || []).map((plugin) => [`${plugin.id}@${plugin.version}`, plugin]));
  const plugins = requested.map((key) => {
    const plugin = catalog.get(key);
    if (!plugin) throw new Error(`plugin_pack_snapshot_plugin_missing:${key}`);
    return { ...plugin, pack_id: pack.id, pack_version: pack.version, enabled: true };
  });
  const modules = pack.modules.map((id) => {
    const unit = storage.readModule(id);
    if (!unit) throw new Error(`installed_module_missing:${id}`);
    return { id, sha256: unit.sha256 };
  });
  return { schema: 'dcf.boot-snapshot.v1', id: `${pack.id}:${pack.version}:${recommendation}`, created_at: nowIso(), pack: { id: pack.id, version: pack.version }, modules, plugins };
}

function snapshotFromManifest(state, storage, manifest, previousSnapshot = null) {
  const catalog = new Map(pluginCatalog(state).map((plugin) => [`${plugin.id}@${plugin.version}`, plugin]));
  const plugins = (manifest || []).map((item) => {
    const plugin = catalog.get(`${item.id}@${item.version}`);
    if (!plugin) throw new Error(`snapshot_plugin_not_installed:${item.id}@${item.version}`);
    return { ...plugin, enabled: item.enabled !== false };
  });
  const modules = [];
  const seen = new Set();
  for (const packId of new Set(plugins.map((plugin) => plugin.pack_id))) {
    for (const id of state.installed_packs[packId]?.manifest?.modules || []) {
      if (seen.has(id)) continue;
      const unit = storage.readModule(id);
      if (!unit) throw new Error(`installed_module_missing:${id}`);
      seen.add(id); modules.push({ id, sha256: unit.sha256 });
    }
  }
  return { schema: 'dcf.boot-snapshot.v1', id: `custom:${Date.now()}`, created_at: nowIso(), pack: previousSnapshot?.pack || null, modules, plugins };
}

module.exports = { validatePluginPackBundle, installPluginPack, pluginCatalog, buildSnapshot, snapshotFromManifest };
