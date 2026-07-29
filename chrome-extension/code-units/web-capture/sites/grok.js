/**
 * Grok Site Adapter
 *
 * URL: grok.com（用户已登录实测）
 * 侦察证据（2026-07-29）：
 * - 会话 URL：/c/{uuid}（可带 ?rid= 参数）
 * - 消息容器：div.message-bubble，带 role="user-message" / "assistant-message" 属性
 * - 正文：div.response-content-markdown（markdown 渲染）
 */
'use strict';

const __SITE_GROK = {
  host: 'grok.com',

  matches: [
    'https://grok.com/*',
    'https://*.grok.com/*'
  ],

  conversationId: function (url) {
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  messageSelectors: [
    '.message-bubble',
    '[data-role="user-message"], [data-role="assistant-message"]',
    '.response-content-markdown'
  ],

  roleOf: function (el) {
    // grok 用 data-role 标记角色（侦察实测：message-bubble 上 data-role="user-message"）
    const role = (el.getAttribute && (el.getAttribute('data-role') || el.getAttribute('data-testid') || el.getAttribute('role'))) || '';
    if (role.includes('user')) return 'user';
    if (role.includes('assistant')) return 'assistant';
    const parent = el.closest && (el.closest('[data-role]') || el.closest('[data-testid]'));
    const parentRole = parent ? (parent.getAttribute('data-role') || parent.getAttribute('data-testid') || '') : '';
    if (parentRole.includes('user')) return 'user';
    if (parentRole.includes('assistant')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"], [class*="think"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[class*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 0fe7980f-c2a7-4091-9db6-1d14f5e6b590，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_GROK;
}
