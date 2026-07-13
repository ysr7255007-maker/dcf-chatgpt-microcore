'use strict';

const { UI_KEY } = require('../core/constants');
const { commandList } = require('../runtime/commands');
const { classifyModule, modulesByRole } = require('../modules/module-roles');

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
      button{border:1px solid #9995;border-radius:9px;background:transparent;color:inherit;padding:6px 8px;cursor:pointer}button:hover{background:#8882}button.danger{border-color:#dc262666}.top{height:42px;flex:0 0 42px;display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #9993;box-sizing:border-box}.top b{margin-right:auto}.tabs{display:flex;gap:5px}.tabs button.on{background:#2563eb22;border-color:#2563eb66}.body{flex:1;min-height:0;overflow:auto;padding:9px;box-sizing:border-box}.card{border:1px solid #9994;border-radius:12px;background:#8881;padding:9px;margin-bottom:9px;box-sizing:border-box}.name{font-weight:700}.mini{font-size:11px;opacity:.7;word-break:break-all}.section-title{font-size:12px;font-weight:700;opacity:.8;margin:12px 2px 7px}.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}textarea,input,select{width:100%;box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:7px}textarea{min-height:120px}.notice{padding:6px 9px;border-bottom:1px solid #9993;font-size:12px}.notice:empty{display:none}.row{display:flex;gap:6px;align-items:center}.row>*{min-width:0}.grow{flex:1}.pkg{padding-top:8px;margin-top:8px;border-top:1px solid #9993}.receipt{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.health-healthy{border-color:#16a34a66}.health-warning{border-color:#d9770666}.health-error{border-color:#dc262666}.state-pill{font-size:10px;padding:2px 6px;border:1px solid #9995;border-radius:999px}.state-pill.daily{border-color:#16a34a66}.state-pill.maintenance{border-color:#2563eb66}
      details.card{padding:0}details.card>summary{list-style:none;cursor:pointer;padding:9px}details.card>summary::-webkit-details-marker{display:none}details.card>summary:before{content:'▸';display:inline-block;width:16px;opacity:.7}details.card[open]>summary:before{content:'▾'}details.card>.module-body,details.card>.detail-body{padding:0 9px 9px}.module-summary{display:flex;align-items:flex-start;gap:5px}.module-summary .grow{display:block}.module-summary .fold-hint{font-size:10px;opacity:.55;margin-left:auto}.health-count{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:6px}
    </style><style id="package-style"></style><aside class="sh"><div class="top"></div><div class="notice"></div><div class="body"></div></aside>`;
  doc.documentElement.appendChild(hostElement);
  const shell = root.querySelector('.sh');
  const top = root.querySelector('.top');
  const body = root.querySelector('.body');
  const notice = root.querySelector('.notice');
  const packageStyle = root.querySelector('#package-style');
  const initialSession = storage.get(UI_KEY, { tab: 'ammo', collapsed_modules: {} }) || {};
  let tab = initialSession.tab || 'ammo';
  let collapsedModules = initialSession.collapsed_modules && typeof initialSession.collapsed_modules === 'object' ? Object.assign({}, initialSession.collapsed_modules) : {};
  let packageDraft = '';
  let fenceFrame = 0;
  let capturing = false;

  function saveSession() {
    storage.set(UI_KEY, { tab, collapsed_modules: collapsedModules });
  }

  function setNotice(text) {
    notice.textContent = String(text || '');
    if (text) windowObject.setTimeout(() => { if (notice.textContent === text) notice.textContent = ''; }, 3200);
  }

  function runAndRender(action, successText) {
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        result.then((value) => {
          const failed = value && (value.ok === false || value.status === 'error' || value.status === 'rejected');
          setNotice(failed ? `操作失败${value.error ? `：${value.error}` : ''}` : successText);
          render();
        }).catch((error) => setNotice(`失败：${String(error && error.message || error)}`));
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
      <button data-tab="functions" class="${tab === 'functions' ? 'on' : ''}">功能</button>
      <button data-tab="packages" class="${tab === 'packages' ? 'on' : ''}">包管理</button>
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

  function moduleOrder(module) {
    const display = moduleDisplay(module);
    return Number(display.order != null ? display.order : module.order != null ? module.order : 1000);
  }

  function isCollapsed(module, role) {
    if (Object.prototype.hasOwnProperty.call(collapsedModules, module.id)) return collapsedModules[module.id] === true;
    return role === 'maintenance';
  }

  function renderModuleCards(modules, role, emptyText) {
    modules = modules.slice().sort((a, b) => moduleOrder(a) - moduleOrder(b) || String(a.id).localeCompare(String(b.id)));
    if (!modules.length) return `<div class="card mini">${escapeHtml(emptyText || '暂无功能')}</div>`;
    return modules.map((module) => {
      const display = moduleDisplay(module);
      const entries = commandList(module);
      const grouped = [];
      for (const entry of entries) {
        const blockTitle = entry.block && entry.block.title;
        if (blockTitle && !grouped.includes(blockTitle)) grouped.push(blockTitle);
      }
      const open = !isCollapsed(module, role);
      return `<details class="card module-card" data-module-id="${escapeHtml(module.id)}" data-module-role="${escapeHtml(role)}" ${open ? 'open' : ''}><summary class="module-summary"><span class="grow"><span class="name">${escapeHtml(display.title || module.title || module.id)}</span><br><span class="mini">${escapeHtml(module.version || '')} · ${escapeHtml(module.id)}</span></span><span class="fold-hint">${open ? '收起' : '展开'}</span></summary><div class="module-body">${grouped.length ? `<div class="mini">${grouped.map(escapeHtml).join(' · ')}</div>` : ''}<div class="actions">${entries.map((entry) => `<button data-action="module-command" data-module-id="${escapeHtml(module.id)}" data-command-id="${escapeHtml(entry.command.id)}">${escapeHtml(entry.command.label || entry.command.title || entry.command.id)}</button>`).join('') || '<span class="mini">无可执行命令</span>'}</div></div></details>`;
    }).join('');
  }

  function roleLabel(role) {
    return role === 'maintenance' ? '维护' : '日常';
  }

  function renderRoleManager() {
    const registry = engine.getRegistry();
    const currentRoot = engine.getRoot();
    const modules = registry.modules.filter((module) => module.kind !== 'ammo').slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const rows = modules.map((module) => {
      const display = moduleDisplay(module);
      const classification = classifyModule(currentRoot, registry, module);
      return `<div class="pkg" data-role-module-id="${escapeHtml(module.id)}"><div class="row"><span class="grow"><span class="name">${escapeHtml(display.title || module.title || module.id)}</span><br><span class="mini">${escapeHtml(module.id)} · ${escapeHtml(classification.source)}</span></span><span class="state-pill ${escapeHtml(classification.role)}">${escapeHtml(roleLabel(classification.role))}</span></div><div class="actions"><button data-action="module-role" data-module-id="${escapeHtml(module.id)}" data-module-role="daily">日常功能</button><button data-action="module-role" data-module-id="${escapeHtml(module.id)}" data-module-role="maintenance">维护工具</button></div></div>`;
    }).join('');
    return `<details class="card"><summary><span class="name">功能分区管理</span></summary><div class="detail-body"><div class="mini">这里只决定模块属于日常功能还是维护工具。界面密度由各模块卡片的展开与折叠处理，模块不会因显示偏好而消失。</div>${rows}</div></details>`;
  }

  function renderFunctions() {
    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());
    body.innerHTML = `<section data-runtime-section="daily"><div class="card"><div class="name">日常功能</div><div class="mini">主力能力始终保留入口；点击模块标题展开或收起具体操作。</div></div>${renderModuleCards(groups.daily, 'daily', '暂无日常功能')}</section>`;
  }

  function renderPackages() {
    const entries = packageManager.packages();
    body.innerHTML = `<div class="card"><div class="name">安装包管理</div><div class="mini">这里显示已安装包与版本；它和运行模块、日常功能、维护工具是不同层次。</div><textarea data-role="package-json">${escapeHtml(packageDraft)}</textarea><div class="actions"><button data-action="package-install">安装包</button><button data-action="package-update">检查 GitHub 更新</button></div></div><section data-runtime-section="packages">` + entries.map((entry) => {
      const revisions = Object.keys(entry.revisions || {}).sort();
      const required = packageManager.isRequired(entry.package_id);
      return `<div class="card" data-package-id="${escapeHtml(entry.package_id)}"><div class="name">${escapeHtml(entry.package_id)}${required ? ' · 核心' : ''}</div><div class="mini">active ${escapeHtml(entry.active_revision)} · ${entry.enabled === false ? 'disabled' : 'enabled'}</div><div class="actions">${required ? '' : `<button data-action="package-toggle" data-id="${escapeHtml(entry.package_id)}">${entry.enabled === false ? '启用' : '停用'}</button>`}<select data-role="package-revision" data-id="${escapeHtml(entry.package_id)}">${revisions.map((revision) => `<option ${revision === entry.active_revision ? 'selected' : ''}>${escapeHtml(revision)}</option>`).join('')}</select><button data-action="package-switch" data-id="${escapeHtml(entry.package_id)}">切换</button>${required ? '' : `<button data-action="package-uninstall" data-id="${escapeHtml(entry.package_id)}" class="danger">卸载</button>`}</div></div>`;
    }).join('') + '</section>';
  }

  function renderMaintenance() {
    const summary = maintenance.summary();
    const lastHealth = maintenance.lastHealthReport();
    const receipts = maintenance.receipts().slice(-8).reverse();
    const snapshots = maintenance.snapshots().slice().reverse();
    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());
    const healthStatus = lastHealth ? lastHealth.status : 'healthy';
    const deviationCount = lastHealth && Array.isArray(lastHealth.deviations) ? lastHealth.deviations.length : 0;
    body.innerHTML = `<div class="card health-${escapeHtml(healthStatus)}"><div class="name">一键 Runtime 体检</div><div class="mini">从真实浏览器现场核对脚本实例、存储、内存运行态、实际 DOM、ChatGPT 宿主连接和最近失败。正常项保持安静，只复制无法合理解释的 Runtime 偏差。</div>${lastHealth ? `<div class="health-count">上次结果：${escapeHtml(healthStatus)} · ${deviationCount} deviations</div>` : ''}<div class="actions"><button data-action="maintenance-health-copy">体检并复制</button></div></div>
      <section data-runtime-section="maintenance-tools"><div class="section-title">维护工具</div>${renderModuleCards(groups.maintenance, 'maintenance', '暂无维护工具')}</section>
      ${renderRoleManager()}
      <details class="card"><summary><span class="name">运行摘要</span></summary><div class="detail-body"><div class="receipt">${escapeHtml(JSON.stringify(summary, null, 2))}</div><div class="actions"><button data-action="maintenance-copy">复制简要诊断</button><button data-action="receipts-clear">清空回执</button></div></div></details>
      <details class="card"><summary><span class="name">最近回执</span></summary><div class="detail-body">${receipts.length ? receipts.map((item) => `<div class="receipt pkg">${escapeHtml(JSON.stringify(item, null, 2))}</div>`).join('') : '<div class="mini">暂无回执</div>'}</div></details>
      <details class="card"><summary><span class="name">状态快照</span></summary><div class="detail-body">${snapshots.length ? snapshots.map((item) => `<div class="pkg row"><span class="grow mini">r${item.revision} · ${escapeHtml(item.reason)}</span><button data-action="rollback" data-revision="${item.revision}">恢复</button></div>`).join('') : '<div class="mini">暂无快照</div>'}</div></details>`;
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

  function setModuleRole(moduleId, role) {
    const current = engine.getRoot().user.moduleDisplay && engine.getRoot().user.moduleDisplay[moduleId] || {};
    const next = Object.assign({}, current, {
      role,
      area: role === 'maintenance' ? 'maintenance' : 'work'
    });
    delete next.hidden;
    return engine.setUserPath(['moduleDisplay', moduleId], next);
  }

  function collectIds(selector, attribute) {
    return Array.from(root.querySelectorAll(selector)).map((node) => String(node.getAttribute(attribute) || '')).filter(Boolean);
  }

  function captureRuntimeViews() {
    const originalTab = tab;
    const originalScroll = body.scrollTop;
    const views = {};
    capturing = true;
    try {
      tab = 'packages'; render();
      views.packages = { entry_ids: collectIds('[data-runtime-section="packages"] [data-package-id]', 'data-package-id') };
      tab = 'functions'; render();
      views.functions = {
        module_ids: collectIds('[data-runtime-section="daily"] [data-module-id]', 'data-module-id'),
        collapsed_module_ids: collectIds('[data-runtime-section="daily"] details[data-module-id]:not([open])', 'data-module-id')
      };
      tab = 'maintenance'; render();
      views.maintenance = {
        module_ids: collectIds('[data-runtime-section="maintenance-tools"] [data-module-id]', 'data-module-id'),
        collapsed_module_ids: collectIds('[data-runtime-section="maintenance-tools"] details[data-module-id]:not([open])', 'data-module-id')
      };
    } finally {
      tab = originalTab;
      render();
      body.scrollTop = originalScroll;
      capturing = false;
    }
    const rect = shell.getBoundingClientRect();
    const style = typeof windowObject.getComputedStyle === 'function' ? windowObject.getComputedStyle(shell) : null;
    const viewport = windowObject.visualViewport ? { width: windowObject.visualViewport.width, height: windowObject.visualViewport.height, left: windowObject.visualViewport.offsetLeft || 0, top: windowObject.visualViewport.offsetTop || 0 } : { width: windowObject.innerWidth, height: windowObject.innerHeight, left: 0, top: 0 };
    const visible = !!(shell.isConnected && rect.width > 0 && rect.height > 0 && (!style || (style.display !== 'none' && style.visibility !== 'hidden')));
    const intersectsViewport = visible && rect.right > viewport.left && rect.bottom > viewport.top && rect.left < viewport.left + viewport.width && rect.top < viewport.top + viewport.height;
    return {
      schema: 'dcf.ui.runtime.snapshot.v1',
      host_count: doc.querySelectorAll('#dcf-chatgpt-microcore-host').length,
      host_connected: hostElement.isConnected,
      shadow_root_attached: hostElement.shadowRoot === root,
      shell_connected: shell.isConnected,
      shell_visible: visible,
      shell_intersects_viewport: intersectsViewport,
      shell_rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      current_tab: originalTab,
      tab_ids: collectIds('.tabs [data-tab]', 'data-tab'),
      version_text: String((top.querySelector('b') && top.querySelector('b').textContent) || ''),
      views
    };
  }

  root.addEventListener('input', (event) => {
    if (event.target && event.target.dataset.role === 'package-json') packageDraft = event.target.value;
  });

  root.addEventListener('toggle', (event) => {
    if (capturing) return;
    const details = event.target && event.target.closest && event.target.closest('details[data-module-id]');
    if (!details) return;
    collapsedModules[details.dataset.moduleId] = !details.open;
    saveSession();
  }, true);

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) {
      tab = button.dataset.tab;
      saveSession();
      render();
      return;
    }
    const action = button.dataset.action;
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
    else if (action === 'package-install') runAndRender(() => packageManager.installJson(packageDraft), '安装包已安装');
    else if (action === 'package-update') runAndRender(() => packageManager.checkUpdates(true), '更新检查完成');
    else if (action === 'package-toggle') {
      const entry = packageManager.packages().find((pkg) => pkg.package_id === button.dataset.id);
      runAndRender(() => packageManager.setEnabled(button.dataset.id, entry && entry.enabled === false), '安装包状态已更新');
    } else if (action === 'package-uninstall') runAndRender(() => packageManager.uninstall(button.dataset.id), '安装包已卸载');
    else if (action === 'package-switch') {
      const select = Array.from(root.querySelectorAll('select[data-role="package-revision"]')).find((entry) => entry.dataset.id === button.dataset.id);
      runAndRender(() => packageManager.switchRevision(button.dataset.id, select.value), '版本已切换');
    } else if (action === 'module-command') {
      const module = engine.getRegistry().modules.find((entry) => entry.id === button.dataset.moduleId);
      const found = module && commandList(module).find((entry) => String(entry.command.id) === String(button.dataset.commandId));
      if (module && found) runAndRender(() => commandRunner.execute(module, found.command, found.block), '命令已执行');
    } else if (action === 'module-role') {
      runAndRender(() => setModuleRole(button.dataset.moduleId, button.dataset.moduleRole), '功能分区已更新');
    } else if (action === 'maintenance-health-copy') runAndRender(() => maintenance.copyHealthReport(), 'Runtime 体检报告已复制');
    else if (action === 'maintenance-copy') runAndRender(() => maintenance.copySummary(), '简要诊断已复制');
    else if (action === 'receipts-clear') runAndRender(() => maintenance.clearReceipts(), '回执已清空');
    else if (action === 'rollback') runAndRender(() => maintenance.rollbackTo(Number(button.dataset.revision)), '状态已恢复');
  });

  windowObject.addEventListener('resize', scheduleFence, { passive: true });
  if (windowObject.visualViewport) {
    windowObject.visualViewport.addEventListener('resize', scheduleFence, { passive: true });
    windowObject.visualViewport.addEventListener('scroll', scheduleFence, { passive: true });
  }
  render();
  return { render, setNotice, captureRuntimeViews, destroy: () => hostElement.remove(), root, shell, hostElement };
}

module.exports = { createApp, computeFenceStyle };
