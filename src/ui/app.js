'use strict';

const { commandList } = require('../runtime/commands');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function computeFenceStyle(rect, viewport, margin = 12) {
  const originLeft = Number(viewport.left || 0);
  const originTop = Number(viewport.top || 0);
  const width = Math.min(Math.max(240, rect.width || 340), Math.max(240, viewport.width - margin * 2));
  const height = Math.min(Math.max(260, rect.height || 600), Math.max(260, viewport.height - margin * 2));
  const left = Math.min(Math.max(originLeft + margin, rect.left), Math.max(originLeft + margin, originLeft + viewport.width - width - margin));
  const top = Math.min(Math.max(originTop + margin, rect.top), Math.max(originTop + margin, originTop + viewport.height - height - margin));
  return { width, height, left, top };
}

function createApp(options) {
  const { engine, ammo, packageManager, maintenance, commandRunner, storage, version } = options;
  const doc = options.document || document;
  const windowObject = doc.defaultView || window;
  const hostElement = doc.createElement('div');
  hostElement.id = 'dcf-chatgpt-microcore-host';
  const root = hostElement.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style id="core-style">
      :host{all:initial}.sh{position:fixed;right:12px;bottom:var(--bottom,112px);top:auto;width:var(--w,340px);height:min(var(--h,800px),calc(100vh - 24px));z-index:2147483646;background:#fffffff2;color:#111;border:1px solid #9996;border-radius:14px;box-shadow:0 18px 44px #0002;font:13px system-ui;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column}
      .sh[data-side=left]{left:12px;right:auto}.sh[data-anchor=top]{top:var(--top,12px);bottom:auto}.sh[data-anchor=bottom]{bottom:var(--bottom,112px);top:auto}
      @media(prefers-color-scheme:dark){.sh{background:#171717ee;color:#eee}}
      button{border:1px solid #9995;border-radius:9px;background:transparent;color:inherit;padding:6px 8px;cursor:pointer}button:hover{background:#8882}button.danger{border-color:#dc262666}.top{height:42px;flex:0 0 42px;display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #9993;box-sizing:border-box}.top b{margin-right:auto}.tabs{display:flex;gap:5px}.tabs button.on{background:#2563eb22;border-color:#2563eb66}.body{flex:1;min-height:0;overflow:auto;padding:9px;box-sizing:border-box}.card{border:1px solid #9994;border-radius:12px;background:#8881;padding:9px;margin-bottom:9px;box-sizing:border-box}.name{font-weight:700}.mini{font-size:11px;opacity:.7;word-break:break-all}.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}textarea,input,select{width:100%;box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:7px}textarea{min-height:120px}.notice{padding:6px 9px;border-bottom:1px solid #9993;font-size:12px}.notice:empty{display:none}.row{display:flex;gap:6px;align-items:center}.row>*{min-width:0}.grow{flex:1}.pkg{padding-top:8px;margin-top:8px;border-top:1px solid #9993}.receipt{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}
    </style><style id="package-style"></style><aside class="sh"><div class="top"></div><div class="notice"></div><div class="body"></div></aside>`;
  doc.documentElement.appendChild(hostElement);
  const shell = root.querySelector('.sh');
  const top = root.querySelector('.top');
  const body = root.querySelector('.body');
  const notice = root.querySelector('.notice');
  const packageStyle = root.querySelector('#package-style');
  let tab = storage.get('dcf.ui.session.v1', { tab: 'ammo' }).tab || 'ammo';
  let packageDraft = '';
  let selectedSurface = storage.get('dcf.ui.session.v1', { selectedSurface: null }).selectedSurface || null;
  let fenceFrame = 0;

  function setNotice(text) {
    notice.textContent = String(text || '');
    if (text) windowObject.setTimeout(() => { if (notice.textContent === text) notice.textContent = ''; }, 3200);
  }

  function runAndRender(action, successText) {
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        result.then((value) => { const failed = value && (value.ok === false || value.status === 'error' || value.status === 'rejected'); setNotice(failed ? `操作失败${value.error ? `：${value.error}` : ''}` : successText); render(); });
      } else {
        setNotice(result && result.status === 'rejected' ? `失败：${result.error || (result.errors || []).join('; ')}` : successText);
        render();
      }
    } catch (error) {
      setNotice(`失败：${String(error && error.message || error)}`);
    }
  }

  function renderTop() {
    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class="tabs">
      <button data-tab="ammo" class="${tab === 'ammo' ? 'on' : ''}">弹药</button>
      <button data-tab="functions" class="${tab === 'functions' ? 'on' : ''}">功能</button><button data-tab="packages" class="${tab === 'packages' ? 'on' : ''}">模块</button>
      <button data-tab="maintenance" class="${tab === 'maintenance' ? 'on' : ''}">维护</button>
    </div>`;
  }

  function renderAmmo() {
    const items = ammo.items();
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    body.innerHTML = `<div class="card"><div class="name">语言弹药</div><div class="mini">自动提取、自动装填、更新与发射</div><div class="actions"><button data-action="ammo-extract">从当前对话提取</button><button data-action="ammo-mode">发射：${mode === 'send' ? '直接发送' : '填入输入框'}</button></div></div>` +
      (items.length ? items.map((item) => `<div class="card" data-ammo-id="${escapeHtml(item.id)}"><div class="name">${escapeHtml(item.title || item.id)}</div><div class="mini">${escapeHtml(item.purpose || item.id)}</div><div class="actions"><button data-action="ammo-fire">发射</button><button data-action="ammo-copy">复制</button><button data-action="ammo-update">更新</button><button data-action="ammo-delete" class="danger">删除</button></div></div>`).join('') : '<div class="card mini">弹药库为空。完成一次提取后，回复中的 DCF_AMMO 会自动装填。</div>');
  }

  function moduleDisplay(module) {
    return engine.getRegistry().moduleDisplay && engine.getRegistry().moduleDisplay[module.id] || {};
  }

  function moduleArea(module) {
    const display = moduleDisplay(module);
    return display.area || module.area || 'work';
  }

  function moduleOrder(module) {
    const display = moduleDisplay(module);
    return Number(display.order != null ? display.order : module.order != null ? module.order : 1000);
  }

  function visibleModules(modules) {
    return modules.filter((module) => moduleDisplay(module).hidden !== true).sort((a, b) => moduleOrder(a) - moduleOrder(b) || String(a.id).localeCompare(String(b.id)));
  }

  function renderModuleCards(modules) {
    modules = visibleModules(modules);
    if (!modules.length) return '<div class="card mini">暂无模块功能</div>';
    return modules.map((module) => {
      const display = moduleDisplay(module);
      const entries = commandList(module);
      const grouped = [];
      for (const entry of entries) {
        const blockTitle = entry.block && entry.block.title;
        if (blockTitle && !grouped.includes(blockTitle)) grouped.push(blockTitle);
      }
      return `<div class="card" data-module-id="${escapeHtml(module.id)}"><div class="name">${escapeHtml(display.title || module.title || module.id)}</div><div class="mini">${escapeHtml(module.version || '')}</div>${grouped.length ? `<div class="mini">${grouped.map(escapeHtml).join(' · ')}</div>` : ''}<div class="actions">${entries.map((entry) => `<button data-action="module-command" data-module-id="${escapeHtml(module.id)}" data-command-id="${escapeHtml(entry.command.id)}">${escapeHtml(entry.command.label || entry.command.title || entry.command.id)}</button>`).join('') || '<span class="mini">无可执行命令</span>'}</div></div>`;
    }).join('');
  }

  function renderFunctions() {
    const registry = engine.getRegistry();
    const surfaces = Object.values(registry.surfaces || {}).filter((surface) => surface.id !== 'dcf.ammo' && surface.content_type !== 'ammo' && surface.area !== 'maintenance').sort((a, b) => Number(a.order || 1000) - Number(b.order || 1000));
    if (surfaces.length && !surfaces.some((surface) => surface.id === selectedSurface)) selectedSurface = surfaces[0].id;
    const surface = surfaces.find((entry) => entry.id === selectedSurface) || null;
    const modules = registry.modules.filter((module) => {
      if (module.kind === 'ammo' || moduleArea(module) === 'maintenance') return false;
      if (!surface) return true;
      const display = moduleDisplay(module);
      if (display.surface_id || module.surface_id) return (display.surface_id || module.surface_id) === surface.id;
      return !surface.area || moduleArea(module) === surface.area;
    });
    const rail = surfaces.length ? `<div class="card actions">${surfaces.map((entry) => `<button data-action="surface-select" data-surface-id="${escapeHtml(entry.id)}" class="${entry.id === selectedSurface ? 'on' : ''}">${escapeHtml(entry.title || entry.id)}</button>`).join('')}</div>` : '';
    body.innerHTML = rail + renderModuleCards(modules);
  }

  function renderPackages() {
    const entries = packageManager.packages();
    body.innerHTML = `<div class="card"><div class="name">安装模块包</div><div class="mini">粘贴完整 dcf.module_pack.v1 JSON；对话与 GitHub 更新仍会自动进入同一事务。</div><textarea data-role="package-json">${escapeHtml(packageDraft)}</textarea><div class="actions"><button data-action="package-install">安装</button><button data-action="package-update">检查 GitHub 更新</button></div></div>` + entries.map((entry) => {
      const revisions = Object.keys(entry.revisions || {}).sort();
      const required = packageManager.isRequired(entry.package_id);
      return `<div class="card"><div class="name">${escapeHtml(entry.package_id)}${required ? ' · 核心' : ''}</div><div class="mini">active ${escapeHtml(entry.active_revision)} · ${entry.enabled === false ? 'disabled' : 'enabled'}</div><div class="actions">${required ? '' : `<button data-action="package-toggle" data-id="${escapeHtml(entry.package_id)}">${entry.enabled === false ? '启用' : '停用'}</button>`}<select data-role="package-revision" data-id="${escapeHtml(entry.package_id)}">${revisions.map((revision) => `<option ${revision === entry.active_revision ? 'selected' : ''}>${escapeHtml(revision)}</option>`).join('')}</select><button data-action="package-switch" data-id="${escapeHtml(entry.package_id)}">切换</button>${required ? '' : `<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">卸载</button>`}</div></div>`;
    }).join('');
  }

  function renderMaintenance() {
    const summary = maintenance.summary();
    const receipts = maintenance.receipts().slice(-8).reverse();
    const snapshots = maintenance.snapshots().slice().reverse();
    body.innerHTML = `<div class="card"><div class="name">运行状态</div><div class="receipt">${escapeHtml(JSON.stringify(summary, null, 2))}</div><div class="actions"><button data-action="maintenance-copy">复制诊断</button><button data-action="receipts-clear">清空回执</button></div></div>
      <div class="card"><div class="name">最近回执</div>${receipts.length ? receipts.map((item) => `<div class="receipt pkg">${escapeHtml(JSON.stringify(item, null, 2))}</div>`).join('') : '<div class="mini">暂无回执</div>'}</div>
      <div class="card"><div class="name">状态快照</div>${snapshots.length ? snapshots.map((item) => `<div class="pkg row"><span class="grow mini">r${item.revision} · ${escapeHtml(item.reason)}</span><button data-action="rollback" data-revision="${item.revision}">恢复</button></div>`).join('') : '<div class="mini">暂无快照</div>'}</div>` + renderModuleCards(engine.getRegistry().modules.filter((module) => moduleArea(module) === 'maintenance'));
  }

  function applyAppearance() {
    const appearance = engine.getRegistry().appearance;
    const vars = appearance.vars || {};
    for (const [key, value] of Object.entries(vars)) shell.style.setProperty(`--${key}`, String(value));
    shell.dataset.side = appearance.side === 'left' ? 'left' : 'right';
    shell.dataset.anchor = vars.anchor === 'top' ? 'top' : 'bottom';
    packageStyle.textContent = appearance.css || '';
    shell.style.left = ''; shell.style.top = ''; shell.style.right = ''; shell.style.bottom = '';
    scheduleFence();
  }

  function applyFence() {
    fenceFrame = 0;
    const viewport = windowObject.visualViewport ? { width: windowObject.visualViewport.width, height: windowObject.visualViewport.height, left: windowObject.visualViewport.offsetLeft || 0, top: windowObject.visualViewport.offsetTop || 0 } : { width: windowObject.innerWidth, height: windowObject.innerHeight, left: 0, top: 0 };
    shell.style.maxWidth = '';
    shell.style.maxHeight = '';
    const rect = shell.getBoundingClientRect();
    const target = computeFenceStyle(rect, viewport, 12);
    shell.style.maxWidth = `${target.width}px`;
    shell.style.maxHeight = `${target.height}px`;
    if (rect.left < viewport.left + 12 || rect.right > viewport.left + viewport.width - 12 || rect.top < viewport.top + 12 || rect.bottom > viewport.top + viewport.height - 12) {
      shell.style.left = `${target.left}px`;
      shell.style.top = `${target.top}px`;
      shell.style.right = 'auto';
      shell.style.bottom = 'auto';
    } else {
      shell.style.left = '';
      shell.style.top = '';
      shell.style.right = '';
      shell.style.bottom = '';
    }
  }

  function scheduleFence() {
    if (fenceFrame) return;
    fenceFrame = windowObject.requestAnimationFrame(applyFence);
  }

  function render() {
    renderTop();
    if (tab === 'functions') renderFunctions();
    else if (tab === 'packages') renderPackages();
    else if (tab === 'maintenance') renderMaintenance();
    else renderAmmo();
    applyAppearance();
  }

  root.addEventListener('input', (event) => {
    if (event.target && event.target.dataset.role === 'package-json') packageDraft = event.target.value;
  });

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) {
      tab = button.dataset.tab;
      storage.set('dcf.ui.session.v1', { tab, selectedSurface });
      render();
      return;
    }
    const action = button.dataset.action;
    if (action === 'surface-select') {
      selectedSurface = button.dataset.surfaceId;
      storage.set('dcf.ui.session.v1', { tab, selectedSurface });
      render();
      return;
    }
    const card = button.closest('[data-ammo-id]');
    const item = card ? ammo.items().find((entry) => entry.id === card.dataset.ammoId) : null;
    if (action === 'ammo-extract') runAndRender(() => ammo.requestExtract(), '提取请求已发送');
    else if (action === 'ammo-mode') {
      const current = engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
      runAndRender(() => engine.setUserPath(['preferences', 'ammo_fire_mode'], current === 'send' ? 'insert' : 'send'), '发射方式已更新');
    } else if (action === 'ammo-fire' && item) runAndRender(() => ammo.fire(item), '弹药已发射');
    else if (action === 'ammo-copy' && item) runAndRender(() => ammo.copy(item), '已复制');
    else if (action === 'ammo-update' && item) runAndRender(() => ammo.requestUpdate(item), '更新请求已发送');
    else if (action === 'ammo-delete' && item) runAndRender(() => engine.removeContent('ammo', item.id), '已删除');
    else if (action === 'package-install') runAndRender(() => packageManager.installJson(packageDraft), '模块已安装');
    else if (action === 'package-update') runAndRender(() => packageManager.checkUpdates(true), '更新检查完成');
    else if (action === 'package-toggle') {
      const entry = packageManager.packages().find((pkg) => pkg.package_id === button.dataset.id);
      runAndRender(() => packageManager.setEnabled(button.dataset.id, entry && entry.enabled === false), '模块状态已更新');
    } else if (action === 'package-uninstall') runAndRender(() => packageManager.uninstall(button.dataset.id), '模块已卸载');
    else if (action === 'package-switch') {
      const select = Array.from(root.querySelectorAll('select[data-role="package-revision"]')).find((entry) => entry.dataset.id === button.dataset.id);
      runAndRender(() => packageManager.switchRevision(button.dataset.id, select.value), '版本已切换');
    } else if (action === 'module-command') {
      const module = engine.getRegistry().modules.find((entry) => entry.id === button.dataset.moduleId);
      const found = module && commandList(module).find((entry) => String(entry.command.id) === String(button.dataset.commandId));
      if (module && found) runAndRender(() => commandRunner.execute(module, found.command, found.block), '命令已执行');
    } else if (action === 'maintenance-copy') runAndRender(() => maintenance.copySummary(), '诊断已复制');
    else if (action === 'receipts-clear') runAndRender(() => maintenance.clearReceipts(), '回执已清空');
    else if (action === 'rollback') runAndRender(() => maintenance.rollbackTo(Number(button.dataset.revision)), '状态已恢复');
  });

  windowObject.addEventListener('resize', scheduleFence, { passive: true });
  if (windowObject.visualViewport) {
    windowObject.visualViewport.addEventListener('resize', scheduleFence, { passive: true });
    windowObject.visualViewport.addEventListener('scroll', scheduleFence, { passive: true });
  }
  render();
  return { render, setNotice, destroy: () => hostElement.remove(), root, shell };
}

module.exports = { createApp, computeFenceStyle };
