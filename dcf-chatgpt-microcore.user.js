// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.8.6
// @description  DCF light capability-bus kernel with guarded automatic module ingestion and safe feedback. No remote eval, no chunks.
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
  "use strict";

  const VERSION = "0.8.6";
  const STATE_KEY = "dcf.kernel.state.v1";
  const REGISTRY_KEY = "dcf.kernel.registry.v1";
  const LOG_KEY = "dcf.kernel.log.v1";
  const KV_PREFIX = "dcf.kv.";
  const PACK_RE = /<<<DCF_MODULE_PACK\b\s*([\s\S]*?)\s*DCF_MODULE_PACK>>>/g;
  const LEGACY_KEYS = [
    "dcf.github.engine." + "cache.v1",
    "dcf.github.engine." + "lastCheck.v1",
    "dcf.local.engine." + "v1",
    "dcf.ammo.store.v1",
    "dcf.module.registry.v1",
    "dcf.kernel.modules.v1",
  ];

  const CAPABILITY_NAMES = [
    "ui.notice", "ui.rerender", "ui.addStyle", "ui.notify", "ui.setTab", "ui.setSection", "ui.showModule",
    "composer.find", "composer.read", "composer.insert", "composer.replace", "composer.append", "composer.clear", "composer.send",
    "conversation.readText", "conversation.getPageInfo", "conversation.findBlocks", "conversation.findModulePacks", "conversation.observe",
    "clipboard.write",
    "store.get", "store.set", "store.delete", "store.list", "store.snapshot", "store.restore",
    "module.list", "module.get", "module.install", "module.update", "module.enable", "module.disable", "module.remove", "module.reload",
    "package.detect", "package.apply", "package.fetchAndApply", "package.listInstalled",
    "network.fetchData",
    "log.write", "log.list", "log.clear",
    "maintenance.feedback", "maintenance.diagnose", "maintenance.requestKernelChange",
  ];

  const state = loadState();
  const registry = loadRegistry();
  const capabilities = makeCapabilities();
  let scanTimer = null;
  let lastScan = { at: "", packs: 0, ignored: 0, textLength: 0 };

  const host = document.createElement("div");
  host.id = "dcf-chatgpt-microcore-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{all:initial}
      .shell{position:fixed;top:72px;right:12px;bottom:86px;width:min(372px,calc(100vw - 28px));z-index:2147483646;display:flex;flex-direction:column;border:1px solid rgba(130,130,130,.28);border-radius:18px;background:rgba(250,250,250,.94);color:#111827;box-shadow:0 18px 50px rgba(0,0,0,.16);backdrop-filter:blur(14px);font:13px/1.42 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
      .shell[data-side=left]{left:12px;right:auto}
      @media(prefers-color-scheme:dark){.shell{background:rgba(23,23,23,.92);color:#f5f5f5;border-color:rgba(210,210,210,.16);box-shadow:0 18px 50px rgba(0,0,0,.38)}}
      .top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid rgba(130,130,130,.18)}
      .title{font-size:14px;font-weight:780}.sub{margin-top:1px;font-size:11px;opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pill{border:1px solid rgba(37,99,235,.35);border-radius:999px;padding:6px 9px;background:rgba(37,99,235,.10);color:inherit;font:700 11px/1 system-ui;white-space:nowrap}
      .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(130,130,130,.14)}
      .tab{border:1px solid rgba(130,130,130,.18);border-radius:11px;padding:7px 0;background:transparent;color:inherit;cursor:pointer;font:650 12px/1 system-ui}
      .tab[aria-selected=true]{background:rgba(37,99,235,.12);border-color:rgba(37,99,235,.35)}
      .content{flex:1;overflow:auto;padding:10px}.small{font-size:12px;opacity:.72}.notice{border:1px solid rgba(5,150,105,.25);background:rgba(5,150,105,.09);border-radius:12px;padding:8px 9px;margin:0 0 10px;font-size:12px}.warnbox{border:1px solid rgba(217,119,6,.35);background:rgba(217,119,6,.10);border-radius:12px;padding:8px 9px;margin:0 0 10px;font-size:12px}
      .block{border:1px solid rgba(130,130,130,.18);border-radius:15px;background:rgba(127,127,127,.045);margin-bottom:10px;overflow:hidden}.head{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;padding:11px 12px;color:inherit;background:transparent;text-align:left;cursor:pointer;font:inherit}
      .bt{font-size:13px;font-weight:760}.bd{margin-top:2px;font-size:12px;opacity:.62}.body{padding:0 12px 12px;border-top:1px solid rgba(130,130,130,.12)}
      .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.a{border:1px solid rgba(130,130,130,.23);border-radius:10px;padding:7px 9px;background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font:12px/1.1 system-ui}.a.primary{background:rgba(37,99,235,.14);border-color:rgba(37,99,235,.35);font-weight:700}.a.hot{background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.32);font-weight:700}.a.warn{background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.32)}
      .card{border:1px solid rgba(130,130,130,.16);border-radius:12px;padding:9px;background:rgba(255,255,255,.32);margin-top:8px}@media(prefers-color-scheme:dark){.card{background:rgba(255,255,255,.035)}}.name{font-weight:720;font-size:12px}.desc{margin-top:3px;font-size:12px;opacity:.66}.mini{font-size:11px;opacity:.56;margin-top:4px}.kv{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.72;word-break:break-all}
      .field{margin-top:9px}.field label{display:block;font-size:12px;font-weight:680;margin-bottom:5px}textarea{width:100%;min-height:92px;box-sizing:border-box;resize:vertical;border-radius:12px;border:1px solid rgba(130,130,130,.22);padding:8px 9px;background:rgba(255,255,255,.55);color:inherit;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}@media(prefers-color-scheme:dark){textarea{background:rgba(0,0,0,.18)}}
      .empty{border:1px dashed rgba(130,130,130,.26);border-radius:14px;padding:12px;font-size:12px;opacity:.72}.badge{border:1px solid rgba(37,99,235,.26);color:#2563eb;border-radius:999px;padding:2px 7px;font-size:11px;white-space:nowrap}.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.chip{border:1px solid rgba(130,130,130,.20);border-radius:999px;padding:2px 6px;font-size:11px;opacity:.76}
    </style>
    <aside class="shell" aria-label="DCF Light Capability Bus"></aside>
  `;
  const shell = root.querySelector(".shell");
  document.documentElement.appendChild(host);

  shell.addEventListener("click", onClick);
  shell.addEventListener("input", onInput);
  registerMenu();
  render();
  scheduleScan(200);
  new MutationObserver(() => scheduleScan(700)).observe(document.body, { childList: true, subtree: true, characterData: true });

  function render() {
    shell.dataset.side = state.side;
    shell.innerHTML = `
      <div class="top"><div><div class="title">DCF Kernel</div><div class="sub">native ${VERSION} · guarded capability bus</div></div><span class="pill">${registry.modules.length} modules</span></div>
      <div class="tabs"><button class="tab" aria-selected="${state.tab === "maint"}" data-act="tab" data-tab="maint">维护</button><button class="tab" aria-selected="${state.tab === "modules"}" data-act="tab" data-tab="modules">模块</button></div>
      <div class="content">${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}${state.tab === "modules" ? modulesView() : maintenanceView()}</div>
    `;
  }

  function maintenanceView() {
    return `
      <div class="warnbox">0.8.6：自动摄取器会忽略说明性占位块；反馈不会覆盖你的输入草稿。业务能力仍必须通过模块包进入。</div>
      ${section("status", "内核状态", "版本、自动摄取、最近安装。", statusBody())}
      ${section("caps", "能力接口", "模块可通过 command steps 调用的能力面。", capabilitiesBody())}
      ${section("install", "模块包入口", "自动扫描真实 DCF_MODULE_PACK；粘贴区仅用于调试。", installBody())}
      ${section("events", "轻量日志", "最近事件、忽略、拒绝和反馈状态。", eventsBody())}
      ${section("repair", "自我纠错", "防止模块需求退化为内核硬编码。", repairBody())}
      ${section("danger", "恢复", "清理历史错误状态、安装账本或模块。", dangerBody())}
    `;
  }

  function modulesView() {
    if (!registry.modules.length) return `<div class="empty">当前没有业务模块。模块必须通过真实 DCF_MODULE_PACK 自动热更新或维护入口装载；内核不内置语言弹药 UI。</div>`;
    return registry.modules.map(renderModule).join("");
  }

  function section(id, title, desc, body) {
    const open = state.section === id;
    return `<section class="block"><button class="head" data-act="section" data-section="${esc(id)}"><span><div class="bt">${esc(title)}</div><div class="bd">${esc(desc)}</div></span><span>${open ? "−" : "+"}</span></button>${open ? `<div class="body">${body}</div>` : ""}</section>`;
  }

  function statusBody() {
    const last = registry.lastHotUpdate;
    return `<div class="small">kernel: ${VERSION}</div><div class="small">auto ingest: on · last scan: ${esc(lastScan.at || "pending")}</div><div class="small">page text: ${lastScan.textLength || 0} · packs seen: ${lastScan.packs || 0} · ignored: ${lastScan.ignored || 0}</div><div class="small">modules: ${registry.modules.length} · installed packs: ${Object.keys(registry.installedPacks).length}</div><div class="small">last hot update: ${esc(last?.at || "none")}</div><div class="actions"><button class="a primary" data-act="copy-diag">复制诊断</button><button class="a" data-act="scan-now">立即扫描</button><button class="a" data-act="side">切换左右侧</button></div>`;
  }

  function capabilitiesBody() {
    const groups = groupCapabilities();
    return Object.keys(groups).map((group) => `<div class="card"><div class="name">${esc(group)}.*</div><div class="chips">${groups[group].map((name) => `<span class="chip">${esc(name)}</span>`).join("")}</div></div>`).join("");
  }

  function installBody() {
    return `<div class="small">真实模块包必须是 JSON 对象，且 schema 为 dcf.module_pack.v1。说明文字中的省略号或占位内容会被忽略，不再向对话发送失败反馈。</div><div class="field"><label>调试用模块包 JSON</label><textarea data-role="pack" placeholder='{"schema":"dcf.module_pack.v1","pack_id":"example.pack","revision":"1","modules":[{"id":"example.module","title":"示例模块","commands":[{"id":"hello","label":"插入文本","steps":[{"call":"composer.insert","with":{"text":"hello"}}]}]}]}'></textarea></div><div class="actions"><button class="a primary" data-act="apply-pack">手动应用调试包</button><button class="a hot" data-act="probe">生成自检包并安装</button><button class="a" data-act="copy-sample">复制模块包样例</button></div>`;
  }

  function eventsBody() {
    const events = recentEvents(10);
    const rejects = registry.rejections.slice(-5).reverse();
    return `<div class="small">最近事件只保留短日志。重复安装、占位块忽略、反馈回退都会记录在这里。</div>${events.length ? events.map(renderEvent).join("") : `<div class="empty">暂无事件。</div>`}${rejects.length ? `<div class="card"><div class="name">最近拒绝</div>${rejects.map((item) => `<div class="mini">${esc(item.at)} · ${esc(item.reason)} · ${esc(item.sourceHash || "")}</div>`).join("")}</div>` : ""}<div class="actions"><button class="a" data-act="copy-log">复制日志</button><button class="a warn" data-act="clear-log">清空日志</button></div>`;
  }

  function renderEvent(event) {
    return `<div class="card"><div class="name">${esc(event.type || event.event || "event")} · ${esc(event.status || "")}</div><div class="mini">${esc(event.at || "")}</div><div class="kv">${esc(JSON.stringify(compactEvent(event)))}</div></div>`;
  }

  function repairBody() {
    return `<div class="small">模块需要新能力时，先通过 capability request 回馈，不把业务需求直接写进内核。</div><div class="actions"><button class="a primary" data-act="insert-repair">插入纠错提示</button><button class="a" data-act="copy-repair">复制纠错提示</button></div>`;
  }

  function dangerBody() {
    return `<div class="small">恢复动作只清理本地状态，不改变 GitHub，不改变底层脚本。</div><div class="actions"><button class="a warn" data-act="clear-legacy">清理历史错误状态</button><button class="a warn" data-act="clear-ledger">清空安装账本</button><button class="a warn" data-act="reset-modules">清空模块</button></div>`;
  }

  function renderModule(module) {
    const blocks = module.blocks.length ? module.blocks : [{ id: "commands", title: "模块命令", description: module.description || "", commands: module.commands }];
    return `<section class="block"><button class="head" data-act="noop"><span><div class="bt">${esc(module.title)}</div><div class="bd">${esc(module.description || module.id)}</div></span><span class="badge">${esc(module.disabled ? "disabled" : module.version)}</span></button><div class="body"><div class="mini">${esc(module.id)}</div>${module.permissions.length ? `<div class="chips">${module.permissions.map((p) => `<span class="chip">${esc(p)}</span>`).join("")}</div>` : ""}${blocks.map((block, blockIndex) => renderBlock(module, block, blockIndex)).join("")}<div class="actions"><button class="a warn" data-act="disable-module" data-module="${esc(module.id)}">卸载模块</button></div></div></section>`;
  }

  function renderBlock(module, block, blockIndex) {
    const commands = block.commands || [];
    return `<div class="card"><div class="name">${esc(block.title || block.id)}</div><div class="desc">${esc(block.description || "")}</div>${commands.length ? `<div class="actions">${commands.map((command, commandIndex) => `<button class="a ${command.primary ? "primary" : ""}" data-act="run-command" data-module="${esc(module.id)}" data-block="${blockIndex}" data-command="${commandIndex}">${esc(command.label || command.id)}</button>`).join("")}</div>` : `<div class="mini">没有命令。</div>`}</div>`;
  }

  function onInput(event) {
    const node = event.target;
    if (node?.dataset?.role === "pack") state.packDraft = node.value;
  }

  function onClick(event) {
    const node = event.target.closest("[data-act]");
    if (!node) return;
    const act = node.dataset.act;
    if (act === "noop") return;
    if (act === "tab") { state.tab = node.dataset.tab === "modules" ? "modules" : "maint"; saveState(); render(); return; }
    if (act === "section") { state.section = node.dataset.section || "status"; saveState(); render(); return; }
    if (act === "copy-diag") { copyText(diagnostics()); notice("诊断已复制。"); return; }
    if (act === "copy-log") { copyText(JSON.stringify(getLog(), null, 2)); notice("日志已复制。"); return; }
    if (act === "clear-log") { setLog([]); notice("日志已清空。"); return; }
    if (act === "scan-now") { autoScan(true); return; }
    if (act === "side") { state.side = state.side === "left" ? "right" : "left"; saveState(); render(); return; }
    if (act === "apply-pack") { applyPackFromTextarea(); return; }
    if (act === "probe") { applyPack(probePack(), { source: "kernel-self-test", feedback: true, force: true }); return; }
    if (act === "copy-sample") { copyText(JSON.stringify(samplePack(), null, 2)); notice("模块包样例已复制。"); return; }
    if (act === "insert-repair") { insertText(repairPrompt(), { send: false }); return; }
    if (act === "copy-repair") { copyText(repairPrompt()); notice("维护纠错提示已复制。"); return; }
    if (act === "clear-legacy") { clearLegacy(); return; }
    if (act === "clear-ledger") { registry.installedPacks = {}; registry.seenBlocks = {}; registry.rejections = []; saveRegistry(); notice("安装账本已清空。"); return; }
    if (act === "reset-modules") { registry.modules = []; registry.lastHotUpdate = { at: now(), source: "reset" }; saveRegistry(); writeLog({ type: "module_reset", status: "ok" }); state.tab = "maint"; notice("模块已清空。"); return; }
    if (act === "disable-module") { disableModule(node.dataset.module); return; }
    if (act === "run-command") runCommandFromNode(node);
  }

  function scheduleScan(delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => autoScan(false), delay);
  }

  function autoScan(manual) {
    const text = readPageText();
    const found = findModulePackBlocks(text);
    let ignored = 0;
    lastScan = { at: now(), packs: found.length, ignored: 0, textLength: text.length };
    for (const block of found) {
      const result = processPackBlock(block, manual);
      if (result === "ignored") ignored += 1;
    }
    lastScan.ignored = ignored;
    render();
  }

  function processPackBlock(block, manual) {
    const raw = block.raw;
    const sourceHash = hash(raw);
    if (registry.seenBlocks[sourceHash] && !manual) return "seen";
    const candidate = classifyPackCandidate(raw);

    if (!candidate.shouldParse) {
      registry.seenBlocks[sourceHash] = { status: "ignored", at: now(), reason: candidate.reason };
      writeLog({ type: "package_ignore", status: "ignored", reason: candidate.reason, sourceHash });
      saveRegistry();
      return "ignored";
    }

    let pack;
    try {
      pack = JSON.parse(raw.trim());
    } catch (error) {
      registry.seenBlocks[sourceHash] = { status: "rejected", at: now(), reason: "json_parse_failed" };
      rememberRejected(sourceHash, "json_parse_failed", error.message);
      emitFeedback({ event: "module_install", status: "failed", reason: "json_parse_failed", error: error.message, source_hash: sourceHash });
      return "failed";
    }

    const result = applyPack(pack, { source: "auto-scan", sourceHash, feedback: true });
    if (result.status === "skipped") {
      registry.seenBlocks[sourceHash] = { status: "skipped", at: now(), reason: result.reason };
      saveRegistry();
    }
    return result.status;
  }

  function classifyPackCandidate(raw) {
    const text = String(raw || "").trim();
    if (!text) return { shouldParse: false, reason: "empty_block" };
    if (text === "..." || text.startsWith("...")) return { shouldParse: false, reason: "placeholder_ellipsis" };
    if (!text.startsWith("{")) return { shouldParse: false, reason: "not_json_object" };
    if (!text.includes("\"schema\"") && !text.includes("'schema'")) return { shouldParse: false, reason: "missing_schema_marker" };
    return { shouldParse: true };
  }

  function applyPackFromTextarea() {
    const text = root.querySelector("[data-role='pack']")?.value?.trim() || state.packDraft || "";
    if (!text) { notice("没有可应用的模块包 JSON。"); return; }
    try {
      applyPack(JSON.parse(text), { source: "manual-textarea", feedback: true, force: true });
    } catch (error) {
      notice(`模块包 JSON 解析失败：${error.message}`);
      emitFeedback({ event: "module_install", status: "failed", reason: "json_parse_failed", error: error.message });
    }
  }

  function applyPack(pack, options) {
    const opts = { source: "unknown", sourceHash: hash(safeStringify(pack)), feedback: false, force: false, ...options };
    const normalized = normalizePack(pack);
    if (!normalized.ok) {
      rememberRejected(opts.sourceHash, normalized.reason || "invalid_pack", normalized.error);
      if (opts.feedback) emitFeedback({ event: "module_install", status: "failed", reason: normalized.reason || "invalid_pack", error: normalized.error, source_hash: opts.sourceHash });
      return { status: "failed", reason: normalized.reason || "invalid_pack" };
    }

    const key = `${normalized.pack.packId}@${normalized.pack.revision}`;
    if (!opts.force && registry.installedPacks[key]) {
      registry.seenBlocks[opts.sourceHash] = { status: "installed_duplicate", at: now(), key };
      saveRegistry();
      return { status: "skipped", reason: "already_installed", key };
    }

    const warnings = collectPackWarnings(normalized.pack);
    if (normalized.pack.mode === "replace") registry.modules = [];
    for (const module of normalized.pack.modules) upsertModule(module);

    const record = {
      pack_id: normalized.pack.packId,
      revision: normalized.pack.revision,
      installedAt: now(),
      moduleCount: normalized.pack.modules.length,
      modules: normalized.pack.modules.map((module) => module.id),
      sourceHash: opts.sourceHash,
      warnings,
    };
    registry.installedPacks[key] = record;
    registry.seenBlocks[opts.sourceHash] = { status: "installed", at: record.installedAt, key };
    registry.lastHotUpdate = { at: record.installedAt, source: opts.source, pack_id: record.pack_id, revision: record.revision, moduleCount: record.moduleCount };
    writeLog({ type: "module_install", status: "ok", ...registry.lastHotUpdate, warnings });
    saveRegistry();

    state.tab = "modules";
    state.section = "status";
    notice(`自动热更新完成：${record.moduleCount} 个模块已装载。`);

    if (opts.feedback) emitFeedback({ event: "module_install", status: "ok", pack_id: record.pack_id, revision: record.revision, installed_modules: record.modules, warnings, source_hash: opts.sourceHash });
    return { status: "ok", record };
  }

  function normalizePack(pack) {
    if (!pack || typeof pack !== "object") return { ok: false, reason: "not_object", error: "模块包不是对象。" };
    if (pack.schema !== "dcf.module_pack.v1") return { ok: false, reason: "bad_schema", error: "模块包 schema 必须是 dcf.module_pack.v1。" };
    if (!Array.isArray(pack.modules)) return { ok: false, reason: "missing_modules", error: "模块包缺少 modules 数组。" };
    const modules = pack.modules.map(normalizeModule).filter(Boolean);
    if (!modules.length) return { ok: false, reason: "no_valid_modules", error: "模块包没有合法模块。" };
    return { ok: true, pack: { packId: String(pack.pack_id || pack.packId || `pack.${hash(JSON.stringify(pack))}`), revision: String(pack.revision || pack.version || hash(JSON.stringify(pack))).slice(0, 80), mode: pack.mode === "replace" ? "replace" : "merge", modules } };
  }

  function normalizeModule(module) {
    if (!module || typeof module !== "object") return null;
    const id = String(module.id || "").trim();
    const title = String(module.title || "").trim();
    if (!id || !title) return null;
    const templates = isPlainObject(module.templates) ? module.templates : {};
    const commands = Array.isArray(module.commands) ? module.commands.map((command) => normalizeCommand(command, templates)).filter(Boolean) : [];
    const blocks = Array.isArray(module.blocks) ? module.blocks.map((block) => normalizeBlock(block, templates)).filter(Boolean) : [];
    return { id, title, version: String(module.version || "1.0.0"), description: String(module.description || ""), permissions: Array.isArray(module.permissions) ? module.permissions.map(String) : [], templates, commands, blocks, installedAt: now(), disabled: Boolean(module.disabled) };
  }

  function normalizeBlock(block, templates) {
    if (!block || typeof block !== "object") return null;
    const id = String(block.id || `block.${hash(JSON.stringify(block))}`);
    const sourceCommands = Array.isArray(block.commands) ? block.commands : (Array.isArray(block.actions) ? block.actions.map(actionToCommand) : []);
    return { id, title: String(block.title || id), description: String(block.description || ""), commands: sourceCommands.map((command) => normalizeCommand(command, templates)).filter(Boolean) };
  }

  function normalizeCommand(command, templates) {
    if (!command || typeof command !== "object") return null;
    const id = String(command.id || `command.${hash(JSON.stringify(command))}`);
    const label = String(command.label || command.title || id);
    const steps = Array.isArray(command.steps) ? command.steps.map(normalizeStep).filter(Boolean) : [];
    if (!steps.length && command.kind) return normalizeCommand(actionToCommand(command), templates);
    if (!steps.length) return null;
    return { id, label, description: String(command.description || ""), primary: Boolean(command.primary), feedback: Boolean(command.feedback), steps };
  }

  function actionToCommand(action) {
    const id = String(action.id || action.kind || `action.${hash(JSON.stringify(action))}`);
    const label = String(action.label || id);
    const text = String(action.text || "");
    if (action.kind === "insert_text") return { id, label, primary: Boolean(action.primary), steps: [{ call: "composer.insert", with: { text } }] };
    if (action.kind === "insert_and_send") return { id, label, primary: Boolean(action.primary), steps: [{ call: "composer.insert", with: { text } }, { call: "composer.send" }] };
    if (action.kind === "copy_text") return { id, label, primary: Boolean(action.primary), steps: [{ call: "clipboard.write", with: { text } }, { call: "ui.notice", with: { text: action.message || "模块文本已复制。" } }] };
    if (action.kind === "notice") return { id, label, primary: Boolean(action.primary), steps: [{ call: "ui.notice", with: { text: action.message || text || "模块动作已执行。" } }] };
    return { id, label, steps: [] };
  }

  function normalizeStep(step) {
    if (!step || typeof step !== "object") return null;
    const call = String(step.call || "").trim();
    if (!call) return null;
    return { call, with: isPlainObject(step.with) ? step.with : {}, as: step.as ? String(step.as) : "" };
  }

  function collectPackWarnings(pack) {
    const warnings = [];
    for (const module of pack.modules) {
      for (const command of module.commands) collectCommandWarnings(module, command, warnings);
      for (const block of module.blocks) for (const command of block.commands) collectCommandWarnings(module, command, warnings);
    }
    return warnings.slice(0, 20);
  }

  function collectCommandWarnings(module, command, warnings) {
    for (const step of command.steps) {
      if (!CAPABILITY_NAMES.includes(step.call)) warnings.push(`missing capability now: ${module.id}.${command.id} -> ${step.call}`);
      else if (module.permissions.length && !permissionCovers(module.permissions, step.call)) warnings.push(`undeclared permission: ${module.id}.${command.id} -> ${step.call}`);
    }
  }

  async function runCommandFromNode(node) {
    const module = registry.modules.find((item) => item.id === node.dataset.module);
    const block = module?.blocks?.[Number(node.dataset.block)];
    const command = block?.commands?.[Number(node.dataset.command)];
    if (!module || !command) return;
    if (module.disabled) { notice(`模块已禁用：${module.id}`); return; }
    try {
      const result = await runCommand(module, command);
      if (command.feedback) emitFeedback({ event: "command_run", status: "ok", module_id: module.id, command_id: command.id, result: compactValue(result) });
    } catch (error) {
      emitFeedback({ event: "command_run", status: "failed", module_id: module.id, command_id: command.id, reason: error.code || "command_failed", error: error.message });
    }
  }

  async function runCommand(module, command) {
    const vars = { now: now(), page_url: location.href, page_title: document.title, module_id: module.id, module_title: module.title };
    let last = null;
    for (const step of command.steps) {
      const payload = interpolateObject(step.with || {}, vars, module);
      last = await callCapability(step.call, payload, { module, command, step });
      if (step.as) vars[step.as] = last;
    }
    return last;
  }

  async function callCapability(name, payload, context) {
    const module = context?.module || null;
    if (!capabilities[name]) {
      const error = new Error(`Capability not available: ${name}`);
      error.code = "capability_not_available";
      writeLog({ type: "capability_call", status: "failed", capability: name, module_id: module?.id || "", reason: error.code });
      emitFeedback({ event: "capability_call", status: "failed", module_id: module?.id || "", capability: name, reason: error.code, suggestion: "maintenance.requestKernelChange" });
      throw error;
    }
    if (module?.permissions?.length && !permissionCovers(module.permissions, name)) writeLog({ type: "permission_note", status: "warning", module_id: module.id, capability: name, reason: "undeclared_permission_but_allowed" });
    try {
      return await Promise.resolve(capabilities[name](payload || {}, context || {}));
    } catch (error) {
      writeLog({ type: "capability_call", status: "failed", capability: name, module_id: module?.id || "", reason: error.message });
      emitFeedback({ event: "capability_call", status: "failed", module_id: module?.id || "", capability: name, reason: "runtime_error", error: error.message });
      throw error;
    }
  }

  function makeCapabilities() {
    return {
      "ui.notice": ({ text }) => { notice(String(text || "")); return { ok: true }; },
      "ui.rerender": () => { render(); return { ok: true }; },
      "ui.addStyle": ({ css }) => { const text = String(css || ""); if (typeof GM_addStyle === "function") GM_addStyle(text); else { const style = document.createElement("style"); style.textContent = text; document.head.appendChild(style); } return { ok: true }; },
      "ui.notify": ({ title, text }) => { const message = String(text || ""); if (typeof GM_notification === "function") GM_notification({ title: String(title || "DCF"), text: message, silent: true }); else notice(message); return { ok: true }; },
      "ui.setTab": ({ tab }) => { state.tab = tab === "modules" ? "modules" : "maint"; saveState(); render(); return { ok: true, tab: state.tab }; },
      "ui.setSection": ({ section }) => { state.section = String(section || "status"); saveState(); render(); return { ok: true, section: state.section }; },
      "ui.showModule": ({ module_id }) => { state.tab = "modules"; saveState(); render(); return { ok: true, module_id: String(module_id || "") }; },
      "composer.find": () => ({ ok: Boolean(findComposer()) }),
      "composer.read": () => ({ text: readComposer() }),
      "composer.insert": ({ text }) => insertText(String(text || ""), { send: false, mode: "insert" }),
      "composer.replace": ({ text }) => insertText(String(text || ""), { send: false, mode: "replace" }),
      "composer.append": ({ text }) => insertText(String(text || ""), { send: false, mode: "append" }),
      "composer.clear": () => insertText("", { send: false, mode: "replace" }),
      "composer.send": () => ({ ok: clickSend() }),
      "conversation.readText": () => ({ text: readPageText(), length: readPageText().length }),
      "conversation.getPageInfo": () => ({ url: location.href, title: document.title, at: now() }),
      "conversation.findBlocks": ({ tag }) => ({ blocks: findTaggedBlocks(String(tag || "DCF_MODULE_PACK"), readPageText()) }),
      "conversation.findModulePacks": () => ({ blocks: findModulePackBlocks(readPageText()).map((block) => ({ hash: block.hash, summary: block.raw.slice(0, 120) })) }),
      "conversation.observe": () => ({ ok: true, mode: "kernel_mutation_observer" }),
      "clipboard.write": ({ text }) => { copyText(String(text || "")); return { ok: true }; },
      "store.get": ({ namespace, key, defaultValue }) => ({ value: kvGet(namespace, key, defaultValue) }),
      "store.set": ({ namespace, key, value }) => { kvSet(namespace, key, value); return { ok: true }; },
      "store.delete": ({ namespace, key }) => { kvDelete(namespace, key); return { ok: true }; },
      "store.list": ({ namespace }) => ({ keys: kvList(namespace) }),
      "store.snapshot": ({ namespace }) => ({ namespace: String(namespace || "global"), values: kvSnapshot(namespace) }),
      "store.restore": ({ namespace, values }) => { kvRestore(namespace, values); return { ok: true }; },
      "module.list": () => ({ modules: registry.modules.map(publicModule) }),
      "module.get": ({ module_id }) => ({ module: publicModule(registry.modules.find((module) => module.id === module_id)) }),
      "module.install": ({ module }) => { const normalized = normalizeModule(module); if (!normalized) throw new Error("invalid module"); upsertModule(normalized); saveRegistry(); render(); return { ok: true, module: publicModule(normalized) }; },
      "module.update": ({ module }) => { const normalized = normalizeModule(module); if (!normalized) throw new Error("invalid module"); upsertModule(normalized); saveRegistry(); render(); return { ok: true, module: publicModule(normalized) }; },
      "module.enable": ({ module_id }) => { const module = registry.modules.find((item) => item.id === module_id); if (module) module.disabled = false; saveRegistry(); render(); return { ok: Boolean(module) }; },
      "module.disable": ({ module_id }) => { const module = registry.modules.find((item) => item.id === module_id); if (module) module.disabled = true; saveRegistry(); render(); return { ok: Boolean(module) }; },
      "module.remove": ({ module_id }) => { disableModule(String(module_id || "")); return { ok: true }; },
      "module.reload": () => { saveRegistry(); render(); return { ok: true }; },
      "package.detect": () => ({ packs: findModulePackBlocks(readPageText()).map((block) => ({ hash: block.hash, text: block.raw })) }),
      "package.apply": ({ pack, text }) => applyPack(pack || JSON.parse(String(text || "{}")), { source: "capability", feedback: true, force: false }),
      "package.fetchAndApply": async ({ url }) => { const fetched = await networkFetchData({ url, responseType: "json" }); if (!fetched.ok || !fetched.json) throw new Error(fetched.error || `fetch failed: ${fetched.status}`); return applyPack(fetched.json, { source: "network.fetchData", feedback: true, force: false }); },
      "package.listInstalled": () => ({ installedPacks: registry.installedPacks }),
      "network.fetchData": networkFetchData,
      "log.write": ({ entry }) => { writeLog({ type: "module_log", status: "ok", entry }); return { ok: true }; },
      "log.list": ({ limit }) => ({ events: recentEvents(Number(limit || 20)) }),
      "log.clear": () => { setLog([]); return { ok: true }; },
      "maintenance.feedback": ({ feedback, send }) => emitFeedback(feedback || {}, { send: send !== false }),
      "maintenance.diagnose": () => ({ diagnostics: JSON.parse(diagnostics()) }),
      "maintenance.requestKernelChange": ({ capability, reason, module_id }) => { const request = { schema: "dcf.kernel_capability_request.v1", capability: String(capability || ""), reason: String(reason || ""), module_id: String(module_id || ""), at: now() }; emitFeedback({ event: "kernel_capability_request", status: "requested", request }); return { ok: true, request }; },
    };
  }

  async function networkFetchData({ url, method, headers, body, responseType, timeout }) {
    const target = String(url || "");
    if (!/^https?:\/\//i.test(target)) throw new Error("network.fetchData only accepts http/https data URLs.");
    const parsedType = responseType === "json" ? "json" : "text";
    const request = { method: method || "GET", url: target, headers: isPlainObject(headers) ? headers : {}, data: body == null ? undefined : String(body), timeout: Number(timeout || 15000) };
    if (typeof GM_xmlhttpRequest === "function") {
      return await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({ ...request, onload: (response) => resolve(parseNetworkResponse(response.status, response.responseText || "", parsedType)), onerror: () => reject(new Error("network request failed")), ontimeout: () => reject(new Error("network request timed out")) });
      });
    }
    const response = await fetch(target, { method: request.method, headers: request.headers, body: request.data });
    const text = await response.text();
    return parseNetworkResponse(response.status, text, parsedType);
  }

  function parseNetworkResponse(status, text, responseType) {
    if (responseType === "json") {
      try { return { ok: status >= 200 && status < 300, status, json: JSON.parse(text) }; }
      catch (error) { return { ok: false, status, text, error: `json_parse_failed: ${error.message}` }; }
    }
    return { ok: status >= 200 && status < 300, status, text };
  }

  function emitFeedback(data, options) {
    const opts = { send: true, ...options };
    const feedback = { schema: "dcf.feedback.v1", kernel_version: VERSION, at: now(), ...compactValue(data || {}) };
    const text = ["<<<DCF_FEEDBACK", JSON.stringify(feedback, null, 2), "DCF_FEEDBACK>>>"].join("\n");
    writeLog({ type: "feedback", status: "queued", event: feedback.event || "unknown", feedback_status: feedback.status || "" });
    const composerText = readComposer().trim();
    if (composerText) {
      copyText(text);
      notice("已生成反馈，但输入框非空；为避免覆盖草稿，反馈已复制到剪贴板。");
      writeLog({ type: "feedback", status: "clipboard_fallback", reason: "composer_not_empty" });
      return { ok: false, fallback: "clipboard", reason: "composer_not_empty" };
    }
    const result = insertText(text, { send: opts.send, mode: "replace", quiet: true });
    if (!result.ok) {
      copyText(text);
      notice("反馈发送失败，已复制到剪贴板。");
      writeLog({ type: "feedback", status: "clipboard_fallback", reason: result.reason || "composer_not_found" });
      return { ok: false, fallback: "clipboard" };
    }
    return { ok: true, sent: opts.send };
  }

  function insertText(text, options) {
    const opts = { send: false, mode: "insert", quiet: false, ...options };
    const target = findComposer();
    if (!target) {
      if (!opts.quiet) { copyText(text); alert("DCF 未找到输入框，内容已复制到剪贴板。"); }
      return { ok: false, reason: "composer_not_found" };
    }
    target.focus();
    const value = String(text || "");
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      if (opts.mode === "replace") target.value = value;
      else if (opts.mode === "append") target.value = target.value + value;
      else {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.value = target.value.slice(0, start) + value + target.value.slice(end);
      }
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    } else {
      if (opts.mode === "replace") {
        target.textContent = "";
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: "" }));
      } else if (opts.mode === "append") {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      document.execCommand("insertText", false, value);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
    if (opts.send) setTimeout(clickSend, 650);
    return { ok: true };
  }

  function readComposer() {
    const target = findComposer();
    if (!target) return "";
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return target.value || "";
    return target.innerText || target.textContent || "";
  }

  function clickSend() {
    for (const selector of ["button[data-testid='send-button']", "button[aria-label='Send prompt']", "button[aria-label*='Send']", "button[aria-label*='发送']", "form button[type='submit']"]) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLButtonElement && !button.disabled && visible(button)) { button.click(); return true; }
    }
    notice("已插入，但未找到可点击的发送按钮。请手动发送。");
    return false;
  }

  function findComposer() {
    for (const selector of ["#prompt-textarea", "textarea[data-id='root']", "textarea", "[contenteditable='true']", "div.ProseMirror"]) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement && visible(node) && !host.contains(node)) return node;
    }
    return null;
  }

  function readPageText() {
    return document.body?.innerText || "";
  }

  function findModulePackBlocks(text) {
    return textBlocks(text, PACK_RE);
  }

  function findTaggedBlocks(tag, text) {
    const safe = String(tag || "").replace(/[^\w.-]/g, "");
    const re = new RegExp(`<<<${safe}\\b\\s*([\\s\\S]*?)\\s*${safe}>>>`, "g");
    return textBlocks(text, re);
  }

  function textBlocks(text, re) {
    const blocks = [];
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) && blocks.length < 40) {
      const raw = match[1].trim();
      blocks.push({ raw, hash: hash(raw), summary: raw.slice(0, 160) });
    }
    return blocks;
  }

  function upsertModule(module) {
    const index = registry.modules.findIndex((item) => item.id === module.id);
    if (index >= 0) registry.modules[index] = module;
    else registry.modules.push(module);
  }

  function disableModule(id) {
    registry.modules = registry.modules.filter((item) => item.id !== id);
    registry.lastHotUpdate = { at: now(), source: "disable", module_id: id };
    writeLog({ type: "module_disable", status: "ok", module_id: id });
    saveRegistry();
    notice(`已卸载模块：${id}`);
  }

  function publicModule(module) {
    if (!module) return null;
    return { id: module.id, title: module.title, version: module.version, description: module.description, permissions: module.permissions, commands: module.commands.length, blocks: module.blocks.length, disabled: Boolean(module.disabled) };
  }

  function rememberRejected(sourceHash, reason, error) {
    registry.rejections.push({ at: now(), sourceHash, reason, error: String(error || "") });
    registry.rejections = registry.rejections.slice(-30);
    writeLog({ type: "module_install", status: "failed", reason, sourceHash, error: String(error || "") });
    saveRegistry();
  }

  function permissionCovers(permissions, capability) {
    return permissions.includes(capability) || permissions.some((permission) => permission.endsWith(".*") && capability.startsWith(permission.slice(0, -1)));
  }

  function interpolateObject(value, vars, module) {
    if (typeof value === "string") {
      const exact = value.match(/^\{\{\s*([\w.-]+)\s*\}\}$/);
      if (exact) {
        const resolved = resolveTemplateValue(exact[1], vars, module);
        return resolved == null ? "" : resolved;
      }
      return interpolate(value, vars, module);
    }
    if (Array.isArray(value)) return value.map((item) => interpolateObject(item, vars, module));
    if (isPlainObject(value)) {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = interpolateObject(item, vars, module);
      return out;
    }
    return value;
  }

  function interpolate(text, vars, module) {
    return String(text || "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
      const value = resolveTemplateValue(key, vars, module);
      if (value == null) return "";
      return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    });
  }

  function resolveTemplateValue(key, vars, module) {
    if (key.startsWith("template.")) return module?.templates?.[key.slice("template.".length)];
    const parts = key.split(".");
    let value = vars;
    for (const part of parts) { if (value == null) return undefined; value = value[part]; }
    return value;
  }

  function probePack() {
    const at = now();
    return {
      schema: "dcf.module_pack.v1",
      pack_id: "dcf.kernel.ingestion_guard_probe.pack.v1",
      revision: at,
      mode: "merge",
      modules: [{
        id: "dcf.ingestion_guard_probe",
        title: "摄取保护探针",
        version: at,
        description: "验证 0.8.6 能忽略说明性占位块，并通过能力总线执行模块命令。",
        permissions: ["composer.*", "clipboard.*", "ui.*", "maintenance.*"],
        commands: [{
          id: "insert_probe",
          label: "插入探针",
          primary: true,
          steps: [{ call: "composer.insert", with: { text: `请确认：DCF Kernel ${VERSION} 已安装摄取保护探针，并通过 composer.insert 执行。时间：${at}` } }],
        }, {
          id: "feedback_probe",
          label: "发送反馈探针",
          steps: [{ call: "maintenance.feedback", with: { feedback: { event: "probe_command", status: "ok", module_id: "dcf.ingestion_guard_probe" }, send: true } }],
        }],
      }],
    };
  }

  function samplePack() {
    return {
      schema: "dcf.module_pack.v1",
      pack_id: "dcf.sample.ingestion_guard.pack.v1",
      revision: "1",
      mode: "merge",
      modules: [{
        id: "dcf.sample.ingestion_guard",
        title: "摄取保护样例",
        version: "1.0.0",
        description: "展示模块如何通过 command steps 调用内核能力。",
        permissions: ["composer.*", "clipboard.*", "ui.*", "conversation.*"],
        templates: { hello: "这段文字来自 DCF_MODULE_PACK 自动安装模块，不是内核硬编码业务功能。" },
        commands: [{
          id: "insert_template",
          label: "插入模板",
          primary: true,
          steps: [{ call: "composer.insert", with: { text: "{{template.hello}}" } }],
        }, {
          id: "copy_page_info",
          label: "复制页面信息",
          steps: [{ call: "conversation.getPageInfo", as: "page" }, { call: "clipboard.write", with: { text: "{{page}}" } }, { call: "ui.notice", with: { text: "页面信息已复制。" } }],
        }],
      }],
    };
  }

  function repairPrompt() {
    return ["<<<DCF_MAINT", JSON.stringify({
      schema: "dcf.kernel.maintenance.repair.v1",
      kernel_version: VERSION,
      task: "Maintain DCF as a light capability-bus kernel, not a business-feature userscript.",
      required_behavior: [
        "Classify requests as kernel capability, module pack, ammo pack, configuration, documentation, or ADR.",
        "Expose generic kernel abilities through capability calls instead of adding module-specific code.",
        "Module/UI/workflow changes must be delivered as dcf.module_pack.v1 and auto-ingested from the conversation.",
        "Ignore documentation placeholders instead of reporting them as module install failures.",
        "Install and capability failures must produce concise DCF_FEEDBACK without overwriting user drafts.",
        "Keep maintenance light: small log, diagnostics, recovery, no heavy governance system.",
      ],
      current_contract: "DCF core is a small readable Tampermonkey kernel with guarded auto-ingest, capability bus, auto feedback, registry, and rollback-friendly local state.",
    }, null, 2), "DCF_MAINT>>>"].join("\n");
  }

  function diagnostics() {
    return JSON.stringify({
      schema: "dcf.kernel.diagnostics.v1",
      version: VERSION,
      url: location.href,
      title: document.title,
      at: now(),
      state: { tab: state.tab, section: state.section, side: state.side },
      capabilities: CAPABILITY_NAMES,
      modules: registry.modules.map(publicModule),
      installedPacks: registry.installedPacks,
      lastHotUpdate: registry.lastHotUpdate || null,
      lastScan,
      recentEvents: recentEvents(20),
      rejections: registry.rejections.slice(-10),
      legacyKeysPresent: LEGACY_KEYS.filter((key) => localStorage.getItem(key) !== null),
    }, null, 2);
  }

  function clearLegacy() {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    writeLog({ type: "clear_legacy", status: "ok" });
    notice("历史错误状态已清理。");
  }

  function kvKey(namespace, key) { return KV_PREFIX + String(namespace || "global") + "." + String(key || ""); }
  function kvGet(namespace, key, defaultValue) { const full = kvKey(namespace, key); try { if (typeof GM_getValue === "function") return GM_getValue(full, defaultValue); const raw = localStorage.getItem(full); return raw == null ? defaultValue : JSON.parse(raw); } catch { return defaultValue; } }
  function kvSet(namespace, key, value) { const full = kvKey(namespace, key); if (typeof GM_setValue === "function") GM_setValue(full, value); else localStorage.setItem(full, JSON.stringify(value)); }
  function kvDelete(namespace, key) { const full = kvKey(namespace, key); if (typeof GM_deleteValue === "function") GM_deleteValue(full); else localStorage.removeItem(full); }
  function kvList(namespace) { const prefix = KV_PREFIX + String(namespace || "global") + "."; if (typeof GM_listValues === "function") return GM_listValues().filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)); return Object.keys(localStorage).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)); }
  function kvSnapshot(namespace) { const out = {}; for (const key of kvList(namespace)) out[key] = kvGet(namespace, key, null); return out; }
  function kvRestore(namespace, values) { if (!isPlainObject(values)) return; for (const [key, value] of Object.entries(values)) kvSet(namespace, key, value); }

  function loadState() {
    try { return { tab: "maint", section: "status", side: "right", notice: "", packDraft: "", ...(JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}) }; }
    catch { return { tab: "maint", section: "status", side: "right", notice: "", packDraft: "" }; }
  }

  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify({ tab: state.tab === "modules" ? "modules" : "maint", section: state.section || "status", side: state.side === "left" ? "left" : "right", notice: state.notice || "" }));
  }

  function loadRegistry() {
    try {
      const value = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "{}") || {};
      return {
        schema: "dcf.kernel.registry.v1",
        modules: Array.isArray(value.modules) ? value.modules.map(normalizeModule).filter(Boolean) : [],
        installedPacks: isPlainObject(value.installedPacks) ? value.installedPacks : {},
        seenBlocks: isPlainObject(value.seenBlocks) ? value.seenBlocks : {},
        rejections: Array.isArray(value.rejections) ? value.rejections.slice(-30) : [],
        lastHotUpdate: value.lastHotUpdate || null,
      };
    } catch {
      return { schema: "dcf.kernel.registry.v1", modules: [], installedPacks: {}, seenBlocks: {}, rejections: [], lastHotUpdate: null };
    }
  }

  function saveRegistry() { localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry)); }
  function getLog() { try { const value = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
  function setLog(events) { localStorage.setItem(LOG_KEY, JSON.stringify(Array.isArray(events) ? events.slice(-40) : [])); }
  function writeLog(entry) { const next = getLog().slice(-39); next.push({ at: entry.at || now(), ...entry }); setLog(next); }
  function recentEvents(limit) { return getLog().slice(-Number(limit || 20)).reverse(); }
  function compactEvent(event) { const out = { ...event }; delete out.entry; return out; }
  function compactValue(value) { if (Array.isArray(value)) return value.slice(0, 20).map(compactValue); if (isPlainObject(value)) { const out = {}; for (const [key, item] of Object.entries(value).slice(0, 40)) out[key] = compactValue(item); return out; } if (typeof value === "string" && value.length > 700) return value.slice(0, 700) + "…"; return value; }
  function groupCapabilities() { const groups = {}; for (const name of CAPABILITY_NAMES) { const group = name.split(".")[0]; if (!groups[group]) groups[group] = []; groups[group].push(name); } return groups; }
  function registerMenu() { if (typeof GM_registerMenuCommand !== "function") return; GM_registerMenuCommand("DCF: copy diagnostics", () => copyText(diagnostics())); GM_registerMenuCommand("DCF: scan module packs", () => autoScan(true)); }
  function copyText(text) { if (typeof GM_setClipboard === "function") GM_setClipboard(String(text || "")); else navigator.clipboard?.writeText(String(text || "")); }
  function notice(text) { state.notice = String(text || ""); saveState(); render(); }
  function visible(node) { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
  function now() { return new Date().toISOString(); }
  function safeStringify(value) { try { return JSON.stringify(value); } catch { return String(value); } }
  function isPlainObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function hash(text) { let value = 5381; const source = String(text || ""); for (let index = 0; index < source.length; index += 1) value = ((value << 5) + value) ^ source.charCodeAt(index); return `h${(value >>> 0).toString(16)}`; }
  function esc(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
})();
