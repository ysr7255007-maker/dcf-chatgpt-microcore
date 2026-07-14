from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)

# Version and test entry.
constants = read('src/core/constants.js').replace("const VERSION = '0.14.0';", "const VERSION = '0.15.0';")
write('src/core/constants.js', constants)

package = json.loads(read('package.json'))
package['version'] = '0.15.0'
needle = 'node tests/dcf-ammo-protocol.unit.test.js && '
if needle not in package['scripts']['test']:
    raise RuntimeError('package test insertion point missing')
package['scripts']['test'] = package['scripts']['test'].replace(needle, needle + 'node tests/dcf-module-supersession.unit.test.js && ', 1)
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')

# Generic exact-ID module supersession in Runtime projection.
projection = read('src/core/projection.js')
helper = r'''function resolveModuleSupersession(modules) {
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

'''
projection = replace_once(projection, 'function buildProjection(root) {', helper + 'function buildProjection(root) {', 'projection helper')
projection = replace_once(
    projection,
    "  modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));\n\n  const registry = {",
    "  modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));\n  const supersession = resolveModuleSupersession(modules);\n  if (!supersession.ok) return { ok: false, errors: supersession.errors, registry: null };\n  const runtimeModules = modules.filter((module) => !supersession.entries[String(module.id)]);\n\n  const registry = {",
    'projection runtime modules'
)
projection = replace_once(projection, '    modules,\n    moduleDisplay:', '    modules: runtimeModules,\n    moduleSupersession: { schema: \'dcf.runtime.module-supersession.v1\', entries: clone(supersession.entries) },\n    moduleDisplay:', 'projection registry field')
projection = replace_once(projection, 'build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership, resources: compiled.resourceGraph })', 'build_id: hash({ state_hash: root.state_hash, active: compiled.activePackages, ownership: compiled.ownership, resources: compiled.resourceGraph, module_supersession: supersession.entries })', 'projection build id')
projection = replace_once(projection, 'module.exports = { buildProjection };', 'module.exports = { buildProjection, resolveModuleSupersession };', 'projection exports')
write('src/core/projection.js', projection)

# Canonical ammo workbench package absorbs the useful old workbench roles and declares exact supersession.
packs = read('src/modules/standard-packages.js')
packs = packs.replace("revision: '1.2.0'", "revision: '1.3.0'", 1)
packs = packs.replace("title: '语言弹药核心'", "title: '语言弹药工作台'", 1)
packs = packs.replace("description: '提供语言弹药内容、语境化调用、实质更新和低摩擦发射能力。'", "description: '统一提供语言弹药的提取、新建、编辑、查找、语境化调用、实质更新与管理。'", 1)
packs = packs.replace("title: '语言弹药', description: '自动提取、自动装填、语境化调用与实质更新。', order: 10", "title: '语言弹药工作台', description: '在一个入口中提取、新建、编辑、查找、调用、更新和管理语言弹药。', order: 10, labels: { extract: '从当前对话提取', new_item: '新建弹药', search_placeholder: '查找标题、用途、标签或 ID', fire_mode: '发射', fire: '发射', copy: '复制', update: '更新', edit: '编辑', remove: '删除', save: '保存', cancel: '取消' }", 1)
packs = packs.replace("modules: [{ id: 'dcf.ammo.module', title: '语言弹药', version: '1.2.0', kind: 'ammo' }]", "modules: [{ id: 'dcf.ammo.module', title: '语言弹药工作台', version: '1.3.0', kind: 'ammo', supersedes: ['dcf.ammo_workbench', 'dcf.ammo_workspace.unified', 'dcf.language_ammo'] }]", 1)
write('src/modules/standard-packages.js', packs)

# Package manager separates active packages from packages whose only runtime module has been superseded.
pm = read('src/modules/package-manager.js')
insert = r'''
function hasNonModuleRuntimeContribution(pack) {
  const source = pack && typeof pack === 'object' ? pack : {};
  if (Array.isArray(source.resources) && source.resources.length) return true;
  const contributes = source.contributes && typeof source.contributes === 'object' ? source.contributes : {};
  for (const key of ['content_types', 'surfaces', 'ui_views', 'styles']) {
    if (Array.isArray(contributes[key]) && contributes[key].length) return true;
  }
  for (const key of ['appearance', 'settings', 'policies', 'content']) {
    if (contributes[key] && typeof contributes[key] === 'object' && Object.keys(contributes[key]).length) return true;
  }
  return false;
}

function packageSupersessionStatus(entry, registry) {
  const pack = activePack(entry) || {};
  const moduleIds = (Array.isArray(pack.modules) ? pack.modules : []).map((module) => String(module && module.id || '')).filter(Boolean);
  const map = registry && registry.moduleSupersession && registry.moduleSupersession.entries || {};
  const superseded = moduleIds.filter((id) => !!map[id]);
  const replacements = unique(superseded.map((id) => map[id] && map[id].by));
  return {
    fully_superseded: moduleIds.length > 0 && superseded.length === moduleIds.length && !hasNonModuleRuntimeContribution(pack),
    module_ids: moduleIds,
    superseded_module_ids: superseded,
    replacements
  };
}
'''
pm = replace_once(pm, 'function packagePresentation(entry) {', insert + '\nfunction packagePresentation(entry) {', 'package supersession helpers')
old_packages = "  function packages() {\n    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => packagePresentation(a).title.localeCompare(packagePresentation(b).title, 'zh-CN') || String(a.package_id).localeCompare(String(b.package_id)));\n  }"
new_packages = "  function sortedPackages() {\n    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => packagePresentation(a).title.localeCompare(packagePresentation(b).title, 'zh-CN') || String(a.package_id).localeCompare(String(b.package_id)));\n  }\n  function status(entry) { return packageSupersessionStatus(entry, engine.getRegistry()); }\n  function packages() { return sortedPackages().filter((entry) => !status(entry).fully_superseded); }\n  function supersededPackages() { return sortedPackages().filter((entry) => status(entry).fully_superseded); }"
pm = replace_once(pm, old_packages, new_packages, 'package list split')
pm = replace_once(pm, '    packages,\n    environment:', '    packages,\n    supersededPackages,\n    supersessionStatus: status,\n    environment:', 'package manager return')
pm = replace_once(pm, 'module.exports = { createPackageManager, packagePresentation, activePack, LEGACY_PRESENTATION };', 'module.exports = { createPackageManager, packagePresentation, activePack, packageSupersessionStatus, LEGACY_PRESENTATION };', 'package manager exports')
write('src/modules/package-manager.js', pm)

# Consolidated ammo workbench and folded historical package section.
app = read('src/ui/app.js')
app = replace_once(app, "  let profileDraft = '';", "  let profileDraft = '';\n  let ammoQuery = '';\n  let ammoDraft = null;", 'app ammo state')
start = app.index('  function renderAmmo() {')
end = app.index('\n  function moduleDisplay(module) {', start)
if start < 0 or end < 0:
    raise RuntimeError('renderAmmo block not found')
new_ammo = r'''  function ammoLabels(view) {
    return Object.assign({
      extract: '从当前对话提取', new_item: '新建弹药', search_placeholder: '查找标题、用途、标签或 ID',
      fire_mode: '发射', fire: '发射', copy: '复制', update: '更新', edit: '编辑', remove: '删除',
      save: '保存', cancel: '取消', id: 'ID', title: '标题', purpose: '用途', tags: '标签', body: '正文'
    }, view.labels || {});
  }

  function startAmmoDraft(item) {
    ammoDraft = {
      original_id: item && item.id || '',
      id: item && item.id || `ammo-${Date.now().toString(36)}`,
      title: item && item.title || '',
      purpose: item && item.purpose || '',
      tags: Array.isArray(item && item.tags) ? item.tags.join(', ') : '',
      body: item && item.body || ''
    };
  }

  function saveAmmoDraft() {
    if (!ammoDraft) throw new Error('没有待保存的弹药');
    const id = String(ammoDraft.id || '').trim();
    const bodyText = String(ammoDraft.body || '').trim();
    if (!id) throw new Error('弹药 ID 不能为空');
    if (!bodyText) throw new Error('弹药正文不能为空');
    const existing = ammoDraft.original_id ? ammo.items().find((entry) => entry.id === ammoDraft.original_id) : null;
    if (!ammoDraft.original_id && ammo.items().some((entry) => entry.id === id)) throw new Error(`弹药 ${id} 已存在`);
    const value = Object.assign({}, existing || {}, {
      id,
      title: String(ammoDraft.title || id).trim() || id,
      purpose: String(ammoDraft.purpose || '').trim(),
      body: bodyText
    });
    const tags = String(ammoDraft.tags || '').split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) value.tags = Array.from(new Set(tags));
    else delete value.tags;
    ammoDraft = null;
    return reconciler.acceptIntent({ type: 'environment.resource.upsert', resource_type: 'ammo', resource_id: id }, { value });
  }

  function renderAmmo() {
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.ammo || {};
    const labels = ammoLabels(view);
    const items = ammo.items();
    const query = String(ammoQuery || '').trim().toLocaleLowerCase();
    const visibleItems = query ? items.filter((item) => [item.id, item.title, item.purpose, Array.isArray(item.tags) ? item.tags.join(' ') : ''].join(' ').toLocaleLowerCase().includes(query)) : items;
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    const editor = ammoDraft ? `<div class="card ammo-editor"><div class="name">${escapeHtml(ammoDraft.original_id ? '编辑语言弹药' : '新建语言弹药')}</div><div class="mini">${escapeHtml(labels.id)}</div><input data-role="ammo-draft-id" value="${escapeHtml(ammoDraft.id)}" ${ammoDraft.original_id ? 'readonly' : ''}><div class="mini">${escapeHtml(labels.title)}</div><input data-role="ammo-draft-title" value="${escapeHtml(ammoDraft.title)}"><div class="mini">${escapeHtml(labels.purpose)}</div><input data-role="ammo-draft-purpose" value="${escapeHtml(ammoDraft.purpose)}"><div class="mini">${escapeHtml(labels.tags)}</div><input data-role="ammo-draft-tags" value="${escapeHtml(ammoDraft.tags)}"><div class="mini">${escapeHtml(labels.body)}</div><textarea data-role="ammo-draft-body">${escapeHtml(ammoDraft.body)}</textarea><div class="actions"><button data-action="ammo-save">${escapeHtml(labels.save)}</button><button data-action="ammo-cancel">${escapeHtml(labels.cancel)}</button></div></div>` : '';
    const search = items.length ? `<div class="card"><input data-role="ammo-search" placeholder="${escapeHtml(labels.search_placeholder)}" value="${escapeHtml(ammoQuery)}"><div class="mini">${query ? `显示 ${visibleItems.length} / ${items.length}` : `共 ${items.length} 枚弹药`}</div></div>` : '';
    body.innerHTML = `<div class="card"><div class="name">${escapeHtml(view.title || '语言弹药工作台')}</div><div class="mini">${escapeHtml(view.description || '在一个入口中提取、新建、编辑、查找、调用、更新和管理语言弹药。')}</div><div class="actions"><button data-action="ammo-extract">${escapeHtml(labels.extract)}</button><button data-action="ammo-new">${escapeHtml(labels.new_item)}</button><button data-action="ammo-mode">${escapeHtml(labels.fire_mode)}：${mode === 'send' ? '直接发送' : '填入输入框'}</button></div></div>${editor}${search}` +
      (visibleItems.length ? visibleItems.map((item) => `<div class="card" data-ammo-id="${escapeHtml(item.id)}"><div class="name">${escapeHtml(item.title || item.id)}</div><div class="mini">${escapeHtml(item.purpose || item.id)}</div><div class="actions"><button data-action="ammo-fire">${escapeHtml(labels.fire)}</button><button data-action="ammo-copy">${escapeHtml(labels.copy)}</button><button data-action="ammo-update">${escapeHtml(labels.update)}</button><button data-action="ammo-edit">${escapeHtml(labels.edit)}</button><button data-action="ammo-delete" class="danger">${escapeHtml(labels.remove)}</button></div></div>`).join('') : `<div class="card mini">${query ? '没有匹配的语言弹药。' : '弹药库为空。可以直接新建，或从当前对话提取。'}</div>`);
  }
'''
app = app[:start] + new_ammo + app[end:]

start = app.index('  function renderPackages() {')
end = app.index('\n  function renderMaintenance() {', start)
if start < 0 or end < 0:
    raise RuntimeError('renderPackages block not found')
new_packages_render = r'''  function renderPackages() {
    const entries = packageManager.packages();
    const supersededEntries = packageManager.supersededPackages();
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.packages || {};
    const labels = Object.assign({
      check_updates: '检查更新', manual_install: '手动安装包', install_json: '安装 JSON',
      package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON', switch_revision: '切换',
      enable: '启用', disable: '停用', uninstall: '卸载'
    }, view.labels || {});
    const stateLabels = Object.assign({ required: '核心', enabled: '已启用', disabled: '已停用', superseded: '已替代' }, view.state_labels || {});
    const controlOrder = Array.isArray(view.control_order) && view.control_order.length ? view.control_order : ['revision', 'switch', 'toggle', 'uninstall'];
    const density = view.density === 'comfortable' ? 'comfortable' : 'compact';
    const manualInstall = view.manual_install !== false && view.manual_install !== 'hidden';
    const manualOpen = view.manual_install === 'open' ? 'open' : '';
    const installPanel = manualInstall ? `<details class="package-install" ${manualOpen}><summary>${escapeHtml(labels.manual_install)}</summary><div class="detail-body"><textarea data-role="package-json" placeholder="${escapeHtml(labels.package_json_placeholder)}">${escapeHtml(packageDraft)}</textarea><div class="actions"><button data-action="package-install">${escapeHtml(labels.install_json)}</button></div></div></details>` : '';
    function packageCard(entry, retired) {
      const revisions = Object.keys(entry.revisions || {}).sort();
      const required = packageManager.isRequired(entry.package_id);
      const presentation = packageManager.presentation(entry);
      const enabled = entry.enabled !== false;
      const status = packageManager.supersessionStatus(entry);
      const stateClass = retired ? 'disabled' : required ? 'required' : enabled ? 'enabled' : 'disabled';
      const stateLabel = retired ? stateLabels.superseded : required ? stateLabels.required : enabled ? stateLabels.enabled : stateLabels.disabled;
      const controls = [];
      if (retired) {
        controls.push(`<span class="package-version">v${escapeHtml(entry.active_revision)}</span>`);
        if (!required) controls.push(`<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">${escapeHtml(labels.uninstall)}</button>`);
      } else {
        for (const control of controlOrder) {
          if (control === 'revision') {
            controls.push(revisions.length > 1
              ? `<select aria-label="选择版本" data-role="package-revision" data-id="${escapeHtml(entry.package_id)}">${revisions.map((revision) => `<option ${revision === entry.active_revision ? 'selected' : ''}>${escapeHtml(revision)}</option>`).join('')}</select>`
              : `<span class="package-version">v${escapeHtml(entry.active_revision)}</span>`);
          } else if (control === 'switch' && revisions.length > 1) controls.push(`<button data-action="package-switch" data-id="${escapeHtml(entry.package_id)}">${escapeHtml(labels.switch_revision)}</button>`);
          else if (control === 'toggle' && !required) controls.push(`<button data-action="package-toggle" data-id="${escapeHtml(entry.package_id)}">${escapeHtml(enabled ? labels.disable : labels.enable)}</button>`);
          else if (control === 'uninstall' && !required) controls.push(`<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">${escapeHtml(labels.uninstall)}</button>`);
        }
      }
      const replacement = retired && status.replacements.length ? `<div class="mini">由 ${escapeHtml(status.replacements.join('、'))} 替代</div>` : '';
      return `<div class="package-card" data-package-id="${escapeHtml(entry.package_id)}"><div class="package-title-row"><span class="name">${escapeHtml(presentation.title)}</span><span class="state-pill ${stateClass}">${escapeHtml(stateLabel)}</span></div><div class="package-description">${escapeHtml(presentation.description)}</div>${replacement}${view.show_technical_id === false ? '' : `<div class="mini package-id">${escapeHtml(entry.package_id)}</div>`}<div class="package-controls">${controls.join('')}</div></div>`;
    }
    const history = supersededEntries.length ? `<details class="card package-history"><summary><span class="name">已替代历史包（${supersededEntries.length}）</span></summary><div class="detail-body"><div class="mini">这些包的运行能力已经由当前完整实现接管，不再占用功能或维护入口。历史 revision 仍保留供恢复，也可以直接卸载。</div>${supersededEntries.map((entry) => packageCard(entry, true)).join('')}</div></details>` : '';
    body.innerHTML = `<div class="card package-toolbar"><div class="row"><span class="grow"><span class="name">${escapeHtml(view.title || '安装包管理')}</span><br><span class="mini">${escapeHtml(view.description || '包与 revision 的期望状态控制面。')}</span></span><button data-action="package-update">${escapeHtml(labels.check_updates)}</button></div>${installPanel}</div><section class="card package-list density-${density}" data-runtime-section="packages">${entries.map((entry) => packageCard(entry, false)).join('')}</section>${history}`;
  }
'''
app = app[:start] + new_packages_render + app[end:]

old_input = "  root.addEventListener('input', (event) => {\n    if (event.target && event.target.dataset.role === 'package-json') packageDraft = event.target.value;\n    if (event.target && event.target.dataset.role === 'profile-title') profileDraft = event.target.value;\n  });"
new_input = "  root.addEventListener('input', (event) => {\n    const role = event.target && event.target.dataset.role;\n    if (role === 'package-json') packageDraft = event.target.value;\n    if (role === 'profile-title') profileDraft = event.target.value;\n    if (role === 'ammo-search') {\n      ammoQuery = event.target.value;\n      renderAmmo();\n      const input = root.querySelector('[data-role=ammo-search]');\n      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }\n    }\n    if (ammoDraft && role && role.startsWith('ammo-draft-')) ammoDraft[role.slice('ammo-draft-'.length)] = event.target.value;\n  });"
app = replace_once(app, old_input, new_input, 'app input handler')
old_click = "    if (action === 'ammo-extract') runAndRender(() => ammo.requestExtract(), '提取请求已发送');"
new_click = "    if (action === 'ammo-new') { startAmmoDraft(null); render(); }\n    else if (action === 'ammo-edit' && item) { startAmmoDraft(item); render(); }\n    else if (action === 'ammo-save') runAndRender(() => saveAmmoDraft(), '语言弹药已保存');\n    else if (action === 'ammo-cancel') { ammoDraft = null; render(); }\n    else if (action === 'ammo-extract') runAndRender(() => ammo.requestExtract(), '提取请求已发送');"
app = replace_once(app, old_click, new_click, 'app ammo click handler')
write('src/ui/app.js', app)

# Existing protocol test follows the immutable new package revision.
protocol_test = read('tests/dcf-ammo-protocol.unit.test.js').replace("assert.strictEqual(ammoPack.revision, '1.2.0');", "assert.strictEqual(ammoPack.revision, '1.3.0');")
write('tests/dcf-ammo-protocol.unit.test.js', protocol_test)

# New regression coverage.
test = r'''\'use strict\';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { clone } = require('../src/core/utils');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { buildProjection, resolveModuleSupersession } = require('../src/core/projection');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');
const { createPackageManager } = require('../src/modules/package-manager');

const legacyIds = ['dcf.ammo_workbench', 'dcf.ammo_workspace.unified', 'dcf.language_ammo'];
const ammoPack = STANDARD_PACKS.find((pack) => pack.pack_id === 'dcf.standard.ammo');
assert(ammoPack, 'canonical ammo package missing');
assert.strictEqual(ammoPack.revision, '1.3.0');
assert.strictEqual(ammoPack.modules[0].title, '语言弹药工作台');
assert.deepStrictEqual(ammoPack.modules[0].supersedes, legacyIds);

let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
for (const id of legacyIds) {
  addPackRevision(candidate, { schema: 'dcf.module_pack.v1', pack_id: id, revision: 'legacy-1', modules: [{ id, title: id, version: 'legacy-1', commands: [{ id: 'old', label: '旧命令', steps: [] }] }] }, { kind: 'legacy-registry' });
}
addPackRevision(candidate, { schema: 'dcf.module_pack.v1', pack_id: 'example.similar-name', revision: '1', modules: [{ id: 'example.similar-name', title: '另一个弹药工作台', version: '1', commands: [] }] }, { kind: 'test' });
root = finalizeCandidate(root, candidate);
const built = buildProjection(root);
assert.strictEqual(built.ok, true, built.errors && built.errors.join('; '));
const ids = built.registry.modules.map((module) => module.id);
for (const id of legacyIds) assert(!ids.includes(id), `${id} remained in Runtime`);
assert(ids.includes('dcf.ammo.module'), 'canonical ammo workbench missing');
assert(ids.includes('example.similar-name'), 'title-similar unrelated module was incorrectly suppressed');
for (const id of legacyIds) assert.strictEqual(built.registry.moduleSupersession.entries[id].by, 'dcf.ammo.module');

const manager = createPackageManager({ getRoot: () => root, getRegistry: () => built.registry, getEnvironment: () => ({}) }, { check: () => null }, null);
const activePackageIds = manager.packages().map((entry) => entry.package_id);
const retiredPackageIds = manager.supersededPackages().map((entry) => entry.package_id);
for (const id of legacyIds) {
  assert(!activePackageIds.includes(id), `${id} remained in primary package list`);
  assert(retiredPackageIds.includes(id), `${id} missing from historical package list`);
}
assert(activePackageIds.includes('example.similar-name'));

const fallback = resolveModuleSupersession(legacyIds.map((id) => ({ id, supersedes: [] })));
assert.strictEqual(fallback.ok, true);
assert.deepStrictEqual(fallback.entries, {}, 'legacy modules must remain reachable when no replacement is active');
const conflict = resolveModuleSupersession([{ id: 'new-a', supersedes: ['old'] }, { id: 'new-b', supersedes: ['old'] }, { id: 'old' }]);
assert.strictEqual(conflict.ok, false, 'conflicting replacements were accepted');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
for (const marker of ['ammo-new', 'ammo-edit', 'ammo-search', 'saveAmmoDraft', 'package-history', 'supersededPackages']) assert(appSource.includes(marker), `workbench consolidation missing ${marker}`);

console.log(JSON.stringify({
  ok: true,
  exact_id_supersession: true,
  fallback_preserved: true,
  conflicts_rejected: true,
  canonical_ammo_workbench: true,
  direct_create_edit_search: true,
  historical_packages_folded: true
}, null, 2));
'''
# Fix the raw-string opening quote.
test = test.replace("\\'use strict\\';", "'use strict';", 1)
write('tests/dcf-module-supersession.unit.test.js', test)

# Docs.
readme = read('README.md')
readme = readme.replace('DCF `0.12.0` keeps a generic modular kernel', 'DCF `0.15.0` keeps a generic modular kernel', 1)
readme += '''\n\n## Canonical module supersession\n\nDCF `0.15.0` lets an active module declare exact predecessor module IDs through `supersedes`. A predecessor leaves normal Runtime views only while its replacement is active; similarly named modules are never inferred as duplicates. Packages whose only runtime module is superseded move from the primary package list into a folded historical section instead of being destructively deleted. `dcf.standard.ammo@1.3.0` uses this mechanism to replace the three migrated ammo workbenches with one complete language-ammunition workbench.\n'''
write('README.md', readme)

architecture = read('docs/architecture-current.md')
architecture = architecture.replace('Current release: `0.14.0`', 'Current release: `0.15.0`', 1)
architecture += '''\n\n## 12. 模块替代与工作台收口（0.15.0）\n\n模块重复不再通过中文标题或相似功能猜测。活动模块可以用 `supersedes` 声明被其完整接管的稳定旧 module ID；投影器验证冲突与循环后，从正常 Runtime modules 中移除已替代对象，并发布 `dcf.runtime.module-supersession.v1` 关系。替代模块不存在时，旧模块仍保持可达，作为恢复退路。\n\n包不会因替代而被自动删除。只有当一个包的全部运行模块均已被替代，且没有其他独立 content/view/style/policy 资源时，它才从包管理主列表移入折叠的“已替代历史包”区域。\n\n`dcf.standard.ammo@1.3.0` 将 `dcf.ammo_workbench`、`dcf.ammo_workspace.unified`、`dcf.language_ammo` 收口到 `dcf.ammo.module`。正式语言弹药工作台同时提供提取、新建、编辑、查找、语境化发射、复制、实质更新和删除；因此退出的是过渡入口，不是仍未接管的能力。\n'''
write('docs/architecture-current.md', architecture)

maintenance = read('docs/dcf-maintenance-skill.md')
maintenance += '''\n\n## 十一、重复能力与模块替代\n\n发现功能、维护或包管理中存在相似对象时，不得按中文标题去重。先比较稳定 module ID、命令集合、资源所有权和用户数据边界；只有一个活动实现已经完整接管另一个实现时，才由新模块显式声明 `supersedes`。\n\n替代前先吸收旧实现仍有价值的独有能力。替代关系必须使用精确 ID，冲突或循环在候选投影阶段失败。替代模块不在时旧模块继续可达；替代成立时旧模块退出功能、维护和分区管理，纯旧模块包移入折叠历史区，但不自动删除 revision 或用户成果。需要彻底删除时由用户在历史区显式卸载。\n'''
write('docs/dcf-maintenance-skill.md', maintenance)

consensus = read('docs/dcf-basic-consensus-prompt.md')
consensus += '''\n\n重复功能的消解采用显式替代关系，不用标题相似度猜测。完整接管者以稳定 ID 声明旧模块；先吸收仍有价值的独有能力，再让旧入口退出正常 Runtime。历史包保留恢复与显式卸载出口，用户内容不随模块替代删除。\n'''
write('docs/dcf-basic-consensus-prompt.md', consensus)

status = read('docs/adr/status-index.md')
status = status.replace('## Current\n', '## Current\n\n- `2026-07-14-dcf-canonical-module-supersession.md` — **accepted**\n', 1)
write('docs/adr/status-index.md', status)

adr = '''# ADR: Canonical module supersession and workbench consolidation\n\nDate: 2026-07-14  \nStatus: accepted\n\n## Context\n\nMigration deliberately kept legacy modules discoverable, but no exit condition existed after a complete replacement became active. The temporary compatibility rule therefore produced permanent duplicate entries in Functions, Maintenance role management and Package Management. Title-based deduplication would be unsafe because similar names do not prove equivalent commands or ownership.\n\n## Decision\n\n- An active module may declare exact predecessor IDs in `supersedes`.\n- Projection validates self-replacement, conflicting replacements and cycles.\n- A predecessor is omitted from normal Runtime modules only while a valid replacement is active.\n- Registry publishes the resolved relation as `dcf.runtime.module-supersession.v1`.\n- A package whose only runtime capability consists of superseded modules moves to a folded historical package section; it is not automatically deleted.\n- `dcf.standard.ammo@1.3.0` becomes the canonical `语言弹药工作台`, absorbs direct create/edit/search in addition to the existing value loop, and supersedes `dcf.ammo_workbench`, `dcf.ammo_workspace.unified` and `dcf.language_ammo`.\n\n## Boundaries\n\n- Similar titles never create a replacement relation.\n- Distinct helpers such as extraction or formatting remain unless explicitly audited and superseded.\n- User ammo and other user content are not package-owned and are never deleted by module consolidation.\n- Removing the canonical replacement restores legacy reachability from the still-installed historical package.\n'''
write('docs/adr/2026-07-14-dcf-canonical-module-supersession.md', adr)

current = read('docs/current-state.md')
current = current.replace('当前正式版本：`0.14.0`', '当前正式版本：`0.15.0`', 1)
current = current.replace('`0.14.0` 为语言弹药增加语境化调用标志和实质更新协议，并把协议下沉为 ammo package policy。', '`0.14.0` 为语言弹药增加语境化调用标志和实质更新协议，并把协议下沉为 ammo package policy。`0.15.0` 增加显式模块替代生命周期，把三个迁移期弹药工作台收口为一个完整工作台，并将纯历史包折叠收纳。', 1)
current = current.replace('- `dcf.standard.ammo@1.2.0` owns the `ammo_protocol` policy;', '- `dcf.standard.ammo@1.3.0` owns the `ammo_protocol` policy and canonical workbench supersession;', 1)
current += '''\n\n## 0.15.0 模块替代与语言弹药工作台收口\n\n- `dcf.ammo.module` 正式命名为“语言弹药工作台”，在一个页面提供提取、新建、编辑、查找、语境化发射、复制、实质更新和删除。\n- 它以精确 ID 替代 `dcf.ammo_workbench`、`dcf.ammo_workspace.unified`、`dcf.language_ammo`；这三个迁移期入口不再出现在功能、维护或分区管理中。\n- 旧包不会静默删除，而是折叠进包管理的“已替代历史包”，保留显式卸载和恢复出口。\n- 替代只按声明的稳定 ID 生效，名称相似的其他模块不受影响；自动提取、格式化等未确认等价的独立能力继续保留。\n- 用户浏览器尚未完成 0.15.0 的 Runtime 现场验收。\n'''
write('docs/current-state.md', current)

print(json.dumps({'ok': True, 'version': '0.15.0'}, ensure_ascii=False))
