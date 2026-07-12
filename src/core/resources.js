'use strict';

const { clone, isObject, safeId } = require('./utils');

function normalizeClaim(address, value, provider, mode = 'exclusive', replaces = []) {
  return {
    address: String(address),
    value: clone(value),
    provider: String(provider),
    mode: mode === 'extend' ? 'extend' : 'exclusive',
    replaces: Array.isArray(replaces) ? replaces.map(String) : []
  };
}

function styleViolations(css) {
  const text = String(css || '');
  const violations = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(text))) {
    const selectors = match[1].split(',').map((s) => s.trim());
    const ownsShell = selectors.some((selector) => selector === '.sh' || selector.endsWith(' .sh') || selector.endsWith('>.sh'));
    if (!ownsShell) continue;
    const declarations = match[2].toLowerCase();
    for (const property of ['position', 'top', 'right', 'bottom', 'left', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'transform']) {
      if (new RegExp(`(^|;)\\s*${property}\\s*:`).test(declarations)) violations.push(property);
    }
  }
  return Array.from(new Set(violations));
}

function normalizePack(pack, fallbackId, fallbackRevision) {
  const source = isObject(pack) ? clone(pack) : {};
  const packageId = String(source.pack_id || source.package_id || fallbackId || '').trim();
  const revision = String(source.revision || fallbackRevision || '').trim();
  const errors = [];
  if (!packageId) errors.push('package id missing');
  if (!revision) errors.push(`package ${packageId || '<unknown>'} revision missing`);
  if (source.schema && source.schema !== 'dcf.module_pack.v1' && source.schema !== 'dcf.package.v2') {
    errors.push(`package ${packageId || '<unknown>'} unsupported schema ${source.schema}`);
  }
  const provider = `${packageId}@${revision}`;
  const claims = [];
  const styles = [];
  const replaces = Array.isArray(source.replaces) ? source.replaces.map(String) : [];
  const contributions = isObject(source.contributes) ? source.contributes : {};

  if (Array.isArray(source.resources)) {
    for (const resource of source.resources) {
      if (!resource || !resource.address) continue;
      claims.push(normalizeClaim(resource.address, resource.value, provider, resource.mode, resource.replaces || replaces));
    }
  }

  const appearance = isObject(contributions.appearance) ? contributions.appearance : {};
  if (appearance.side != null) claims.push(normalizeClaim('appearance-side', appearance.side, provider, 'exclusive', replaces));
  for (const [key, value] of Object.entries(isObject(appearance.vars) ? appearance.vars : {})) {
    claims.push(normalizeClaim(`appearance-var:${key}`, value, provider, 'exclusive', replaces));
  }
  if (appearance.css) styles.push({ source_id: provider, css: String(appearance.css) });
  for (const style of Array.isArray(contributions.styles) ? contributions.styles : []) {
    if (style && style.css) styles.push({ source_id: `${provider}:${safeId(style.id || styles.length)}`, css: String(style.css) });
  }
  for (const type of Array.isArray(contributions.content_types) ? contributions.content_types : []) {
    if (type && type.id) claims.push(normalizeClaim(`content-type:${type.id}`, type, provider, 'exclusive', replaces));
  }
  for (const surface of Array.isArray(contributions.surfaces) ? contributions.surfaces : []) {
    if (surface && surface.id) claims.push(normalizeClaim(`surface:${surface.id}`, surface, provider, 'exclusive', replaces));
  }
  for (const module of Array.isArray(source.modules) ? source.modules : []) {
    if (module && module.id) claims.push(normalizeClaim(`module:${module.id}`, module, provider, 'exclusive', replaces));
  }
  for (const [id, display] of Object.entries(isObject(contributions.module_display) ? contributions.module_display : {})) {
    claims.push(normalizeClaim(`module-display:${id}`, display, provider, 'exclusive', replaces));
  }
  for (const [key, value] of Object.entries(isObject(contributions.settings) ? contributions.settings : {})) {
    claims.push(normalizeClaim(`setting-default:${key}`, value, provider, 'exclusive', replaces));
  }
  for (const [type, items] of Object.entries(isObject(contributions.content) ? contributions.content : {})) {
    const list = Array.isArray(items) ? items : Object.values(isObject(items) ? items : {});
    for (const item of list) {
      if (item && item.id) claims.push(normalizeClaim(`content:${type}:${item.id}`, item, provider, 'exclusive', replaces));
    }
  }

  for (const style of styles) {
    const violations = styleViolations(style.css);
    if (violations.length) errors.push(`package ${packageId} style violates shell geometry ownership: ${violations.join(', ')}`);
  }

  return { ok: errors.length === 0, errors, package_id: packageId, revision, claims, styles, pack: source };
}

function resolveAddressClaims(address, addressClaims, ownership, errors) {
  if (addressClaims.length === 1) {
    const claim = addressClaims[0];
    ownership[address] = claim.provider;
    return claim;
  }

  if (addressClaims.every((claim) => claim.mode === 'extend')) {
    const first = addressClaims[0];
    const mergedValue = addressClaims.slice(1).reduce((value, claim) => {
      if (Array.isArray(value) && Array.isArray(claim.value)) return value.concat(claim.value);
      return Object.assign({}, isObject(value) ? value : {}, isObject(claim.value) ? claim.value : {});
    }, clone(first.value));
    const provider = addressClaims.map((claim) => claim.provider).sort().join('+');
    ownership[address] = provider;
    return Object.assign({}, first, { value: mergedValue, provider });
  }

  const replacers = addressClaims.filter((claim) => claim.replaces.includes(address));
  if (replacers.length === 1) {
    const replacement = replacers[0];
    ownership[address] = replacement.provider;
    return replacement;
  }

  const providers = addressClaims.map((claim) => claim.provider).sort();
  errors.push(`resource conflict ${address}: ${providers.join(' vs ')}`);
  return null;
}

function resolveClaims(allClaims, ownership, errors) {
  const grouped = new Map();
  for (const claim of allClaims) {
    if (!grouped.has(claim.address)) grouped.set(claim.address, []);
    grouped.get(claim.address).push(claim);
  }
  const resolved = new Map();
  for (const address of Array.from(grouped.keys()).sort()) {
    const claims = grouped.get(address).slice().sort((a, b) => a.provider.localeCompare(b.provider));
    const claim = resolveAddressClaims(address, claims, ownership, errors);
    if (claim) resolved.set(address, claim);
  }
  return resolved;
}

function compilePackageSet(packageState) {
  const allClaims = [];
  const ownership = {};
  const styles = [];
  const errors = [];
  const activePackages = {};
  const packages = isObject(packageState && packageState.packages) ? packageState.packages : {};
  const enabled = Object.values(packages).filter((entry) => entry && entry.enabled !== false).sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)));
  for (const entry of enabled) {
    const revision = String(entry.active_revision || '');
    const stored = entry.revisions && entry.revisions[revision];
    if (!stored || !stored.pack) {
      errors.push(`package ${entry.package_id} active revision ${revision} missing`);
      continue;
    }
    const normalized = normalizePack(stored.pack, entry.package_id, revision);
    if (!normalized.ok) {
      errors.push(...normalized.errors);
      continue;
    }
    allClaims.push(...normalized.claims);
    styles.push(...normalized.styles);
    activePackages[`${entry.package_id}@${revision}`] = {
      package_id: entry.package_id,
      revision,
      hash: stored.hash || '',
      source: clone(entry.source || {})
    };
  }
  const claims = resolveClaims(allClaims, ownership, errors);
  return { ok: errors.length === 0, errors, claims, ownership, styles, activePackages };
}

module.exports = { normalizePack, compilePackageSet, styleViolations, resolveClaims };
