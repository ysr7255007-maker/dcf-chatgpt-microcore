'use strict';

const { createEmitter } = require('../core/utils');

const DEFAULT_GEOMETRY = { side: 'right', width: 360, top: 72, height: 680, margin: 12, collapsed: false };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function shellPlugin() {
  return {
    id: 'dcf.next.shell',
    version: '1.0.0',
    title: '基础界面',
    description: 'DCF 的正常可见入口与插件面板宿主。',
    async start(ctx) {
      const doc = ctx.platform.document;
      if (!doc?.documentElement) throw new Error('document_unavailable');
      doc.getElementById('dcf-next-shell-host')?.remove();
      const host = doc.createElement('div');
      host.id = 'dcf-next-shell-host';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host{all:initial;--dcf-width:360px;--dcf-top:72px;--dcf-height:680px;--dcf-margin:12px}
        .shell{position:fixed;z-index:2147483000;top:var(--dcf-top);width:min(var(--dcf-width),calc(100vw - 24px));height:min(var(--dcf-height),calc(100vh - var(--dcf-top) - 12px));background:#fafafa;color:#202124;border:1px solid #d6d6d6;border-radius:14px;box-shadow:0 14px 42px #0003;font:13px/1.45 system-ui;display:flex;flex-direction:column;overflow:hidden}
        .shell.right{right:var(--dcf-margin)}.shell.left{left:var(--dcf-margin)}.shell.collapsed{height:auto;width:auto;min-width:160px}
        .head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#f0f0f0;border-bottom:1px solid #ddd}.brand{font-weight:700;flex:1}.status{font-size:11px;color:#666}.head button,.tabs button,.toast button{border:0;background:transparent;cursor:pointer;color:inherit}
        .tabs{display:flex;gap:4px;padding:7px;overflow:auto;border-bottom:1px solid #e2e2e2}.tabs button{padding:6px 8px;border-radius:8px;white-space:nowrap}.tabs button.active{background:#202124;color:white}
        .body{flex:1;overflow:auto;padding:10px}.panel[hidden],.shell.collapsed .tabs,.shell.collapsed .body{display:none!important}
        .toast{position:absolute;left:12px;right:12px;bottom:12px;background:#202124;color:#fff;border-radius:9px;padding:9px 11px;box-shadow:0 8px 22px #0004}.toast.error{background:#8b1e1e}
        button,input,textarea,select{font:inherit}.dcf-btn{border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 9px;cursor:pointer}.dcf-btn.primary{background:#202124;color:#fff;border-color:#202124}.dcf-btn.danger{color:#a11616}.dcf-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dcf-stack{display:grid;gap:9px}.dcf-card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff}.dcf-muted{color:#666;font-size:12px}.dcf-field{display:grid;gap:4px}.dcf-field input,.dcf-field textarea,.dcf-field select{border:1px solid #bbb;border-radius:8px;padding:7px;background:#fff;color:#202124}.dcf-field textarea{min-height:110px;resize:vertical}.dcf-grid{display:grid;gap:8px}.dcf-title{font-weight:700}.dcf-badge{display:inline-block;border-radius:999px;padding:2px 7px;background:#eee;font-size:11px}.dcf-empty{padding:18px;text-align:center;color:#777}
        @media(prefers-color-scheme:dark){.shell{background:#181818;color:#f3f3f3;border-color:#444}.head{background:#222;border-color:#444}.tabs{border-color:#444}.dcf-card{background:#222;border-color:#444}.dcf-btn,.dcf-field input,.dcf-field textarea,.dcf-field select{background:#292929;color:#f3f3f3;border-color:#555}.dcf-muted{color:#aaa}.dcf-badge{background:#333}}
      </style>`;
      const shell = element('section', null, 'shell right');
      const head = element('div', null, 'head');
      const brand = element('div', 'DCF Next', 'brand');
      const status = element('div', '已启动', 'status');
      const collapse = element('button', '收起');
      head.append(brand, status, collapse);
      const tabs = element('nav', null, 'tabs');
      const body = element('main', null, 'body');
      shell.append(head, tabs, body); shadow.append(shell); doc.documentElement.append(host);

      const panels = new Map();
      const emitter = createEmitter();
      let active = null;
      let geometry = { ...DEFAULT_GEOMETRY };

      function applyGeometry(next = {}) {
        geometry = { ...geometry, ...next };
        const viewportWidth = globalThis.visualViewport?.width || globalThis.innerWidth || 1280;
        const viewportHeight = globalThis.visualViewport?.height || globalThis.innerHeight || 800;
        geometry.width = Math.max(280, Math.min(Number(geometry.width) || 360, viewportWidth - 24));
        geometry.top = Math.max(8, Math.min(Number(geometry.top) || 72, viewportHeight - 120));
        geometry.height = Math.max(240, Math.min(Number(geometry.height) || 680, viewportHeight - geometry.top - 12));
        geometry.margin = Math.max(0, Math.min(Number(geometry.margin) || 12, 80));
        shell.style.setProperty('--dcf-width', `${geometry.width}px`);
        shell.style.setProperty('--dcf-top', `${geometry.top}px`);
        shell.style.setProperty('--dcf-height', `${geometry.height}px`);
        shell.style.setProperty('--dcf-margin', `${geometry.margin}px`);
        shell.classList.toggle('left', geometry.side === 'left');
        shell.classList.toggle('right', geometry.side !== 'left');
        shell.classList.toggle('collapsed', Boolean(geometry.collapsed));
        collapse.textContent = geometry.collapsed ? '展开' : '收起';
        emitter.emit('geometry', { ...geometry });
      }

      function activate(id) {
        if (!panels.has(id)) return;
        active = id;
        for (const [panelId, record] of panels) {
          record.button.classList.toggle('active', panelId === id);
          record.container.hidden = panelId !== id;
        }
        panels.get(id).render(panels.get(id).container);
      }

      function registerPanel(definition) {
        if (!definition?.id || typeof definition.render !== 'function') throw new Error('invalid_panel');
        panels.get(definition.id)?.button.remove();
        panels.get(definition.id)?.container.remove();
        const button = element('button', definition.title || definition.id);
        const container = element('section', null, 'panel');
        container.dataset.panelId = definition.id;
        const record = { ...definition, button, container };
        panels.set(definition.id, record);
        button.onclick = () => activate(definition.id);
        tabs.append(button); body.append(container);
        if (!active) activate(definition.id); else container.hidden = true;
        return () => { button.remove(); container.remove(); panels.delete(definition.id); if (active === definition.id) active = null; };
      }

      function refresh(id = active) {
        const record = panels.get(id);
        if (record) record.render(record.container);
      }

      let toastTimer = null;
      function notify(message, kind = 'success') {
        shadow.querySelector('.toast')?.remove();
        const toast = element('div', message, `toast ${kind === 'error' ? 'error' : ''}`);
        shell.append(toast);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.remove(), kind === 'error' ? 6500 : 2200);
      }

      collapse.onclick = () => applyGeometry({ collapsed: !geometry.collapsed });
      applyGeometry();

      return {
        host,
        shadow,
        registerPanel,
        activate,
        refresh,
        notify,
        setStatus: (text) => { status.textContent = String(text); },
        setGeometry: applyGeometry,
        getGeometry: () => ({ ...geometry }),
        onGeometry: (handler) => emitter.on('geometry', handler),
        ui: { element }
      };
    }
  };
}

module.exports = { shellPlugin, DEFAULT_GEOMETRY };
