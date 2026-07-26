'use strict';
// cpaste.js — 卡片发送（剪贴板模拟）工具
// 导出：globalThis.DCFCpaste.sendCardToActiveTab(cardText)
// 方案 A: navigator.clipboard.writeText（需 secure context + 权限）
// 方案 B: 隐藏 textarea + document.execCommand('copy')（降级）
// 注意：Chrome 138 已移除 clipboard-unrestricted-read-write flag，
//       因此方案 A 可能因权限降级失败，需自动回退到方案 B。

(function () {
  'use strict';

  async function copyViaClipboardAPI(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('clipboard API 不可用');
    }
    await navigator.clipboard.writeText(text);
    return { status: 'copied', method: 'clipboard-api' };
  }

  function copyViaExecCommand(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (!ok) throw new Error('execCommand copy 失败');
    return { status: 'pasted', method: 'exec-command' };
  }

  // 主入口：将卡片文本写入剪贴板，供后续粘贴动作使用。
  // 优先方案 A，失败自动降级方案 B。
  async function sendCardToActiveTab(cardText) {
    if (typeof cardText !== 'string') {
      return { status: 'failed', error: 'cardText 必须为字符串' };
    }
    try {
      return await copyViaClipboardAPI(cardText);
    } catch (eA) {
      try {
        return await copyViaExecCommand(cardText);
      } catch (eB) {
        return {
          status: 'failed',
          error: 'A:' + (eA && eA.message || eA) + '; B:' + (eB && eB.message || eB)
        };
      }
    }
  }

  globalThis.DCFCpaste = {
    sendCardToActiveTab: sendCardToActiveTab,
    copyViaClipboardAPI: copyViaClipboardAPI,
    copyViaExecCommand: copyViaExecCommand
  };
})();
