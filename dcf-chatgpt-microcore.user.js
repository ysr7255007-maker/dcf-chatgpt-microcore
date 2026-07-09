// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.8.1
// @description  DCF native single-file Tampermonkey release. No remote eval, no chunks.
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

  const VERSION = "0.8.1";
  const STORE_KEY = "dcf.native.state.v1";
  const LEGACY_KEYS = [
    "dcf.github.engine.cache.v1",
    "dcf.github.engine.lastCheck.v1",
    "dcf.local.engine.v1",
  ];
  const RUN_RE = /<<<DCF_RUN\b\s*([\s\S]*?)\s*DCF_RUN>>>/g;
  const MAINT_RE = /<<<DCF_MAINT\b\s*([\s\S]*?)\s*DCF_MAINT>>>/g;

  const state = loadState();
  const shell = createShell();
  document.documentElement.appendChild(shell.host);
  render();
  setTimeout(scanAndRender, 0);
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, characterData: true });

  let scanTimer = null;
  let lastScan = { runBlocks: [], maintBlocks: [], textLength: 0, at: "" };

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndRender, 500);
  }

  function scanAndRender() {
    const text = document.body?.innerText || "";
    lastScan = {
      runBlocks: collectBlocks(text, RUN_RE),
      maintBlocks: collectBlocks(text, MAINT_RE),
      textLength: text.length,
      at: new Date().toISOString(),
    };
    render();
  }

  function collectBlocks(text, regex) {
    const blocks = [];
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) && blocks.length < 20) {
      const raw = match[1].trim();
      blocks.push({ id: hash(raw), raw, summary: summarizeBlock(raw) });
    }
    return blocks;
  }

  function summarizeBlock(raw) {
    const first = raw.split(/\n+/).map((line) => line.trim()).find(Boolean) || "empty block";
    return first.length > 90 ? first.slice(0, 90) + "…" : first;
  }

  function createShell() {
    const host = document.createElement("div");
    host.id = "dcf-chatgpt-microcore-host";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .button {
          position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
          width: 52px; height: 52px; border-radius: 999px; border: 1px solid rgba(120,120,120,.35);
          background: #111827; color: white; font: 700 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 10px 30px rgba(0,0,0,.28); cursor: pointer;
        }
        .panel {
          position: fixed; right: 18px; bottom: 82px; z-index: 2147483647;
          width: min(420px, calc(100vw - 36px)); max-height: min(620px, calc(100vh - 120px)); overflow: auto;
          border-radius: 16px; border: 1px solid rgba(120,120,120,.28);
          background: color-mix(in srgb, Canvas 96%, transparent); color: CanvasText;
          box-shadow: 0 16px 50px rgba(0,0,0,.32);
          font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .hidden { display: none; }
        .head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(120,120,120,.22); }
        .title { font-weight: 750; font-size: 14px; }
        .muted { color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 12px; }
        .body { padding: 12px 14px 14px; }
        .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 12px; }
        button.action {
          border: 1px solid rgba(120,120,120,.28); border-radius: 10px; padding: 7px 9px;
          background: color-mix(in srgb, CanvasText 7%, Canvas); color: CanvasText; cursor: pointer;
          font: inherit;
        }
        button.action:hover { background: color-mix(in srgb, CanvasText 12%, Canvas); }
        .section { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(120,120,120,.18); }
        .block { margin-top: 8px; padding: 9px; border-radius: 11px; background: color-mix(in srgb, CanvasText 5%, Canvas); border: 1px solid rgba(120,120,120,.16); }
        .block-title { font-weight: 650; margin-bottom: 4px; }
        textarea {
          width: 100%; min-height: 110px; box-sizing: border-box; resize: vertical; border-radius: 12px;
          border: 1px solid rgba(120,120,120,.24); padding: 9px; background: Canvas; color: CanvasText; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .ok { color: #059669; }
        .warn { color: #d97706; }
      </style>
      <button class="button" type="button" title="DCF">DCF</button>
      <section class="panel hidden" role="dialog" aria-label="DCF ChatGPT Microcore"></section>
    `;
    root.querySelector(".button").addEventListener("click", () => {
      state.open = !state.open;
      saveState();
      render();
    });
    return { host, root, panel: root.querySelector(".panel") };
  }

  function render() {
    shell.panel.classList.toggle("hidden", !state.open);
    if (!state.open) return;
    const runBlocks = lastScan.runBlocks || [];
    const maintBlocks = lastScan.maintBlocks || [];
    shell.panel.innerHTML = `
      <div class="head">
        <div>
          <div class="title">DCF ChatGPT Microcore</div>
          <div class="muted">native ${VERSION} · no remote eval · no chunks</div>
        </div>
        <button class="action" data-action="close">关闭</button>
      </div>
      <div class="body">
        <div class="muted">状态：<span class="ok">脚本已作为完整 Tampermonkey userscript 运行</span></div>
        <div class="muted">页面文本：${lastScan.textLength || 0} chars · RUN ${runBlocks.length} · MAINT ${maintBlocks.length}</div>
        <div class="row">
          <button class="action" data-action="scan">重扫页面</button>
          <button class="action" data-action="copy-summary">复制摘要</button>
          <button class="action" data-action="insert-maint">插入维护提示</button>
          <button class="action" data-action="clear-legacy">清理旧缓存</button>
        </div>
        <div class="section">
          <div class="block-title">维护说明</div>
          <div class="muted">0.8.1 是原生单文件恢复版：GitHub 根目录脚本就是完整运行代码，不再从 GitHub 拉 engine，不再 Function/eval。</div>
        </div>
        ${renderBlocks("DCF_RUN blocks", runBlocks)}
        ${renderBlocks("DCF_MAINT blocks", maintBlocks)}
        <div class="section">
          <div class="block-title">当前摘要</div>
          <textarea readonly>${escapeHtml(makeSummary())}</textarea>
        </div>
      </div>
    `;
    shell.panel.querySelectorAll("[data-action]").forEach((node) => {
      node.addEventListener("click", () => handleAction(node.getAttribute("data-action")));
    });
  }

  function renderBlocks(title, blocks) {
    if (!blocks.length) {
      return `<div class="section"><div class="block-title">${escapeHtml(title)}</div><div class="muted">未发现。</div></div>`;
    }
    return `<div class="section"><div class="block-title">${escapeHtml(title)}</div>${blocks.map((block, index) => `
      <div class="block">
        <div class="block-title">#${index + 1} · ${escapeHtml(block.summary)}</div>
        <textarea readonly>${escapeHtml(block.raw)}</textarea>
      </div>
    `).join("")}</div>`;
  }

  function handleAction(action) {
    if (action === "close") {
      state.open = false;
      saveState();
      render();
      return;
    }
    if (action === "scan") {
      scanAndRender();
      return;
    }
    if (action === "copy-summary") {
      copyText(makeSummary());
      return;
    }
    if (action === "insert-maint") {
      insertText(makeMaintenancePrompt());
      return;
    }
    if (action === "clear-legacy") {
      LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
      scanAndRender();
    }
  }

  function makeSummary() {
    return JSON.stringify({
      schema: "dcf.native.summary.v1",
      version: VERSION,
      url: location.href,
      title: document.title,
      at: new Date().toISOString(),
      textLength: lastScan.textLength || 0,
      runBlocks: (lastScan.runBlocks || []).map(({ id, summary }) => ({ id, summary })),
      maintBlocks: (lastScan.maintBlocks || []).map(({ id, summary }) => ({ id, summary })),
    }, null, 2);
  }

  function makeMaintenancePrompt() {
    return [
      "<<<DCF_MAINT",
      JSON.stringify({
        schema: "dcf.maintenance.request.v1",
        version: VERSION,
        request: "Summarize the current conversation state, decisions, errors, and next concrete action. Keep it suitable for ADR/update logging.",
        at: new Date().toISOString(),
        source: location.href,
      }, null, 2),
      "DCF_MAINT>>>",
    ].join("\n");
  }

  function insertText(text) {
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
      return;
    }
    document.execCommand("insertText", false, text);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      "textarea[data-id='root']",
      "textarea",
      "[contenteditable='true']",
      "div.ProseMirror",
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement && isVisible(node)) return node;
    }
    return null;
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text);
      return;
    }
    navigator.clipboard?.writeText(text);
  }

  function loadState() {
    try {
      return { open: false, ...(JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}) };
    } catch {
      return { open: false };
    }
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ open: Boolean(state.open) }));
  }

  function hash(text) {
    let value = 5381;
    for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value) ^ text.charCodeAt(index);
    return `h${(value >>> 0).toString(16)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
