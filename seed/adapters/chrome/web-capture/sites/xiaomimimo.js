/**
 * 小米 MiMo Studio Site Adapter
 *
 * URL: aistudio.xiaomimimo.com（用户已登录实测）
 * 侦察证据（2026-07-29）：
 * - 会话 URL：hash 路由 #/chat/{hex}（如 https://aistudio.xiaomimimo.com/#/chat/f04abac...）
 * - 用户气泡：div.bg-mimo-bg-message（右对齐 flex-row-reverse/items-end）
 * - 助手正文：div.markdown-prose（class 含 Markdown_markdown 哈希）
 * - 助手含「已深度思考（用时 N 秒）」思维链标题，textOf 须排除
 */
'use strict';

const __SITE_XIAOMIMIMO = {
  host: 'aistudio.xiaomimimo.com',

  matches: [
    'https://aistudio.xiaomimimo.com/*',
    'https://*.xiaomimimo.com/*'
  ],

  // hash 路由提取会话 ID：#/chat/{hex}
  conversationId: function (url) {
    const match = (url.hash || '').match(/#\/chat\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  messageSelectors: [
    '.bg-mimo-bg-message, .markdown-prose',
    '[class*="bg-mimo-bg-message"], [class*="Markdown_markdown"]',
    '[class*="markdown-prose"]'
  ],

  roleOf: function (el) {
    const cls = (el.className || '').toString();
    if (cls.includes('bg-mimo-bg-message')) return 'user';
    if (el.querySelector && el.querySelector('[class*="bg-mimo-bg-message"]')) return 'user';
    if (el.closest && el.closest('[class*="bg-mimo-bg-message"]')) return 'user';
    if (cls.includes('markdown-prose') || cls.includes('Markdown_markdown')) return 'assistant';
    if (el.querySelector && el.querySelector('[class*="markdown-prose"], [class*="Markdown_markdown"]')) return 'assistant';
    if (el.closest && el.closest('[class*="markdown-prose"], [class*="Markdown_markdown"]')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"], [class*="Collapsible"], [class*="collapsible"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('已深度思考') && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 957943e69161854490547ddaebb4f43a，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_XIAOMIMIMO;
}
