const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dcf-chatgpt-microcore.user.js'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escape = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    if (escape) { escape = false; continue; }
    if (quote) {
      if (c === '\\') escape = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const functionNames = [
  'normalizePackageState', 'normalizeUserState', 'normalizeOps',
  'migrateLegacyRegistry', 'migrateInstall',
  'buildRuntime', 'coreClaim', 'addClaim', 'normalizePack',
  'shellGeometryViolations', 'eachDisplay', 'legacy', 'styleVars',
  'safeId', 'obj', 'clone', 'merge', 'deepMerge', 'hash'
];
const extracted = functionNames.map(extractFunction).join('\n');

const CORE_APPEARANCE = { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } };
const CORE_AMMO_TYPE = { id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy'] };
const EMPTY_PACKAGES = { schema: 'dcf.package.sources.v1', revision: 0, packages: {} };
const EMPTY_USER = {
  schema: 'dcf.user.state.v1', revision: 0,
  appearance: { side: null, vars: {}, css: '', safe_mode: false },
  settings: {}, content: { ammo: {} }, moduleDisplay: {}
};
const EMPTY_OPS = { schema: 'dcf.kernel.ops.v2', seenBlocks: {}, badBlocks: {}, migration: null, legacyInstalledPacks: {} };
const V = '0.10.0';

const factory = new Function(
  'CORE_APPEARANCE', 'CORE_AMMO_TYPE', 'EMPTY_PACKAGES', 'EMPTY_USER', 'EMPTY_OPS', 'V',
  `${extracted}\nreturn { normalizePackageState, normalizeUserState, normalizeOps, migrateLegacyRegistry, buildRuntime, shellGeometryViolations, hash };`
);
const engine = factory(CORE_APPEARANCE, CORE_AMMO_TYPE, EMPTY_PACKAGES, EMPTY_USER, EMPTY_OPS, V);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stored(pack, source = { kind: 'test' }) {
  const revision = String(pack.revision);
  return {
    package_id: pack.pack_id,
    enabled: true,
    active_revision: revision,
    source,
    revisions: {
      [revision]: { revision, hash: engine.hash(JSON.stringify(pack)), installed_at: '2026-07-12T00:00:00.000Z', pack }
    }
  };
}

function emptyUser() { return JSON.parse(JSON.stringify(EMPTY_USER)); }
function emptyOps() { return JSON.parse(JSON.stringify(EMPTY_OPS)); }

const modulePack = {
  schema: 'dcf.module_pack.v1',
  pack_id: 'dcf.alpha',
  revision: '1.0.0',
  contributes: {
    appearance: { css: '.card{padding:7px}', vars: { h: '700px' } },
    settings: { mode: 'default' },
    module_display: { 'dcf.alpha.module': { area: 'maintenance', order: 20 } },
    content: { ammo: [{ id: 'package-ammo', title: '包弹药', body: 'package' }] }
  },
  modules: [{ id: 'dcf.alpha.module', title: 'Alpha', version: '1.0.0', commands: [] }]
};

const packages = JSON.parse(JSON.stringify(EMPTY_PACKAGES));
packages.packages[modulePack.pack_id] = stored(modulePack);
packages.revision = 1;
const user = emptyUser();
user.appearance.vars = { h: '620px', w: '410px' };
user.settings.mode = 'user';
user.content.ammo['user-ammo'] = { id: 'user-ammo', title: '用户弹药', body: 'user' };

const first = engine.buildRuntime(packages, user, emptyOps());
assert(first.ok, `initial build rejected: ${first.errors}`);
assert(first.registry.modules.some((m) => m.id === 'dcf.alpha.module'), 'module contribution missing');
assert(first.registry.appearance.vars.h === '620px', 'user appearance did not override package default');
assert(first.registry.appearance.vars.w === '410px', 'user appearance width missing');
assert(first.registry.settings.mode === 'user', 'user setting did not override package default');
assert(first.registry.content.ammo['package-ammo'] && first.registry.content.ammo['user-ammo'], 'package and user content were not composed');
assert(first.registry.appearance.styles.length === 1 && first.registry.appearance.styles[0].source_id === 'dcf.alpha@1.0.0', 'style source was flattened without ownership');

const disabled = JSON.parse(JSON.stringify(packages));
disabled.packages['dcf.alpha'].enabled = false;
disabled.revision++;
const disabledBuild = engine.buildRuntime(disabled, user, emptyOps());
assert(disabledBuild.ok, 'disabled package build failed');
assert(!disabledBuild.registry.modules.some((m) => m.id === 'dcf.alpha.module'), 'disabled package still contributed module');
assert(disabledBuild.registry.appearance.vars.h === '620px', 'disabling package destroyed user state');
assert(disabledBuild.registry.content.ammo['user-ammo'], 'disabling package destroyed user content');
assert(!disabledBuild.registry.content.ammo['package-ammo'], 'disabled package content remained');

const conflictingPack = {
  schema: 'dcf.module_pack.v1', pack_id: 'dcf.beta', revision: '1.0.0',
  modules: [{ id: 'dcf.alpha.module', title: 'Conflict' }]
};
const conflictState = JSON.parse(JSON.stringify(packages));
conflictState.packages[conflictingPack.pack_id] = stored(conflictingPack);
conflictState.revision++;
const conflict = engine.buildRuntime(conflictState, user, emptyOps());
assert(!conflict.ok && conflict.errors.some((e) => e.includes('resource conflict module:dcf.alpha.module')), 'duplicate resource was silently merged');

const geometryPack = {
  schema: 'dcf.module_pack.v1', pack_id: 'dcf.bad-style', revision: '1',
  contributes: { appearance: { css: '.sh{width:500px!important;bottom:0}' } }
};
const badStyleState = JSON.parse(JSON.stringify(EMPTY_PACKAGES));
badStyleState.packages[geometryPack.pack_id] = stored(geometryPack);
const badStyle = engine.buildRuntime(badStyleState, emptyUser(), emptyOps());
assert(!badStyle.ok && badStyle.errors.some((e) => e.includes('shell geometry ownership')), 'shell geometry invariant did not reject bad package style');
assert(engine.shellGeometryViolations('.sh .card{width:120px}').length === 0, 'descendant width was mistaken for shell geometry ownership');

const replacementPack = {
  schema: 'dcf.module_pack.v1', pack_id: 'dcf.ammo-type', revision: '1',
  replaces: ['content-type:ammo'],
  contributes: { content_types: [{ ...CORE_AMMO_TYPE, title: '自定义弹药' }] }
};
const replacementState = JSON.parse(JSON.stringify(EMPTY_PACKAGES));
replacementState.packages[replacementPack.pack_id] = stored(replacementPack);
const replacement = engine.buildRuntime(replacementState, emptyUser(), emptyOps());
assert(replacement.ok && replacement.registry.contentTypes.ammo.title === '自定义弹药', 'explicit core replacement failed');

const secondReplacementPack = {
  schema: 'dcf.module_pack.v1', pack_id: 'dcf.ammo-type-2', revision: '1',
  replaces: ['content-type:ammo'],
  contributes: { content_types: [{ ...CORE_AMMO_TYPE, title: '第二个替换' }] }
};
const doubleReplacementState = JSON.parse(JSON.stringify(replacementState));
doubleReplacementState.packages[secondReplacementPack.pack_id] = stored(secondReplacementPack);
const doubleReplacement = engine.buildRuntime(doubleReplacementState, emptyUser(), emptyOps());
assert(!doubleReplacement.ok, 'two packages were allowed to replace the same resource implicitly');

const repeated = engine.buildRuntime(packages, user, emptyOps());
assert(repeated.ok && repeated.registry.build.build_id === first.registry.build.build_id, 'same inputs did not produce the same build identity');

const legacy = {
  appearance: { side: 'left', css: '.card{margin:4px}', vars: { w: '390px', h: '650px', anchor: 'top', top: '20px', bottom: '80px' } },
  contentTypes: { ammo: CORE_AMMO_TYPE },
  content: { ammo: { legacy: { id: 'legacy', title: 'Legacy', body: 'x' } } },
  surfaces: {},
  modules: [{ id: 'dcf.legacy.module', title: 'Legacy Module', version: '2.0' }],
  moduleDisplay: { 'dcf.legacy.module': { area: 'maintenance' } },
  settings: { a: 1 }, seenBlocks: {}, badBlocks: {}, installedPacks: {}
};
const migrated = engine.migrateLegacyRegistry(legacy);
const migratedBuild = engine.buildRuntime(migrated.packages, migrated.user, migrated.ops);
assert(migratedBuild.ok, `legacy migration failed: ${migratedBuild.errors}`);
assert(migratedBuild.registry.modules.some((m) => m.id === 'dcf.legacy.module'), 'legacy module was not converted to a package source');
assert(migratedBuild.registry.appearance.vars.w === '390px' && migratedBuild.registry.appearance.side === 'left', 'legacy user appearance was not separated');
assert(migratedBuild.registry.content.ammo.legacy, 'legacy user content was lost');

const brokenLegacy = JSON.parse(JSON.stringify(legacy));
brokenLegacy.appearance.css = '.sh{height:999px!important}';
const quarantined = engine.migrateLegacyRegistry(brokenLegacy);
const quarantinedBuild = engine.buildRuntime(quarantined.packages, quarantined.user, quarantined.ops);
assert(quarantinedBuild.ok, 'legacy invalid CSS prevented safe migration');
assert(quarantined.ops.badBlocks['legacy-appearance-css'], 'legacy invalid CSS was not quarantined');

console.log(JSON.stringify({
  ok: true,
  version: '0.10.0',
  deterministic_build: true,
  precise_disable: true,
  user_state_separated: true,
  resource_conflict_rejected: true,
  package_style_ownership: true,
  explicit_core_replacement: true,
  legacy_migration: true,
  invalid_legacy_css_quarantined: true
}, null, 2));
