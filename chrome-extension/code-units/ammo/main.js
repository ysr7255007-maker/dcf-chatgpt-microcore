(function () {
  'use strict';
  const UNIT_ID = 'dcf.firstparty.ammo';
  const UNIT_VERSION = '1.0.0-rc.2';
  const PANEL_ID = 'ammo';
  const PANEL_HOST_ID = 'dcf-panel-ammo';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_AMMO__';
  const INVOCATION_MARKER = '〔DCF·语言弹药〕';
  const UPDATE_MARKER = '〔DCF·弹药更新〕';
  const LIBRARY_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/language-ammo-library/data/language-ammo/library.json';
  const send = (message) => chrome.runtime.sendMessage(message).then((result) => { if (!result || result.ok === false) throw new Error(result && result.error || 'DCF host rejected request'); return result; });
  const previous = globalThis[GLOBAL_KEY]; if (previous && typeof previous.destroy === 'function') previous.destroy();
  let panelHost; let observer; let retryTimer; let noticeTimer; const seen = new Set();
  const state = { items: {}, settings: { fire_mode: 'insert', library_url: LIBRARY_URL }, query: '', draft: null, notice: '' };
  function destroy() { observer?.disconnect(); clearTimeout(retryTimer); clearTimeout(noticeTimer); panelHost?.remove(); }
  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function cleanItem(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const id = String(item.id || '').trim(); const body = String(item.body || '').trim();
    if (!id || !body) throw new Error('语言弹药必须包含 id 和 body');
    const result = { id, title: String(item.title || id).trim(), purpose: String(item.purpose || '').trim(), body };
    const tags = Array.isArray(item.tags) ? item.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [];
    if (tags.length) result.tags = tags;
    if (item.created_at) result.created_at = String(item.created_at);
    if (item.updated_at) result.updated_at = String(item.updated_at);
    return result;
  }
  function signature(item) { return JSON.stringify({ id:item.id,title:item.title,purpose:item.purpose,body:item.body,tags:item.tags||[] }); }
  function upsert(raw, source = 'manual') {
    const item = cleanItem(raw); const old = state.items[item.id]; const changed = !old || signature(old) !== signature(item); const now = new Date().toISOString();
    state.items[item.id] = { ...old, ...item, created_at: old?.created_at || item.created_at || now, updated_at: changed ? now : old?.updated_at || item.updated_at || now, _meta: { version: old ? (changed ? Number(old._meta?.version || 1) + 1 : Number(old._meta?.version || 1)) : 1, source } };
    return { item: state.items[item.id], changed, created: !old };
  }
  async function persist() { await send({ type: 'plugin.data.set', plugin_id: UNIT_ID, data: { items: state.items, settings: state.settings } }); }
  async function mergeLibrary(library, source) {
    if (!library || library.schema !== 'dcf.language-ammo.library.v1' || !Array.isArray(library.items)) throw new Error('无效的语言弹药便携库');
    let added=0, updated=0, unchanged=0;
    for (const raw of library.items) { const result = upsert(raw, source); if (result.created) added += 1; else if (result.changed) updated += 1; else unchanged += 1; }
    await persist(); render(); return { added, updated, unchanged, total: library.items.length };
  }
  async function loadGithubLibrary({ silent = false } = {}) {
    const response = await fetch(state.settings.library_url || LIBRARY_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub 弹药库 HTTP ${response.status}`);
    const result = await mergeLibrary(await response.json(), 'github-library');
    if (!silent) setNotice(`GitHub 载入完成：新增 ${result.added}，更新 ${result.updated}，未变 ${result.unchanged}`);
    return result;
  }
  function decodeAmmoArtifacts(text) {
    const source = String(text || ''); const items = []; const errors = []; const start = '<<<DCF_AMMO'; const end = 'DCF_AMMO>>>'; let cursor=0;
    while (cursor < source.length) {
      const a = source.indexOf(start, cursor); if (a < 0) break; const open = source.indexOf('\n', a); const b = source.indexOf(end, open < 0 ? a + start.length : open + 1); if (b < 0) { errors.push('未找到 DCF_AMMO 结束标记'); break; }
      const body = source.slice(open < 0 ? a + start.length : open + 1, b).replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
      try { items.push(cleanItem(JSON.parse(body))); } catch (error) { errors.push(String(error && error.message || error)); }
      cursor = b + end.length;
    }
    return { items, errors };
  }
  function composer() { return document.querySelector('#prompt-textarea') || document.querySelector('[data-testid="composer-text-input"]') || document.querySelector('form textarea') || document.querySelector('main [contenteditable="true"]'); }
  function composerText(node) { return node && ('value' in node ? String(node.value || '') : String(node.innerText || node.textContent || '')); }
  function setComposer(node, text) {
    if (!node) throw new Error('未找到 ChatGPT 输入框');
    const existing = composerText(node).trim(); if (existing && existing !== String(text).trim()) throw new Error('输入框中已有未发送内容');
    node.focus();
    if ('value' in node) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')?.set; if (setter) setter.call(node, text); else node.value = text; node.dispatchEvent(new Event('input', { bubbles:true })); }
    else { const selection = getSelection(); if (selection) { const range = document.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range); } if (!document.execCommand?.('insertText', false, text)) node.textContent = text; node.dispatchEvent(new InputEvent('input', { bubbles:true,inputType:'insertText',data:text })); }
  }
  async function place(text, shouldSend) { const node = composer(); setComposer(node,text); if (!shouldSend) return; await delay(80); const button = document.querySelector('[data-testid="send-button"],button[aria-label*="Send"],button[aria-label*="发送"]'); if (!button || button.disabled) throw new Error('输入已填入，但发送按钮暂不可用'); button.click(); }
  function invocation(item) { return `${INVOCATION_MARKER}\n\n${item.body}`; }
  function updateRequest(item) { const raw = { ...item }; delete raw._meta; return [UPDATE_MARKER,'','请结合当前对话重新理解并修订下面这枚长期语言弹药。保留仍成立的核心意图，只吸收已经稳定形成的变化，不要机械摘要对话，不要另建相似弹药。必须保留原 id。','','完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body。','','当前弹药：',JSON.stringify(raw,null,2)].join('\n'); }
  function extractRequest() { return '请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。\n返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'; }
  async function copy(text) { await navigator.clipboard.writeText(String(text)); }
  function list() { const q=state.query.trim().toLowerCase(); return Object.values(state.items).filter((item)=>!q||`${item.id} ${item.title} ${item.purpose} ${(item.tags||[]).join(' ')}`.toLowerCase().includes(q)).sort((a,b)=>String(a.title).localeCompare(String(b.title),'zh-CN')); }
  function setNotice(text) { state.notice=String(text||''); renderNotice(); clearTimeout(noticeTimer); if (text) noticeTimer=setTimeout(()=>{state.notice='';renderNotice();},4200); }
  function renderNotice() { panelHost?.shadowRoot?.querySelector('.notice')?.replaceChildren(document.createTextNode(state.notice)); }
  function editorHtml() { if (!state.draft) return ''; const d=state.draft; return `<section class="card editor"><b>${d.original_id?'编辑':'新建'}语言弹药</b><label>ID<input data-field="id" value="${esc(d.id)}" ${d.original_id?'readonly':''}></label><label>标题<input data-field="title" value="${esc(d.title)}"></label><label>用途<textarea data-field="purpose">${esc(d.purpose)}</textarea></label><label>标签（逗号分隔）<input data-field="tags" value="${esc(d.tags)}"></label><label>正文<textarea class="body-input" data-field="body">${esc(d.body)}</textarea></label><div class="row"><button class="primary" data-action="save">保存</button><button data-action="cancel">取消</button></div></section>`; }
  function render() {
    const root=panelHost.shadowRoot; const shown=list(); root.querySelector('.content').innerHTML=`<div class="notice">${esc(state.notice)}</div><section class="card"><div class="row"><b>语言弹药工作台</b><span class="badge">${Object.keys(state.items).length} 枚</span></div><p>从新完成的助手回复自动装填；同一 ID 原位更新。</p><div class="row"><button class="primary" data-action="extract">从当前对话提取</button><button data-action="new">新建</button><button data-action="mode">发射：${state.settings.fire_mode==='send'?'直接发送':'填入输入框'}</button></div></section><section class="card"><b>GitHub 便携库</b><p>固定读取个人语言弹药库；不存在于 GitHub 的本地弹药不会被删除。</p><div class="row"><button data-action="github">从 GitHub 加载</button><button data-action="export">复制便携库</button><button data-action="import">导入文件</button><input hidden type="file" accept="application/json" data-role="file"></div></section>${editorHtml()}<input class="search" data-role="search" placeholder="搜索标题、用途、标签或 ID" value="${esc(state.query)}">${shown.length?shown.map((item)=>`<article class="card" data-id="${esc(item.id)}"><div class="row"><b class="grow">${esc(item.title||item.id)}</b><span class="badge">v${Number(item._meta?.version||1)}</span></div><p>${esc(item.purpose||item.id)} · ${esc(item.id)}</p><div class="row"><button class="primary" data-action="fire">发射</button><button data-action="copy">复制正文</button><button data-action="update">更新</button><button data-action="edit">编辑</button><button class="danger" data-action="delete">删除</button></div></article>`).join(''):'<div class="empty">还没有语言弹药。正在等待 GitHub 便携库或新的 DCF_AMMO。</div>'}`;
    bind();
  }
  function cardItem(node) { const card=node.closest('[data-id]'); return card&&state.items[card.dataset.id]; }
  function startDraft(item) { state.draft={original_id:item?.id||'',id:item?.id||`ammo-${Date.now().toString(36)}`,title:item?.title||'',purpose:item?.purpose||'',tags:(item?.tags||[]).join(', '),body:item?.body||''}; render(); }
  async function saveDraft() { const fields=Object.fromEntries(Array.from(panelHost.shadowRoot.querySelectorAll('[data-field]')).map((node)=>[node.dataset.field,node.value])); const item={id:fields.id,title:fields.title,purpose:fields.purpose,body:fields.body,tags:String(fields.tags||'').split(/[,，]/).map((v)=>v.trim()).filter(Boolean)}; upsert(item,'workbench'); state.draft=null; await persist(); render(); setNotice('语言弹药已保存'); }
  function bind() {
    const root=panelHost.shadowRoot; const search=root.querySelector('[data-role="search"]'); if(search)search.oninput=()=>{state.query=search.value;render();};
    for(const button of root.querySelectorAll('[data-action]')) button.onclick=async()=>{try{const action=button.dataset.action;const item=cardItem(button);if(action==='extract')await place(extractRequest(),true);else if(action==='new')startDraft();else if(action==='mode'){state.settings.fire_mode=state.settings.fire_mode==='send'?'insert':'send';await persist();render();}else if(action==='github')await loadGithubLibrary();else if(action==='export'){const library={schema:'dcf.language-ammo.library.v1',exported_at:new Date().toISOString(),count:Object.keys(state.items).length,items:Object.values(state.items).map((item)=>{const x={...item};delete x._meta;return x;})};await copy(JSON.stringify(library,null,2));setNotice(`已复制 ${library.count} 枚语言弹药`);}else if(action==='import')root.querySelector('[data-role="file"]').click();else if(action==='save')await saveDraft();else if(action==='cancel'){state.draft=null;render();}else if(action==='fire'&&item)await place(invocation(item),state.settings.fire_mode==='send');else if(action==='copy'&&item){await copy(item.body);setNotice('正文已复制');}else if(action==='update'&&item)await place(updateRequest(item),true);else if(action==='edit'&&item)startDraft(item);else if(action==='delete'&&item&&confirm(`删除“${item.title||item.id}”？`)){delete state.items[item.id];await persist();render();}}catch(error){setNotice(`操作失败：${String(error&&error.message||error)}`);}};
    const file=root.querySelector('[data-role="file"]');if(file)file.onchange=async()=>{try{if(file.files[0])await mergeLibrary(JSON.parse(await file.files[0].text()),'file-import');setNotice('导入完成');}catch(error){setNotice(`导入失败：${String(error&&error.message||error)}`);}file.value='';};
  }
  function textHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
  function assistantNodes(root){return Array.from(root.querySelectorAll('[data-message-author-role="assistant"]'));}
  async function ingestNode(node){await delay(1100);if(!node.isConnected)return;const text=String(node.innerText||node.textContent||'');if(!text.includes('DCF_AMMO'))return;const key=textHash(text);if(seen.has(key))return;seen.add(key);const decoded=decodeAmmoArtifacts(text);for(const item of decoded.items)upsert(item,'assistant-reply');if(decoded.items.length){await persist();render();setNotice(`已自动装填 ${decoded.items.length} 枚语言弹药`);}if(decoded.errors.length)setNotice(`发现 DCF_AMMO，但有 ${decoded.errors.length} 个解析失败`);}
  function attachObserver(){const main=document.querySelector('main')||document.querySelector('[role="main"]');if(!main){retryTimer=setTimeout(attachObserver,900);return;}const known=new WeakSet(assistantNodes(main));observer=new MutationObserver((records)=>{for(const record of records)for(const added of record.addedNodes){if(!(added instanceof Element))continue;const nodes=[];if(added.matches?.('[data-message-author-role="assistant"]'))nodes.push(added);nodes.push(...added.querySelectorAll?.('[data-message-author-role="assistant"]')||[]);for(const node of nodes)if(!known.has(node)){known.add(node);ingestNode(node).catch((error)=>setNotice(`自动装填失败：${error.message||error}`));}}});observer.observe(main,{childList:true,subtree:true});assistantNodes(main).slice(-3).forEach((node)=>ingestNode(node).catch(()=>undefined));}
  function createPanel(){panelHost=document.createElement('section');panelHost.id=PANEL_HOST_ID;panelHost.dataset.dcfPanelRoot='true';panelHost.dataset.dcfPanelId=PANEL_ID;panelHost.dataset.dcfPanelTitle='弹药';panelHost.style.display='none';const root=panelHost.attachShadow({mode:'open'});root.innerHTML=`<style>:host{display:block;color:inherit;font:13px/1.5 system-ui}.content{display:grid;gap:9px}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff}.row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.grow{flex:1}.badge{border-radius:999px;padding:2px 7px;background:#eee;font-size:11px}p{margin:5px 0;color:#666;font-size:12px}button,input,textarea{font:inherit;color:inherit}button{border:1px solid #bbb;background:#fff;border-radius:8px;padding:6px 9px;cursor:pointer}.primary{background:#202124;color:#fff;border-color:#202124}.danger{color:#a11616}.search,label{display:grid;gap:4px}.search,input,textarea{width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:8px;padding:7px;background:#fff;color:#202124}.body-input{min-height:220px}.notice{min-height:18px;color:#666}.empty{text-align:center;padding:20px;color:#777}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}button,input,textarea{background:#292929;color:#f3f3f3;border-color:#555}.primary{background:#f3f3f3;color:#181818}.badge{background:#333}p,.notice,.empty{color:#aaa}}</style><div class="content"></div>`;document.documentElement.append(panelHost);document.dispatchEvent(new CustomEvent('dcf:panel-ready',{detail:PANEL_ID}));}

  try {
    document.getElementById(PANEL_HOST_ID)?.remove(); createPanel();
    send({type:'plugin.data.get',plugin_id:UNIT_ID}).then(async(result)=>{const data=result.data||{};state.items=data.items&&typeof data.items==='object'?data.items:{};state.settings={...state.settings,...(data.settings||{})};render();attachObserver();if(!Object.keys(state.items).length){try{const loaded=await loadGithubLibrary({silent:true});if(loaded.total)setNotice(`已从 GitHub 恢复 ${loaded.total} 枚语言弹药`);}catch(_){}}await send({type:'unit.started',unit_id:UNIT_ID,version:UNIT_VERSION});}).catch((error)=>send({type:'unit.failed',unit_id:UNIT_ID,version:UNIT_VERSION,error:String(error&&error.message||error)}).catch(()=>undefined));
  } catch(error){destroy();send({type:'unit.failed',unit_id:UNIT_ID,version:UNIT_VERSION,error:String(error&&error.message||error)}).catch(()=>undefined);}
})();
