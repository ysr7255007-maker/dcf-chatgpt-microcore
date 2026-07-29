/**
 * MiniMax Agent (Mavis) Site Adapter
 *
 * URL: agent.minimaxi.com（用户已登录实测）
 * 侦察证据（2026-07-29）：
 * - 会话 URL：/mavis?id={digits}（会话 ID 在查询参数）
 * - composer：tiptap ProseMirror contenteditable
 * - 用户消息：p.message-container-user-text（气泡右对齐 items-end）
 * - 助手消息：div.message-animate-in（Mavis 回复容器）
 */
'use strict';

const __SITE_MINIMAX = {
  host: 'agent.minimaxi.com',

  matches: [
    'https://agent.minimaxi.com/*',
    'https://*.minimaxi.com/*'
  ],

  // 会话 ID 在 ?id= 查询参数；无则返回 null
  conversationId: function (url) {
    const id = url.searchParams.get('id');
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  },

  messageSelectors: [
    '.message-container-user-text, .message-animate-in',
    '[class*="message-container-user"], [class*="message-animate-in"]',
    '.message-container-chat-content [class*="message"]'
  ],

  roleOf: function (el) {
    const cls = (el.className || '').toString();
    // 自身或后代含用户文本容器 → user（兼容最外层去重后的容器元素）
    if (cls.includes('message-container-user')) return 'user';
    if (el.querySelector && el.querySelector('[class*="message-container-user"]')) return 'user';
    if (el.closest && el.closest('[class*="message-container-user"]')) return 'user';
    if (cls.includes('message-animate-in')) return 'assistant';
    if (el.querySelector && el.querySelector('[class*="message-animate-in"]')) return 'assistant';
    if (el.closest && el.closest('[class*="message-animate-in"]')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"], [class*="think"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^\d{2}:\d{2}$/.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*\d{2}:\d{2}$/, '')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 425157680432342，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_MINIMAX;
}
