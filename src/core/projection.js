'use strict';

const { clone, deepMerge, hash, isObject } = require('./utils');
const { compilePackageSet } = require('./resources');

function buildProjection(root) {
  const compiled = compilePackageSet(root.packages || {});
  if (!compiled.ok) return { ok: false, errors: compiled.errors, registry: null };
  const claims = compiled.claims;
  const user = root.user || {};
  const appearanceVars = {};
  const contentTypes = {};
  const packageContent = {};
  const surfaces = {};
  const modules = [];
  const moduleDisplayDefaults = {};
  const settingDefaults = {};

  for (const [address, claim] of claims.entries()) {
    if (address === 'appearance-side') continue;
    if (address.startsWith('appearance-var:')) appearanceVars[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('content-type:')) contentTypes[address.slice(13)] = clone(claim.value);
    else if (address.startsWith('surface:')) surfaces[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('module:')) modules.push(clone(claim.value));
    else if (address.startsWith('module-display:')) moduleDisplayDefaults[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('setting-default:')) settingDefaults[address.slice(16)] = clone(claim.value);
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
    modules,
    moduleDisplay: deepMerge(moduleDisplayDefaults, user.moduleDisplay || {}),
    settings: Object.assign({}, settingDefaults, clone(user.settings || {})),
    installedPacks: compiled.activePackages,
    build: {
      schema: 'dcf.build.result.v2',
      build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership }),
      resource_ownership: compiled.ownership,
      conflicts: []
    }
  };
  return { ok: true, errors: [], registry };
}

module.exports = { buildProjection };
