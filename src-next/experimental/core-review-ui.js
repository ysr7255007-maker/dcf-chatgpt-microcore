'use strict';

const { CORE_REVIEW_VERSION, DEFAULT_PACK_URL } = require('./core-review-constants');
const { downloadText } = require('./core-review-modules');
const { installPluginPack, buildSnapshot } = require('./core-review-pack');

function fetchText(url) {
  if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('gm_xmlhttp_request_unavailable'));
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url, headers: { Accept: 'application/json' }, timeout: 15000,
      onload(response) {
        if (response.status >= 200 && response.status < 300) resolve(String(response.responseText || ''));
        else reject(new Error(`plugin_pack_http_${response.status}`));
      },
      onerror: () => reject(new Error('plugin_pack_network_error')),
      ontimeout: () => reject(new Error('plugin_pack_timeout'))
    });
  });
}

function createRecoveryRenderer(options) {
  const { platform, storage, getState, setState, save, reload } = options;
  let host = null;
  let panelOpen = true;
  function element(tag, text, className) {
    const node = platform.document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function remove() { host?.remove(); host = null; }

  function render(reason = 'manual') {
    remove();
    let state = getState();
    const doc = platform.document;
    host = doc.createElement('div');
    host.id = 'dcf-core-review-recovery';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial}.toggle{position:fixed;z-index:2147483646;left:12px;bottom:12px;border:0;border-radius:999px;padding:8px 11px;background:#17212b;color:#fff;font:12px system-ui;cursor:pointer}.panel{position:fixed;z-index:2147483645;left:12px;bottom:52px;width:min(520px,calc(100vw - 24px));max-height:min(760px,calc(100vh - 70px));overflow:auto;background:#f8f8f8;color:#202124;border:1px solid #bbb;border-radius:12px;box-shadow:0 14px 40px #0004;padding:12px;font:13px/1.45 system-ui}.panel[hidden]{display:none}.stack{display:grid;gap:9px}.row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.card{border:1px solid #ddd;border-radius:9px;background:#fff;padding:9px}.muted{font-size:12px;color:#666}button,input,textarea{font:inherit}button{border:1px solid #aaa;background:#fff;border-radius:7px;padding:6px 8px;cursor:pointer}button.primary{background:#17212b;color:#fff}button.danger{color:#a11616}input,textarea{box-sizing:border-box;width:100%;border:1px solid #aaa;border-radius:7px;padding:7px}textarea{min-height:120px;resize:vertical}pre{white-space:pre-wrap;word-break:break-word;margin:0}@media(prefers-color-scheme:dark){.panel{background:#181818;color:#eee;border-color:#555}.card{background:#242424;border-color:#555}.muted{color:#aaa}button,input,textarea{background:#2a2a2a;color:#eee;border-color:#666}}
    </style>`;
    const toggle = element('button', 'DCF Core Review', 'toggle');
    const panel = element('section', null, 'panel stack');
    panel.hidden = !panelOpen;
    toggle.onclick = () => { panelOpen = !panelOpen; panel.hidden = !panelOpen; };

    const heading = element('div', null, 'card');
    heading.append(element('strong', `DCF Core Review · ${reason}`));
    const status = element('pre');
    status.textContent = JSON.stringify({
      core_version: CORE_REVIEW_VERSION,
      boot: state.boot,
      current_snapshot: state.current_snapshot?.id || null,
      last_known_good_snapshot: state.last_known_good_snapshot?.id || null,
      installed_packs: Object.keys(state.installed_packs || {}),
      stored_modules: storage.listModules().length
    }, null, 2);
    heading.append(status); panel.append(heading);

    const importCard = element('section', null, 'card stack');
    importCard.append(element('strong', '导入插件工具包'));
    const url = element('input'); url.value = DEFAULT_PACK_URL;
    const paste = element('textarea'); paste.placeholder = '或粘贴 dcf.plugin-pack.bundle.v1 JSON';
    const message = element('div', '', 'muted');
    const importValue = async (text) => {
      state = getState();
      const installed = await installPluginPack(JSON.parse(text), storage, state);
      setState(state);
      message.textContent = `已导入 ${installed.id}@${installed.version}`;
      render('pack_imported');
    };
    const fetchButton = element('button', '从 URL 导入', 'primary');
    fetchButton.onclick = () => fetchText(url.value).then(importValue).catch((error) => { message.textContent = error.message; });
    const pasteButton = element('button', '导入粘贴内容');
    pasteButton.onclick = () => importValue(paste.value).catch((error) => { message.textContent = error.message; });
    const importActions = element('div', null, 'row'); importActions.append(fetchButton, pasteButton);
    importCard.append(url, paste, importActions, message); panel.append(importCard);

    for (const installed of Object.values(state.installed_packs || {})) {
      const card = element('section', null, 'card stack');
      card.append(element('strong', `${installed.title || installed.id} · ${installed.version}`));
      const actions = element('div', null, 'row');
      for (const name of Object.keys(installed.manifest?.recommended_snapshots || {})) {
        const button = element('button', `加载 ${name}`, name === 'minimal' ? 'primary' : '');
        button.onclick = () => {
          try {
            state = getState();
            state.current_snapshot = buildSnapshot(state, storage, installed.id, name);
            state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle';
            setState(state); save(); reload();
          } catch (error) { message.textContent = error.message; }
        };
        actions.append(button);
      }
      card.append(actions); panel.append(card);
    }

    const recovery = element('section', null, 'card stack');
    recovery.append(element('strong', '原始恢复'));
    const actions = element('div', null, 'row');
    const knownGood = element('button', '加载上次可用快照', 'primary');
    knownGood.disabled = !state.last_known_good_snapshot;
    knownGood.onclick = () => {
      state = getState();
      state.current_snapshot = JSON.parse(JSON.stringify(state.last_known_good_snapshot));
      state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle';
      setState(state); save(); reload();
    };
    const clear = element('button', '清空当前快照', 'danger');
    clear.onclick = () => {
      state = getState();
      state.current_snapshot = null; state.force_recovery = false; state.recovery_reason = null; state.boot.status = 'idle';
      setState(state); save(); reload();
    };
    const exportState = element('button', '下载状态');
    exportState.onclick = () => downloadText(`dcf-core-review-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ state: getState(), modules: storage.listModules().map((unit) => ({ id: unit.id, sha256: unit.sha256, pack_id: unit.pack_id, pack_version: unit.pack_version })) }, null, 2));
    actions.append(knownGood, clear, exportState); recovery.append(actions); panel.append(recovery);

    shadow.append(toggle, panel); doc.documentElement.append(host);
  }
  return { render, remove };
}

module.exports = { fetchText, createRecoveryRenderer };
