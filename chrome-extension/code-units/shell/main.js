(function () {
  'use strict';
  const UNIT_ID = 'dcf.firstparty.shell';
  const UNIT_VERSION = '1.0.0-rc.2-shell.4';
  const HOST_ID = 'dcf-chrome-shell-host';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_SHELL__';
  const PANEL_SELECTOR = '[data-dcf-panel-root="true"]';
  const send = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request');
    return result;
  });

  const previous = globalThis[GLOBAL_KEY];
  const previousHost = document.getElementById(HOST_ID);
  if (previousHost?.shadowRoot) {
    for (const panelHost of previousHost.shadowRoot.querySelectorAll(PANEL_SELECTOR)) {
      panelHost.hidden = true;
      panelHost.style.setProperty('display', 'none', 'important');
      document.documentElement.append(panelHost);
    }
  }
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  let host;
  let observer;
  let panelListener;
  let panelResizeObserver;
  let activeId = null;
  let appearanceState = {};
  const panels = new Map();
  const cleanup = [];

  function setPanelVisible(record, visible) {
    if (!record || !record.host) return;
    record.host.hidden = !visible;
    record.host.style.setProperty('display', visible ? '' : 'none', 'important');
  }

  function releasePanels() {
    for (const record of panels.values()) {
      const panelHost = record && record.host;
      if (!(panelHost instanceof Element) || !panelHost.isConnected) continue;
      setPanelVisible(record, false);
      document.documentElement.append(panelHost);
    }
  }

  function destroy() {
    observer?.disconnect();
    panelResizeObserver?.disconnect();
    if (panelListener) document.removeEventListener('dcf:panel-ready', panelListener, true);
    for (const fn of cleanup.splice(0)) {
      try { fn(); } catch (_) {}
    }
    releasePanels();
    host?.remove();
    panels.clear();
  }
  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy };

  try {
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial;--dcf-width:380px;--dcf-top:72px;--dcf-height:680px;--dcf-margin:12px}
      .shell{position:fixed;z-index:2147483000;top:var(--dcf-top);right:var(--dcf-margin);width:min(var(--dcf-width),calc(100vw - 24px));height:min(var(--dcf-height),calc(100vh - var(--dcf-top) - 12px));background:#fafafa;color:#202124;border:1px solid #d6d6d6;border-radius:14px;box-shadow:0 14px 42px #0003;font:13px/1.45 system-ui;display:flex;flex-direction:column;overflow:hidden}.shell.left{left:var(--dcf-margin);right:auto}.shell.collapsed{width:auto;height:auto;min-width:168px}
      .head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#f0f0f0;border-bottom:1px solid #ddd}.brand{font-weight:700;flex:1}.status{font-size:11px;color:#666}.head button,.tabs button{border:0;background:transparent;cursor:pointer;color:inherit;font:inherit}.tabs{display:flex;gap:4px;padding:7px;overflow:auto;border-bottom:1px solid #e2e2e2;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tabs button{padding:6px 8px;border-radius:8px;white-space:nowrap}.tabs button.active{background:#202124;color:#fff}
      .body-wrap{position:relative;flex:1;min-height:0}.body{height:100%;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;padding:18px 10px;scrollbar-width:none}.body::-webkit-scrollbar{display:none}
      .scroll-hint{position:absolute;left:50%;z-index:4;transform:translateX(-50%);width:30px;height:18px;padding:0;border:0;border-radius:999px;background:rgba(32,33,36,.12);color:inherit;font:600 14px/18px system-ui;opacity:0;pointer-events:none;transition:opacity .16s ease,background .16s ease;cursor:pointer;backdrop-filter:blur(4px)}.scroll-hint.up{top:2px}.scroll-hint.down{bottom:2px}.scroll-hint.visible{opacity:.34;pointer-events:auto}.scroll-hint.visible:hover{opacity:.78;background:rgba(32,33,36,.2)}
      .shell.collapsed .tabs,.shell.collapsed .body-wrap{display:none!important}.empty{padding:24px;text-align:center;color:#777}
      @media(prefers-color-scheme:dark){.shell{background:#181818;color:#f3f3f3;border-color:#444}.head{background:#222;border-color:#444}.tabs{border-color:#444}.tabs button.active{background:#f3f3f3;color:#181818}.status,.empty{color:#aaa}.scroll-hint{background:rgba(255,255,255,.13)}.scroll-hint.visible:hover{background:rgba(255,255,255,.22)}}
    </style>`;

    const shell = document.createElement('section');
    shell.className = 'shell';
    const head = document.createElement('div');
    head.className = 'head';
    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.textContent = 'DCF';
    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = '已启动';
    const recovery = document.createElement('button');
    recovery.textContent = '维护';
    recovery.title = '恢复与诊断';
    const collapse = document.createElement('button');
    collapse.textContent = '收起';
    head.append(brand, status, recovery, collapse);

    const tabs = document.createElement('nav');
    tabs.className = 'tabs';
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'body-wrap';
    const body = document.createElement('main');
    body.className = 'body';
    const scrollUp = document.createElement('button');
    scrollUp.className = 'scroll-hint up';
    scrollUp.type = 'button';
    scrollUp.textContent = '⌃';
    scrollUp.setAttribute('aria-label', '向上滚动');
    const scrollDown = document.createElement('button');
    scrollDown.className = 'scroll-hint down';
    scrollDown.type = 'button';
    scrollDown.textContent = '⌄';
    scrollDown.setAttribute('aria-label', '向下滚动');
    bodyWrap.append(body, scrollUp, scrollDown);
    shell.append(head, tabs, bodyWrap);
    shadow.append(shell);
    document.documentElement.append(host);

    function updateScrollHints() {
      const max = Math.max(0, body.scrollHeight - body.clientHeight);
      scrollUp.classList.toggle('visible', max > 4 && body.scrollTop > 4);
      scrollDown.classList.toggle('visible', max > 4 && body.scrollTop < max - 4);
    }

    function scheduleScrollHints() {
      requestAnimationFrame(() => requestAnimationFrame(updateScrollHints));
    }

    function scrollBody(direction) {
      const distance = Math.max(140, Math.round(body.clientHeight * 0.72));
      body.scrollBy({ top: direction * distance, behavior: 'smooth' });
    }

    body.addEventListener('scroll', updateScrollHints, { passive: true });
    scrollUp.onclick = () => scrollBody(-1);
    scrollDown.onclick = () => scrollBody(1);
    cleanup.push(() => body.removeEventListener('scroll', updateScrollHints));

    panelResizeObserver = new ResizeObserver(scheduleScrollHints);
    panelResizeObserver.observe(body);

    function applyAppearance(raw) {
      const patch = raw && typeof raw === 'object' ? raw : {};
      appearanceState = { ...appearanceState, ...patch };
      const value = appearanceState;
      const viewportWidth = globalThis.visualViewport?.width || globalThis.innerWidth || 1280;
      const viewportHeight = globalThis.visualViewport?.height || globalThis.innerHeight || 800;
      const width = Math.max(280, Math.min(Number(value.width) || 380, viewportWidth - 24));
      const top = Math.max(8, Math.min(Number(value.top) || 72, viewportHeight - 120));
      const height = Math.max(240, Math.min(Number(value.height) || 680, viewportHeight - top - 12));
      const margin = Math.max(0, Math.min(Number(value.margin) || 12, 80));
      shell.style.setProperty('--dcf-width', `${width}px`);
      shell.style.setProperty('--dcf-top', `${top}px`);
      shell.style.setProperty('--dcf-height', `${height}px`);
      shell.style.setProperty('--dcf-margin', `${margin}px`);
      shell.classList.toggle('left', value.side === 'left');
      shell.classList.toggle('collapsed', value.collapsed === true);
      collapse.textContent = value.collapsed === true ? '展开' : '收起';
      scheduleScrollHints();
    }

    async function saveShellState(patch) {
      const current = await send({ type: 'plugin.data.get', plugin_id: UNIT_ID });
      const next = Object.assign({}, current.data || {}, patch || {});
      await send({ type: 'plugin.data.set', plugin_id: UNIT_ID, data: next });
      return next;
    }

    function activate(id) {
      if (!panels.has(id)) return;
      activeId = id;
      for (const [panelId, record] of panels) {
        record.button.classList.toggle('active', panelId === id);
        setPanelVisible(record, panelId === id);
      }
      saveShellState({ active_panel: id }).catch(() => undefined);
      scheduleScrollHints();
    }

    function registerPanel(panelHost) {
      if (!(panelHost instanceof Element)) return;
      const id = String(panelHost.dataset.dcfPanelId || '').trim();
      if (!id || panels.get(id)?.host === panelHost) return;
      const old = panels.get(id);
      const wasActive = activeId === id;
      old?.button.remove();
      if (old?.host && old.host !== panelHost) {
        panelResizeObserver.unobserve(old.host);
        old.host.remove();
      }
      const button = document.createElement('button');
      button.textContent = panelHost.dataset.dcfPanelTitle || id;
      button.onclick = () => activate(id);
      const record = { button, host: panelHost };
      setPanelVisible(record, false);
      panels.set(id, record);
      tabs.append(button);
      body.append(panelHost);
      panelResizeObserver.observe(panelHost);
      if (wasActive || !activeId || !panels.has(activeId)) activate(id);
      else scheduleScrollHints();
    }

    function scanPanels(root = document) {
      if (root.matches?.(PANEL_SELECTOR)) registerPanel(root);
      for (const panel of root.querySelectorAll?.(PANEL_SELECTOR) || []) registerPanel(panel);
      if (!panels.size) body.innerHTML = '<div class="empty">正在等待 DCF 功能插件…</div>';
      else body.querySelector('.empty')?.remove();
      scheduleScrollHints();
    }

    panelListener = (event) => {
      const id = event && event.detail && String(event.detail);
      const found = id ? document.querySelector(`${PANEL_SELECTOR}[data-dcf-panel-id="${CSS.escape(id)}"]`) : null;
      if (found) registerPanel(found);
      else scanPanels();
    };
    document.addEventListener('dcf:panel-ready', panelListener, true);
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) scanPanels(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    collapse.onclick = async () => {
      const collapsed = !shell.classList.contains('collapsed');
      await saveShellState({ collapsed });
      applyAppearance({ collapsed });
    };
    recovery.onclick = () => send({ type: 'host.open_recovery' }).catch(() => undefined);

    const appearanceListener = (event) => {
      try { applyAppearance(JSON.parse(String(event.detail || '{}'))); } catch (_) {}
    };
    document.addEventListener('dcf:appearance', appearanceListener, true);
    cleanup.push(() => document.removeEventListener('dcf:appearance', appearanceListener, true));

    Promise.all([
      send({ type: 'plugin.data.get', plugin_id: UNIT_ID }),
      send({ type: 'plugin.data.get', plugin_id: 'dcf.firstparty.appearance' })
    ]).then(([shellState, appearance]) => {
      activeId = shellState.data && shellState.data.active_panel || null;
      applyAppearance(Object.assign({}, appearance.data || {}, shellState.data || {}));
      scanPanels();
      if (activeId && panels.has(activeId)) activate(activeId);
      document.dispatchEvent(new CustomEvent('dcf:shell-ready'));
      return send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => {
      send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
    });
  } catch (error) {
    destroy();
    send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
  }
})();
