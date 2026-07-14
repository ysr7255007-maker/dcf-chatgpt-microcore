'use strict';

const { decodeArtifacts } = require('../core/artifacts');
const { REQUIRED_PRODUCT_PACKAGES } = require('./standard-packages');

const LEGACY_PRESENTATION = {
  'dcf.ammo.module': { title: '语言弹药核心', description: '提供语言弹药内容、主入口和低摩擦发射能力。' },
  'dcf.ammo_workbench': { title: '弹药工作台', description: '提供语言弹药的创建、编辑和常用操作。' },
  'dcf.ammo_workspace.unified': { title: '统一弹药工作区', description: '集中浏览、整理和使用语言弹药。' },
  'dcf.language_ammo': { title: '语言弹药', description: '提供旧版语言弹药工作流的兼容能力。' },
  'dcf.ammo_library.dcf_kernel_maintenance': { title: 'DCF 内核维护', description: '提供语言弹药库与内核维护相关操作。' },
  'dcf.block_scanner': { title: '对话块扫描', description: '扫描并识别对话中的 DCF 工件块。' },
  'dcf.capability_gap_probe': { title: '能力缺口探针', description: '检查当前运行能力与预期能力之间的差异。' },
  'dcf.command_runtime_probe': { title: '命令运行探针', description: '检查模块命令在当前 Runtime 中的执行情况。' },
  'dcf.feedback_safety_probe': { title: '草稿保护探针', description: '检查反馈操作与输入框草稿保护是否可靠。' },
  'dcf.kernel_acceptance': { title: '内核验收', description: '执行 DCF 内核关键能力的验收检查。' },
  'dcf.maintenance_feedback': { title: '维护回馈', description: '生成维护流程需要的反馈信息。' },
  'dcf.module_authoring': { title: '模块作者工具', description: '辅助创建、检查和维护 DCF 模块包。' },
  'dcf.runtime_inspector': { title: '运行检查', description: '查看当前 DCF Runtime 的实际运行状态。' },
  'dcf.shell_adjuster': { title: '壳体调节（旧版）', description: '调整 DCF 侧栏的位置和尺寸。' },
  'dcf.standard.shell-adjuster': { title: '壳体调节', description: '调整侧栏宽度、高度、边距和停靠方向。' },
  'dcf.store_probe': { title: '存储探针', description: '检查 DCF 存储读写与状态恢复。' },
  'dcf.ui_siderail_control': { title: '侧栏控制', description: '调整 DCF 侧栏布局与停靠方式。' },
  'dcf.ui_visual_control': { title: '视觉布局控制', description: '调整 DCF 界面的视觉与布局表现。' },
  'dcf.ui.runtime-workspace': { title: '对话环境工作区', description: '提供功能与维护两种期望环境投影视图。' }
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function unique(values) { return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))); }
function hasCjk(value) { return /[\u3400-\u9fff]/.test(String(value || '')); }
function activePack(entry) { const revision = entry && entry.active_revision; return entry && entry.revisions && entry.revisions[revision] && entry.revisions[revision].pack || null; }


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

function packagePresentation(entry) {
  const pack = activePack(entry) || {};
  const modules = Array.isArray(pack.modules) ? pack.modules : [];
  const contributes = pack.contributes && typeof pack.contributes === 'object' ? pack.contributes : {};
  const surfaces = Array.isArray(contributes.surfaces) ? contributes.surfaces : [];
  const views = Array.isArray(contributes.ui_views) ? contributes.ui_views : [];
  const contentTypes = Array.isArray(contributes.content_types) ? contributes.content_types : [];
  const known = modules.map((module) => LEGACY_PRESENTATION[String(module && module.id || '')]).find(Boolean) || LEGACY_PRESENTATION[String(entry && entry.package_id || '')] || null;
  const explicitTitle = firstText(pack.title, pack.display_name, pack.name, pack.label);
  const moduleTitles = unique(modules.map((module) => module && module.title));
  const surfaceTitles = unique(surfaces.map((surface) => surface && surface.title));
  const viewTitles = unique(views.map((view) => view && (view.title || view.tab_label)));
  const contentTitles = unique(contentTypes.map((type) => type && type.title));
  let title = '';
  if (hasCjk(explicitTitle)) title = explicitTitle;
  else if (known) title = known.title;
  else if (moduleTitles.some(hasCjk)) title = moduleTitles.find(hasCjk);
  else if (viewTitles.some(hasCjk)) title = viewTitles.find(hasCjk);
  else if (surfaceTitles.some(hasCjk)) title = surfaceTitles.find(hasCjk);
  else if (contentTitles.some(hasCjk)) title = contentTitles.find(hasCjk);
  else if (modules.length) title = modules.some((module) => module && module.kind === 'ammo') ? '语言弹药功能包' : 'DCF 功能模块包';
  else if (views.length || surfaces.length) title = '界面入口扩展包';
  else if (contentTypes.length) title = '内容类型扩展包';
  else if (contributes.appearance) title = '界面外观扩展包';
  else title = 'DCF 扩展包';
  const explicitDescription = firstText(pack.description, pack.summary, pack.purpose);
  const moduleDescriptions = unique(modules.map((module) => firstText(module && module.description, module && module.summary, module && module.purpose)));
  const blockTitles = unique(modules.flatMap((module) => Array.isArray(module && module.blocks) ? module.blocks.map((block) => block && block.title) : []));
  const commandLabels = unique(modules.flatMap((module) => {
    const direct = Array.isArray(module && module.commands) ? module.commands : [];
    const blocked = Array.isArray(module && module.blocks) ? module.blocks.flatMap((block) => Array.isArray(block && block.commands) ? block.commands : []) : [];
    return direct.concat(blocked).map((command) => command && (command.label || command.title));
  }));
  let description = '';
  if (hasCjk(explicitDescription)) description = explicitDescription;
  else if (known) description = known.description;
  else if (moduleDescriptions.some(hasCjk)) description = moduleDescriptions.find(hasCjk);
  else if (blockTitles.some(hasCjk)) description = `功能包括：${blockTitles.filter(hasCjk).slice(0, 4).join('、')}。`;
  else if (commandLabels.some(hasCjk)) description = `提供：${commandLabels.filter(hasCjk).slice(0, 4).join('、')}${commandLabels.filter(hasCjk).length > 4 ? '等' : ''}。`;
  else if (viewTitles.some(hasCjk)) description = `提供「${viewTitles.filter(hasCjk).slice(0, 2).join('、')}」环境视图。`;
  else if (surfaceTitles.some(hasCjk)) description = `提供「${surfaceTitles.filter(hasCjk).slice(0, 2).join('、')}」界面入口。`;
  else if (contentTitles.some(hasCjk)) description = `提供「${contentTitles.filter(hasCjk).slice(0, 2).join('、')}」内容类型。`;
  else if (moduleTitles.some(hasCjk)) description = `包含：${moduleTitles.filter(hasCjk).slice(0, 3).join('、')}。`;
  else description = '提供 DCF 的扩展功能；英文 ID 保留为技术标识。';
  return { title, description };
}

function createPackageManager(engine, catalog, reconciler) {
  function sortedPackages() {
    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => packagePresentation(a).title.localeCompare(packagePresentation(b).title, 'zh-CN') || String(a.package_id).localeCompare(String(b.package_id)));
  }
  function status(entry) { return packageSupersessionStatus(entry, engine.getRegistry()); }
  function packages() { return sortedPackages().filter((entry) => !status(entry).fully_superseded); }
  function supersededPackages() { return sortedPackages().filter((entry) => status(entry).fully_superseded); }
  function installJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    const wrapper = `<<<DCF_MODULE_PACK\n${JSON.stringify(parsed)}\nDCF_MODULE_PACK>>>`;
    const decoded = decodeArtifacts(wrapper);
    if (decoded.errors.length || decoded.artifacts.length !== 1) throw new Error(decoded.errors[0] && decoded.errors[0].error || 'invalid package');
    return reconciler ? reconciler.accept(decoded.artifacts[0], { kind: 'manual-json' }) : engine.applyArtifact(decoded.artifacts[0], { kind: 'manual-json' });
  }
  function assertMutable(id) { if (REQUIRED_PRODUCT_PACKAGES.includes(String(id))) throw new Error(`${id} is required by the DCF product value loop`); }
  function intent(value, material) { return reconciler ? reconciler.acceptIntent(value, material) : engine.applyEnvironmentIntent(value, material); }
  return {
    packages,
    supersededPackages,
    supersessionStatus: status,
    environment: () => engine.getEnvironment(),
    presentation: packagePresentation,
    installJson,
    setEnabled: (id, enabled) => { if (!enabled) assertMutable(id); return intent({ type: 'environment.package.enable', package_id: id, enabled: !!enabled }); },
    uninstall: (id) => { assertMutable(id); return intent({ type: 'environment.package.remove', package_id: id }); },
    switchRevision: (id, revision) => intent({ type: 'environment.package.select', package_id: id, revision }),
    checkUpdates: (force) => catalog.check({ force: !!force }),
    isRequired: (id) => REQUIRED_PRODUCT_PACKAGES.includes(String(id))
  };
}

module.exports = { createPackageManager, packagePresentation, activePack, packageSupersessionStatus, LEGACY_PRESENTATION };
