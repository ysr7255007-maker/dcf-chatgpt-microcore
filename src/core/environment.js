'use strict';

const { clone, isObject, nowIso } = require('./utils');

function packageSelections(root) {
  const packages = root && root.packages && root.packages.packages || {};
  return Object.values(packages).map((entry) => ({
    package_id: String(entry.package_id),
    active_revision: String(entry.active_revision || ''),
    enabled: entry.enabled !== false
  })).sort((a, b) => a.package_id.localeCompare(b.package_id));
}

function contentIndex(root) {
  const result = {};
  const content = root && root.user && root.user.content || {};
  for (const [type, items] of Object.entries(isObject(content) ? content : {})) {
    result[type] = Object.values(isObject(items) ? items : {}).map((item) => ({
      id: String(item && item.id || ''),
      title: String(item && (item.title || item.id) || '')
    })).filter((item) => item.id).sort((a, b) => a.id.localeCompare(b.id));
  }
  return result;
}

function profileItems(root) {
  const profiles = root && root.user && root.user.environmentProfiles || {};
  return Object.values(isObject(profiles) ? profiles : {}).map((profile) => ({
    id: String(profile.id),
    title: String(profile.title || profile.id),
    saved_at: profile.saved_at || null,
    package_count: Object.keys(profile.package_selection || {}).length
  })).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
}

function environmentSnapshot(root, registry) {
  const user = root && root.user || {};
  const build = registry && registry.build || {};
  return {
    schema: 'dcf.environment.snapshot.v1',
    state: {
      revision: Number(root && root.revision || 0),
      state_hash: String(root && root.state_hash || ''),
      kernel_version: String(root && root.kernel_version || '')
    },
    packages: packageSelections(root),
    capabilities: {
      packages: packageSelections(root)
    },
    user_resources: {
      content: contentIndex(root)
    },
    policies: {
      settings: clone(user.settings || {}),
      preferences: clone(user.preferences || {})
    },
    presentation: {
      appearance: clone(user.appearance || {}),
      module_display: clone(user.moduleDisplay || {}),
      views: clone(registry && registry.uiViews || {})
    },
    profiles: {
      active_id: user.active_environment_profile || null,
      items: profileItems(root)
    },
    provenance: {
      active_packages: clone(registry && registry.installedPacks || {}),
      resource_ownership: clone(build.resource_ownership || {})
    },
    runtime: {
      registry_schema: registry && registry.schema || null,
      build_id: build.build_id || null,
      resource_graph_schema: registry && registry.resources && registry.resources.schema || null
    }
  };
}

function captureEnvironmentProfile(root, id, title) {
  const packageSelection = {};
  for (const entry of packageSelections(root)) {
    packageSelection[entry.package_id] = {
      active_revision: entry.active_revision,
      enabled: entry.enabled
    };
  }
  const user = root.user || {};
  return {
    schema: 'dcf.environment.profile.v1',
    id: String(id),
    title: String(title || id),
    saved_at: nowIso(),
    package_selection: packageSelection,
    policies: {
      settings: clone(user.settings || {}),
      preferences: clone(user.preferences || {})
    },
    presentation: {
      appearance: clone(user.appearance || {}),
      moduleDisplay: clone(user.moduleDisplay || {})
    }
  };
}

function applyEnvironmentProfile(candidate, profile) {
  if (!profile || profile.schema !== 'dcf.environment.profile.v1') throw new Error('invalid environment profile');
  let packageChanged = false;
  for (const [packageId, selection] of Object.entries(profile.package_selection || {})) {
    const entry = candidate.packages.packages[packageId];
    if (!entry) throw new Error(`profile package ${packageId} is not installed`);
    const revision = String(selection.active_revision || '');
    if (!entry.revisions || !entry.revisions[revision]) throw new Error(`profile package revision ${packageId}@${revision} is not installed`);
    if (entry.active_revision !== revision || entry.enabled !== (selection.enabled !== false)) packageChanged = true;
    entry.active_revision = revision;
    entry.enabled = selection.enabled !== false;
  }
  if (packageChanged) candidate.packages.revision += 1;
  candidate.user.settings = clone(profile.policies && profile.policies.settings || {});
  candidate.user.preferences = clone(profile.policies && profile.policies.preferences || {});
  candidate.user.appearance = clone(profile.presentation && profile.presentation.appearance || candidate.user.appearance || {});
  candidate.user.moduleDisplay = clone(profile.presentation && profile.presentation.moduleDisplay || {});
  candidate.user.active_environment_profile = String(profile.id);
  candidate.user.revision += 1;
}

module.exports = {
  environmentSnapshot,
  packageSelections,
  captureEnvironmentProfile,
  applyEnvironmentProfile
};
