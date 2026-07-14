'use strict';

const { clone, deepMerge, hash, isObject } = require('./utils');
const { compilePackageSet } = require('./resources');

function resolveModuleSupersession(modules) {
  const ids = new Set((modules || []).map((module) => String(module && module.id || '')).filter(Boolean));
  const direct = {};
  const errors = [];
  const ordered = (modules || []).slice().sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  for (const module of ordered) {
    const by = String(module && module.id || '');
    for (const rawTarget of Array.isArray(module && module.supersedes) ? module.supersedes : []) {
      const target = String(rawTarget || '').trim();
      if (!target) continue;
      if (target === by) {
        errors.push(`module ${by} cannot supersede itself`);
        continue;
      }
      if (direct[target] && direct[target] !== by) {
        errors.push(`module supersession conflict ${target}: ${direct[target]} vs ${by}`);
        continue;
      }
      direct[target] = by;
    }
  }
  function finalReplacement(target) {
    const seen = [target];
    let current = direct[target];
    while (current && direct[current]) {
      if (seen.includes(current)) {
        errors.push(`module supersession cycle: ${seen.concat(current).join(' -> ')}`);
        return '';
      }
      seen.push(current);
      current = direct[current];
    }
    return current || '';
  }
  const entries = {};
  for (const target of Object.keys(direct).sort()) {
    if (!ids.has(target)) continue;
    const by = finalReplacement(target);
    if (by) entries[target] = { by, direct_by: direct[target] };
  }
  return { ok: errors.length === 0, errors, entries };
}

function buildProjection(root) {
  const compiled = compilePackageSet(root.packages || {});
  if (!compiled.ok) return { ok: false, errors: compiled.errors, registry: null };
  const claims = compiled.claims;
  const user = root.user || {};
  const appearanceVars = {};
  const contentTypes = {};
  const packageContent = {};
  const surfaces = {};
  const uiViews = {};
  const modules = [];
  const moduleDisplayDefaults = {};
  const settingDefaults = {};
  const policyDefaults = {};

  for (const [address, claim] of claims.entries()) {
    if (address === 'appearance-side') continue;
    if (address.startsWith('appearance-var:')) appearanceVars[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('content-type:')) contentTypes[address.slice(13)] = clone(claim.value);
    else if (address.startsWith('surface:')) surfaces[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('ui-view:')) uiViews[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('module:')) modules.push(clone(claim.value));
    else if (address.startsWith('module-display:')) moduleDisplayDefaults[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('setting-default:')) settingDefaults[address.slice(16)] = clone(claim.value);
    else if (address.startsWith('policy-default:')) policyDefaults[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('content:')) {
      const rest = address.slice(8);
      const split = rest.indexOf(':');
      if (split > 0) {
        const type = rest.slice(0, split);
        const id = rest.slice(split + 1);
        packageContent[type] = packageContent[type] || {};
        packageContent[type][id] = clone(claim.value);
      }
    }
  }

  Object.assign(appearanceVars, clone(user.appearance && user.appearance.vars || {}));
  const side = user.appearance && user.appearance.side || claims.get('appearance-side') && claims.get('appearance-side').value || 'right';
  const styleFragments = compiled.styles.slice();
  if (!(user.appearance && user.appearance.safe_mode) && user.appearance && user.appearance.css) {
    styleFragments.push({ source_id: 'user', css: String(user.appearance.css) });
  }
  const content = clone(packageContent);
  for (const [type, items] of Object.entries(isObject(user.content) ? user.content : {})) {
    content[type] = content[type] || {};
    for (const [id, item] of Object.entries(isObject(items) ? items : {})) content[type][id] = clone(item);
  }
  for (const type of Object.keys(contentTypes)) content[type] = content[type] || {};
  modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const supersession = resolveModuleSupersession(modules);
  if (!supersession.ok) return { ok: false, errors: supersession.errors, registry: null };
  const runtimeModules = modules.filter((module) => !supersession.entries[String(module.id)]);

  const registry = {
    schema: 'dcf.runtime.registry.v3',
    kernel_version: root.kernel_version,
    state_revision: root.revision,
    state_hash: root.state_hash,
    appearance: {
      side,
      vars: appearanceVars,
      styles: styleFragments,
      css: styleFragments.map((style) => `/* DCF source: ${style.source_id} */\n${style.css}`).join('\n')
    },
    contentTypes,
    content,
    surfaces,
    uiViews,
    modules: runtimeModules,
    moduleSupersession: { schema: 'dcf.runtime.module-supersession.v1', entries: clone(supersession.entries) },
    moduleDisplay: deepMerge(moduleDisplayDefaults, user.moduleDisplay || {}),
    settings: Object.assign({}, settingDefaults, clone(user.settings || {})),
    policies: Object.assign({}, policyDefaults, clone(user.preferences || {})),
    resources: clone(compiled.resourceGraph),
    installedPacks: compiled.activePackages,
    build: {
      schema: 'dcf.build.result.v2',
      build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership, resources: compiled.resourceGraph, module_supersession: supersession.entries }),
      resource_ownership: compiled.ownership,
      conflicts: []
    }
  };
  return { ok: true, errors: [], registry };
}

module.exports = { buildProjection, resolveModuleSupersession };
