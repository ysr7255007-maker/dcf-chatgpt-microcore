/**
 * Z.ai (GLM) Site Adapter
 *
 * URL: chat.z.ai（用户已登录实测）
 * 侦察证据（2026-07-29）：
 * - 会话 URL：/c/{uuid}
 * - 用户消息容器：div.user-message（内层 div.chat-user.markdown-prose）
 * - 助手消息容器：div.message-{messageId}（class 含 svelte- 哈希）
 * - 助手容器内含「正在思考/跳过」思维链，textOf 须排除
 */
'use strict';

const __SITE_Z_AI = {
  host: 'chat.z.ai',

  matches: [
    'https://chat.z.ai/*',
    'https://*.z.ai/*'
  ],

  conversationId: function (url) {
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  messageSelectors: [
    '.user-message, div[class*="message-"]',
    '.chat-user, [class*="message-"]',
    '[class*="markdown-prose"]'
  ],

  roleOf: function (el) {
    const cls = (el.className || '').toString();
    if (cls.includes('user-message') || cls.includes('chat-user')) return 'user';
    if (el.closest && el.closest('.user-message, .chat-user')) return 'user';
    if (/message-[a-f0-9]{8}/.test(cls)) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '正在思考' && line !== '跳过' && line !== '思考已完成' && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[class*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv c434f3f0-a22f-4a59-9091-2c0def764bbf，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_Z_AI;
}
