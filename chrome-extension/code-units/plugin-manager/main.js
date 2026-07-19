(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.plugin-manager';
  const UNIT_VERSION = '1.0.0-rc.2-plugin-manager.2';
  const PANEL_ID = 'plugins';
  const HOST_ID = 'dcf-panel-plugins';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_PLUGIN_MANAGER__';
  const SHELL_UNIT_ID = 'dcf.firstparty.shell';
  const PANEL_BY_UNIT = {
    'dcf.firstparty.ammo': { panel_id: 'ammo', title: '语言弹药' },
    'dcf.firstparty.conversation-performance': { panel_id: 'performance', title: '长对话减负' },
    'dcf.firstparty.attribution': { panel_id: 'attribution', title: '问答性能归因' },
    'dcf.firstparty.appearance': { panel_id: 'appearance', title: '外观' },
    'dcf.firstparty.local-agent': { panel_id: 'local-agent', title: '本机 Agent' },
    'dcf.firstparty.backup': { panel_id: 'backup', title: '备份恢复' },
    'dcf.firstparty.plugin-manager': { panel_id: 'plugins', title: '功能' },
    'dcf.firstparty.diagnostics': { panel_id: 'diagnostics', title: '诊断' },
    'dcf.firstparty.runtime-evidence': { panel_id: 'runtime-evidence', title: 'Evidence' }
  };

  const send = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request');
    return result;
  });

  const previous = globalThis[GLOBAL_KEY];
  if (previous?.destroy) previous.destroy();

  let panel;
  let status = null;
  let notice = '';
  let shellState = { pinned_panels: ['ammo', 'plugins'], active_panel: null, panels: [] };
  let remembered = { pinned_panels: ['ammo', 'plugins'], active_panel: null };
  let shellStateListener;
  let shellReadyListener;
  let persistTimer = null;
  let restoring = true;

  const unique = (values) => Array.from(new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean)));
  const normalizeMemory = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    const pinned = unique(raw.pinned_panels).filter((id) => id !== 'plugins');
    pinned.push('plugins');
    return { pinned_panels: pinned.length > 1 ? pinned : ['ammo', 'plugins'], active_panel: String(raw.active_panel || '') || null };
  };

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit;min-width:0}.content{display:grid;gap:9px;min-width:0}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;min-width:0}.unit{padding:10px 0;border-top:1px solid #ddd;display:grid;gap:6px;min-width:0}.unit:first-child{border-top:0}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}.grow{flex:1;min-width:0}.title{font-weight:700;overflow-wrap:anywhere}.technical{font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#666;overflow-wrap:anywhere}.description{font-size:12px;color:#666}.badge{font-size:11px;border:1px solid #ccc;border-radius:999px;padding:2px 7px}.actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}button{font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 9px;min-width:0}.primary{background:#202124;color:#fff;border-color:#202124}.notice{min-height:18px;color:#666;overflow-wrap:anywhere}.locked{opacity:.72}@media(max-width:330px){.actions{grid-template-columns:1fr}}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}.unit{border-color:#444}button{background:#292929;color:#f3f3f3;border-color:#555}.primary{background:#f3f3f3;color:#181818}.technical,.notice,.description{color:#aaa}.badge{border-color:#555}}`;
  }

  function emitShellCommand(action, panelId, activate = true) {
    document.dispatchEvent(new CustomEvent('dcf:shell-command', { detail: JSON.stringify({ action, panel_id: panelId, activate }) }));
  }
  function queryShellState() { document.dispatchEvent(new CustomEvent('dcf:shell-query')); }
  function panelIsPinned(panelId) { return Array.isArray(shellState.pinned_panels) && shellState.pinned_panels.includes(panelId); }
  function currentSnapshot() { return status && (status.snapshots.current || status.snapshots.last_known_good); }

  async function loadMemory() {
    const [own, shell] = await Promise.all([
      send({ type: 'plugin.data.get', plugin_id: UNIT_ID }),
      send({ type: 'plugin.data.get', plugin_id: SHELL_UNIT_ID })
    ]);
    const ownData = own.data && typeof own.data === 'object' ? own.data : {};
    const shellData = shell.data && typeof shell.data === 'object' ? shell.data : {};
    remembered = normalizeMemory(Array.isArray(ownData.pinned_panels) ? ownData : shellData);
  }
  async function saveMemory(next = shellState) {
    remembered = normalizeMemory(next);
    await send({ type: 'plugin.data.set', plugin_id: UNIT_ID, data: remembered });
  }
  function scheduleMemorySave() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => saveMemory(shellState).catch(() => {}), 120);
  }

  function restoreRemembered() {
    const available = new Set((shellState.panels || []).map((item) => String(item.id || '')));
    const wanted = remembered.pinned_panels.filter((id) => id === 'plugins' || available.has(id));
    for (const id of wanted) if (id !== 'plugins') emitShellCommand('pin', id, false);
    const active = remembered.active_panel && wanted.includes(remembered.active_panel) ? remembered.active_panel : wanted[0] || 'plugins';
    setTimeout(() => emitShellCommand('activate', active, true), 80);
    setTimeout(() => { restoring = false; queryShellState(); }, 180);
  }

  function unitDescription(id) {
    const descriptions = {
      'dcf.firstparty.shell': 'DCF 可见外壳与工作区标签。',
      'dcf.firstparty.ammo': '语言弹药选择、发射、插入与便携库。',
      'dcf.firstparty.conversation-performance': '长对话渲染减负与历史窗口。',
      'dcf.firstparty.attribution': '记录下一轮问答的浏览器性能归因。',
      'dcf.firstparty.appearance': '调整 DCF 位置、宽度和高度。',
      'dcf.firstparty.local-agent': '连接本机 OpenCode，管理会话、任务和结果。',
      'dcf.firstparty.backup': '导出与恢复各插件数据。',
      'dcf.firstparty.plugin-manager': '功能启停、更新与标签固定入口。',
      'dcf.firstparty.diagnostics': '查看和复制隐私受限诊断。',
      'dcf.firstparty.runtime-evidence': '向本机 loopback 提供受白名单限制的只读运行证据。'
    };
    return descriptions[id] || '';
  }

  async function refresh() {
    status = await send({ type: 'host.status' });
    render();
    queryShellState();
  }

  function render() {
    if (!status || !panel) return;
    const root = panel.shadowRoot;
    const current = currentSnapshot();
    const units = Object.entries(status.code_units || {});
    root.querySelector('.content').innerHTML = `
      <section class="card">
        <div class="row"><b class="grow">DCF 功能库</b><button class="primary" data-action="update">检查 DCF 更新</button></div>
        <div class="description">标签栏只保留当前固定的工作区。固定状态会跨插件更新保留。</div>
        <div class="notice">${notice}</div>
      </section>
      <section class="card">
        ${units.map(([id, versions]) => {
          const ref = current?.entries?.find((entry) => entry.id === id);
          const enabled = Boolean(ref && ref.enabled !== false);
          const panelInfo = PANEL_BY_UNIT[id];
          const pinned = panelInfo ? panelIsPinned(panelInfo.panel_id) : false;
          const essential = id === SHELL_UNIT_ID || id === UNIT_ID;
          const title = panelInfo?.title || id.replace('dcf.firstparty.', '');
          return `<div class="unit ${essential ? 'locked' : ''}" data-unit-id="${id}">
            <div class="row"><span class="title grow">${title}</span>${essential ? '<span class="badge">核心入口</span>' : enabled ? '<span class="badge">已启用</span>' : '<span class="badge">已停用</span>'}</div>
            <div class="description">${unitDescription(id)}</div>
            <div class="technical">${ref ? `${ref.version} · ${ref.hash.slice(0, 12)}` : `已保存 ${versions.join(', ')}`}</div>
            ${essential ? '' : `<div class="actions"><button data-action="toggle" data-id="${id}" data-enabled="${enabled}">${enabled ? '停用功能' : '启用功能'}</button>${panelInfo ? `<button class="${pinned ? '' : 'primary'}" data-action="pin" data-id="${id}" data-panel-id="${panelInfo.panel_id}" data-enabled="${enabled}" data-pinned="${pinned}">${pinned ? '移出标签栏' : enabled ? '添加到标签栏' : '启用并添加'}</button>` : ''}</div>`}
          </div>`;
        }).join('') || '尚未安装功能插件'}
      </section>`;

    root.querySelector('[data-action="update"]').onclick = async () => {
      notice = '正在保存标签并检查更新…';
      render();
      await saveMemory(shellState);
      const result = await send({ type: 'host.check_all_updates' });
      notice = result.plugins?.ok === false ? `功能更新失败：${result.plugins.error}` : result.plugins?.status === 'current' ? 'DCF 已是最新版本' : '已取得更新，正在恢复工作区';
      await refresh();
    };

    for (const button of root.querySelectorAll('[data-action="toggle"]')) {
      button.onclick = async () => {
        const enabled = button.dataset.enabled === 'true';
        notice = `正在${enabled ? '停用' : '启用'} ${button.dataset.id}…`;
        render();
        await send({ type: 'host.set_unit_enabled', id: button.dataset.id, enabled: !enabled });
        if (enabled) {
          const info = PANEL_BY_UNIT[button.dataset.id];
          if (info && panelIsPinned(info.panel_id)) emitShellCommand('unpin', info.panel_id, false);
        }
        await refresh();
      };
    }

    for (const button of root.querySelectorAll('[data-action="pin"]')) {
      button.onclick = async () => {
        const pinned = button.dataset.pinned === 'true';
        const enabled = button.dataset.enabled === 'true';
        const panelId = button.dataset.panelId;
        if (pinned) {
          emitShellCommand('unpin', panelId, false);
          notice = '已移出标签栏，功能仍保持启用';
          render();
          return;
        }
        if (!enabled) {
          notice = `正在启用 ${button.dataset.id} 并添加到标签栏…`;
          render();
          await send({ type: 'host.set_unit_enabled', id: button.dataset.id, enabled: true });
        }
        emitShellCommand('pin', panelId, true);
        notice = '已添加到标签栏';
        render();
        setTimeout(queryShellState, 120);
      };
    }
  }

  function create() {
    panel = document.createElement('section');
    panel.id = HOST_ID;
    panel.dataset.dcfPanelRoot = 'true';
    panel.dataset.dcfPanelId = PANEL_ID;
    panel.dataset.dcfPanelTitle = '功能';
    panel.style.display = 'none';
    const root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${style()}</style><div class="content"></div>`;
    document.documentElement.append(panel);
    document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID }));
  }

  function destroy() {
    clearTimeout(persistTimer);
    if (shellStateListener) document.removeEventListener('dcf:shell-state', shellStateListener, true);
    if (shellReadyListener) document.removeEventListener('dcf:shell-ready', shellReadyListener, true);
    panel?.remove();
  }

  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy };

  try {
    document.getElementById(HOST_ID)?.remove();
    create();
    shellStateListener = (event) => {
      try {
        shellState = JSON.parse(String(event.detail || '{}'));
        render();
        if (!restoring) scheduleMemorySave();
      } catch (_) {}
    };
    shellReadyListener = () => setTimeout(() => { queryShellState(); setTimeout(restoreRemembered, 80); }, 80);
    document.addEventListener('dcf:shell-state', shellStateListener, true);
    document.addEventListener('dcf:shell-ready', shellReadyListener, true);
    loadMemory()
      .then(refresh)
      .then(() => { setTimeout(restoreRemembered, 220); return send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }); })
      .catch((error) => send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }));
  } catch (error) {
    destroy();
    send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
  }
})();
