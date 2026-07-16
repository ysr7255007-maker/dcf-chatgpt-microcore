(function () {
  'use strict';
  const UNIT_ID = 'dcf.firstparty.ammo';
  const UNIT_VERSION = '1.0.0-rc.1';
  const HOST_ID = 'dcf-chrome-ammo-host';
  const INVOCATION_MARKER = '〔DCF·语言弹药〕';
  const UPDATE_MARKER = '〔DCF·弹药更新〕';
  if (document.getElementById(HOST_ID)) {
    chrome.runtime.sendMessage({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }).catch(() => undefined);
    return;
  }

  const state = { product: { ammo: {}, settings: { ammo_fire_mode: 'insert', appearance: {} }, migration: {} }, query: '', draft: null, collapsed: false, notice: '' };
  let noticeTimer = 0;

  function send(message) { return chrome.runtime.sendMessage(message).then((result) => { if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host did not accept the request'); return result; }); }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function setNotice(text) { state.notice = String(text || ''); renderNotice(); clearTimeout(noticeTimer); if (text) noticeTimer = setTimeout(() => { state.notice = ''; renderNotice(); }, 3600); }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial}.shell{position:fixed;right:12px;bottom:108px;width:350px;max-height:min(800px,calc(100vh - 24px));z-index:2147483645;background:#fffffff4;color:#171717;border:1px solid #8885;border-radius:15px;box-shadow:0 18px 44px #0003;font:13px/1.45 system-ui;display:flex;flex-direction:column;overflow:hidden}.shell[data-side=left]{left:12px;right:auto}@media(prefers-color-scheme:dark){.shell{background:#171717f5;color:#f5f5f5}}button,input,textarea{font:inherit;color:inherit}button{border:1px solid #8885;background:transparent;border-radius:9px;padding:6px 8px;cursor:pointer}button:hover{background:#8882}button.primary{border-color:#2563eb88;background:#2563eb18}button.danger{border-color:#ef444477}.top{display:flex;align-items:center;gap:6px;height:42px;box-sizing:border-box;padding:6px 8px;border-bottom:1px solid #8883}.top b{margin-right:auto}.body{overflow:auto;padding:9px;min-height:0}.shell.collapsed .body,.shell.collapsed .notice{display:none}.shell.collapsed{height:auto}.notice{padding:6px 9px;border-bottom:1px solid #8883;min-height:18px;box-sizing:border-box;font-size:12px}.notice:empty{display:none}.card{border:1px solid #8884;border-radius:12px;padding:9px;margin-bottom:9px;background:#8881}.name{font-weight:700}.mini{font-size:11px;opacity:.7;word-break:break-word}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.toolbar{display:flex;gap:6px;margin-bottom:9px}.toolbar input{flex:1}input,textarea{width:100%;box-sizing:border-box;border:1px solid #8885;border-radius:9px;padding:7px;background:Canvas;color:CanvasText}textarea{min-height:150px;resize:vertical}.field{margin-top:7px}.pill{display:inline-block;border:1px solid #8885;border-radius:999px;padding:2px 7px;font-size:10px;margin-left:5px}.empty{text-align:center;padding:24px 12px;opacity:.7}.hidden{display:none}
  </style><aside class="shell"><div class="top"><b>DCF 语言弹药</b><button data-action="recovery" title="恢复与诊断">维护</button><button data-action="collapse" title="收起">−</button></div><div class="notice"></div><div class="body"></div></aside>`;
  document.documentElement.appendChild(host);
  const shell = shadow.querySelector('.shell');
  const body = shadow.querySelector('.body');
  const notice = shadow.querySelector('.notice');

  function renderNotice() { notice.textContent = state.notice; }
  function items() { return Object.values(state.product.ammo || {}).sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id))); }
  function filteredItems() { const q = state.query.trim().toLocaleLowerCase(); return q ? items().filter((item) => [item.id,item.title,item.purpose,(item.tags||[]).join(' ')].join(' ').toLocaleLowerCase().includes(q)) : items(); }

  function applyAppearance() {
    const appearance = state.product.settings && state.product.settings.appearance || {};
    shell.dataset.side = appearance.side === 'left' ? 'left' : 'right';
    if (appearance.w) shell.style.width = appearance.w;
    if (appearance.bottom) shell.style.bottom = appearance.bottom;
    if (appearance.top && appearance.anchor === 'top') { shell.style.top = appearance.top; shell.style.bottom = 'auto'; }
  }

  function editorHtml() {
    if (!state.draft) return '';
    const d = state.draft;
    return `<div class="card"><div class="name">${d.original_id ? '编辑语言弹药' : '新建语言弹药'}</div>
      <div class="field mini">ID</div><input data-field="id" value="${escapeHtml(d.id)}" ${d.original_id ? 'readonly' : ''}>
      <div class="field mini">标题</div><input data-field="title" value="${escapeHtml(d.title)}">
      <div class="field mini">用途</div><input data-field="purpose" value="${escapeHtml(d.purpose)}">
      <div class="field mini">标签（逗号分隔）</div><input data-field="tags" value="${escapeHtml(d.tags)}">
      <div class="field mini">正文</div><textarea data-field="body">${escapeHtml(d.body)}</textarea>
      <div class="actions"><button class="primary" data-action="save">保存</button><button data-action="cancel">取消</button></div></div>`;
  }

  function render() {
    applyAppearance();
    const mode = state.product.settings && state.product.settings.ammo_fire_mode === 'send' ? 'send' : 'insert';
    const visible = filteredItems();
    body.innerHTML = `<div class="card"><div class="name">语言弹药工作台 <span class="pill">${items().length} 枚</span></div><div class="mini">从新完成的助手回复自动装填；同一 ID 会原位更新。</div><div class="actions"><button class="primary" data-action="extract">从当前对话提取</button><button data-action="new">新建</button><button data-action="mode">发射：${mode === 'send' ? '直接发送' : '填入输入框'}</button><button data-action="export">导出</button><button data-action="import">导入</button><input class="hidden" type="file" accept="application/json" data-role="import-file"></div></div>
      ${editorHtml()}<div class="toolbar"><input data-role="search" placeholder="查找标题、用途、标签或 ID" value="${escapeHtml(state.query)}"></div>
      ${visible.length ? visible.map((item) => `<div class="card" data-id="${escapeHtml(item.id)}"><div class="name">${escapeHtml(item.title || item.id)} <span class="pill">v${escapeHtml(item._meta && item._meta.version || 1)}</span></div><div class="mini">${escapeHtml(item.purpose || item.id)} · ${escapeHtml(item.id)}</div><div class="actions"><button class="primary" data-action="fire">发射</button><button data-action="copy">复制</button><button data-action="update">更新</button><button data-action="edit">编辑</button><button class="danger" data-action="delete">删除</button></div></div>`).join('') : '<div class="empty">弹药库为空。可以新建，或从当前对话提取。</div>'}`;
    bindBody();
  }

  function cardItem(target) { const card = target.closest('[data-id]'); return card && state.product.ammo[card.dataset.id] || null; }
  function invocation(item) { return `${INVOCATION_MARKER}\n\n${item.body}`; }
  function updateRequest(item) { return [UPDATE_MARKER,'','下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。','- 保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。','- 吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。','- 这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。','','完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。','','当前弹药：',JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => key !== '_meta')), null, 2)].join('\n'); }

  function composer() { return document.querySelector('#prompt-textarea') || document.querySelector('textarea[data-id="root"]') || document.querySelector('main textarea') || document.querySelector('[contenteditable="true"][data-virtualkeyboard="true"]') || document.querySelector('main [contenteditable="true"]'); }
  function setComposerText(text) {
    const node = composer();
    if (!node) throw new Error('未找到 ChatGPT 输入框');
    node.focus();
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(node, text);
    } else {
      node.textContent = text;
    }
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return node;
  }
  async function placeInComposer(text, shouldSend) {
    setComposerText(text);
    if (!shouldSend) return;
    await delay(80);
    const button = document.querySelector('[data-testid="send-button"]') || document.querySelector('button[aria-label*="Send"]') || document.querySelector('button[aria-label*="发送"]');
    if (!button || button.disabled) throw new Error('输入已填入，但发送按钮暂不可用');
    button.click();
  }

  async function refresh() {
    const response = await send({ type: 'product.state' });
    state.product = response.product;
    render();
  }

  function startDraft(item) {
    state.draft = { original_id: item && item.id || '', id: item && item.id || `ammo-${Date.now().toString(36)}`, title: item && item.title || '', purpose: item && item.purpose || '', tags: Array.isArray(item && item.tags) ? item.tags.join(', ') : '', body: item && item.body || '' };
    render();
  }

  async function saveDraft() {
    const fields = Object.fromEntries(Array.from(shadow.querySelectorAll('[data-field]')).map((node) => [node.dataset.field, node.value]));
    if (!String(fields.id || '').trim() || !String(fields.body || '').trim()) throw new Error('ID 和正文不能为空');
    const item = { id: fields.id.trim(), title: (fields.title || fields.id).trim(), purpose: String(fields.purpose || '').trim(), body: fields.body.trim() };
    const tags = String(fields.tags || '').split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) item.tags = tags;
    await send({ type: 'ammo.upsert', item, source: 'ammo-workbench' });
    state.draft = null;
    await refresh();
    setNotice('语言弹药已原子保存');
  }

  async function exportLibrary() {
    const result = await send({ type: 'product.export' });
    await navigator.clipboard.writeText(JSON.stringify(result.export, null, 2));
    setNotice(`已复制 ${result.export.count} 枚语言弹药`);
  }

  async function importLibrary(file) {
    const parsed = JSON.parse(await file.text());
    const input = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(input)) throw new Error('导入文件不包含 items 数组');
    for (const item of input) await send({ type: 'ammo.upsert', item, source: 'library-import' });
    await refresh();
    setNotice(`已导入 ${input.length} 枚语言弹药`);
  }

  function bindBody() {
    const search = shadow.querySelector('[data-role="search"]');
    if (search) search.addEventListener('input', () => { state.query = search.value; render(); });
    shadow.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const action = button.dataset.action;
        const item = cardItem(button);
        if (action === 'extract') await placeInComposer('请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。\n返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。', true);
        else if (action === 'new') startDraft(null);
        else if (action === 'mode') { const mode = state.product.settings.ammo_fire_mode === 'send' ? 'insert' : 'send'; await send({ type: 'settings.set', patch: { ammo_fire_mode: mode } }); await refresh(); }
        else if (action === 'export') await exportLibrary();
        else if (action === 'import') shadow.querySelector('[data-role="import-file"]').click();
        else if (action === 'save') await saveDraft();
        else if (action === 'cancel') { state.draft = null; render(); }
        else if (action === 'fire' && item) await placeInComposer(invocation(item), state.product.settings.ammo_fire_mode === 'send');
        else if (action === 'copy' && item) { await navigator.clipboard.writeText(item.body); setNotice('已复制原始正文'); }
        else if (action === 'update' && item) await placeInComposer(updateRequest(item), true);
        else if (action === 'edit' && item) startDraft(item);
        else if (action === 'delete' && item) { if (confirm(`删除“${item.title || item.id}”？`)) { await send({ type: 'ammo.delete', id: item.id }); await refresh(); } }
      } catch (error) { setNotice(`操作失败：${String(error && error.message || error)}`); }
    }));
    const file = shadow.querySelector('[data-role="import-file"]');
    if (file) file.addEventListener('change', async () => { try { if (file.files[0]) await importLibrary(file.files[0]); } catch (error) { setNotice(`导入失败：${String(error && error.message || error)}`); } file.value = ''; });
  }

  shadow.querySelector('[data-action="collapse"]').addEventListener('click', () => { state.collapsed = !state.collapsed; shell.classList.toggle('collapsed', state.collapsed); shadow.querySelector('[data-action="collapse"]').textContent = state.collapsed ? '+' : '−'; });
  shadow.querySelector('[data-action="recovery"]').addEventListener('click', () => send({ type: 'host.status' }).then(() => chrome.runtime.sendMessage({ type: 'host.open_recovery' })).catch(() => undefined));

  const seen = new Set();
  function textHash(text) { let hash = 2166136261; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
  function assistantNodes(root) {
    const direct = Array.from(root.querySelectorAll('[data-message-author-role="assistant"]'));
    if (direct.length) return direct;
    return Array.from(root.querySelectorAll('article')).filter((node) => /assistant|ChatGPT/i.test(node.getAttribute('aria-label') || ''));
  }
  async function ingestNode(node) {
    await delay(900);
    if (!node.isConnected) return;
    const text = String(node.innerText || node.textContent || '');
    if (!text.includes('DCF_AMMO')) return;
    const key = textHash(text);
    if (seen.has(key)) return;
    seen.add(key);
    const result = await send({ type: 'ammo.ingest', text, source: 'new-assistant-reply' });
    if (result.imported) { await refresh(); setNotice(`已自动装填 ${result.imported} 枚语言弹药`); }
  }
  function startReplyObserver() {
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!main) { setTimeout(startReplyObserver, 800); return; }
    const known = new WeakSet(assistantNodes(main));
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const added of mutation.addedNodes) {
        if (!(added instanceof Element)) continue;
        const candidates = [];
        if (added.matches && added.matches('[data-message-author-role="assistant"]')) candidates.push(added);
        candidates.push(...Array.from(added.querySelectorAll ? added.querySelectorAll('[data-message-author-role="assistant"]') : []));
        for (const node of candidates) if (!known.has(node)) { known.add(node); ingestNode(node).catch((error) => setNotice(`自动装填失败：${String(error && error.message || error)}`)); }
      }
    });
    observer.observe(main, { childList: true, subtree: true });
    assistantNodes(main).slice(-3).forEach((node) => ingestNode(node).catch(() => undefined));
  }

  refresh().then(() => {
    startReplyObserver();
    return send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
  }).catch((error) => {
    setNotice(`DCF 启动失败：${String(error && error.message || error)}`);
    chrome.runtime.sendMessage({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
  });
})();
