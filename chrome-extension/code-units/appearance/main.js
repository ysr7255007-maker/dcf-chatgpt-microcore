(function () {
  'use strict';
  const UNIT_ID = 'dcf.firstparty.appearance';
  const UNIT_VERSION = '1.0.0-rc.2-appearance.2';
  const PANEL_ID = 'appearance';
  const HOST_ID = 'dcf-panel-appearance';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_APPEARANCE__';
  const DEFAULTS = { side: 'right', width: 380, top: 72, height: 680, margin: 12 };
  const METRICS = {
    width: { label: '宽度', min: 280, max: 900, step: 20 },
    top: { label: '顶部边距', min: 8, max: 800, step: 10 },
    height: { label: '高度', min: 240, max: 1200, step: 20 },
    margin: { label: '侧边距', min: 0, max: 80, step: 4 }
  };
  const send = (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return Promise.reject(new Error('host_messaging_unavailable'));
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request');
      return result;
    });
  };
  const previous = globalThis[GLOBAL_KEY];
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  let panel;
  let settings = { ...DEFAULTS };

  function clamp(key, value) {
    const spec = METRICS[key];
    const number = Number(value);
    if (!spec || !Number.isFinite(number)) return DEFAULTS[key];
    return Math.max(spec.min, Math.min(spec.max, number));
  }

  function normalize(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      side: value.side === 'left' ? 'left' : 'right',
      width: clamp('width', value.width),
      top: clamp('top', value.top),
      height: clamp('height', value.height),
      margin: clamp('margin', value.margin)
    };
  }

  function apply() {
    document.dispatchEvent(new CustomEvent('dcf:appearance', { detail: JSON.stringify(settings) }));
  }

  async function persist() {
    settings = normalize(settings);
    await send({ type: 'plugin.data.set', plugin_id: UNIT_ID, data: settings });
    apply();
  }

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.control{display:grid;gap:5px}.control-head{display:flex;align-items:center;gap:8px}.control-head span{flex:1}.control-head input[type=number]{width:84px}.control input[type=range]{width:100%;padding:0;border:0}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}label{display:grid;gap:4px}button,input,select{font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 9px}.primary{background:#202124;color:#fff;border-color:#202124}.hint{margin:0;color:#666;font-size:12px}@media(max-width:420px){.grid{grid-template-columns:1fr}}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}button,input,select{background:#292929;color:#f3f3f3;border-color:#555}.primary{background:#f3f3f3;color:#181818}.hint{color:#aaa}}`;
  }

  function metricHtml(key) {
    const spec = METRICS[key];
    return `<div class="control" data-control="${key}"><div class="control-head"><span>${spec.label}</span><input type="number" min="${spec.min}" max="${spec.max}" step="${spec.step}" data-number="${key}" value="${settings[key]}"></div><input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" data-range="${key}" value="${settings[key]}"></div>`;
  }

  function bindMetric(root, key) {
    const number = root.querySelector(`[data-number="${key}"]`);
    const range = root.querySelector(`[data-range="${key}"]`);
    const update = (source, target) => {
      const value = clamp(key, source.value);
      settings[key] = value;
      source.value = String(value);
      target.value = String(value);
      apply();
    };
    number.oninput = () => update(number, range);
    range.oninput = () => update(range, number);
  }

  function render() {
    const root = panel.shadowRoot;
    root.querySelector('.content').innerHTML = `<section class="card"><b>外观与位置</b><p class="hint">数字输入使用较大步进；滑块可快速调整，点击“保存外观”后长期保存。</p><label>停靠<select data-key="side"><option value="right">右侧</option><option value="left">左侧</option></select></label><div class="grid">${Object.keys(METRICS).map(metricHtml).join('')}</div><div class="row"><button class="primary" data-action="save">保存外观</button><button data-action="reset">恢复默认</button></div></section>`;
    const side = root.querySelector('[data-key="side"]');
    side.value = settings.side;
    side.onchange = () => {
      settings.side = side.value === 'left' ? 'left' : 'right';
      apply();
    };
    for (const key of Object.keys(METRICS)) bindMetric(root, key);
    root.querySelector('[data-action="save"]').onclick = persist;
    root.querySelector('[data-action="reset"]').onclick = async () => {
      settings = { ...DEFAULTS };
      await persist();
      render();
    };
  }

  function create() {
    panel = document.createElement('section');
    panel.id = HOST_ID;
    panel.dataset.dcfPanelRoot = 'true';
    panel.dataset.dcfPanelId = PANEL_ID;
    panel.dataset.dcfPanelTitle = '外观';
    panel.style.display = 'none';
    const root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${style()}</style><div class="content"></div>`;
    document.documentElement.append(panel);
    document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID }));
  }

  function destroy() {
    panel?.remove();
  }
  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy };

  try {
    document.getElementById(HOST_ID)?.remove();
    create();
    send({ type: 'plugin.data.get', plugin_id: UNIT_ID }).then(async (result) => {
      settings = normalize({ ...DEFAULTS, ...(result.data || {}) });
      render();
      apply();
      await send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => {
      send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
    });
  } catch (error) {
    destroy();
    send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
  }
})();
