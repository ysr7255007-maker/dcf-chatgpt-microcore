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
  const { engine, ammo, packageManager, maintenance, commandRunner, reconciler, storage, version } = options;
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
      button{border:1px solid #9995;border-radius:9px;background:transparent;color:inherit;padding:6px 8px;cursor:pointer}button:hover{background:#8882}button.danger{border-color:#dc262666}.top{height:42px;flex:0 0 42px;display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #9993;box-sizing:border-box}.top b{margin-right:auto}.tabs{display:flex;gap:5px}.tabs button.on{background:#2563eb22;border-color:#2563eb66}.body{flex:1;min-height:0;overflow:auto;padding:9px;box-sizing:border-box}.card{border:1px solid #9994;border-radius:12px;background:#8881;padding:9px;margin-bottom:9px;box-sizing:border-box}.name{font-weight:700}.mini{font-size:11px;opacity:.7;word-break:break-all}.section-title{font-size:12px;font-weight:700;opacity:.8;margin:12px 2px 7px}.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}textarea,input{width:100%;box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:7px}select{box-sizing:border-box;border:1px solid #9995;border-radius:9px;background:#fff8;color:inherit;padding:6px}textarea{min-height:120px}.notice{padding:6px 9px;border-bottom:1px solid #9993;font-size:12px}.notice:empty{display:none}.row{display:flex;gap:6px;align-items:center}.row>*{min-width:0}.grow{flex:1}.pkg{padding-top:8px;margin-top:8px;border-top:1px solid #9993}.receipt{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.health-healthy{border-color:#16a34a66}.health-warning{border-color:#d9770666}.health-error{border-color:#dc262666}.state-pill{font-size:10px;padding:2px 6px;border:1px solid #9995;border-radius:999px}.state-pill.daily{border-color:#16a34a66}.state-pill.maintenance{border-color:#2563eb66}
      details.card{padding:0}details.card>summary{list-style:none;cursor:pointer;padding:9px}details.card>summary::-webkit-details-marker{display:none}details.card>summary:before{content:'▸';display:inline-block;width:16px;opacity:.7}details.card[open]>summary:before{content:'▾'}details.card>.module-body,details.card>.detail-body{padding:0 9px 9px}.module-summary{display:flex;align-items:flex-start;gap:5px}.module-summary .grow{display:block}.module-summary .fold-hint{font-size:10px;opacity:.55;margin-left:auto}.health-count{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:6px}.package-toolbar{padding:8px}.package-toolbar>.row{align-items:flex-start}.package-toolbar>.row>button{white-space:nowrap}.package-install{margin-top:7px;border-top:1px solid #9993}.package-install>summary{cursor:pointer;padding-top:7px;font-size:11px;opacity:.75}.package-install>.detail-body{padding-top:7px}.package-list{padding:0 9px}.package-card{padding:8px 0;border-bottom:1px solid #9993}.package-card:last-child{border-bottom:0}.package-title-row{display:flex;align-items:center;gap:6px}.package-title-row .name{flex:1;min-width:0}.package-description{font-size:11px;line-height:1.35;opacity:.78;margin-top:2px}.package-id{margin-top:2px}.package-controls{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:6px}.package-controls select{width:auto;min-width:72px;max-width:118px;padding:4px 22px 4px 6px}.package-controls button{padding:4px 7px}.package-version{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;border:1px solid #9994;border-radius:8px}.state-pill.enabled{border-color:#16a34a66}.state-pill.disabled{border-color:#d9770666}.state-pill.required{border-color:#7c3aed66}
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
  let profileDraft = '';
  let fenceFrame = 0;

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

  function environmentViews() {
    const defaults = {
      ammo: { id: 'ammo', kind: 'content', tab_label: '弹药', title: '语言弹药', order: 10 },
      functions: { id: 'functions', kind: 'actions', tab_label: '功能', title: '日常功能', order: 20 },
      packages: { id: 'packages', kind: 'composition', tab_label: '构成', title: '期望环境构成', order: 30 },
      maintenance: { id: 'maintenance', kind: 'observation', tab_label: '维护', title: '环境观察与恢复', order: 40 }
    };
    const supplied = engine.getRegistry().uiViews || {};
    return Object.values(Object.assign({}, defaults, supplied)).filter((view) => ['ammo', 'functions', 'packages', 'maintenance'].includes(String(view.id))).sort((a, b) => Number(a.order || 1000) - Number(b.order || 1000));
  }

  function currentView() { return environmentViews().find((view) => String(view.id) === String(tab)) || environmentViews()[0]; }

  function renderTop() {
    const views = environmentViews();
    if (!views.some((view) => String(view.id) === String(tab))) tab = views[0] && views[0].id || 'ammo';
    top.innerHTML = `<b>DCF ${escapeHtml(version)}</b><div class="tabs">${views.map((view) => `<button data-tab="${escapeHtml(view.id)}" class="${tab === view.id ? 'on' : ''}">${escapeHtml(view.tab_label || view.title || view.id)}</button>`).join('')}</div>`;
  }

  function renderAmmo() {
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.ammo || {};
    const items = ammo.items();
    const mode = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
    body.innerHTML = `<div class="card"><div class="name">${escapeHtml(view.title || '语言弹药')}</div><div class="mini">${escapeHtml(view.description || '自动提取、自动装填、更新与发射')}</div><div class="actions"><button data-action="ammo-extract">从当前对话提取</button><button data-action="ammo-mode">发射：${mode === 'send' ? '直接发送' : '填入输入框'}</button></div></div>` +
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
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.functions || {};
    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());
    body.innerHTML = `<section data-runtime-section="daily"><div class="card"><div class="name">${escapeHtml(view.title || '日常功能')}</div><div class="mini">${escapeHtml(view.description || '主力能力始终保留入口；点击模块标题展开或收起具体操作。')}</div></div>${renderModuleCards(groups.daily, 'daily', '暂无日常功能')}</section>`;
  }

  function renderPackages() {
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

  function renderMaintenance() {
    const view = engine.getRegistry().uiViews && engine.getRegistry().uiViews.maintenance || {};
    const summary = maintenance.summary();
    const lastHealth = maintenance.lastHealthReport();
    const receipts = maintenance.receipts().slice(-8).reverse();
    const snapshots = maintenance.snapshots().slice().reverse();
    const groups = modulesByRole(engine.getRoot(), engine.getRegistry());
    const profileState = maintenance.profiles();
    const healthStatus = lastHealth ? lastHealth.status : 'healthy';
    const deviationCount = lastHealth && Array.isArray(lastHealth.deviations) ? lastHealth.deviations.length : 0;
    body.innerHTML = `<div class="card"><div class="name">${escapeHtml(view.title || '环境观察与恢复')}</div><div class="mini">${escapeHtml(view.description || '观察期望环境在真实浏览器 Runtime 中是否成立，并提供恢复入口。')}</div></div><div class="card health-${escapeHtml(healthStatus)}"><div class="name">一键 Runtime 体检</div><div class="mini">从真实浏览器现场核对脚本实例、存储、内存运行态、实际 DOM、ChatGPT 宿主连接和最近失败。正常项保持安静，只复制无法合理解释的 Runtime 偏差。</div>${lastHealth ? `<div class="health-count">上次结果：${escapeHtml(healthStatus)} · ${deviationCount} deviations</div>` : ''}<div class="actions"><button data-action="maintenance-health-copy">体检并复制</button></div></div>
      <section data-runtime-section="maintenance-tools"><div class="section-title">维护工具</div>${renderModuleCards(groups.maintenance, 'maintenance', '暂无维护工具')}</section>
      ${renderRoleManager()}
      <details class="card"><summary><span class="name">环境 Profile</span></summary><div class="detail-body"><div class="mini">Profile 保存包选择、政策和界面组织，不复制用户弹药正文。</div><div class="row"><input data-role="profile-title" placeholder="环境名称" value="${escapeHtml(profileDraft)}"><button data-action="profile-save">保存当前环境</button></div>${profileState.items.length ? profileState.items.map((profile) => `<div class="pkg row"><span class="grow mini">${escapeHtml(profile.title)} · ${profile.package_count} packages${profileState.active_id === profile.id ? ' · 当前' : ''}</span><button data-action="profile-activate" data-profile-id="${escapeHtml(profile.id)}">激活</button><button data-action="profile-remove" data-profile-id="${escapeHtml(profile.id)}" class="danger">删除</button></div>`).join('') : '<div class="mini">暂无环境 Profile</div>'}</div></details>
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
    const view = currentView();
    if (view.kind === 'actions' || view.id === 'functions') renderFunctions();
    else if (view.kind === 'composition' || view.id === 'packages') renderPackages();
    else if (view.kind === 'observation' || view.id === 'maintenance') renderMaintenance();
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
    return engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['moduleDisplay', moduleId] }, { value: next });
  }

  function collectIds(selector, attribute) {
    return Array.from(root.querySelectorAll(selector)).map((node) => String(node.getAttribute(attribute) || '')).filter(Boolean);
  }

  function captureRuntimeViews() {
    const originalTab = tab;
    const originalScroll = body.scrollTop;
    const views = {};
    try {
      tab = 'packages'; render();
      views.packages = { entry_ids: collectIds('[data-runtime-section="packages"] [data-package-id]', 'data-package-id') };
      tab = 'functions'; render();
      views.functions = {
        module_ids: collectIds('[data-runtime-section="daily"] > details.module-card[data-module-id]', 'data-module-id'),
        collapsed_module_ids: collectIds('[data-runtime-section="daily"] > details.module-card[data-module-id]:not([open])', 'data-module-id')
      };
      tab = 'maintenance'; render();
      views.maintenance = {
        module_ids: collectIds('[data-runtime-section="maintenance-tools"] > details.module-card[data-module-id]', 'data-module-id'),
        collapsed_module_ids: collectIds('[data-runtime-section="maintenance-tools"] > details.module-card[data-module-id]:not([open])', 'data-module-id')
      };
    } finally {
      tab = originalTab;
      render();
      body.scrollTop = originalScroll;
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
    if (event.target && event.target.dataset.role === 'profile-title') profileDraft = event.target.value;
  });

  root.addEventListener('click', (event) => {
    const moduleSummary = event.target.closest('details[data-module-id] > summary');
    if (moduleSummary) {
      const details = moduleSummary.parentElement;
      collapsedModules[details.dataset.moduleId] = details.open;
      saveSession();
      return;
    }

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
      const current = engine.getRoot().user.preferences && engine.getRoot().user.preferences.ammo_fire_mode || 'insert';
      runAndRender(() => engine.applyEnvironmentIntent({ type: 'environment.user.set', path: ['preferences', 'ammo_fire_mode'] }, { value: current === 'send' ? 'insert' : 'send' }), '发射方式已更新');
    } else if (action === 'ammo-fire' && item) runAndRender(() => ammo.fire(item), '弹药已发射');
    else if (action === 'ammo-copy' && item) runAndRender(() => ammo.copy(item), '已复制');
    else if (action === 'ammo-update' && item) runAndRender(() => ammo.requestUpdate(item), '更新请求已发送');
    else if (action === 'ammo-delete' && item) runAndRender(() => engine.applyEnvironmentIntent({ type: 'environment.resource.remove', resource_type: 'ammo', resource_id: item.id }), '已删除');
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
    else if (action === 'profile-save') runAndRender(() => maintenance.saveProfile(profileDraft || '当前环境'), '环境 Profile 已保存');
    else if (action === 'profile-activate') runAndRender(() => maintenance.activateProfile(button.dataset.profileId), '环境 Profile 已激活');
    else if (action === 'profile-remove') runAndRender(() => maintenance.removeProfile(button.dataset.profileId), '环境 Profile 已删除');
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
