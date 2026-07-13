from pathlib import Path
import json
import re

ROOT = Path('.')

def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

write('src/core/artifacts.js', r'''\
'use strict';

const { clone, hash, isObject } = require('./utils');

const BLOCKS = [
  { marker: 'DCF_AMMO', type: 'ammo' },
  { marker: 'DCF_MODULE_PACK', type: 'package' },
  { marker: 'DCF_PACKAGE_UPDATE', type: 'package-reference' }
];

function extractBlocks(text, marker) {
  const source = String(text || '');
  const startToken = `<<<${marker}`;
  const endToken = `${marker}>>>`;
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(startToken, cursor);
    if (start < 0) break;
    const end = source.indexOf(endToken, start + startToken.length);
    if (end < 0) break;
    const bodyStart = source.indexOf('{', start + startToken.length);
    if (bodyStart < 0 || bodyStart >= end) { cursor = end + endToken.length; continue; }
    blocks.push(source.slice(bodyStart, end).trim());
    cursor = end + endToken.length;
  }
  return blocks;
}

function normalizeAmmo(payload) {
  if (!isObject(payload) || !payload.id) throw new Error('DCF_AMMO requires id');
  const item = clone(payload);
  item.id = String(item.id);
  item.title = String(item.title || item.id);
  item.body = String(item.body || '');
  return {
    schema: 'dcf.artifact.v1',
    type: 'ammo',
    identity: `ammo:${item.id}:${hash(item)}`,
    logical_id: `ammo:${item.id}`,
    payload: item
  };
}

function normalizePackage(payload) {
  if (!isObject(payload) || !(payload.pack_id || payload.package_id) || !payload.revision) throw new Error('DCF_MODULE_PACK requires pack_id and revision');
  const pack = clone(payload);
  pack.pack_id = String(pack.pack_id || pack.package_id);
  pack.revision = String(pack.revision);
  pack.schema = pack.schema || 'dcf.module_pack.v1';
  const contentHash = hash(pack);
  return {
    schema: 'dcf.artifact.v1',
    type: 'package',
    identity: `package:${pack.pack_id}:${pack.revision}:${contentHash}`,
    logical_id: `package:${pack.pack_id}:${pack.revision}`,
    payload: pack
  };
}

function normalizePackageReference(payload) {
  if (!isObject(payload) || !(payload.package_id || payload.pack_id)) throw new Error('DCF_PACKAGE_UPDATE requires package_id');
  const reference = {
    schema: 'dcf.package.reference.v1',
    package_id: String(payload.package_id || payload.pack_id),
    target: String(payload.target || payload.revision || 'latest'),
    channel: String(payload.channel || 'stable')
  };
  if (payload.catalog_url) reference.catalog_url = String(payload.catalog_url);
  return {
    schema: 'dcf.artifact.v1',
    type: 'package-reference',
    identity: `package-reference:${hash(reference)}`,
    logical_id: `package-reference:${reference.package_id}:${reference.target}`,
    payload: reference
  };
}

function decodeArtifacts(text) {
  const artifacts = [];
  const errors = [];
  for (const block of BLOCKS) {
    for (const raw of extractBlocks(text, block.marker)) {
      const trimmed = raw.trim();
      if (!trimmed || /^(?:\.\.\.|…+|placeholder|example)$/i.test(trimmed)) continue;
      if (!trimmed.startsWith('{') || !/["'](?:schema|id|pack_id|package_id)["']\s*:/.test(trimmed)) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (block.type === 'ammo') artifacts.push(normalizeAmmo(payload));
        else if (block.type === 'package') artifacts.push(normalizePackage(payload));
        else artifacts.push(normalizePackageReference(payload));
      } catch (error) {
        errors.push({ marker: block.marker, error: String(error && error.message || error), preview: { redacted: true, length: raw.length, hash: hash(raw) } });
      }
    }
  }
  return { artifacts, errors };
}

module.exports = { decodeArtifacts, normalizeAmmo, normalizePackage, normalizePackageReference, extractBlocks };
''')

write('src/modules/catalog.js', r'''\
'use strict';

const { CATALOG_URL, CATALOG_STATE_KEY } = require('../core/constants');
const { compareRevision, hash, nowIso } = require('../core/utils');
const { normalizePackage } = require('../core/artifacts');

function createCatalogTransport(storage, engine, api = globalThis) {
  let applyResolved = (resolved) => engine.applyArtifact(resolved.artifact, resolved.source);

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof api.GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest unavailable'));
      api.GM_xmlhttpRequest({
        method: 'GET', url,
        onload(response) {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`HTTP ${response.status}`));
          try { resolve(JSON.parse(response.responseText)); } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('network timeout'))
      });
    });
  }

  function validateCatalog(catalog) {
    if (!catalog || catalog.schema !== 'dcf.catalog.v1' || !Array.isArray(catalog.packages)) throw new Error('invalid catalog');
    return catalog;
  }

  async function loadCatalog(options = {}) {
    const url = options.url || CATALOG_URL;
    return { url, catalog: validateCatalog(await requestJson(url)) };
  }

  function selectEntry(catalog, reference) {
    const packageId = String(reference.package_id || '');
    const channel = String(reference.channel || 'stable');
    const target = String(reference.target || 'latest');
    const matches = catalog.packages.filter((entry) => String(entry.package_id) === packageId && String(entry.channel || 'stable') === channel);
    if (!matches.length) throw new Error(`catalog package ${packageId} not found on ${channel}`);
    if (target !== 'latest' && target !== 'stable') {
      const exact = matches.find((entry) => String(entry.revision) === target);
      if (!exact) throw new Error(`catalog package revision ${packageId}@${target} not found`);
      return exact;
    }
    return matches.slice().sort((a, b) => compareRevision(b.revision, a.revision))[0];
  }

  async function resolveFromCatalog(catalogInfo, reference) {
    const entry = selectEntry(catalogInfo.catalog, reference);
    const pack = await requestJson(entry.url);
    const expected = String(entry.hash || '');
    const actual = hash(pack);
    if (expected && expected !== actual) throw new Error(`catalog hash mismatch ${entry.package_id}@${entry.revision}`);
    const artifact = normalizePackage(pack);
    if (artifact.payload.pack_id !== String(entry.package_id) || artifact.payload.revision !== String(entry.revision)) {
      throw new Error(`catalog identity mismatch ${entry.package_id}@${entry.revision}`);
    }
    return {
      schema: 'dcf.resolved.artifact.v1',
      input_mode: 'reference',
      artifact,
      reference: Object.assign({}, reference),
      catalog_entry: { package_id: entry.package_id, revision: entry.revision, channel: entry.channel || 'stable', hash: expected },
      source: { kind: 'github-catalog-reference', catalog_url: catalogInfo.url, package_url: entry.url }
    };
  }

  async function resolve(reference, options = {}) {
    if (reference.catalog_url && !options.url && reference.catalog_url !== CATALOG_URL) throw new Error('untrusted catalog_url');
    const catalogInfo = await loadCatalog({ url: options.url || reference.catalog_url || CATALOG_URL });
    return resolveFromCatalog(catalogInfo, reference);
  }

  async function check(options = {}) {
    const currentState = storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null });
    const minInterval = Number(options.minIntervalMs || 6 * 60 * 60 * 1000);
    if (!options.force && currentState.last_checked_at && Date.now() - Date.parse(currentState.last_checked_at) < minInterval) {
      return { ok: true, skipped: true, reason: 'interval' };
    }
    try {
      const catalogInfo = await loadCatalog({ url: options.url || CATALOG_URL });
      const installed = engine.getRoot().packages.packages;
      const applied = [];
      for (const local of Object.values(installed)) {
        if (!local || local.enabled === false) continue;
        let resolved;
        try {
          resolved = await resolveFromCatalog(catalogInfo, { package_id: local.package_id, target: 'latest', channel: 'stable' });
        } catch (error) {
          if (/not found/.test(String(error && error.message || error))) continue;
          throw error;
        }
        if (compareRevision(resolved.artifact.payload.revision, local.active_revision) <= 0) continue;
        const result = await Promise.resolve(applyResolved(resolved));
        applied.push({ package_id: local.package_id, revision: resolved.artifact.payload.revision, status: result && result.status || result && result.receipt && result.receipt.status || null });
      }
      const result = { ok: true, skipped: false, applied };
      storage.set(CATALOG_STATE_KEY, { last_checked_at: nowIso(), last_result: result });
      return result;
    } catch (error) {
      const result = { ok: false, error: String(error && error.message || error) };
      storage.set(CATALOG_STATE_KEY, { last_checked_at: nowIso(), last_result: result });
      return result;
    }
  }

  function setApplyResolved(handler) {
    if (typeof handler === 'function') applyResolved = handler;
  }

  return { check, resolve, loadCatalog, setApplyResolved };
}

module.exports = { createCatalogTransport };
''')

write('src/runtime/reconciler.js', r'''\
'use strict';

const { clone, nowIso } = require('../core/utils');

function createCapabilityReconciler(engine, catalog, receiptStore, options = {}) {
  let lastResult = null;

  function desiredState() {
    const packages = engine.getRoot().packages && engine.getRoot().packages.packages || {};
    return {
      schema: 'dcf.desired.capabilities.v1',
      state_revision: engine.getRoot().revision,
      packages: Object.values(packages).map((entry) => ({
        package_id: entry.package_id,
        active_revision: entry.active_revision,
        enabled: entry.enabled !== false
      })).sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)))
    };
  }

  function activationFor(artifact, status) {
    if (status !== 'committed') return 'none';
    if (artifact.type === 'package') return 'runtime-reprojected';
    if (artifact.type === 'ammo') return 'content-projected';
    return 'none';
  }

  function applyResolved(resolved, sourceOverride) {
    const artifact = resolved && resolved.artifact || resolved;
    if (!artifact || artifact.type === 'package-reference') throw new Error('resolved artifact must contain value payload');
    const source = sourceOverride || resolved && resolved.source || { kind: 'resolved-artifact' };
    const receipt = engine.applyArtifact(artifact, source);
    const result = {
      schema: 'dcf.reconcile.result.v1',
      at: nowIso(),
      input_mode: resolved && resolved.input_mode || 'value',
      artifact_type: artifact.type,
      package_id: artifact.type === 'package' ? artifact.payload.pack_id : null,
      revision: artifact.type === 'package' ? artifact.payload.revision : null,
      status: receipt.status,
      activation: activationFor(artifact, receipt.status),
      desired_state_revision: engine.getRoot().revision,
      receipt
    };
    lastResult = clone(result);
    if (receipt.status === 'committed' && typeof options.onCommitted === 'function') options.onCommitted(result);
    return result;
  }

  function rejectReference(artifact, source, error) {
    const message = String(error && error.message || error);
    const receipt = receiptStore.append({
      schema: 'dcf.receipt.v1',
      intent: { type: 'capability.reconcile', input_mode: 'reference', package_id: artifact.payload.package_id, target: artifact.payload.target, source: clone(source || {}) },
      status: 'rejected',
      stage: 'resolve',
      error: message
    });
    const result = {
      schema: 'dcf.reconcile.result.v1',
      at: nowIso(),
      input_mode: 'reference',
      artifact_type: 'package-reference',
      package_id: artifact.payload.package_id,
      revision: null,
      status: 'rejected',
      activation: 'none',
      desired_state_revision: engine.getRoot().revision,
      receipt
    };
    lastResult = clone(result);
    return result;
  }

  function accept(artifact, source = {}) {
    if (artifact.type !== 'package-reference') return applyResolved({ artifact, input_mode: 'value', source });
    return catalog.resolve(artifact.payload).then((resolved) => applyResolved(resolved)).catch((error) => rejectReference(artifact, source, error));
  }

  return {
    accept,
    applyResolved,
    desiredState,
    lastResult: () => clone(lastResult)
  };
}

module.exports = { createCapabilityReconciler };
''')

write('src/core/projection.js', r'''\
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
  const uiViews = {};
  const modules = [];
  const moduleDisplayDefaults = {};
  const settingDefaults = {};

  for (const [address, claim] of claims.entries()) {
    if (address === 'appearance-side') continue;
    if (address.startsWith('appearance-var:')) appearanceVars[address.slice(15)] = clone(claim.value);
    else if (address.startsWith('content-type:')) contentTypes[address.slice(13)] = clone(claim.value);
    else if (address.startsWith('surface:')) surfaces[address.slice(8)] = clone(claim.value);
    else if (address.startsWith('ui-view:')) uiViews[address.slice(8)] = clone(claim.value);
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
    uiViews,
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
''')

write('src/modules/standard-packages.js', r'''\
'use strict';

const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management'];

const STANDARD_PACKS = [
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.ammo',
    revision: '1.0.0',
    title: '语言弹药核心',
    description: '提供语言弹药内容、主入口和低摩擦发射能力。',
    contributes: {
      content_types: [{ id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy', 'update', 'delete'] }],
      surfaces: [{ id: 'dcf.ammo', title: '弹药', area: 'primary', order: 10, kind: 'content-list', content_type: 'ammo' }],
      appearance: { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } }
    },
    modules: [{ id: 'dcf.ammo.module', title: '语言弹药', version: '1.0.0', kind: 'ammo' }]
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.ui.package-management',
    revision: '1.0.0',
    title: '包管理界面',
    description: '提供可自更新的中文包总览、版本控制和安装入口。',
    contributes: {
      ui_views: [{
        id: 'packages',
        kind: 'package-management',
        tab_label: '包管理',
        title: '安装包管理',
        description: '中文名称和功能说明用于日常识别；英文 ID 仅保留为技术标识。',
        density: 'compact',
        show_technical_id: true,
        manual_install: 'folded',
        control_order: ['revision', 'switch', 'toggle', 'uninstall'],
        labels: {
          check_updates: '检查更新',
          manual_install: '手动安装包',
          install_json: '安装 JSON',
          package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON',
          switch_revision: '切换',
          enable: '启用',
          disable: '停用',
          uninstall: '卸载'
        },
        state_labels: { required: '核心', enabled: '已启用', disabled: '已停用' }
      }],
      styles: [{ id: 'package-management-compact', css: '.package-list.density-compact .package-card{padding:7px 0}.package-list.density-compact .package-description{line-height:1.3}' }]
    },
    modules: []
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.shell-adjuster',
    revision: '1.0.0',
    title: '壳体调节',
    description: '调整侧栏宽度、高度、边距和停靠方向。',
    modules: [{ id: 'dcf.standard.shell-adjuster', title: '壳体调节', version: '1.0.0', kind: 'shell-adjuster', blocks: [{ id: 'geometry', title: '壳体几何', commands: [
      { id: 'width_minus', label: '窄', steps: [{ call: 'appearance.adjust', with: { w: -20 } }] },
      { id: 'width_plus', label: '宽', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] },
      { id: 'height_minus', label: '矮', steps: [{ call: 'appearance.adjust', with: { h: -40 } }] },
      { id: 'height_plus', label: '高', steps: [{ call: 'appearance.adjust', with: { h: 40 } }] },
      { id: 'offset_minus', label: '靠近边缘', steps: [{ call: 'appearance.adjust', with: { offset: -10 } }] },
      { id: 'offset_plus', label: '远离边缘', steps: [{ call: 'appearance.adjust', with: { offset: 10 } }] },
      { id: 'top', label: '贴顶', steps: [{ call: 'appearance.adjust', with: { anchor: 'top' } }] },
      { id: 'bottom', label: '贴底', steps: [{ call: 'appearance.adjust', with: { anchor: 'bottom' } }] },
      { id: 'side', label: '换边', steps: [{ call: 'appearance.adjust', with: { side: 'toggle' } }] }
    ]}] }],
    contributes: { module_display: { 'dcf.standard.shell-adjuster': { area: 'maintenance', order: 20 } } }
  }
];

module.exports = { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES };
''')

write('src/modules/package-manager.js', r'''\
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
  'dcf.ui_visual_control': { title: '视觉布局控制', description: '调整 DCF 界面的视觉与布局表现。' }
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function unique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function activePack(entry) {
  const revision = entry && entry.active_revision;
  return entry && entry.revisions && entry.revisions[revision] && entry.revisions[revision].pack || null;
}

function packagePresentation(entry) {
  const pack = activePack(entry) || {};
  const modules = Array.isArray(pack.modules) ? pack.modules : [];
  const contributes = pack.contributes && typeof pack.contributes === 'object' ? pack.contributes : {};
  const surfaces = Array.isArray(contributes.surfaces) ? contributes.surfaces : [];
  const contentTypes = Array.isArray(contributes.content_types) ? contributes.content_types : [];
  const known = modules.map((module) => LEGACY_PRESENTATION[String(module && module.id || '')]).find(Boolean) || LEGACY_PRESENTATION[String(entry && entry.package_id || '')] || null;
  const explicitTitle = firstText(pack.title, pack.display_name, pack.name, pack.label);
  const moduleTitles = unique(modules.map((module) => module && module.title));
  const surfaceTitles = unique(surfaces.map((surface) => surface && surface.title));
  const contentTitles = unique(contentTypes.map((type) => type && type.title));

  let title = '';
  if (hasCjk(explicitTitle)) title = explicitTitle;
  else if (known) title = known.title;
  else if (moduleTitles.some(hasCjk)) title = moduleTitles.find(hasCjk);
  else if (surfaceTitles.some(hasCjk)) title = surfaceTitles.find(hasCjk);
  else if (contentTitles.some(hasCjk)) title = contentTitles.find(hasCjk);
  else if (modules.length) title = modules.some((module) => module && module.kind === 'ammo') ? '语言弹药功能包' : 'DCF 功能模块包';
  else if (surfaces.length) title = '界面入口扩展包';
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
  else if (moduleTitles.some(hasCjk)) description = `包含：${moduleTitles.filter(hasCjk).slice(0, 3).join('、')}。`;
  else if (surfaceTitles.some(hasCjk)) description = `提供「${surfaceTitles.filter(hasCjk).slice(0, 2).join('、')}」界面入口。`;
  else if (contentTitles.some(hasCjk)) description = `提供「${contentTitles.filter(hasCjk).slice(0, 2).join('、')}」内容类型。`;
  else description = '提供 DCF 的扩展功能；英文 ID 保留为技术标识。';

  return { title, description };
}

function createPackageManager(engine, catalog, reconciler) {
  function packages() {
    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => {
      const left = packagePresentation(a).title;
      const right = packagePresentation(b).title;
      return left.localeCompare(right, 'zh-CN') || String(a.package_id).localeCompare(String(b.package_id));
    });
  }
  function installJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    const wrapper = `<<<DCF_MODULE_PACK\n${JSON.stringify(parsed)}\nDCF_MODULE_PACK>>>`;
    const decoded = decodeArtifacts(wrapper);
    if (decoded.errors.length || decoded.artifacts.length !== 1) throw new Error(decoded.errors[0] && decoded.errors[0].error || 'invalid package');
    return reconciler ? reconciler.accept(decoded.artifacts[0], { kind: 'manual-json' }) : engine.applyArtifact(decoded.artifacts[0], { kind: 'manual-json' });
  }
  function assertMutable(id) {
    if (REQUIRED_PRODUCT_PACKAGES.includes(String(id))) throw new Error(`${id} is required by the DCF product value loop`);
  }
  return {
    packages,
    presentation: packagePresentation,
    installJson,
    setEnabled: (id, enabled) => { if (!enabled) assertMutable(id); return engine.setPackageEnabled(id, enabled); },
    uninstall: (id) => { assertMutable(id); return engine.uninstallPackage(id); },
    switchRevision: (id, revision) => engine.switchPackageRevision(id, revision),
    checkUpdates: (force) => catalog.check({ force: !!force }),
    isRequired: (id) => REQUIRED_PRODUCT_PACKAGES.includes(String(id))
  };
}

module.exports = { createPackageManager, packagePresentation, activePack, LEGACY_PRESENTATION };
''')

write('src/index.js', r'''\
'use strict';

const { VERSION } = require('./core/constants');
const { clone } = require('./core/utils');
const { buildProjection } = require('./core/projection');
const { loadOrMigrate, addPackRevision, finalizeCandidate } = require('./core/state');
const { decodeArtifacts } = require('./core/artifacts');
const { createReceiptStore } = require('./core/receipts');
const { createTransactionEngine } = require('./core/transactions');
const { createStorage } = require('./runtime/storage');
const { createEffectRunner } = require('./runtime/effects');
const { createCommandRunner } = require('./runtime/commands');
const { createCapabilityReconciler } = require('./runtime/reconciler');
const { createChatGPTHost } = require('./host/chatgpt');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('./modules/standard-packages');
const { createAmmoModule } = require('./modules/ammo');
const { createCatalogTransport } = require('./modules/catalog');
const { createPackageManager } = require('./modules/package-manager');
const { createHealthReporter } = require('./modules/health');
const { createMaintenanceModule } = require('./modules/maintenance');
const { createApp } = require('./ui/app');

function ensureProductBaseline(root) {
  let current = root;
  const projection = buildProjection(current);
  const candidate = clone(current);
  let changed = false;
  for (const packageId of REQUIRED_PRODUCT_PACKAGES) {
    const pack = STANDARD_PACKS.find((item) => item.pack_id === packageId);
    if (!pack) throw new Error(`required embedded package ${packageId} missing`);
    const entry = candidate.packages.packages[packageId];
    const resourceMissing = packageId === 'dcf.standard.ammo' && (!projection.ok || !projection.registry.contentTypes.ammo);
    const uiMissing = packageId === 'dcf.ui.package-management' && (!projection.ok || !projection.registry.uiViews || !projection.registry.uiViews.packages);
    if (!entry) {
      addPackRevision(candidate, pack, { kind: 'embedded-standard' });
      changed = true;
    } else if (entry.enabled === false || resourceMissing || uiMissing) {
      entry.enabled = true;
      candidate.packages.revision += 1;
      changed = true;
    }
  }
  return changed ? finalizeCandidate(current, candidate) : current;
}

function boot(api = globalThis) {
  const windowObject = api.window || (typeof window !== 'undefined' ? window : null);
  const storage = createStorage(api);
  const receiptStore = createReceiptStore(storage);
  let initialRoot = loadOrMigrate(storage, STANDARD_PACKS);
  initialRoot = ensureProductBaseline(initialRoot);
  const engine = createTransactionEngine(storage, receiptStore, { initialRoot });
  engine.initialize();
  const host = createChatGPTHost(windowObject);
  const effects = createEffectRunner(host, receiptStore);
  const catalog = createCatalogTransport(storage, engine, api);
  const ammo = createAmmoModule(engine, effects);
  let app = null;
  const reconciler = createCapabilityReconciler(engine, catalog, receiptStore, {
    onCommitted: () => { if (app) app.render(); }
  });
  catalog.setApplyResolved((resolved) => reconciler.applyResolved(resolved));
  const packageManager = createPackageManager(engine, catalog, reconciler);
  const health = createHealthReporter(engine, receiptStore, storage, host, REQUIRED_PRODUCT_PACKAGES, {
    windowObject,
    getApp: () => app,
    getRuntime: () => api.__DCF_RUNTIME__ || null
  });
  const maintenance = createMaintenanceModule(engine, receiptStore, effects, storage, health);
  const commandRunner = createCommandRunner(engine, effects, receiptStore, () => {
    if (!app || !app.shell) return null;
    const rect = app.shell.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
  app = createApp({ engine, ammo, packageManager, maintenance, commandRunner, storage, version: VERSION });

  async function processReply(reply) {
    const decoded = decodeArtifacts(reply.text);
    let changed = false;
    let referenced = false;
    for (const artifact of decoded.artifacts) {
      const result = await Promise.resolve(reconciler.accept(artifact, { kind: 'chatgpt-reply', completed_at: reply.completed_at }));
      if (result.status === 'committed') changed = true;
      if (result.input_mode === 'reference') referenced = true;
    }
    for (const error of decoded.errors) receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'artifact.decode', source: reply.source }, status: 'rejected', error: error.error, marker: error.marker, preview: error.preview });
    if (changed) app.setNotice(referenced ? 'DCF 已拉取并协调指定能力包' : 'DCF 工件已协调到当前 Runtime');
    if (changed || decoded.errors.length) app.render();
  }

  host.startReplyObserver((reply) => {
    processReply(reply).catch((error) => receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'reply.reconcile' }, status: 'rejected', stage: 'runtime', error: String(error && error.message || error) }));
  });
  api.setTimeout(() => catalog.check().then((result) => { if (result && result.applied && result.applied.length) { app.setNotice('DCF 能力包已自动协调到最新版本'); app.render(); } }), 1600);

  if (typeof api.GM_registerMenuCommand === 'function') {
    api.GM_registerMenuCommand('DCF：检查能力包更新', () => catalog.check({ force: true }).then(() => app.render()));
    api.GM_registerMenuCommand('DCF：一键 Runtime 体检并复制', () => maintenance.copyHealthReport());
    api.GM_registerMenuCommand('DCF：复制简要诊断', () => maintenance.copySummary());
  }

  api.__DCF_RUNTIME__ = { version: VERSION, engine, host, app, catalog, reconciler, receiptStore, health, maintenance };
  return api.__DCF_RUNTIME__;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot(globalThis);

module.exports = { boot, ensureProductBaseline };
''')

# Patch ui-view resource support.
resources = Path('src/core/resources.js').read_text(encoding='utf-8')
needle = "  for (const surface of Array.isArray(contributions.surfaces) ? contributions.surfaces : []) {\n    if (surface && surface.id) claims.push(normalizeClaim(`surface:${surface.id}`, surface, provider, 'exclusive', replaces));\n  }\n"
addition = needle + "  for (const view of Array.isArray(contributions.ui_views) ? contributions.ui_views : []) {\n    if (view && view.id) claims.push(normalizeClaim(`ui-view:${view.id}`, view, provider, 'exclusive', replaces));\n  }\n"
if needle not in resources:
    raise SystemExit('resources ui-view insertion anchor missing')
Path('src/core/resources.js').write_text(resources.replace(needle, addition, 1), encoding='utf-8')

# Patch app top tab and package-management view renderer.
app = Path('src/ui/app.js').read_text(encoding='utf-8')
render_top = r'''  function renderTop() {
    const packageView = engine.getRegistry().uiViews && engine.getRegistry().uiViews.packages || {};
    const packageTabLabel = packageView.tab_label || '包管理';
    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class="tabs">
      <button data-tab="ammo" class="${tab === 'ammo' ? 'on' : ''}">弹药</button>
      <button data-tab="functions" class="${tab === 'functions' ? 'on' : ''}">功能</button>
      <button data-tab="packages" class="${tab === 'packages' ? 'on' : ''}">${escapeHtml(packageTabLabel)}</button>
      <button data-tab="maintenance" class="${tab === 'maintenance' ? 'on' : ''}">维护</button>
    </div>`;
  }

  function renderAmmo'''
app, count = re.subn(r"  function renderTop\(\) \{.*?\n  \}\n\n  function renderAmmo", render_top, app, count=1, flags=re.S)
if count != 1:
    raise SystemExit('renderTop replacement failed')

render_packages = r'''  function renderPackages() {
    const entries = packageManager.packages();
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.packages || {};
    const labels = Object.assign({
      check_updates: '检查更新', manual_install: '手动安装包', install_json: '安装 JSON',
      package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON', switch_revision: '切换',
      enable: '启用', disable: '停用', uninstall: '卸载'
    }, view.labels || {});
    const stateLabels = Object.assign({ required: '核心', enabled: '已启用', disabled: '已停用' }, view.state_labels || {});
    const controlOrder = Array.isArray(view.control_order) && view.control_order.length ? view.control_order : ['revision', 'switch', 'toggle', 'uninstall'];
    const density = view.density === 'comfortable' ? 'comfortable' : 'compact';
    const manualInstall = view.manual_install !== false && view.manual_install !== 'hidden';
    const manualOpen = view.manual_install === 'open' ? 'open' : '';
    const installPanel = manualInstall ? `<details class="package-install" ${manualOpen}><summary>${escapeHtml(labels.manual_install)}</summary><div class="detail-body"><textarea data-role="package-json" placeholder="${escapeHtml(labels.package_json_placeholder)}">${escapeHtml(packageDraft)}</textarea><div class="actions"><button data-action="package-install">${escapeHtml(labels.install_json)}</button></div></div></details>` : '';
    body.innerHTML = `<div class="card package-toolbar"><div class="row"><span class="grow"><span class="name">${escapeHtml(view.title || '安装包管理')}</span><br><span class="mini">${escapeHtml(view.description || '包与 revision 的期望状态控制面。')}</span></span><button data-action="package-update">${escapeHtml(labels.check_updates)}</button></div>${installPanel}</div><section class="card package-list density-${density}" data-runtime-section="packages">` + entries.map((entry) => {
      const revisions = Object.keys(entry.revisions || {}).sort();
      const required = packageManager.isRequired(entry.package_id);
      const presentation = packageManager.presentation(entry);
      const enabled = entry.enabled !== false;
      const stateClass = required ? 'required' : enabled ? 'enabled' : 'disabled';
      const stateLabel = required ? stateLabels.required : enabled ? stateLabels.enabled : stateLabels.disabled;
      const controls = [];
      for (const control of controlOrder) {
        if (control === 'revision') {
          controls.push(revisions.length > 1
            ? `<select aria-label="选择版本" data-role="package-revision" data-id="${escapeHtml(entry.package_id)}">${revisions.map((revision) => `<option ${revision === entry.active_revision ? 'selected' : ''}>${escapeHtml(revision)}</option>`).join('')}</select>`
            : `<span class="package-version">v${escapeHtml(entry.active_revision)}</span>`);
        } else if (control === 'switch' && revisions.length > 1) {
          controls.push(`<button data-action="package-switch" data-id="${escapeHtml(entry.package_id)}">${escapeHtml(labels.switch_revision)}</button>`);
        } else if (control === 'toggle' && !required) {
          controls.push(`<button data-action="package-toggle" data-id="${escapeHtml(entry.package_id)}">${escapeHtml(enabled ? labels.disable : labels.enable)}</button>`);
        } else if (control === 'uninstall' && !required) {
          controls.push(`<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">${escapeHtml(labels.uninstall)}</button>`);
        }
      }
      return `<div class="package-card" data-package-id="${escapeHtml(entry.package_id)}"><div class="package-title-row"><span class="name">${escapeHtml(presentation.title)}</span><span class="state-pill ${stateClass}">${escapeHtml(stateLabel)}</span></div><div class="package-description">${escapeHtml(presentation.description)}</div>${view.show_technical_id === false ? '' : `<div class="mini package-id">${escapeHtml(entry.package_id)}</div>`}<div class="package-controls">${controls.join('')}</div></div>`;
    }).join('') + '</section>';
  }

  function renderMaintenance'''
app, count = re.subn(r"  function renderPackages\(\) \{.*?\n  \}\n\n  function renderMaintenance", render_packages, app, count=1, flags=re.S)
if count != 1:
    raise SystemExit('renderPackages replacement failed')
Path('src/ui/app.js').write_text(app, encoding='utf-8')

# Build includes reconciler.
build = Path('scripts/build-userscript.js').read_text(encoding='utf-8')
anchor = "  'src/runtime/commands.js',\n"
if anchor not in build:
    raise SystemExit('build module anchor missing')
build = build.replace(anchor, anchor + "  'src/runtime/reconciler.js',\n", 1)
build = build.replace('DCF modular runtime with foldable daily and maintenance views, browser Runtime deviation health checks, bounded reply intake and unified transactions.', 'DCF capability reconciler with value/reference artifacts, self-updating declarative views, Runtime health checks and bounded reply intake.')
Path('scripts/build-userscript.js').write_text(build, encoding='utf-8')

# Version.
constants = Path('src/core/constants.js').read_text(encoding='utf-8')
constants = re.sub(r"const VERSION = '[^']+';", "const VERSION = '0.12.0';", constants, count=1)
Path('src/core/constants.js').write_text(constants, encoding='utf-8')

package = json.loads(Path('package.json').read_text(encoding='utf-8'))
package['version'] = '0.12.0'
tests = package['scripts']['test']
insert = 'node tests/dcf-capability-reconciliation.unit.test.js && node tests/dcf-declarative-ui-package.unit.test.js && '
if 'dcf-capability-reconciliation.unit.test.js' not in tests:
    package['scripts']['test'] = insert + tests
Path('package.json').write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

write('tests/dcf-capability-reconciliation.unit.test.js', r'''\
'use strict';

const assert = require('assert');
const { createStorage } = require('../src/runtime/storage');
const { createReceiptStore } = require('../src/core/receipts');
const { createTransactionEngine } = require('../src/core/transactions');
const { createCapabilityReconciler } = require('../src/runtime/reconciler');
const { normalizeRoot } = require('../src/core/state');
const { decodeArtifacts, normalizePackage } = require('../src/core/artifacts');

const storage = createStorage({});
const receipts = createReceiptStore(storage);
const engine = createTransactionEngine(storage, receipts, { initialRoot: normalizeRoot({}) });
engine.initialize();

const remotePack = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.remote-test', revision: '2.0.0', title: '远程测试包', modules: [] };
const catalog = {
  resolve(reference) {
    assert.strictEqual(reference.package_id, 'dcf.remote-test');
    assert.strictEqual(reference.target, 'latest');
    return Promise.resolve({ schema: 'dcf.resolved.artifact.v1', input_mode: 'reference', artifact: normalizePackage(remotePack), source: { kind: 'test-catalog' } });
  }
};
let activations = 0;
const reconciler = createCapabilityReconciler(engine, catalog, receipts, { onCommitted: () => { activations += 1; } });

(async () => {
  const referenceText = `<<<DCF_PACKAGE_UPDATE\n${JSON.stringify({ package_id: 'dcf.remote-test', target: 'latest' })}\nDCF_PACKAGE_UPDATE>>>`;
  const decodedReference = decodeArtifacts(referenceText);
  assert.strictEqual(decodedReference.artifacts.length, 1);
  assert.strictEqual(decodedReference.artifacts[0].type, 'package-reference');
  const referenceResult = await reconciler.accept(decodedReference.artifacts[0], { kind: 'test-reply' });
  assert.strictEqual(referenceResult.schema, 'dcf.reconcile.result.v1');
  assert.strictEqual(referenceResult.input_mode, 'reference');
  assert.strictEqual(referenceResult.status, 'committed');
  assert.strictEqual(referenceResult.activation, 'runtime-reprojected');
  assert.strictEqual(engine.getRoot().packages.packages['dcf.remote-test'].active_revision, '2.0.0');

  const directPack = { schema: 'dcf.module_pack.v1', pack_id: 'dcf.direct-test', revision: '1.0.0', title: '直接测试包', modules: [] };
  const directText = `<<<DCF_MODULE_PACK\n${JSON.stringify(directPack)}\nDCF_MODULE_PACK>>>`;
  const directResult = reconciler.accept(decodeArtifacts(directText).artifacts[0], { kind: 'test-reply' });
  assert.strictEqual(directResult.input_mode, 'value');
  assert.strictEqual(directResult.status, 'committed');
  assert(reconciler.desiredState().packages.some((entry) => entry.package_id === 'dcf.direct-test'));
  assert.strictEqual(activations, 2);
  console.log(JSON.stringify({ ok: true, value_and_reference_inputs_unified: true, desired_state_derived_from_root: true, runtime_activation_callback: true }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
''')

write('tests/dcf-declarative-ui-package.unit.test.js', r'''\
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeRoot, addPackRevision, finalizeCandidate } = require('../src/core/state');
const { buildProjection } = require('../src/core/projection');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('../src/modules/standard-packages');
const { clone } = require('../src/core/utils');

let root = normalizeRoot({});
let candidate = clone(root);
for (const pack of STANDARD_PACKS) addPackRevision(candidate, pack, { kind: 'test' });
root = finalizeCandidate(root, candidate);
let projection = buildProjection(root);
assert(projection.ok, projection.errors.join('; '));
assert(REQUIRED_PRODUCT_PACKAGES.includes('dcf.ui.package-management'));
assert.strictEqual(projection.registry.uiViews.packages.kind, 'package-management');
assert.strictEqual(projection.registry.uiViews.packages.title, '安装包管理');
assert.strictEqual(projection.registry.build.resource_ownership['ui-view:packages'], 'dcf.ui.package-management@1.0.0');

candidate = clone(root);
const upgraded = clone(STANDARD_PACKS.find((pack) => pack.pack_id === 'dcf.ui.package-management'));
upgraded.revision = '1.1.0';
upgraded.contributes.ui_views[0].title = '能力包控制台';
upgraded.contributes.ui_views[0].labels.check_updates = '同步最新能力';
addPackRevision(candidate, upgraded, { kind: 'test-upgrade' });
root = finalizeCandidate(root, candidate);
projection = buildProjection(root);
assert(projection.ok, projection.errors.join('; '));
assert.strictEqual(projection.registry.uiViews.packages.title, '能力包控制台');
assert.strictEqual(projection.registry.uiViews.packages.labels.check_updates, '同步最新能力');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
assert(appSource.includes('engine.getRegistry().uiViews'), 'UI does not consume package-provided view resources');
assert(appSource.includes('view.control_order'), 'package view cannot control operation order');
assert(appSource.includes('view.labels'), 'package view cannot update visible labels');
console.log(JSON.stringify({ ok: true, package_owned_ui_view: true, ui_updates_by_package_revision: true, bootstrap_renderer_remains_declarative: true }, null, 2));
''')

# Documentation.
readme = Path('README.md').read_text(encoding='utf-8')
readme = readme.replace('DCF `0.11.6`', 'DCF `0.12.0`', 1)
readme = readme.replace('ChatGPT replies, manual package JSON, and the fixed GitHub catalog are transports into the same artifact and transaction path.', 'ChatGPT replies can carry complete `DCF_MODULE_PACK` values or `DCF_PACKAGE_UPDATE` references. Manual JSON and the fixed GitHub catalog are additional transports. All inputs resolve to one typed artifact and one capability-reconciliation transaction path.')
readme += '\n## Unified capability reconciliation\n\n`root.packages` is the authoritative desired capability set. A complete package is a by-value input; `DCF_PACKAGE_UPDATE` is a by-reference input resolved through the trusted catalog. Both enter the same resolver, immutable revision validation, atomic commit, Runtime reprojection and receipt path. The first package-owned declarative view is `dcf.ui.package-management`, so package-management text, control order and style can update as a package revision without changing the userscript bootstrap.\n'
Path('README.md').write_text(readme, encoding='utf-8')

arch = Path('docs/architecture-current.md').read_text(encoding='utf-8')
arch = arch.replace('Current release: `0.11.6`', 'Current release: `0.12.0`', 1)
arch = arch.replace('回复中的 `DCF_AMMO`、`DCF_MODULE_PACK`、手动 JSON 和固定 GitHub catalog 都先解码成 typed artifact，再进入同一事务。', '回复中的 `DCF_AMMO`、完整 `DCF_MODULE_PACK`、引用式 `DCF_PACKAGE_UPDATE`、手动 JSON 和固定 GitHub catalog 都先进入统一工件入口。完整包按值进入；更新控制按引用经 Resolver 取得完整包；随后统一进入 Reconciler、候选验证、原子提交与 Runtime 重投影。')
arch += '\n## 9. 统一能力重协调（0.12.0）\n\n`root.packages` 不再只被描述为安装记录，而是当前期望能力集合。安装、更新、启停、切换和回滚都是期望集合变化；registry 与 UI 是其 Runtime 投影。\n\n工件入口支持两种等价寻址：\n\n- `DCF_MODULE_PACK`：按值携带完整不可变 revision；\n- `DCF_PACKAGE_UPDATE`：按引用指定 package、target 与 channel，由固定 Catalog Resolver 拉取并校验。\n\n两者获得完整工件后进入同一个 `dcf.reconcile.result.v1` 路径。成功提交立即重建 registry，并触发当前 UI 重新渲染；失败不改变旧根。\n\n正常产品 UI 逐步由包声明的 `ui-view:*` 资源拥有。`dcf.ui.package-management` 是首个必需的声明式 UI 包，当前负责包管理页标题、文案、操作顺序、密度与样式。Core 只保留安全转义、稳定操作协议和最低恢复渲染器，不执行远程 JavaScript。\n'
Path('docs/architecture-current.md').write_text(arch, encoding='utf-8')

consensus = Path('docs/dcf-basic-consensus-prompt.md').read_text(encoding='utf-8')
consensus += '\nDCF 的正常演化单位是不可变能力包 revision，而不是整份 userscript。完整对话包是按值交付，`DCF_PACKAGE_UPDATE` 是按引用交付；两者必须经同一个 Resolver/Reconciler 改变 `root.packages` 期望能力集合并重建 Runtime。普通功能、文案、布局和声明式 UI 优先作为包资源更新；userscript 只为启动、存储、校验、Host、协调器与恢复边界升级。\n'
Path('docs/dcf-basic-consensus-prompt.md').write_text(consensus, encoding='utf-8')

skill = Path('docs/dcf-maintenance-skill.md').read_text(encoding='utf-8')
skill = skill.replace('外部 `DCF_AMMO`、`DCF_MODULE_PACK`、手动 JSON 和 GitHub catalog 都必须先解码成 typed artifact，再进入同一个事务。GitHub 只发现、下载和校验不可变 JSON，不参与 registry 合并，也不执行远程代码。', '外部 `DCF_AMMO`、完整 `DCF_MODULE_PACK`、引用式 `DCF_PACKAGE_UPDATE`、手动 JSON 和 GitHub catalog 都必须进入统一工件入口。完整包按值交付，更新控制按引用解析；取得完整不可变包后统一进入 Reconciler、候选验证、单根提交、Runtime 重投影与回执。GitHub 只解析可信 Catalog 引用、下载和校验 JSON，不执行远程代码。')
skill += '\n普通产品功能、中文文案、页面组织、控制顺序和样式变化优先修改对应能力包 revision，不得默认升级整份 userscript。只有包协议、Resolver/Reconciler、存储、Host Adapter、权限、启动与恢复边界无法由现有包资源表达时，才发布 bootstrap 版本。声明式 UI 使用 `ui-view:*` 资源，由 Core 的稳定安全渲染器消费。\n'
Path('docs/dcf-maintenance-skill.md').write_text(skill, encoding='utf-8')

current = Path('docs/current-state.md').read_text(encoding='utf-8')
current = re.sub(r'当前候选版本：`[^`]+`', '当前候选版本：`0.12.0`', current, count=1)
current += '\n## 0.12.0 统一能力重协调\n\n- `root.packages` 正式作为期望能力集合；安装、更新、启停、切换和回滚统一为期望状态变化。\n- 对话完整 `DCF_MODULE_PACK` 是按值输入；新增 `DCF_PACKAGE_UPDATE` 是按引用输入。\n- Catalog Resolver、手动 JSON 和对话输入统一进入 `dcf.reconcile.result.v1`，成功后原子提交并立即重投影 Runtime。\n- `dcf.ui.package-management` 成为必需的声明式 UI 包，拥有包管理页文案、密度、控制顺序和可覆盖样式。\n- 普通 UI/功能调整以后应升级对应包，不再默认发布 Tampermonkey userscript。\n- Core 继续禁止远程 JavaScript，只提供可信解析、事务、协调、Host 与恢复渲染边界。\n'
Path('docs/current-state.md').write_text(current, encoding='utf-8')

adr = r'''# ADR: Unified capability reconciliation and package-owned declarative UI

Date: 2026-07-13  
Status: accepted

## Context

DCF already accepted complete package values from ChatGPT replies and independently scanned a GitHub catalog for newer installed packages. These paths eventually called the same transaction engine, but resolution, control intent, activation and user-visible ownership remained separate. Normal UI changes still modified the userscript bootstrap, contradicting the low-friction self-update direction.

## Decision

1. Treat `root.packages` as the authoritative desired capability set. Do not add a second desired-state store.
2. Treat complete `DCF_MODULE_PACK` as by-value artifact input.
3. Add `DCF_PACKAGE_UPDATE` as by-reference artifact input with package ID, target and channel.
4. Resolve references through the trusted catalog into the same immutable package artifact used by by-value input.
5. Route manual JSON, reply artifacts, explicit references and catalog scans through one capability Reconciler. It performs apply, receives the atomic transaction receipt and exposes one `dcf.reconcile.result.v1` result.
6. Rebuild the Runtime projection after every committed package change and rerender the current UI. A failed resolve or candidate leaves the previous root and Runtime intact.
7. Add `ui-view:*` as a package resource. `dcf.ui.package-management` is the first required package-owned view. It controls visible text, density, operation order and style while Core retains safe rendering and recovery operations.
8. Keep remote JavaScript, eval and localStorage-as-code prohibited. Package-owned UI is declarative.
9. Upgrade the userscript only when the bootstrap boundary changes. Ordinary functions, presentation and declarative UI evolve through package revisions.

## Consequences

- Direct conversation delivery and GitHub-controlled delivery differ only before resolution.
- Package management can update its own normal presentation through the same package mechanism.
- Catalog auto-update and explicit single-package update share activation and receipts.
- The userscript remains a trusted bootstrap and recovery root rather than the normal product release unit.
- Structural UI capabilities remain limited to the declarative view schema supported by the bootstrap renderer; new schema primitives may still require a bootstrap upgrade.

## Reconsider when

- a required UI behavior cannot be represented safely by declarative resources;
- package lifecycle requires explicit deactivate/activate hooks beyond projection and rerender;
- catalog trust, signatures or multi-source resolution need a stronger resolver policy.
'''
write('docs/adr/2026-07-13-dcf-unified-capability-reconciliation.md', adr)

status = Path('docs/adr/status-index.md').read_text(encoding='utf-8')
current_anchor = '## Current\n\n'
line = '- `2026-07-13-dcf-unified-capability-reconciliation.md` — **accepted**\n'
if line not in status:
    status = status.replace(current_anchor, current_anchor + line, 1)
Path('docs/adr/status-index.md').write_text(status, encoding='utf-8')

print(json.dumps({'ok': True, 'version': '0.12.0', 'upgrade': 'unified-capability-reconciliation'}, ensure_ascii=False))
