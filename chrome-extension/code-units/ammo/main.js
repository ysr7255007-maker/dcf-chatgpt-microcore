(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.ammo';
  const UNIT_VERSION = '1.0.0-rc.2-ammo.3';
  const PANEL_ID = 'ammo';
  const HOST_ID = 'dcf-panel-ammo';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_AMMO__';
  const UPDATE_MARKER = '〔DCF·弹药更新〕';
  const DEFAULT_LIBRARY_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/language-ammo-library/data/language-ammo/library.json';

  const send = (message) => chrome.runtime.sendMessage(message).then((result) => {
    if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request');
    return result;
  });

  const previous = globalThis[GLOBAL_KEY];
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  let panel;
  let observer;
  let attachTimer;
  let noticeTimer;
  const processedReplies = new Set();
  const state = {
    items: {},
    settings: { library_url: DEFAULT_LIBRARY_URL },
    query: '',
    selected_id: '',
    draft: null,
    notice: ''
  };

  function destroy() {
    observer?.disconnect();
    clearTimeout(attachTimer);
    clearTimeout(noticeTimer);
    panel?.remove();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeItem(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const id = String(source.id || '').trim();
    const body = String(source.body || '').trim();
    if (!id || !body) throw new Error('语言弹药必须包含 id 和 body');
    const item = {
      id,
      title: String(source.title || id).trim(),
      purpose: String(source.purpose || '').trim(),
      body
    };
    const tags = Array.isArray(source.tags) ? source.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [];
    if (tags.length) item.tags = tags;
    if (source.created_at) item.created_at = String(source.created_at);
    if (source.updated_at) item.updated_at = String(source.updated_at);
    return item;
  }

  function itemFingerprint(item) {
    return JSON.stringify({ id: item.id, title: item.title, purpose: item.purpose, body: item.body, tags: item.tags || [] });
  }

  function upsertItem(raw, source = 'manual') {
    const normalized = normalizeItem(raw);
    const existing = state.items[normalized.id];
    const changed = !existing || itemFingerprint(existing) !== itemFingerprint(normalized);
    const now = new Date().toISOString();
    state.items[normalized.id] = {
      ...existing,
      ...normalized,
      created_at: existing?.created_at || normalized.created_at || now,
      updated_at: changed ? now : existing?.updated_at || normalized.updated_at || now,
      _meta: {
        version: existing ? changed ? Number(existing._meta?.version || 1) + 1 : Number(existing._meta?.version || 1) : 1,
        source
      }
    };
    return { item: state.items[normalized.id], changed, created: !existing };
  }

  async function persist() {
    await send({
      type: 'plugin.data.set',
      plugin_id: UNIT_ID,
      data: {
        items: state.items,
        settings: state.settings,
        selected_id: state.selected_id
      }
    });
  }

  async function importLibrary(payload, source) {
    if (!payload || payload.schema !== 'dcf.language-ammo.library.v1' || !Array.isArray(payload.items)) throw new Error('无效的语言弹药便携库');
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const item of payload.items) {
      const result = upsertItem(item, source);
      if (result.created) added += 1;
      else if (result.changed) updated += 1;
      else unchanged += 1;
    }
    await persist();
    render();
    return { added, updated, unchanged, total: payload.items.length };
  }

  async function loadGitHub({ silent = false } = {}) {
    const response = await fetch(state.settings.library_url || DEFAULT_LIBRARY_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub 弹药库 HTTP ${response.status}`);
    const result = await importLibrary(await response.json(), 'github-library');
    if (!silent) showNotice(`GitHub 载入完成：新增 ${result.added}，更新 ${result.updated}，未变 ${result.unchanged}`);
    return result;
  }

  function composer() {
    return document.querySelector('#prompt-textarea')
      || document.querySelector('[data-testid="composer-text-input"]')
      || document.querySelector('form textarea')
      || document.querySelector('main [contenteditable="true"]');
  }

  function composerText(target) {
    return target && String('value' in target ? target.value || '' : target.innerText || target.textContent || '');
  }

  function dispatchInput(target, text) {
    try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
    catch (_) { target.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function insertAtComposer(target, text) {
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    target.focus();
    if ('value' in target) {
      const original = String(target.value || '');
      const start = Number.isInteger(target.selectionStart) ? target.selectionStart : original.length;
      const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
      const before = original.slice(0, start);
      const after = original.slice(end);
      const inserted = `${before && !before.endsWith('\n\n') ? '\n\n' : ''}${text}${after && !after.startsWith('\n\n') ? '\n\n' : ''}`;
      const next = `${before}${inserted}${after}`;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
      if (setter) setter.call(target, next); else target.value = next;
      const caret = before.length + inserted.length;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(caret, caret);
      dispatchInput(target, inserted);
      return;
    }
    const selection = getSelection();
    let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !target.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const original = composerText(target);
    const inserted = original && !original.endsWith('\n\n') ? `\n\n${text}` : text;
    if (document.execCommand?.('insertText', false, inserted)) {
      dispatchInput(target, inserted);
      return;
    }
    range.deleteContents();
    const node = document.createTextNode(inserted);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    dispatchInput(target, inserted);
  }

  function sendButton() {
    return document.querySelector('[data-testid="send-button"]')
      || document.querySelector('button[aria-label*="Send"]')
      || document.querySelector('button[aria-label*="发送"]');
  }

  async function clickSend() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const button = sendButton();
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
        return;
      }
      await wait(50);
    }
    throw new Error('内容已写入，但发送按钮暂不可用');
  }

  function replaceComposer(target, text) {
    if (!target) throw new Error('未找到 ChatGPT 输入框');
    const existing = composerText(target).trim();
    if (existing && existing !== String(text).trim()) throw new Error('输入框中已有未发送内容');
    target.focus();
    if ('value' in target) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
      if (setter) setter.call(target, text); else target.value = text;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(text.length, text.length);
      dispatchInput(target, text);
      return;
    }
    const selection = getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!document.execCommand?.('insertText', false, text)) target.textContent = text;
    dispatchInput(target, text);
  }

  async function sendPrompt(text) {
    replaceComposer(composer(), text);
    await clickSend();
  }

  function ammoPayload(item) {
    return `〔DCF·语言弹药〕\n\n${item.body}`;
  }

  async function fireItem(item) {
    insertAtComposer(composer(), ammoPayload(item));
    await clickSend();
  }

  function updatePrompt(item) {
    const clean = { ...item };
    delete clean._meta;
    return [
      UPDATE_MARKER,
      '',
      '请结合当前对话重新理解并修订下面这枚长期语言弹药。保留仍成立的核心意图，只吸收已经稳定形成的变化，不要机械摘要对话，不要另建相似弹药。必须保留原 id。',
      '',
      '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body。',
      '',
      '当前弹药：',
      JSON.stringify(clean, null, 2)
    ].join('\n');
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(String(text));
  }

  function showNotice(message) {
    state.notice = String(message || '');
    updateNotice();
    clearTimeout(noticeTimer);
    if (message) {
      noticeTimer = setTimeout(() => {
        state.notice = '';
        updateNotice();
      }, 4200);
    }
  }

  function updateNotice() {
    panel?.shadowRoot?.querySelector('.notice')?.replaceChildren(document.createTextNode(state.notice));
  }

  function visibleItems() {
    const query = state.query.trim().toLowerCase();
    return Object.values(state.items)
      .filter((item) => !query || `${item.id} ${item.title} ${item.purpose} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query))
      .sort((left, right) => String(left.title).localeCompare(String(right.title), 'zh-CN'));
  }

  function ensureSelection(items) {
    if (items.some((item) => item.id === state.selected_id)) return;
    state.selected_id = items[0]?.id || '';
  }

  function selectedItem() {
    return state.items[state.selected_id] || null;
  }

  function editorHtml() {
    if (!state.draft) return '';
    const draft = state.draft;
    return `<section class="card editor">
      <div class="row"><b>${draft.original_id ? '编辑' : '新建'}语言弹药</b><span class="badge">编辑模式</span></div>
      <label>ID<input data-field="id" value="${escapeHtml(draft.id)}" ${draft.original_id ? 'readonly' : ''}></label>
      <label>标题<input data-field="title" value="${escapeHtml(draft.title)}"></label>
      <label>用途<textarea data-field="purpose">${escapeHtml(draft.purpose)}</textarea></label>
      <label>标签（逗号分隔）<input data-field="tags" value="${escapeHtml(draft.tags)}"></label>
      <label>正文<textarea class="body-input" data-field="body">${escapeHtml(draft.body)}</textarea></label>
      <div class="editor-actions"><button class="primary" data-action="save">保存</button><button data-action="cancel">取消</button></div>
    </section>`;
  }

  function cardHtml(item) {
    const selected = item.id === state.selected_id;
    return `<article class="ammo-card ${selected ? 'selected' : ''}" data-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-selected="${selected}">
      <div class="row"><b class="grow">${escapeHtml(item.title || item.id)}</b><span class="badge">v${Number(item._meta?.version || 1)}</span></div>
      <p>${escapeHtml(item.purpose || item.id)}</p>
      <div class="meta">${escapeHtml(item.id)}${item.tags?.length ? ` · ${escapeHtml(item.tags.join(' / '))}` : ''}</div>
    </article>`;
  }

  function render() {
    if (!panel) return;
    const root = panel.shadowRoot;
    const items = visibleItems();
    ensureSelection(items);
    const selected = selectedItem();
    root.querySelector('.content').innerHTML = `
      <div class="notice">${escapeHtml(state.notice)}</div>
      <section class="library-shell">
        <div class="row header-row"><b class="grow">语言弹药</b><span class="badge">${Object.keys(state.items).length} 枚</span></div>
        <input class="search" data-role="search" placeholder="搜索标题、用途、标签或 ID" value="${escapeHtml(state.query)}">
        ${editorHtml()}
        <div class="ammo-list" data-role="ammo-list">
          ${items.length ? items.map(cardHtml).join('') : '<div class="empty">还没有语言弹药。正在等待 GitHub 便携库或新的 DCF_AMMO。</div>'}
        </div>
      </section>
      <section class="control-dock">
        <div class="selection-summary"><span>当前选择</span><b>${selected ? escapeHtml(selected.title || selected.id) : '未选择'}</b></div>
        <div class="action-group"><span>弹药库</span><div class="control-grid library-actions">
          <button class="primary" data-action="extract">从当前对话提取</button>
          <button data-action="new">新建</button>
          <button data-action="github">GitHub 加载</button>
          <button data-action="export">复制便携库</button>
          <button data-action="import">导入文件</button>
          <input hidden type="file" accept="application/json" data-role="file">
        </div></div>
        <div class="action-group"><span>所选弹药</span><div class="control-grid item-actions">
          <button class="primary" data-action="fire" ${selected ? '' : 'disabled'}>发射</button>
          <button class="primary" data-action="insert" ${selected ? '' : 'disabled'}>插入</button>
          <button data-action="copy" ${selected ? '' : 'disabled'}>复制</button>
          <button data-action="update" ${selected ? '' : 'disabled'}>更新</button>
          <button data-action="edit" ${selected ? '' : 'disabled'}>编辑</button>
          <button class="danger" data-action="delete" ${selected ? '' : 'disabled'}>删除</button>
        </div></div>
      </section>`;

    const search = root.querySelector('[data-role="search"]');
    if (search) {
      search.oninput = () => {
        const value = search.value;
        const caret = search.selectionStart;
        state.query = value;
        render();
        const next = panel.shadowRoot.querySelector('[data-role="search"]');
        next?.focus();
        if (Number.isInteger(caret) && typeof next?.setSelectionRange === 'function') next.setSelectionRange(caret, caret);
      };
    }

    for (const card of root.querySelectorAll('.ammo-card')) {
      const select = () => {
        state.selected_id = card.dataset.id;
        persist().catch(() => undefined);
        render();
      };
      card.onclick = select;
      card.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      };
    }

    for (const button of root.querySelectorAll('[data-action]')) {
      button.onclick = async () => {
        try {
          const action = button.dataset.action;
          const item = selectedItem();
          if (action === 'extract') {
            await sendPrompt('请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。\n返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。');
          } else if (action === 'new') {
            openEditor();
          } else if (action === 'github') {
            await loadGitHub();
          } else if (action === 'export') {
            const library = {
              schema: 'dcf.language-ammo.library.v1',
              exported_at: new Date().toISOString(),
              count: Object.keys(state.items).length,
              items: Object.values(state.items).map((entry) => {
                const clean = { ...entry };
                delete clean._meta;
                return clean;
              })
            };
            await copyText(JSON.stringify(library, null, 2));
            showNotice(`已复制 ${library.count} 枚语言弹药`);
          } else if (action === 'import') {
            root.querySelector('[data-role="file"]').click();
          } else if (action === 'save') {
            await saveEditor();
          } else if (action === 'cancel') {
            state.draft = null;
            render();
          } else if (action === 'fire' && item) {
            await fireItem(item);
          } else if (action === 'insert' && item) {
            insertAtComposer(composer(), ammoPayload(item));
            showNotice('已插入当前光标位置');
          } else if (action === 'copy' && item) {
            await copyText(item.body);
            showNotice('正文已复制');
          } else if (action === 'update' && item) {
            await sendPrompt(updatePrompt(item));
          } else if (action === 'edit' && item) {
            openEditor(item);
          } else if (action === 'delete' && item && confirm(`删除“${item.title || item.id}”？`)) {
            delete state.items[item.id];
            state.selected_id = '';
            await persist();
            render();
          }
        } catch (error) {
          showNotice(`操作失败：${String(error && error.message || error)}`);
        }
      };
    }

    const file = root.querySelector('[data-role="file"]');
    if (file) {
      file.onchange = async () => {
        try {
          if (file.files[0]) await importLibrary(JSON.parse(await file.files[0].text()), 'file-import');
          showNotice('导入完成');
        } catch (error) {
          showNotice(`导入失败：${String(error && error.message || error)}`);
        }
        file.value = '';
      };
    }
  }

  function openEditor(item) {
    state.draft = {
      original_id: item?.id || '',
      id: item?.id || `ammo-${Date.now().toString(36)}`,
      title: item?.title || '',
      purpose: item?.purpose || '',
      tags: (item?.tags || []).join(', '),
      body: item?.body || ''
    };
    render();
  }

  async function saveEditor() {
    const values = Object.fromEntries(Array.from(panel.shadowRoot.querySelectorAll('[data-field]')).map((input) => [input.dataset.field, input.value]));
    const result = upsertItem({
      id: values.id,
      title: values.title,
      purpose: values.purpose,
      body: values.body,
      tags: String(values.tags || '').split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    }, 'workbench');
    state.selected_id = result.item.id;
    state.draft = null;
    await persist();
    render();
    showNotice('语言弹药已保存');
  }

  function assistantMessages(root) {
    return Array.from(root.querySelectorAll('[data-message-author-role="assistant"]'));
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function parseAmmoArtifacts(text) {
    const source = String(text || '');
    const items = [];
    const errors = [];
    const startMarker = '<<<DCF_AMMO';
    const endMarker = 'DCF_AMMO>>>';
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf(startMarker, cursor);
      if (start < 0) break;
      const newline = source.indexOf('\n', start);
      const end = source.indexOf(endMarker, newline < 0 ? start + startMarker.length : newline + 1);
      if (end < 0) {
        errors.push('未找到 DCF_AMMO 结束标记');
        break;
      }
      const raw = source
        .slice(newline < 0 ? start + startMarker.length : newline + 1, end)
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      try { items.push(normalizeItem(JSON.parse(raw))); }
      catch (error) { errors.push(String(error && error.message || error)); }
      cursor = end + endMarker.length;
    }
    return { items, errors };
  }

  async function processAssistantMessage(message) {
    await wait(1100);
    if (!message.isConnected) return;
    const text = String(message.innerText || message.textContent || '');
    if (!text.includes('DCF_AMMO')) return;
    const digest = hashText(text);
    if (processedReplies.has(digest)) return;
    processedReplies.add(digest);
    const artifacts = parseAmmoArtifacts(text);
    for (const item of artifacts.items) upsertItem(item, 'assistant-reply');
    if (artifacts.items.length) {
      state.selected_id = artifacts.items[artifacts.items.length - 1].id;
      await persist();
      render();
      showNotice(`已自动装填 ${artifacts.items.length} 枚语言弹药`);
    }
    if (artifacts.errors.length) showNotice(`发现 DCF_AMMO，但有 ${artifacts.errors.length} 个解析失败`);
  }

  function attachObserver() {
    const root = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!root) {
      attachTimer = setTimeout(attachObserver, 900);
      return;
    }
    const seen = new WeakSet(assistantMessages(root));
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const messages = [];
          if (node.matches?.('[data-message-author-role="assistant"]')) messages.push(node);
          messages.push(...(node.querySelectorAll?.('[data-message-author-role="assistant"]') || []));
          for (const message of messages) {
            if (seen.has(message)) continue;
            seen.add(message);
            processAssistantMessage(message).catch((error) => showNotice(`自动装填失败：${error.message || error}`));
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    assistantMessages(root).slice(-3).forEach((message) => processAssistantMessage(message).catch(() => {}));
  }

  function style() {
    return `:host{display:block;color:inherit;font:13px/1.5 system-ui;min-width:0}.content{display:grid;gap:9px;min-width:0}.notice{min-height:18px;color:#666;overflow-wrap:anywhere}.library-shell,.card,.control-dock{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;min-width:0}.header-row{margin-bottom:8px}.row{display:flex;gap:7px;align-items:center;flex-wrap:wrap;min-width:0}.grow{flex:1;min-width:0;overflow-wrap:anywhere}.badge{font-size:11px;border:1px solid #ccc;border-radius:999px;padding:2px 7px}.search,input,textarea,button{box-sizing:border-box;max-width:100%;min-width:0;font:inherit;color:inherit;border:1px solid #bbb;background:#fff;border-radius:8px;padding:7px 9px}.search{width:100%;margin-bottom:8px}.ammo-list{display:grid;gap:7px;max-height:360px;overflow-y:auto;overflow-x:hidden;padding-right:2px;scrollbar-width:thin}.ammo-card{border:1px solid #ddd;border-radius:9px;padding:9px;cursor:pointer;outline:none;transition:border-color .14s ease,background .14s ease,transform .14s ease}.ammo-card:hover{background:#f7f7f7}.ammo-card:focus-visible{box-shadow:0 0 0 2px #7775}.ammo-card.selected{border-color:#202124;background:#f0f0f0;transform:translateX(1px)}.ammo-card p{margin:5px 0;color:#555;overflow-wrap:anywhere}.meta{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#777;overflow-wrap:anywhere}.control-dock{position:sticky;bottom:0;z-index:3;box-shadow:0 -8px 24px #0000000b;display:grid;gap:9px}.selection-summary{display:flex;align-items:center;gap:8px;min-width:0}.selection-summary span{font-size:11px;color:#666}.selection-summary b{overflow-wrap:anywhere}.action-group{display:grid;gap:5px}.action-group>span{font-size:11px;color:#666}.control-grid{display:grid;gap:6px}.library-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.item-actions{grid-template-columns:repeat(3,minmax(0,1fr))}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}.primary{background:#202124;color:#fff;border-color:#202124}.danger{color:#b42318}.editor{display:grid;gap:7px;margin-bottom:8px}.editor label{display:grid;gap:4px;font-size:12px}.editor textarea{width:100%;resize:vertical}.body-input{min-height:180px}.editor-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.empty{padding:24px;text-align:center;color:#777}@media(max-width:330px){.library-actions,.item-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.ammo-list{max-height:320px}}@media(prefers-color-scheme:dark){.library-shell,.card,.control-dock{background:#222;border-color:#444}.notice,.selection-summary span,.action-group>span{color:#aaa}.ammo-card{border-color:#444}.ammo-card:hover{background:#292929}.ammo-card.selected{background:#303030;border-color:#f3f3f3}.ammo-card p,.meta{color:#aaa}.badge{border-color:#555}input,textarea,button{background:#292929;color:#f3f3f3;border-color:#555}.primary{background:#f3f3f3;color:#181818}.danger{color:#ff8b82}.empty{color:#aaa}}`;
  }

  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy };

  try {
    document.getElementById(HOST_ID)?.remove();
    panel = document.createElement('section');
    panel.id = HOST_ID;
    panel.dataset.dcfPanelRoot = 'true';
    panel.dataset.dcfPanelId = PANEL_ID;
    panel.dataset.dcfPanelTitle = '弹药';
    panel.style.display = 'none';
    panel.attachShadow({ mode: 'open' }).innerHTML = `<style>${style()}</style><div class="content"></div>`;
    document.documentElement.append(panel);
    document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID }));

    send({ type: 'plugin.data.get', plugin_id: UNIT_ID }).then(async (result) => {
      const data = result.data && typeof result.data === 'object' ? result.data : {};
      state.items = data.items && typeof data.items === 'object' ? data.items : {};
      state.settings = { ...state.settings, ...(data.settings || {}) };
      state.selected_id = String(data.selected_id || '');
      if (!Object.keys(state.items).length) {
        try { await loadGitHub({ silent: true }); }
        catch (error) { showNotice(`GitHub 自动载入失败：${error.message || error}`); }
      }
      render();
      attachObserver();
      await send({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION });
    }).catch((error) => {
      send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
    });
  } catch (error) {
    destroy();
    send({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
  }
})();
