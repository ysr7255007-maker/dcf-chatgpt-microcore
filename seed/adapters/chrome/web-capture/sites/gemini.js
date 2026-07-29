/**
 * Gemini Site Adapter
 *
 * URL: gemini.google.com（用户已登录 Google 实测）
 * 侦察证据（2026-07-29，BrowserClaw 实测）：
 * - 会话 URL：/app/{16-hex-id}（发送首条消息后跳转）
 * - 消息容器为自定义元素：user-query（用户）/ model-response（助手）
 * - 用户气泡链：p.query-text-line → div.user-query-container
 * - 回复容器链：model-response → div.conversation-container → infinite-scroller.chat-history
 */
'use strict';

const __SITE_GEMINI = {
  host: 'gemini.google.com',

  matches: [
    'https://gemini.google.com/*',
    'https://*.gemini.google.com/*'
  ],

  // /app/{id} 提取会话 ID；新对话首页 /app 无 ID 返回 null（不采集）
  conversationId: function (url) {
    const match = url.pathname.match(/^\/app\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // 消息级容器（自定义元素最稳定，class 降级兜底）
  messageSelectors: [
    'user-query, model-response',
    '[class*="user-query-container"], [class*="response-container"]',
    '[class*="query-content"], [class*="model-response"]'
  ],

  roleOf: function (el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'user-query') return 'user';
    if (tag === 'model-response') return 'assistant';
    const cls = (el.className || '').toString();
    if (cls.includes('user-query')) return 'user';
    if (cls.includes('response-container') || cls.includes('model-response')) return 'assistant';
    if (el.closest && el.closest('user-query')) return 'user';
    if (el.closest && el.closest('model-response')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    // 去掉「Gemini 说」「你说」无障碍播报前缀，保留正文
    const text = (el.textContent || '')
      .replace(/^\s*Gemini 说\s*/, '')
      .replace(/^\s*你说\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  },

  stopButtonSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[class*="stop-button"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（docs/acceptance/web-capture/gemini-acceptance.json）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_GEMINI;
}
