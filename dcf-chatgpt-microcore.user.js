// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.8.7
// @description  DCF light capability-bus kernel with fixed command dispatch and lightweight diagnostics. No remote eval, no chunks.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.8.7';
  const STATE_KEY = 'dcf.kernel.state.v1';
  const REGISTRY_KEY = 'dcf.kernel.registry.v1';
  const LOG_KEY = 'dcf.kernel.log.v1';
  const KV_PREFIX = 'dcf.kv.';
  const PACK_RE = /<<<DCF_MODULE_PACK\b\s*([\s\S]*?)\s*DCF_MODULE_PACK>>>/g;
  const MAINT_RE = /<<<DCF_MAINT_REQUEST\b\s*([\s\S]*?)\s*DCF_MAINT_REQUEST>>>/g;
  const LEGACY_KEYS = ['dcf.github.engine.cache.v1','dcf.github.engine.lastCheck.v1','dcf.local.engine.v1','dcf.ammo.store.v1','dcf.module.registry.v1','dcf.kernel.modules.v1'];
  const DEFAULT_SEND_POLICY = {
    id: 'chatgpt.web.send.default', timeout_ms: 6000, interval_ms: 180, success_delay_ms: 500,
    selectors: ['button[data-testid="send-button"]','button[data-testid="composer-send-button"]','button[aria-label="Send prompt"]','button[aria-label*="Send"]','button[aria-label*="发送"]','form button[type="submit"]']
  };
  const CAPABILITY_NAMES = [
    'ui.notice','ui.rerender','ui.addStyle','ui.notify','ui.setTab','ui.setSection','ui.showModule',
    'composer.find','composer.read','composer.insert','composer.replace','composer.append','composer.clear','composer.send','composer.sendPolicy.get','composer.sendPolicy.set','composer.sendPolicy.test',
    'conversation.readText','conversation.getPageInfo','conversation.findBlocks','conversation.findModulePacks','conversation.observe','clipboard.write',
    'store.get','store.set','store.delete','store.list','store.snapshot','store.restore',
    'module.list','module.get','module.install','module.update','module.enable','module.disable','module.remove','module.reload',
    'package.detect','package.apply','package.fetchAndApply','package.listInstalled','network.fetchData',
    'log.write','log.list','log.clear','maintenance.feedback','maintenance.diagnose','maintenance.requestKernelChange'
  ];

  const state = loadState();
  const registry = loadRegistry();
  const capabilities = makeCapabilities();
  let scanTimer = null;
  let lastScan = { at: '', packs: 0, ignored: 0, maint: 0, textLength: 0 };

  const host = document.createElement('div');
  host.id = 'dcf-chatgpt-microcore-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}.shell{position:fixed;top:72px;right:12px;bottom:86px;width:min(372px,calc(100vw - 28px));z-index:2147483646;display:flex;flex-direction:column;border:1px solid #9996;border-radius:16px;background:#fffffff0;color:#111;box-shadow:0 18px 44px #0002;font:13px/1.42 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}.shell[data-side=left]{left:12px;right:auto}@media(prefers-color-scheme:dark){.shell{background:#171717ee;color:#f5f5f5;border-color:#fff3;box-shadow:0 18px 44px #0008}}.top{display:flex;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid #9994}.title{font-weight:780}.sub,.mini{font-size:11px;opacity:.62}.pill,.badge{border:1px solid #2563eb66;border-radius:999px;padding:3px 7px;font-size:11px;white-space:nowrap}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;border-bottom:1px solid #9993}.tab,.a{border:1px solid #9995;border-radius:10px;background:transparent;color:inherit;cursor:pointer}.tab{padding:7px 0;font-weight:650}.tab[aria-selected=true],.a.primary{background:#2563eb22;border-color:#2563eb66;font-weight:700}.content{flex:1;overflow:auto;padding:10px}.notice{border:1px solid #05966955;background:#05966918;border-radius:12px;padding:8px 9px;margin-bottom:10px}.warn{border:1px solid #d9770655;background:#d9770618;border-radius:12px;padding:8px 9px;margin-bottom:10px}.block{border:1px solid #9994;border-radius:14px;margin-bottom:10px;overflow:hidden;background:#8881}.head{width:100%;display:flex;justify-content:space-between;gap:10px;border:0;padding:10px 12px;color:inherit;background:transparent;text-align:left;cursor:pointer;font:inherit}.bt{font-weight:760}.bd{font-size:12px;opacity:.62}.body{padding:0 12px 12px;border-top:1px solid #9992}.card{border:1px solid #9993;border-radius:12px;padding:9px;margin-top:8px}.name{font-weight:720}.desc{font-size:12px;opacity:.68;margin-top:3px}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.a{padding:7px 9px;font:12px/1.1 system-ui}.a.hot{background:#7c3aed22;border-color:#7c3aed66;font-weight:700}.a.warnbtn{background:#d9770622;border-color:#d9770666}.empty{border:1px dashed #9996;border-radius:12px;padding:12px;opacity:.72}.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.chip{border:1px solid #9994;border-radius:999px;padding:2px 6px;font-size:11px;opacity:.76}.kv{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;opacity:.72}textarea{width:100%;min-height:92px;box-sizing:border-box;border:1px solid #9995;border-radius:12px;padding:8px;background:#fff8;color:inherit;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}@media(prefers-color-scheme:dark){textarea{background:#0003}}
  </style><aside class='shell'></aside>`;
  const shell = root.querySelector('.shell');
  document.documentElement.appendChild(host);

  shell.addEventListener('click', onClick);
  shell.addEventListener('input', (event) => { if (event.target?.dataset?.role === 'pack') state.packDraft = event.target.value; });
  registerMenu();
  render();
  scheduleScan(220);
  new MutationObserver(() => scheduleScan(750)).observe(document.body, { childList: true, subtree: true, characterData: true });

  function render() {
    shell.dataset.side = state.side;
    shell.innerHTML = `<div class='top'><div><div class='title'>DCF Kernel</div><div class='sub'>native ${VERSION} · light diagnostics</div></div><span class='pill'>${registry.modules.length} modules</span></div><div class='tabs'><button class='tab' aria-selected='${state.tab === 'maint'}' data-act='tab' data-tab='maint'>维护</button><button class='tab' aria-selected='${state.tab === 'modules'}' data-act='tab' data-tab='modules'>模块</button></div><div class='content'>${state.notice ? `<div class='notice'>${esc(state.notice)}</div>` : ''}${state.tab === 'modules' ? modulesView() : maintView()}</div>`;
  }
  function maintView() {
    return `<div class='warn'>0.8.7 修复顶层 commands 点击无效；命令失败写轻量日志；新增 DCF_MAINT_REQUEST 诊断入口。</div>${section('status','内核状态','版本、扫描、发送策略。',statusBody())}${section('install','模块包入口','自动扫描 DCF_MODULE_PACK。',installBody())}${section('events','轻量日志','最近 60 条本地事件。',eventsBody())}${section('caps','能力接口','模块可调用的能力面。',capsBody())}${section('repair','维护请求','不依赖普通模块命令的日志回传。',repairBody())}${section('danger','恢复','本地状态清理。',dangerBody())}`;
  }
  function modulesView() {
    if (!registry.modules.length) return `<div class='empty'>当前没有业务模块。</div>`;
    return registry.modules.map(renderModule).join('');
  }
  function section(id, title, desc, body) {
    const open = state.section === id;
    return `<section class='block'><button class='head' data-act='section' data-section='${esc(id)}'><span><div class='bt'>${esc(title)}</div><div class='bd'>${esc(desc)}</div></span><span>${open ? '−' : '+'}</span></button>${open ? `<div class='body'>${body}</div>` : ''}</section>`;
  }
  function statusBody() {
    const p = currentSendPolicy();
    return `<div class='mini'>kernel: ${VERSION}</div><div class='mini'>scan: ${esc(lastScan.at || 'pending')} · packs ${lastScan.packs} · ignored ${lastScan.ignored} · maint ${lastScan.maint}</div><div class='mini'>modules: ${registry.modules.length} · packs: ${Object.keys(registry.installedPacks).length}</div><div class='mini'>send policy: ${esc(p.id)} · ${p.timeout_ms}ms</div><div class='actions'><button class='a primary' data-act='copy-diag'>复制诊断</button><button class='a' data-act='send-diag'>发送诊断反馈</button><button class='a' data-act='scan-now'>立即扫描</button><button class='a' data-act='side'>切换左右</button></div>`;
  }
  function installBody() {
    return `<div class='mini'>这里仍只作调试。正式安装来自对话里的真实模块包。</div><textarea data-role='pack' placeholder='paste dcf.module_pack.v1 JSON'></textarea><div class='actions'><button class='a primary' data-act='apply-pack'>手动应用</button><button class='a hot' data-act='probe'>安装自检模块</button><button class='a' data-act='copy-sample'>复制样例包</button></div>`;
  }
  function eventsBody() {
    const events = recentEvents(12);
    return `${events.length ? events.map((e) => `<div class='card'><div class='name'>${esc(e.type || e.event || 'event')} · ${esc(e.status || '')}</div><div class='mini'>${esc(e.at || '')}</div><div class='kv'>${esc(JSON.stringify(compactEvent(e)))}</div></div>`).join('') : `<div class='empty'>暂无事件。</div>`}<div class='actions'><button class='a' data-act='copy-log'>复制日志</button><button class='a warnbtn' data-act='clear-log'>清空日志</button></div>`;
  }
  function capsBody() {
    const groups = {};
    for (const name of CAPABILITY_NAMES) { const g = name.split('.')[0]; (groups[g] ||= []).push(name); }
    return Object.keys(groups).map((g) => `<div class='card'><div class='name'>${esc(g)}.*</div><div class='chips'>${groups[g].map((n) => `<span class='chip'>${esc(n)}</span>`).join('')}</div></div>`).join('');
  }
  function repairBody() {
    return `<div class='mini'>维护请求只回传诊断，不执行任意动作。</div><div class='actions'><button class='a primary' data-act='copy-maint-request'>复制维护请求块</button><button class='a' data-act='copy-repair'>复制纠错提示</button></div>`;
  }
  function dangerBody() {
    return `<div class='actions'><button class='a warnbtn' data-act='clear-legacy'>清理历史状态</button><button class='a warnbtn' data-act='clear-ledger'>清空安装账本</button><button class='a warnbtn' data-act='reset-modules'>清空模块</button></div>`;
  }
  function renderModule(module) {
    const blocks = getRenderableBlocks(module);
    return `<section class='block'><button class='head' data-act='noop'><span><div class='bt'>${esc(module.title)}</div><div class='bd'>${esc(module.description || module.id)}</div></span><span class='badge'>${esc(module.disabled ? 'disabled' : module.version)}</span></button><div class='body'><div class='mini'>${esc(module.id)}</div>${module.permissions.length ? `<div class='chips'>${module.permissions.map((p) => `<span class='chip'>${esc(p)}</span>`).join('')}</div>` : ''}${blocks.length ? blocks.map((b, bi) => renderBlock(module, b, bi)).join('') : `<div class='empty'>没有可执行命令。</div>`}<div class='actions'><button class='a warnbtn' data-act='disable-module' data-module='${esc(module.id)}'>卸载模块</button></div></div></section>`;
  }
  function renderBlock(module, block, blockIndex) {
    const commands = block.commands || [];
    return `<div class='card'><div class='name'>${esc(block.title || block.id)}</div><div class='desc'>${esc(block.description || '')}</div>${commands.length ? `<div class='actions'>${commands.map((c, ci) => `<button class='a ${c.primary ? 'primary' : ''}' data-act='run-command' data-module='${esc(module.id)}' data-block='${blockIndex}' data-command='${ci}'>${esc(c.label || c.id)}</button>`).join('')}</div>` : `<div class='mini'>没有命令。</div>`}</div>`;
  }
  function getRenderableBlocks(module) {
    if (!module) return [];
    if (Array.isArray(module.blocks) && module.blocks.length) return module.blocks;
    if (Array.isArray(module.commands) && module.commands.length) return [{ id: 'commands', title: '模块命令', description: module.description || '', commands: module.commands }];
    return [];
  }

  function onClick(event) {
    const node = event.target.closest('[data-act]');
    if (!node) return;
    const act = node.dataset.act;
    if (act === 'noop') return;
    if (act === 'tab') { state.tab = node.dataset.tab === 'modules' ? 'modules' : 'maint'; saveState(); render(); return; }
    if (act === 'section') { state.section = node.dataset.section || 'status'; saveState(); render(); return; }
    if (act === 'copy-diag') { copyText(diagnostics()); notice('诊断已复制。'); return; }
    if (act === 'send-diag') { emitFeedback({ event: 'maintenance_diagnostics', status: 'ok', diagnostics: diagnosticsObject({ compact: true }) }); return; }
    if (act === 'copy-log') { copyText(JSON.stringify(getLog(), null, 2)); notice('日志已复制。'); return; }
    if (act === 'clear-log') { setLog([]); notice('日志已清空。'); return; }
    if (act === 'scan-now') { autoScan(true); return; }
    if (act === 'side') { state.side = state.side === 'left' ? 'right' : 'left'; saveState(); render(); return; }
    if (act === 'apply-pack') { applyPackFromTextarea(); return; }
    if (act === 'probe') { applyPack(probePack(), { source: 'self-test', feedback: true, force: true }); return; }
    if (act === 'copy-sample') { copyText(JSON.stringify(samplePack(), null, 2)); notice('样例包已复制。'); return; }
    if (act === 'copy-maint-request') { copyText(maintRequestBlock()); notice('维护请求块已复制。'); return; }
    if (act === 'copy-repair') { copyText(repairPrompt()); notice('纠错提示已复制。'); return; }
    if (act === 'clear-legacy') { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); writeLog({ type: 'clear_legacy', status: 'ok' }); notice('历史状态已清理。'); return; }
    if (act === 'clear-ledger') { registry.installedPacks = {}; registry.seenBlocks = {}; registry.rejections = []; saveRegistry(); notice('安装账本已清空。'); return; }
    if (act === 'reset-modules') { registry.modules = []; registry.lastHotUpdate = { at: now(), source: 'reset' }; saveRegistry(); writeLog({ type: 'module_reset', status: 'ok' }); state.tab = 'maint'; notice('模块已清空。'); return; }
    if (act === 'disable-module') { removeModule(node.dataset.module); return; }
    if (act === 'run-command') runCommandFromNode(node);
  }

  function scheduleScan(delay) { clearTimeout(scanTimer); scanTimer = setTimeout(() => autoScan(false), delay); }
  function autoScan(manual) {
    const text = readPageText();
    const packs = textBlocks(text, PACK_RE);
    const maint = textBlocks(text, MAINT_RE);
    let ignored = 0;
    lastScan = { at: now(), packs: packs.length, ignored: 0, maint: maint.length, textLength: text.length };
    for (const block of packs) if (processPackBlock(block, manual) === 'ignored') ignored += 1;
    for (const block of maint) processMaintBlock(block, manual);
    lastScan.ignored = ignored;
    render();
  }
  function processPackBlock(block, manual) {
    const raw = block.raw;
    const sourceHash = hash(raw);
    if (registry.seenBlocks[sourceHash] && !manual) return 'seen';
    const candidate = classifyJsonCandidate(raw);
    if (!candidate.shouldParse) { registry.seenBlocks[sourceHash] = { status: 'ignored', at: now(), reason: candidate.reason }; writeLog({ type: 'package_ignore', status: 'ignored', reason: candidate.reason, sourceHash }); saveRegistry(); return 'ignored'; }
    let pack;
    try { pack = JSON.parse(raw.trim()); } catch (error) { registry.seenBlocks[sourceHash] = { status: 'rejected', at: now(), reason: 'json_parse_failed' }; rememberRejected(sourceHash, 'json_parse_failed', error.message); emitFeedback({ event: 'module_install', status: 'failed', reason: 'json_parse_failed', error: error.message, source_hash: sourceHash }); return 'failed'; }
    const result = applyPack(pack, { source: 'auto-scan', sourceHash, feedback: true });
    if (result.status === 'skipped') { registry.seenBlocks[sourceHash] = { status: 'skipped', at: now(), reason: result.reason }; saveRegistry(); }
    return result.status;
  }
  function processMaintBlock(block, manual) {
    const raw = block.raw;
    const sourceHash = 'maint:' + hash(raw);
    if (registry.seenBlocks[sourceHash] && !manual) return 'seen';
    const candidate = classifyJsonCandidate(raw);
    if (!candidate.shouldParse) { registry.seenBlocks[sourceHash] = { status: 'ignored', at: now(), reason: candidate.reason }; writeLog({ type: 'maint_ignore', status: 'ignored', reason: candidate.reason, sourceHash }); saveRegistry(); return 'ignored'; }
    let request;
    try { request = JSON.parse(raw.trim()); } catch (error) { writeLog({ type: 'maint_request', status: 'failed', reason: 'json_parse_failed', sourceHash }); registry.seenBlocks[sourceHash] = { status: 'rejected', at: now(), reason: 'json_parse_failed' }; saveRegistry(); return 'failed'; }
    if (request.schema !== 'dcf.maintenance.request.v1') { writeLog({ type: 'maint_request', status: 'failed', reason: 'bad_schema', sourceHash }); registry.seenBlocks[sourceHash] = { status: 'rejected', at: now(), reason: 'bad_schema' }; saveRegistry(); return 'failed'; }
    const payload = handleMaintRequest(request);
    registry.seenBlocks[sourceHash] = { status: 'handled', at: now(), request_id: payload.request_id };
    writeLog({ type: 'maint_request', status: 'ok', request_id: payload.request_id, sourceHash });
    saveRegistry();
    emitFeedback({ event: 'maintenance_request', status: 'ok', ...payload });
    return 'ok';
  }
  function classifyJsonCandidate(raw) {
    const text = String(raw || '').trim();
    if (!text) return { shouldParse: false, reason: 'empty_block' };
    if (text === '...' || text.startsWith('...')) return { shouldParse: false, reason: 'placeholder_ellipsis' };
    if (!text.startsWith('{')) return { shouldParse: false, reason: 'not_json_object' };
    if (!text.includes('"schema"') && !text.includes("'schema'")) return { shouldParse: false, reason: 'missing_schema_marker' };
    return { shouldParse: true };
  }
  function handleMaintRequest(request) {
    const allow = new Set(['diagnostics','recent_log','module_list','installed_pack_list','last_command_error','last_capability_error','composer_probe','send_policy','last_scan']);
    const actions = Array.isArray(request.actions) ? request.actions.map(String).filter((x) => allow.has(x)) : ['diagnostics','recent_log','composer_probe'];
    const out = { schema: 'dcf.maintenance.response.v1', request_id: String(request.request_id || ('request.' + now())), actions };
    if (actions.includes('diagnostics')) out.diagnostics = diagnosticsObject({ compact: true });
    if (actions.includes('recent_log')) out.recent_log = recentEvents(30).reverse();
    if (actions.includes('module_list')) out.modules = registry.modules.map(publicModule);
    if (actions.includes('installed_pack_list')) out.installed_packs = registry.installedPacks;
    if (actions.includes('last_command_error')) out.last_command_error = findLastLog((e) => e.type && String(e.type).startsWith('command_') && e.status === 'failed');
    if (actions.includes('last_capability_error')) out.last_capability_error = findLastLog((e) => e.type === 'capability_call' && e.status === 'failed');
    if (actions.includes('composer_probe')) out.composer = composerProbe();
    if (actions.includes('send_policy')) out.send_policy = currentSendPolicy();
    if (actions.includes('last_scan')) out.last_scan = lastScan;
    return out;
  }

  function applyPackFromTextarea() {
    const text = root.querySelector('[data-role="pack"]')?.value?.trim() || state.packDraft || '';
    if (!text) { notice('没有可应用的模块包 JSON。'); return; }
    try { applyPack(JSON.parse(text), { source: 'manual-textarea', feedback: true, force: true }); }
    catch (error) { notice('模块包 JSON 解析失败：' + error.message); emitFeedback({ event: 'module_install', status: 'failed', reason: 'json_parse_failed', error: error.message }); }
  }
  function applyPack(pack, options) {
    const opts = { source: 'unknown', sourceHash: hash(safeStringify(pack)), feedback: false, force: false, ...options };
    const normalized = normalizePack(pack);
    if (!normalized.ok) { rememberRejected(opts.sourceHash, normalized.reason || 'invalid_pack', normalized.error); if (opts.feedback) emitFeedback({ event: 'module_install', status: 'failed', reason: normalized.reason || 'invalid_pack', error: normalized.error, source_hash: opts.sourceHash }); return { status: 'failed', reason: normalized.reason || 'invalid_pack' }; }
    const key = normalized.pack.packId + '@' + normalized.pack.revision;
    if (!opts.force && registry.installedPacks[key]) { registry.seenBlocks[opts.sourceHash] = { status: 'installed_duplicate', at: now(), key }; saveRegistry(); return { status: 'skipped', reason: 'already_installed', key }; }
    const warnings = collectPackWarnings(normalized.pack);
    if (normalized.pack.mode === 'replace') registry.modules = [];
    for (const module of normalized.pack.modules) upsertModule(module);
    const record = { pack_id: normalized.pack.packId, revision: normalized.pack.revision, installedAt: now(), moduleCount: normalized.pack.modules.length, modules: normalized.pack.modules.map((m) => m.id), sourceHash: opts.sourceHash, warnings };
    registry.installedPacks[key] = record;
    registry.seenBlocks[opts.sourceHash] = { status: 'installed', at: record.installedAt, key };
    registry.lastHotUpdate = { at: record.installedAt, source: opts.source, pack_id: record.pack_id, revision: record.revision, moduleCount: record.moduleCount };
    writeLog({ type: 'module_install', status: 'ok', ...registry.lastHotUpdate, warnings });
    saveRegistry();
    state.tab = 'modules'; state.section = 'status'; notice('自动热更新完成：' + record.moduleCount + ' 个模块已装载。');
    if (opts.feedback) emitFeedback({ event: 'module_install', status: 'ok', pack_id: record.pack_id, revision: record.revision, installed_modules: record.modules, warnings, source_hash: opts.sourceHash });
    return { status: 'ok', record };
  }
  function normalizePack(pack) {
    if (!pack || typeof pack !== 'object') return { ok: false, reason: 'not_object', error: '模块包不是对象。' };
    if (pack.schema !== 'dcf.module_pack.v1') return { ok: false, reason: 'bad_schema', error: '模块包 schema 必须是 dcf.module_pack.v1。' };
    if (!Array.isArray(pack.modules)) return { ok: false, reason: 'missing_modules', error: '模块包缺少 modules 数组。' };
    const modules = pack.modules.map(normalizeModule).filter(Boolean);
    if (!modules.length) return { ok: false, reason: 'no_valid_modules', error: '模块包没有合法模块。' };
    return { ok: true, pack: { packId: String(pack.pack_id || pack.packId || ('pack.' + hash(JSON.stringify(pack)))), revision: String(pack.revision || pack.version || hash(JSON.stringify(pack))).slice(0, 80), mode: pack.mode === 'replace' ? 'replace' : 'merge', modules } };
  }
  function normalizeModule(module) {
    if (!module || typeof module !== 'object') return null;
    const id = String(module.id || '').trim();
    const title = String(module.title || '').trim();
    if (!id || !title) return null;
    const templates = isPlainObject(module.templates) ? module.templates : {};
    const commands = Array.isArray(module.commands) ? module.commands.map(normalizeCommand).filter(Boolean) : [];
    const blocks = Array.isArray(module.blocks) ? module.blocks.map(normalizeBlock).filter(Boolean) : [];
    return { id, title, version: String(module.version || '1.0.0'), description: String(module.description || ''), permissions: Array.isArray(module.permissions) ? module.permissions.map(String) : [], templates, commands, blocks, installedAt: module.installedAt || now(), disabled: Boolean(module.disabled) };
  }
  function normalizeBlock(block) {
    if (!block || typeof block !== 'object') return null;
    const sourceCommands = Array.isArray(block.commands) ? block.commands : (Array.isArray(block.actions) ? block.actions.map(actionToCommand) : []);
    const id = String(block.id || ('block.' + hash(JSON.stringify(block))));
    return { id, title: String(block.title || id), description: String(block.description || ''), commands: sourceCommands.map(normalizeCommand).filter(Boolean) };
  }
  function normalizeCommand(command) {
    if (!command || typeof command !== 'object') return null;
    if (!Array.isArray(command.steps) && command.kind) return normalizeCommand(actionToCommand(command));
    const steps = Array.isArray(command.steps) ? command.steps.map(normalizeStep).filter(Boolean) : [];
    if (!steps.length) return null;
    const id = String(command.id || ('command.' + hash(JSON.stringify(command))));
    return { id, label: String(command.label || command.title || id), description: String(command.description || ''), primary: Boolean(command.primary), feedback: Boolean(command.feedback), steps };
  }
  function actionToCommand(action) {
    const id = String(action.id || action.kind || ('action.' + hash(JSON.stringify(action))));
    const label = String(action.label || id);
    const text = String(action.text || '');
    if (action.kind === 'insert_text') return { id, label, primary: Boolean(action.primary), steps: [{ call: 'composer.insert', with: { text } }] };
    if (action.kind === 'insert_and_send') return { id, label, primary: Boolean(action.primary), steps: [{ call: 'composer.insert', with: { text } }, { call: 'composer.send' }] };
    if (action.kind === 'copy_text') return { id, label, steps: [{ call: 'clipboard.write', with: { text } }, { call: 'ui.notice', with: { text: action.message || '模块文本已复制。' } }] };
    if (action.kind === 'notice') return { id, label, steps: [{ call: 'ui.notice', with: { text: action.message || text || '模块动作已执行。' } }] };
    return { id, label, steps: [] };
  }
  function normalizeStep(step) { const call = String(step?.call || '').trim(); return call ? { call, with: isPlainObject(step.with) ? step.with : {}, as: step.as ? String(step.as) : '' } : null; }
  function collectPackWarnings(pack) { const warnings = []; for (const module of pack.modules) { for (const command of module.commands) collectCommandWarnings(module, command, warnings); for (const block of module.blocks) for (const command of block.commands) collectCommandWarnings(module, command, warnings); } return warnings.slice(0, 20); }
  function collectCommandWarnings(module, command, warnings) { for (const step of command.steps) { if (!CAPABILITY_NAMES.includes(step.call)) warnings.push('missing capability now: ' + module.id + '.' + command.id + ' -> ' + step.call); else if (module.permissions.length && !permissionCovers(module.permissions, step.call)) warnings.push('undeclared permission: ' + module.id + '.' + command.id + ' -> ' + step.call); } }

  async function runCommandFromNode(node) {
    const moduleId = node.dataset.module || '';
    const blockIndex = Number(node.dataset.block);
    const commandIndex = Number(node.dataset.command);
    writeLog({ type: 'command_click', status: 'received', module_id: moduleId, block: blockIndex, command: commandIndex });
    const module = registry.modules.find((m) => m.id === moduleId);
    const block = getRenderableBlocks(module)[blockIndex];
    const command = block?.commands?.[commandIndex];
    if (!module || !block || !command) {
      const reason = !module ? 'module_not_found' : (!block ? 'block_not_found' : 'command_not_found');
      writeLog({ type: 'command_lookup', status: 'failed', module_id: moduleId, block: blockIndex, command: commandIndex, reason });
      notice('模块命令定位失败：' + reason);
      emitFeedback({ event: 'command_lookup', status: 'failed', module_id: moduleId, block: blockIndex, command: commandIndex, reason });
      return;
    }
    if (module.disabled) { notice('模块已禁用：' + module.id); return; }
    writeLog({ type: 'command_lookup', status: 'ok', module_id: module.id, block_id: block.id, command_id: command.id });
    try {
      writeLog({ type: 'command_run', status: 'start', module_id: module.id, command_id: command.id });
      const result = await runCommand(module, command);
      writeLog({ type: 'command_run', status: 'ok', module_id: module.id, command_id: command.id, result: compactValue(result) });
      if (command.feedback) emitFeedback({ event: 'command_run', status: 'ok', module_id: module.id, command_id: command.id, result: compactValue(result) });
    } catch (error) {
      writeLog({ type: 'command_run', status: 'failed', module_id: module.id, command_id: command.id, reason: error.code || 'command_failed', error: error.message });
      notice('模块命令执行失败：' + error.message);
      emitFeedback({ event: 'command_run', status: 'failed', module_id: module.id, command_id: command.id, reason: error.code || 'command_failed', error: error.message });
    }
  }
  async function runCommand(module, command) {
    const vars = { now: now(), page_url: location.href, page_title: document.title, module_id: module.id, module_title: module.title };
    let last = null;
    for (const step of command.steps) { const payload = interpolateObject(step.with || {}, vars, module); last = await callCapability(step.call, payload, { module, command, step }); if (step.as) vars[step.as] = last; }
    return last;
  }
  async function callCapability(name, payload, context) {
    const module = context?.module || null;
    if (!capabilities[name]) { const error = new Error('Capability not available: ' + name); error.code = 'capability_not_available'; writeLog({ type: 'capability_call', status: 'failed', capability: name, module_id: module?.id || '', reason: error.code }); emitFeedback({ event: 'capability_call', status: 'failed', module_id: module?.id || '', capability: name, reason: error.code, suggestion: 'maintenance.requestKernelChange' }); throw error; }
    if (module?.permissions?.length && !permissionCovers(module.permissions, name)) writeLog({ type: 'permission_note', status: 'warning', module_id: module.id, capability: name, reason: 'undeclared_permission_but_allowed' });
    try { return await Promise.resolve(capabilities[name](payload || {}, context || {})); }
    catch (error) { writeLog({ type: 'capability_call', status: 'failed', capability: name, module_id: module?.id || '', reason: error.message }); emitFeedback({ event: 'capability_call', status: 'failed', module_id: module?.id || '', capability: name, reason: 'runtime_error', error: error.message }); throw error; }
  }

  function makeCapabilities() {
    return {
      'ui.notice': ({ text }) => { notice(String(text || '')); return { ok: true }; }, 'ui.rerender': () => { render(); return { ok: true }; }, 'ui.addStyle': ({ css }) => { if (typeof GM_addStyle === 'function') GM_addStyle(String(css || '')); else { const s = document.createElement('style'); s.textContent = String(css || ''); document.head.appendChild(s); } return { ok: true }; }, 'ui.notify': ({ title, text }) => { if (typeof GM_notification === 'function') GM_notification({ title: String(title || 'DCF'), text: String(text || ''), silent: true }); else notice(String(text || '')); return { ok: true }; }, 'ui.setTab': ({ tab }) => { state.tab = tab === 'modules' ? 'modules' : 'maint'; saveState(); render(); return { ok: true }; }, 'ui.setSection': ({ section }) => { state.section = String(section || 'status'); saveState(); render(); return { ok: true }; }, 'ui.showModule': () => { state.tab = 'modules'; saveState(); render(); return { ok: true }; },
      'composer.find': () => composerProbe(), 'composer.read': () => ({ text: readComposer() }), 'composer.insert': ({ text }) => insertText(String(text || ''), { mode: 'insert' }), 'composer.replace': ({ text }) => insertText(String(text || ''), { mode: 'replace' }), 'composer.append': ({ text }) => insertText(String(text || ''), { mode: 'append' }), 'composer.clear': () => insertText('', { mode: 'replace' }), 'composer.send': async () => await sendWithRetry({ source: 'capability.composer.send' }), 'composer.sendPolicy.get': () => ({ policy: currentSendPolicy() }), 'composer.sendPolicy.set': ({ policy }) => { registry.sendPolicy = normalizeSendPolicy(policy); saveRegistry(); writeLog({ type: 'send_policy', status: 'updated', policy_id: registry.sendPolicy.id }); return { ok: true, policy: registry.sendPolicy }; }, 'composer.sendPolicy.test': () => ({ ok: true, policy: currentSendPolicy(), button_found: Boolean(findSendButton(currentSendPolicy())) }),
      'conversation.readText': () => ({ text: readPageText(), length: readPageText().length }), 'conversation.getPageInfo': () => ({ url: location.href, title: document.title, at: now() }), 'conversation.findBlocks': ({ tag }) => ({ blocks: findTaggedBlocks(String(tag || 'DCF_MODULE_PACK'), readPageText()) }), 'conversation.findModulePacks': () => ({ blocks: textBlocks(readPageText(), PACK_RE).map((b) => ({ hash: b.hash, summary: b.raw.slice(0, 120) })) }), 'conversation.observe': () => ({ ok: true, mode: 'kernel_mutation_observer' }),
      'clipboard.write': ({ text }) => { copyText(String(text || '')); return { ok: true }; },
      'store.get': ({ namespace, key, defaultValue }) => ({ value: kvGet(namespace, key, defaultValue) }), 'store.set': ({ namespace, key, value }) => { kvSet(namespace, key, value); return { ok: true }; }, 'store.delete': ({ namespace, key }) => { kvDelete(namespace, key); return { ok: true }; }, 'store.list': ({ namespace }) => ({ keys: kvList(namespace) }), 'store.snapshot': ({ namespace }) => ({ namespace: String(namespace || 'global'), values: kvSnapshot(namespace) }), 'store.restore': ({ namespace, values }) => { kvRestore(namespace, values); return { ok: true }; },
      'module.list': () => ({ modules: registry.modules.map(publicModule) }), 'module.get': ({ module_id }) => ({ module: publicModule(registry.modules.find((m) => m.id === module_id)) }), 'module.install': ({ module }) => { const m = normalizeModule(module); if (!m) throw new Error('invalid module'); upsertModule(m); saveRegistry(); render(); return { ok: true, module: publicModule(m) }; }, 'module.update': ({ module }) => { const m = normalizeModule(module); if (!m) throw new Error('invalid module'); upsertModule(m); saveRegistry(); render(); return { ok: true, module: publicModule(m) }; }, 'module.enable': ({ module_id }) => { const m = registry.modules.find((x) => x.id === module_id); if (m) m.disabled = false; saveRegistry(); render(); return { ok: Boolean(m) }; }, 'module.disable': ({ module_id }) => { const m = registry.modules.find((x) => x.id === module_id); if (m) m.disabled = true; saveRegistry(); render(); return { ok: Boolean(m) }; }, 'module.remove': ({ module_id }) => { removeModule(String(module_id || '')); return { ok: true }; }, 'module.reload': () => { saveRegistry(); render(); return { ok: true }; },
      'package.detect': () => ({ packs: textBlocks(readPageText(), PACK_RE).map((b) => ({ hash: b.hash, text: b.raw })) }), 'package.apply': ({ pack, text }) => applyPack(pack || JSON.parse(String(text || '{}')), { source: 'capability', feedback: true }), 'package.fetchAndApply': async ({ url }) => { const r = await networkFetchData({ url, responseType: 'json' }); if (!r.ok || !r.json) throw new Error(r.error || ('fetch failed: ' + r.status)); return applyPack(r.json, { source: 'network.fetchData', feedback: true }); }, 'package.listInstalled': () => ({ installedPacks: registry.installedPacks }),
      'network.fetchData': networkFetchData, 'log.write': ({ entry }) => { writeLog({ type: 'module_log', status: 'ok', entry }); return { ok: true }; }, 'log.list': ({ limit }) => ({ events: recentEvents(Number(limit || 20)) }), 'log.clear': () => { setLog([]); return { ok: true }; },
      'maintenance.feedback': ({ feedback, send }) => emitFeedback(feedback || {}, { send: send !== false }), 'maintenance.diagnose': () => ({ diagnostics: diagnosticsObject() }), 'maintenance.requestKernelChange': ({ capability, reason, module_id }) => { const request = { schema: 'dcf.kernel_capability_request.v1', capability: String(capability || ''), reason: String(reason || ''), module_id: String(module_id || ''), at: now() }; emitFeedback({ event: 'kernel_capability_request', status: 'requested', request }); return { ok: true, request }; }
    };
  }

  async function networkFetchData({ url, method, headers, body, responseType, timeout }) {
    const target = String(url || '');
    if (!/^https?:\/\//i.test(target)) throw new Error('network.fetchData only accepts http/https data URLs.');
    const request = { method: method || 'GET', url: target, headers: isPlainObject(headers) ? headers : {}, data: body == null ? undefined : String(body), timeout: Number(timeout || 15000) };
    if (typeof GM_xmlhttpRequest === 'function') return await new Promise((resolve, reject) => GM_xmlhttpRequest({ ...request, onload: (r) => resolve(parseNetworkResponse(r.status, r.responseText || '', responseType)), onerror: () => reject(new Error('network request failed')), ontimeout: () => reject(new Error('network request timed out')) }));
    const r = await fetch(target, { method: request.method, headers: request.headers, body: request.data });
    return parseNetworkResponse(r.status, await r.text(), responseType);
  }
  function parseNetworkResponse(status, text, responseType) { if (responseType === 'json') { try { return { ok: status >= 200 && status < 300, status, json: JSON.parse(text) }; } catch (e) { return { ok: false, status, text, error: 'json_parse_failed: ' + e.message }; } } return { ok: status >= 200 && status < 300, status, text }; }

  async function emitFeedback(data, options) {
    const opts = { send: true, ...options };
    const feedback = { schema: 'dcf.feedback.v1', kernel_version: VERSION, at: now(), ...compactValue(data || {}) };
    const text = ['<<<DCF_FEEDBACK', JSON.stringify(feedback, null, 2), 'DCF_FEEDBACK>>>'].join('\n');
    writeLog({ type: 'feedback', status: 'queued', event: feedback.event || 'unknown', feedback_status: feedback.status || '' });
    if (readComposer().trim()) { copyText(text); notice('已生成反馈，但输入框非空；为避免覆盖草稿，反馈已复制到剪贴板。'); writeLog({ type: 'feedback', status: 'clipboard_fallback', reason: 'composer_not_empty' }); return { ok: false, fallback: 'clipboard' }; }
    const inserted = insertText(text, { mode: 'replace', quiet: true });
    if (!inserted.ok) { copyText(text); notice('反馈发送失败，已复制到剪贴板。'); writeLog({ type: 'feedback', status: 'clipboard_fallback', reason: inserted.reason || 'composer_not_found' }); return { ok: false, fallback: 'clipboard' }; }
    writeLog({ type: 'feedback', status: 'inserted', event: feedback.event || 'unknown' });
    if (!opts.send) return { ok: true, inserted: true, sent: false };
    const sent = await sendWithRetry({ source: 'feedback', beforeText: text });
    if (!sent.ok) { copyText(text); notice('自动发送反馈失败，内容已保留在输入框并复制到剪贴板。'); writeLog({ type: 'feedback', status: 'send_timeout', reason: sent.reason }); return { ok: false, inserted: true, sent: false, fallback: 'clipboard' }; }
    writeLog({ type: 'feedback', status: 'sent', event: feedback.event || 'unknown' });
    return { ok: true, inserted: true, sent: true };
  }
  function insertText(text, options) {
    const opts = { mode: 'insert', quiet: false, ...options };
    const target = findComposer();
    if (!target) { if (!opts.quiet) { copyText(text); alert('DCF 未找到输入框，内容已复制到剪贴板。'); } return { ok: false, reason: 'composer_not_found' }; }
    const value = String(text || '');
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      if (opts.mode === 'replace') target.value = value; else if (opts.mode === 'append') target.value += value; else { const s = target.selectionStart ?? target.value.length, e = target.selectionEnd ?? target.value.length; target.value = target.value.slice(0, s) + value + target.value.slice(e); }
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      if (opts.mode === 'replace') { target.textContent = ''; target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: '' })); }
      else if (opts.mode === 'append') { const range = document.createRange(); range.selectNodeContents(target); range.collapse(false); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); }
      document.execCommand('insertText', false, value);
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
    writeLog({ type: 'composer_write', status: 'ok', mode: opts.mode, length: value.length });
    return { ok: true };
  }
  async function sendWithRetry(options) {
    const opts = { source: 'unknown', beforeText: readComposer(), ...options };
    const policy = currentSendPolicy();
    const started = Date.now();
    writeLog({ type: 'composer_send', status: 'start', source: opts.source, policy_id: policy.id });
    while (Date.now() - started < policy.timeout_ms) {
      const button = findSendButton(policy);
      if (button) { button.click(); writeLog({ type: 'composer_send', status: 'clicked', source: opts.source, selector: button.__dcfSelector || '' }); await sleep(policy.success_delay_ms); const after = readComposer().trim(); return { ok: true, clicked: true, unverified: Boolean(after && after === String(opts.beforeText || '').trim()) }; }
      await sleep(policy.interval_ms);
    }
    writeLog({ type: 'composer_send', status: 'timeout', source: opts.source, timeout_ms: policy.timeout_ms });
    return { ok: false, reason: 'send_button_timeout' };
  }
  function findSendButton(policy) { for (const selector of policy.selectors) for (const node of document.querySelectorAll(selector)) if (isUsableButton(node)) { node.__dcfSelector = selector; return node; } return null; }
  function isUsableButton(node) { return node instanceof HTMLElement && visible(node) && !host.contains(node) && !(node instanceof HTMLButtonElement && node.disabled) && String(node.getAttribute('aria-disabled') || '').toLowerCase() !== 'true' && String(node.getAttribute('data-disabled') || '').toLowerCase() !== 'true'; }
  function currentSendPolicy() { return normalizeSendPolicy(registry.sendPolicy || DEFAULT_SEND_POLICY); }
  function normalizeSendPolicy(policy) { const p = isPlainObject(policy) ? policy : {}; return { id: String(p.id || DEFAULT_SEND_POLICY.id), timeout_ms: clampNumber(p.timeout_ms, 800, 15000, DEFAULT_SEND_POLICY.timeout_ms), interval_ms: clampNumber(p.interval_ms, 80, 1000, DEFAULT_SEND_POLICY.interval_ms), success_delay_ms: clampNumber(p.success_delay_ms, 100, 2000, DEFAULT_SEND_POLICY.success_delay_ms), selectors: Array.isArray(p.selectors) && p.selectors.length ? p.selectors.map(String).slice(0, 20) : DEFAULT_SEND_POLICY.selectors }; }

  function readComposer() { const n = findComposer(); if (!n) return ''; if (n instanceof HTMLTextAreaElement || n instanceof HTMLInputElement) return n.value || ''; return n.innerText || n.textContent || ''; }
  function findComposer() { for (const selector of ['#prompt-textarea','textarea[data-id="root"]','textarea','[contenteditable="true"]','div.ProseMirror']) { const n = document.querySelector(selector); if (n instanceof HTMLElement && visible(n) && !host.contains(n)) return n; } return null; }
  function composerProbe() { const n = findComposer(); const t = readComposer(); return { ok: Boolean(n), empty: !t.trim(), length: t.length, tag: n?.tagName || '', contenteditable: n?.getAttribute?.('contenteditable') || '' }; }
  function readPageText() { return document.body?.innerText || ''; }
  function findTaggedBlocks(tag, text) { const safe = String(tag || '').replace(/[^\w.-]/g, ''); return textBlocks(text, new RegExp('<<<' + safe + '\\b\\s*([\\s\\S]*?)\\s*' + safe + '>>>', 'g')); }
  function textBlocks(text, re) { const out = []; re.lastIndex = 0; let m; while ((m = re.exec(text)) && out.length < 40) { const raw = m[1].trim(); out.push({ raw, hash: hash(raw), summary: raw.slice(0, 160) }); } return out; }

  function upsertModule(module) { const i = registry.modules.findIndex((m) => m.id === module.id); if (i >= 0) registry.modules[i] = module; else registry.modules.push(module); }
  function removeModule(id) { registry.modules = registry.modules.filter((m) => m.id !== id); registry.lastHotUpdate = { at: now(), source: 'disable', module_id: id }; writeLog({ type: 'module_disable', status: 'ok', module_id: id }); saveRegistry(); notice('已卸载模块：' + id); }
  function publicModule(m) { if (!m) return null; return { id: m.id, title: m.title, version: m.version, description: m.description, permissions: m.permissions, commands: m.commands.length, blocks: m.blocks.length, renderable_blocks: getRenderableBlocks(m).length, disabled: Boolean(m.disabled) }; }
  function rememberRejected(sourceHash, reason, error) { registry.rejections.push({ at: now(), sourceHash, reason, error: String(error || '') }); registry.rejections = registry.rejections.slice(-30); writeLog({ type: 'module_install', status: 'failed', reason, sourceHash, error: String(error || '') }); saveRegistry(); }
  function permissionCovers(perms, cap) { return perms.includes(cap) || perms.some((p) => p.endsWith('.*') && cap.startsWith(p.slice(0, -1))); }
  function interpolateObject(value, vars, module) { if (typeof value === 'string') { const exact = value.match(/^\{\{\s*([\w.-]+)\s*\}\}$/); if (exact) { const r = resolveTemplateValue(exact[1], vars, module); return r == null ? '' : r; } return interpolate(value, vars, module); } if (Array.isArray(value)) return value.map((x) => interpolateObject(x, vars, module)); if (isPlainObject(value)) { const out = {}; for (const [k, v] of Object.entries(value)) out[k] = interpolateObject(v, vars, module); return out; } return value; }
  function interpolate(text, vars, module) { return String(text || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => { const v = resolveTemplateValue(key, vars, module); return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)); }); }
  function resolveTemplateValue(key, vars, module) { if (key.startsWith('template.')) return module?.templates?.[key.slice(9)]; let v = vars; for (const part of key.split('.')) { if (v == null) return undefined; v = v[part]; } return v; }

  function probePack() { const at = now(); return { schema: 'dcf.module_pack.v1', pack_id: 'dcf.kernel.command_dispatch_probe.pack.v1', revision: at, mode: 'merge', modules: [{ id: 'dcf.command_dispatch_probe', title: '命令分发探针', version: at, description: '验证顶层 commands 可以被渲染并执行。', permissions: ['composer.*','ui.*','maintenance.*'], commands: [{ id: 'insert_probe', label: '插入探针', primary: true, steps: [{ call: 'composer.insert', with: { text: '请确认：DCF Kernel ' + VERSION + ' 顶层 commands 已可执行。时间：' + at } }] }, { id: 'feedback_probe', label: '发送反馈探针', steps: [{ call: 'maintenance.feedback', with: { feedback: { event: 'command_dispatch_probe', status: 'ok', module_id: 'dcf.command_dispatch_probe' }, send: true } }] }] }] }; }
  function samplePack() { return { schema: 'dcf.module_pack.v1', pack_id: 'dcf.sample.command_dispatch.pack.v1', revision: '1', mode: 'merge', modules: [{ id: 'dcf.sample.command_dispatch', title: '命令分发样例', version: '1.0.0', description: '顶层 commands 样例。', permissions: ['composer.*','clipboard.*','ui.*'], templates: { hello: '这段文字来自顶层 module.commands，不是 blocks.commands。' }, commands: [{ id: 'insert_template', label: '插入模板', primary: true, steps: [{ call: 'composer.insert', with: { text: '{{template.hello}}' } }] }] }] }; }
  function maintRequestBlock() { return ['<<<DCF_MAINT_REQUEST', JSON.stringify({ schema: 'dcf.maintenance.request.v1', request_id: 'manual-' + Date.now(), actions: ['diagnostics','recent_log','module_list','installed_pack_list','last_command_error','last_capability_error','composer_probe','send_policy','last_scan'] }, null, 2), 'DCF_MAINT_REQUEST>>>'].join('\n'); }
  function repairPrompt() { return ['<<<DCF_MAINT', JSON.stringify({ schema: 'dcf.kernel.maintenance.repair.v1', kernel_version: VERSION, task: 'Maintain DCF as a small personal Tampermonkey capability bus, not a heavy governance platform.', required_behavior: ['module.commands and blocks[].commands must both execute','command failures write lightweight logs','use DCF_MAINT_REQUEST for diagnostics','keep logs small and local'] }, null, 2), 'DCF_MAINT>>>'].join('\n'); }
  function diagnostics() { return JSON.stringify(diagnosticsObject(), null, 2); }
  function diagnosticsObject(options) { const compact = Boolean(options?.compact); return { schema: 'dcf.kernel.diagnostics.v1', version: VERSION, url: location.href, title: document.title, at: now(), state: { tab: state.tab, section: state.section, side: state.side }, capabilities: compact ? CAPABILITY_NAMES.length : CAPABILITY_NAMES, modules: registry.modules.map(publicModule), installedPacks: registry.installedPacks, lastHotUpdate: registry.lastHotUpdate || null, lastScan, composer: composerProbe(), sendPolicy: currentSendPolicy(), recentEvents: recentEvents(compact ? 20 : 40), lastCommandError: findLastLog((e) => e.type && String(e.type).startsWith('command_') && e.status === 'failed'), lastCapabilityError: findLastLog((e) => e.type === 'capability_call' && e.status === 'failed'), rejections: registry.rejections.slice(-10), legacyKeysPresent: LEGACY_KEYS.filter((k) => localStorage.getItem(k) !== null) }; }

  function kvKey(ns, key) { return KV_PREFIX + String(ns || 'global') + '.' + String(key || ''); }
  function kvGet(ns, key, def) { const k = kvKey(ns, key); try { if (typeof GM_getValue === 'function') return GM_getValue(k, def); const raw = localStorage.getItem(k); return raw == null ? def : JSON.parse(raw); } catch { return def; } }
  function kvSet(ns, key, value) { const k = kvKey(ns, key); if (typeof GM_setValue === 'function') GM_setValue(k, value); else localStorage.setItem(k, JSON.stringify(value)); }
  function kvDelete(ns, key) { const k = kvKey(ns, key); if (typeof GM_deleteValue === 'function') GM_deleteValue(k); else localStorage.removeItem(k); }
  function kvList(ns) { const prefix = KV_PREFIX + String(ns || 'global') + '.'; if (typeof GM_listValues === 'function') return GM_listValues().filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)); return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)); }
  function kvSnapshot(ns) { const out = {}; for (const key of kvList(ns)) out[key] = kvGet(ns, key, null); return out; }
  function kvRestore(ns, values) { if (!isPlainObject(values)) return; for (const [k, v] of Object.entries(values)) kvSet(ns, k, v); }
  function loadState() { try { return { tab: 'maint', section: 'status', side: 'right', notice: '', packDraft: '', ...(JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}) }; } catch { return { tab: 'maint', section: 'status', side: 'right', notice: '', packDraft: '' }; } }
  function saveState() { localStorage.setItem(STATE_KEY, JSON.stringify({ tab: state.tab === 'modules' ? 'modules' : 'maint', section: state.section || 'status', side: state.side === 'left' ? 'left' : 'right', notice: state.notice || '' })); }
  function loadRegistry() { try { const v = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}') || {}; return { schema: 'dcf.kernel.registry.v1', modules: Array.isArray(v.modules) ? v.modules.map(normalizeModule).filter(Boolean) : [], installedPacks: isPlainObject(v.installedPacks) ? v.installedPacks : {}, seenBlocks: isPlainObject(v.seenBlocks) ? v.seenBlocks : {}, rejections: Array.isArray(v.rejections) ? v.rejections.slice(-30) : [], lastHotUpdate: v.lastHotUpdate || null, sendPolicy: normalizeSendPolicy(v.sendPolicy || DEFAULT_SEND_POLICY) }; } catch { return { schema: 'dcf.kernel.registry.v1', modules: [], installedPacks: {}, seenBlocks: {}, rejections: [], lastHotUpdate: null, sendPolicy: normalizeSendPolicy(DEFAULT_SEND_POLICY) }; } }
  function saveRegistry() { localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry)); }
  function getLog() { try { const v = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function setLog(events) { localStorage.setItem(LOG_KEY, JSON.stringify(Array.isArray(events) ? events.slice(-60) : [])); }
  function writeLog(entry) { const next = getLog().slice(-59); next.push({ at: entry.at || now(), ...entry }); setLog(next); }
  function recentEvents(limit) { return getLog().slice(-Number(limit || 20)).reverse(); }
  function findLastLog(pred) { const events = getLog(); for (let i = events.length - 1; i >= 0; i -= 1) if (pred(events[i])) return events[i]; return null; }
  function compactEvent(e) { const out = { ...e }; delete out.entry; return out; }
  function compactValue(v) { if (Array.isArray(v)) return v.slice(0, 20).map(compactValue); if (isPlainObject(v)) { const out = {}; for (const [k, x] of Object.entries(v).slice(0, 40)) out[k] = compactValue(x); return out; } if (typeof v === 'string' && v.length > 700) return v.slice(0, 700) + '…'; return v; }
  function registerMenu() { if (typeof GM_registerMenuCommand !== 'function') return; GM_registerMenuCommand('DCF: copy diagnostics', () => copyText(diagnostics())); GM_registerMenuCommand('DCF: scan module packs', () => autoScan(true)); GM_registerMenuCommand('DCF: copy maint request', () => copyText(maintRequestBlock())); }
  function copyText(text) { if (typeof GM_setClipboard === 'function') GM_setClipboard(String(text || '')); else navigator.clipboard?.writeText(String(text || '')); }
  function notice(text) { state.notice = String(text || ''); saveState(); render(); }
  function visible(node) { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function now() { return new Date().toISOString(); }
  function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
  function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function clampNumber(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
  function hash(text) { let v = 5381; const s = String(text || ''); for (let i = 0; i < s.length; i += 1) v = ((v << 5) + v) ^ s.charCodeAt(i); return 'h' + (v >>> 0).toString(16); }
  function esc(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
})();