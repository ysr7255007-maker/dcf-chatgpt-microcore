// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.8.4
// @description  DCF kernel-only maintenance wrapper and declarative module hot-update runtime. No remote eval, no chunks.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.8.4";
  const STATE_KEY = "dcf.kernel.state.v1";
  const MODULE_KEY = "dcf.kernel.modules.v1";
  const LOG_KEY = "dcf.kernel.maintenance.log.v1";
  const LEGACY_KEYS = [
    "dcf.github.engine." + "cache.v1",
    "dcf.github.engine." + "lastCheck.v1",
    "dcf.local.engine." + "v1",
    "dcf.ammo.store.v1",
    "dcf.module.registry.v1",
  ];

  const state = loadState();
  const registry = loadRegistry();
  const host = document.createElement("div");
  host.id = "dcf-chatgpt-microcore-host";

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{all:initial}
      .shell{position:fixed;top:72px;right:12px;bottom:86px;width:min(352px,calc(100vw - 28px));z-index:2147483646;display:flex;flex-direction:column;border:1px solid rgba(130,130,130,.28);border-radius:18px;background:rgba(250,250,250,.94);color:#111827;box-shadow:0 18px 50px rgba(0,0,0,.16);backdrop-filter:blur(14px);font:13px/1.42 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
      .shell[data-side=left]{left:12px;right:auto}
      @media(prefers-color-scheme:dark){.shell{background:rgba(23,23,23,.92);color:#f5f5f5;border-color:rgba(210,210,210,.16);box-shadow:0 18px 50px rgba(0,0,0,.38)}}
      .top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid rgba(130,130,130,.18)}
      .title{font-size:14px;font-weight:780}.sub{margin-top:1px;font-size:11px;opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pill{border:1px solid rgba(37,99,235,.35);border-radius:999px;padding:6px 9px;background:rgba(37,99,235,.10);color:inherit;font:700 11px/1 system-ui;white-space:nowrap}
      .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(130,130,130,.14)}
      .tab{border:1px solid rgba(130,130,130,.18);border-radius:11px;padding:7px 0;background:transparent;color:inherit;cursor:pointer;font:650 12px/1 system-ui}
      .tab[aria-selected=true]{background:rgba(37,99,235,.12);border-color:rgba(37,99,235,.35)}
      .content{flex:1;overflow:auto;padding:10px}.line{margin:0 0 10px;font-size:12px;opacity:.70}
      .notice{border:1px solid rgba(5,150,105,.25);background:rgba(5,150,105,.09);border-radius:12px;padding:8px 9px;margin:0 0 10px;font-size:12px}
      .warnbox{border:1px solid rgba(217,119,6,.35);background:rgba(217,119,6,.10);border-radius:12px;padding:8px 9px;margin:0 0 10px;font-size:12px}
      .block{border:1px solid rgba(130,130,130,.18);border-radius:15px;background:rgba(127,127,127,.045);margin-bottom:10px;overflow:hidden}
      .head{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;padding:11px 12px;color:inherit;background:transparent;text-align:left;cursor:pointer;font:inherit}
      .bt{font-size:13px;font-weight:760}.bd{margin-top:2px;font-size:12px;opacity:.62}.body{padding:0 12px 12px;border-top:1px solid rgba(130,130,130,.12)}
      .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.a{border:1px solid rgba(130,130,130,.23);border-radius:10px;padding:7px 9px;background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font:12px/1.1 system-ui}
      .a.primary{background:rgba(37,99,235,.14);border-color:rgba(37,99,235,.35);font-weight:700}.a.hot{background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.32);font-weight:700}.a.warn{background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.32)}
      .card{border:1px solid rgba(130,130,130,.16);border-radius:12px;padding:9px;background:rgba(255,255,255,.32);margin-top:8px}@media(prefers-color-scheme:dark){.card{background:rgba(255,255,255,.035)}}
      .name{font-weight:720;font-size:12px}.desc{margin-top:3px;font-size:12px;opacity:.66}.mini{font-size:11px;opacity:.56;margin-top:4px}
      .field{margin-top:9px}.field label{display:block;font-size:12px;font-weight:680;margin-bottom:5px}
      textarea{width:100%;min-height:96px;box-sizing:border-box;resize:vertical;border-radius:12px;border:1px solid rgba(130,130,130,.22);padding:8px 9px;background:rgba(255,255,255,.55);color:inherit;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      @media(prefers-color-scheme:dark){textarea{background:rgba(0,0,0,.18)}}
      .empty{border:1px dashed rgba(130,130,130,.26);border-radius:14px;padding:12px;font-size:12px;opacity:.72}
      .row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(130,130,130,.12)}
      .badge{border:1px solid rgba(37,99,235,.26);color:#2563eb;border-radius:999px;padding:2px 7px;font-size:11px;white-space:nowrap}
    </style>
    <aside class="shell" aria-label="DCF Kernel Maintenance Wrapper"></aside>
  `;
  const shell = root.querySelector(".shell");
  document.documentElement.appendChild(host);

  shell.addEventListener("click", onClick);
  shell.addEventListener("input", onInput);
  render();

  function render() {
    shell.dataset.side = state.side;
    shell.innerHTML = `
      <div class="top">
        <div>
          <div class="title">DCF Kernel</div>
          <div class="sub">native ${VERSION} · maintenance wrapper only</div>
        </div>
        <span class="pill">${registry.modules.length} modules</span>
      </div>
      <div class="tabs">
        <button class="tab" aria-selected="${state.tab === "maint"}" data-act="tab" data-tab="maint">维护</button>
        <button class="tab" aria-selected="${state.tab === "modules"}" data-act="tab" data-tab="modules">模块</button>
      </div>
      <div class="content">
        ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}
        ${state.tab === "modules" ? modulesView() : maintenanceView()}
      </div>
    `;
  }

  function maintenanceView() {
    return `
      <div class="warnbox">当前内核只保留维护框架和声明式模块运行时。业务 UI 与插件能力必须通过模块包热更新进入，不再写入 userscript 主体。</div>
      ${section("status", "内核状态", "版本、模块注册表、热维护记录。", statusBody())}
      ${section("install", "热更新入口", "粘贴模块包 JSON 后即时装载，不刷新页面，不执行远程代码。", installBody())}
      ${section("repair", "自我纠错维护", "用于阻止把模块需求继续写进内核。", repairBody())}
      ${section("danger", "恢复与清理", "只处理内核和历史错误状态。", dangerBody())}
    `;
  }

  function modulesView() {
    if (!registry.modules.length) {
      return `<div class="empty">当前没有业务模块。请回到“维护 → 热更新入口”，通过模块包 JSON 装载模块。内核不会内置语言弹药 UI。</div>`;
    }
    return registry.modules.map(renderModule).join("");
  }

  function section(id, title, desc, body) {
    const open = state.section === id;
    return `<section class="block"><button class="head" data-act="section" data-section="${esc(id)}"><span><div class="bt">${esc(title)}</div><div class="bd">${esc(desc)}</div></span><span>${open ? "−" : "+"}</span></button>${open ? `<div class="body">${body}</div>` : ""}</section>`;
  }

  function statusBody() {
    const last = registry.lastHotUpdate;
    return `
      <div class="small">kernel: ${VERSION}</div>
      <div class="small">module schema: dcf.module_pack.v1</div>
      <div class="small">registered modules: ${registry.modules.length}</div>
      <div class="small">last hot update: ${esc(last?.at || "none")}</div>
      <div class="actions">
        <button class="a primary" data-act="copy-diag">复制诊断</button>
        <button class="a" data-act="side">切换左右侧</button>
      </div>
    `;
  }

  function installBody() {
    return `
      <div class="field">
        <label>模块包 JSON</label>
        <textarea data-role="pack" placeholder='{"schema":"dcf.module_pack.v1","mode":"merge","modules":[{"id":"example.module","title":"示例模块","version":"1.0.0","blocks":[{"id":"hello","title":"示例功能块","description":"通过热更新出现","actions":[{"id":"insert","label":"插入文本","kind":"insert_text","text":"hello"}]}]}]}'></textarea>
      </div>
      <div class="actions">
        <button class="a primary" data-act="apply-pack">应用热更新</button>
        <button class="a hot" data-act="probe">热更新自检模块</button>
        <button class="a" data-act="copy-sample">复制模块包样例</button>
      </div>
    `;
  }

  function repairBody() {
    return `
      <div class="small">这个维护提示用于约束后续 AI：模块需求不得默认改内核；先通过模块包、配置、声明式 UI 和热维护路径解决。</div>
      <div class="actions">
        <button class="a primary" data-act="insert-repair">插入维护纠错提示</button>
        <button class="a" data-act="copy-repair">复制维护纠错提示</button>
      </div>
    `;
  }

  function dangerBody() {
    return `
      <div class="small">清理历史 remote engine、0.8.3 内嵌模块状态和当前模块注册表。清理后内核仍保留维护框架。</div>
      <div class="actions">
        <button class="a warn" data-act="clear-legacy">清理历史错误状态</button>
        <button class="a warn" data-act="reset-modules">清空模块注册表</button>
      </div>
    `;
  }

  function renderModule(module) {
    const blocks = Array.isArray(module.blocks) ? module.blocks : [];
    return `<section class="block"><button class="head" data-act="noop"><span><div class="bt">${esc(module.title || module.id)}</div><div class="bd">${esc(module.description || `module ${module.id}`)}</div></span><span class="badge">${esc(module.version || "v?")}</span></button><div class="body">${blocks.length ? blocks.map((b, i) => renderBlock(module, b, i)).join("") : `<div class="empty">模块没有声明功能块。</div>`}<div class="actions"><button class="a warn" data-act="disable-module" data-module="${esc(module.id)}">卸载模块</button></div></div></section>`;
  }

  function renderBlock(module, block, index) {
    const actions = Array.isArray(block.actions) ? block.actions : [];
    return `<div class="card"><div class="name">${esc(block.title || block.id || `block-${index + 1}`)}</div><div class="desc">${esc(block.description || "")}</div>${actions.length ? `<div class="actions">${actions.map((a, i) => `<button class="a ${a.primary ? "primary" : ""}" data-act="module-action" data-module="${esc(module.id)}" data-block="${index}" data-action-index="${i}">${esc(a.label || a.id || a.kind || `action-${i + 1}`)}</button>`).join("")}</div>` : `<div class="mini">没有声明动作。</div>`}</div>`;
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
    if (act === "side") { state.side = state.side === "left" ? "right" : "left"; saveState(); render(); return; }
    if (act === "apply-pack") { applyPackFromTextarea(); return; }
    if (act === "probe") { applyPack(probePack(), "kernel-self-test"); return; }
    if (act === "copy-sample") { copyText(JSON.stringify(samplePack(), null, 2)); notice("模块包样例已复制。"); return; }
    if (act === "insert-repair") { insertText(repairPrompt(), false); return; }
    if (act === "copy-repair") { copyText(repairPrompt()); notice("维护纠错提示已复制。"); return; }
    if (act === "clear-legacy") { clearLegacy(); return; }
    if (act === "reset-modules") { registry.modules = []; registry.lastHotUpdate = { at: new Date().toISOString(), source: "reset" }; saveRegistry(); state.tab = "maint"; notice("模块注册表已清空。"); return; }
    if (act === "disable-module") { disableModule(node.dataset.module); return; }
    if (act === "module-action") { runModuleAction(node); }
  }

  function applyPackFromTextarea() {
    const text = root.querySelector("[data-role='pack']")?.value?.trim() || state.packDraft || "";
    if (!text) { notice("没有可应用的模块包 JSON。"); return; }
    try { applyPack(JSON.parse(text), "pasted-json"); } catch (error) { notice(`模块包 JSON 解析失败：${error.message}`); }
  }

  function applyPack(pack, source) {
    const normalized = normalizePack(pack);
    if (!normalized.ok) { notice(normalized.error); return; }
    if (normalized.pack.mode === "replace") registry.modules = [];
    for (const module of normalized.pack.modules) upsertModule(module);
    registry.lastHotUpdate = {
      at: new Date().toISOString(),
      source,
      packId: normalized.pack.packId,
      moduleCount: normalized.pack.modules.length,
    };
    writeLog({ type: "module_hot_update", ...registry.lastHotUpdate });
    saveRegistry();
    state.tab = "modules";
    state.section = "status";
    notice(`热更新完成：${normalized.pack.modules.length} 个模块已装载。`);
  }

  function normalizePack(pack) {
    if (!pack || typeof pack !== "object") return { ok: false, error: "模块包不是对象。" };
    if (pack.schema !== "dcf.module_pack.v1") return { ok: false, error: "模块包 schema 必须是 dcf.module_pack.v1。" };
    if (!Array.isArray(pack.modules)) return { ok: false, error: "模块包缺少 modules 数组。" };
    const modules = pack.modules.map(normalizeModule).filter(Boolean);
    if (!modules.length) return { ok: false, error: "模块包没有合法模块。" };
    return {
      ok: true,
      pack: {
        packId: String(pack.pack_id || pack.packId || `pack.${hash(JSON.stringify(pack))}`),
        mode: pack.mode === "replace" ? "replace" : "merge",
        modules,
      },
    };
  }

  function normalizeModule(module) {
    if (!module || typeof module !== "object") return null;
    const id = String(module.id || "").trim();
    const title = String(module.title || "").trim();
    if (!id || !title) return null;
    return {
      id,
      title,
      version: String(module.version || "1.0.0"),
      description: String(module.description || ""),
      blocks: Array.isArray(module.blocks) ? module.blocks.map(normalizeBlock).filter(Boolean) : [],
      installedAt: new Date().toISOString(),
    };
  }

  function normalizeBlock(block) {
    if (!block || typeof block !== "object") return null;
    const id = String(block.id || `block.${hash(JSON.stringify(block))}`);
    const actions = Array.isArray(block.actions) ? block.actions.map(normalizeAction).filter(Boolean) : [];
    return {
      id,
      title: String(block.title || id),
      description: String(block.description || ""),
      actions,
    };
  }

  function normalizeAction(action) {
    if (!action || typeof action !== "object") return null;
    const kind = String(action.kind || "").trim();
    if (!["insert_text", "insert_and_send", "copy_text", "notice"].includes(kind)) return null;
    return {
      id: String(action.id || `action.${hash(JSON.stringify(action))}`),
      label: String(action.label || kind),
      kind,
      text: String(action.text || ""),
      message: String(action.message || ""),
      primary: Boolean(action.primary),
    };
  }

  function upsertModule(module) {
    const index = registry.modules.findIndex((item) => item.id === module.id);
    if (index >= 0) registry.modules[index] = module;
    else registry.modules.push(module);
  }

  function disableModule(id) {
    registry.modules = registry.modules.filter((item) => item.id !== id);
    registry.lastHotUpdate = { at: new Date().toISOString(), source: "disable", moduleId: id };
    writeLog({ type: "module_disable", ...registry.lastHotUpdate });
    saveRegistry();
    notice(`已卸载模块：${id}`);
  }

  function runModuleAction(node) {
    const module = registry.modules.find((item) => item.id === node.dataset.module);
    const block = module?.blocks?.[Number(node.dataset.block)];
    const action = block?.actions?.[Number(node.dataset.actionIndex)];
    if (!action) return;
    if (action.kind === "insert_text") { insertText(action.text, false); return; }
    if (action.kind === "insert_and_send") { insertText(action.text, true); return; }
    if (action.kind === "copy_text") { copyText(action.text); notice(action.message || "模块文本已复制。"); return; }
    if (action.kind === "notice") { notice(action.message || action.text || "模块动作已执行。"); }
  }

  function probePack() {
    const at = new Date().toISOString();
    return {
      schema: "dcf.module_pack.v1",
      pack_id: "dcf.kernel.hot_update_probe.pack.v1",
      mode: "merge",
      modules: [{
        id: "dcf.hot_update_probe.module",
        title: "热更新探针模块",
        version: at,
        description: "这个模块不是内核内置 UI；它通过模块包热更新进入模块区。",
        blocks: [{
          id: "probe",
          title: "探针动作",
          description: "点击后向输入框插入一段验证文字。",
          actions: [{
            id: "insert_probe",
            label: "插入探针",
            kind: "insert_text",
            primary: true,
            text: `请确认：DCF 在 ${at} 通过包裹体完成了一次模块包热更新。这个结果证明的是声明式模块数据热更新，不是 userscript 底层发版，也不是远程代码执行。`,
          }, {
            id: "copy_probe",
            label: "复制探针",
            kind: "copy_text",
            text: `DCF hot-update probe ${at}`,
            message: "热更新探针文本已复制。",
          }],
        }],
      }],
    };
  }

  function samplePack() {
    return {
      schema: "dcf.module_pack.v1",
      pack_id: "custom.sample.pack.v1",
      mode: "merge",
      modules: [{
        id: "custom.sample.module",
        title: "自定义样例模块",
        version: "1.0.0",
        description: "通过 DCF 包裹体热更新装载的声明式模块。",
        blocks: [{
          id: "hello",
          title: "样例功能块",
          description: "这个功能块不是 userscript 内核代码。",
          actions: [{
            id: "insert",
            label: "插入样例文本",
            kind: "insert_text",
            primary: true,
            text: "这段文字来自热更新模块包，而不是 DCF 内核硬编码功能。",
          }, {
            id: "copy",
            label: "复制样例文本",
            kind: "copy_text",
            text: "DCF declarative module sample",
            message: "样例文本已复制。",
          }],
        }],
      }],
    };
  }

  function repairPrompt() {
    return [
      "<<<DCF_MAINT",
      JSON.stringify({
        schema: "dcf.kernel.maintenance.repair.v1",
        kernel_version: VERSION,
        task: "Stop treating module/plugin requirements as kernel code changes.",
        required_behavior: [
          "First classify the request as kernel, module package, ammo pack, configuration, documentation, or ADR.",
          "Only modify userscript kernel when the maintenance wrapper or declarative module runtime itself is insufficient.",
          "For UI and feature changes, produce a dcf.module_pack.v1 package and apply it through the DCF wrapper.",
          "Do not implement plugin-specific behavior by adding functions to dcf-chatgpt-microcore.user.js.",
          "After changes, verify by applying a module package without refreshing the page or changing userscript version.",
        ],
        current_contract: "DCF core is a maintenance wrapper and declarative module hot-update runtime. Business UI and plugin behavior must enter through module packages.",
      }, null, 2),
      "DCF_MAINT>>>",
    ].join("\n");
  }

  function diagnostics() {
    return JSON.stringify({
      schema: "dcf.kernel.diagnostics.v1",
      version: VERSION,
      url: location.href,
      title: document.title,
      at: new Date().toISOString(),
      state: { tab: state.tab, section: state.section, side: state.side },
      modules: registry.modules.map((module) => ({
        id: module.id,
        title: module.title,
        version: module.version,
        blocks: module.blocks.length,
      })),
      lastHotUpdate: registry.lastHotUpdate || null,
      legacyKeysPresent: LEGACY_KEYS.filter((key) => localStorage.getItem(key) !== null),
    }, null, 2);
  }

  function clearLegacy() {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    writeLog({ type: "clear_legacy", at: new Date().toISOString() });
    notice("历史错误状态已清理。");
  }

  function insertText(text, send) {
    const target = findComposer();
    if (!target) {
      copyText(text);
      alert("DCF 未找到输入框，内容已复制到剪贴板。");
      return;
    }
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else {
      document.execCommand("insertText", false, text);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    if (send) setTimeout(clickSend, 650);
  }

  function clickSend() {
    for (const selector of ["button[data-testid='send-button']", "button[aria-label='Send prompt']", "button[aria-label*='Send']", "button[aria-label*='发送']", "form button[type='submit']"]) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLButtonElement && !button.disabled && visible(button)) {
        button.click();
        return true;
      }
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

  function visible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function copyText(text) {
    if (typeof GM_setClipboard === "function") GM_setClipboard(text);
    else navigator.clipboard?.writeText(text);
  }

  function notice(text) {
    state.notice = text;
    saveState();
    render();
  }

  function loadState() {
    try {
      return { tab: "maint", section: "status", side: "right", notice: "", packDraft: "", ...(JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}) };
    } catch {
      return { tab: "maint", section: "status", side: "right", notice: "", packDraft: "" };
    }
  }

  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      tab: state.tab === "modules" ? "modules" : "maint",
      section: state.section || "status",
      side: state.side === "left" ? "left" : "right",
      notice: state.notice || "",
    }));
  }

  function loadRegistry() {
    try {
      const value = JSON.parse(localStorage.getItem(MODULE_KEY) || "{}") || {};
      return {
        schema: "dcf.kernel.modules.v1",
        modules: Array.isArray(value.modules) ? value.modules.map(normalizeModule).filter(Boolean) : [],
        lastHotUpdate: value.lastHotUpdate || null,
      };
    } catch {
      return { schema: "dcf.kernel.modules.v1", modules: [], lastHotUpdate: null };
    }
  }

  function saveRegistry() {
    localStorage.setItem(MODULE_KEY, JSON.stringify(registry));
  }

  function writeLog(entry) {
    try {
      const old = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      const next = Array.isArray(old) ? old.slice(-49) : [];
      next.push({ ...entry, at: entry.at || new Date().toISOString() });
      localStorage.setItem(LOG_KEY, JSON.stringify(next));
    } catch {
      localStorage.setItem(LOG_KEY, JSON.stringify([{ ...entry, at: new Date().toISOString() }]));
    }
  }

  function hash(text) {
    let value = 5381;
    for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value) ^ text.charCodeAt(index);
    return `h${(value >>> 0).toString(16)}`;
  }

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
