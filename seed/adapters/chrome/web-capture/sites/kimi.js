/**
 * Kimi Site Adapter
 *
 * URLs: kimi.com（现行主域）/ kimi.moonshot.cn（旧域，跳转 kimi.com）
 * 实测（2026-07-29，用户已登录）：
 * - 会话 URL：/chat/{uuid}（可带 ?chat_enter_method=home 参数）
 * - 用户消息容器：div.chat-content-item-user（内层 div.user-content）
 * - 助手消息容器：div.chat-content-item-assistant
 * - 助手容器内含「思考已完成」思维链块，textOf 须排除
 */
'use strict';

const __SITE_KIMI = {
  host: 'kimi.com',

  matches: [
    'https://www.kimi.com/*',
    'https://*.kimi.com/*',
    'https://*.kimi.moonshot.cn/*'
  ],

  // /chat/{uuid} 提取会话 ID；/messages/{id} 兼容；首页返回 null
  conversationId: function (url) {
    let match = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    match = url.pathname.match(/^\/messages\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    return null;
  },

  messageSelectors: [
    '.chat-content-item-user, .chat-content-item-assistant',
    '.chat-content-item[class*="user"], .chat-content-item[class*="assistant"]',
    '.segment-user, .chat-content-item'
  ],

  roleOf: function (el) {
    const cls = ((el.className || '') + ' ' + (el.closest && el.closest('[class*="chat-content-item"]') ? el.closest('[class*="chat-content-item"]').className : '')).toString();
    if (cls.includes('user')) return 'user';
    if (cls.includes('assistant')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    // 排除思维链块与操作按钮区
    clone.querySelectorAll('[class*="thinking"], [class*="thought"], [class*="reasoning"], [class*="action"], button').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '思考已完成' && line !== '已完成思考' && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 19faf17e-6242-8a5a-8000-0928b04dce6f，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_KIMI;
}
