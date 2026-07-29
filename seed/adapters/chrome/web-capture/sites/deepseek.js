/**
 * DeepSeek Site Adapter
 *
 * URL: chat.deepseek.com（用户已登录实测）
 * 侦察证据（2026-07-29）：
 * - 会话 URL：/a/chat/s/{uuid}
 * - 用户消息：div.ds-message 内含 .fbb737a4 文本节点（气泡 d29f3d7d）
 * - 助手消息：div.ds-message（内含 ds-markdown 正文，无 .fbb737a4）
 * - 消息列表为 ds-virtual-list 虚拟滚动
 */
'use strict';

const __SITE_DEEPSEEK = {
  host: 'chat.deepseek.com',

  matches: [
    'https://chat.deepseek.com/*',
    'https://*.deepseek.com/*'
  ],

  // /a/chat/s/{uuid} 提取会话 ID；/c/{id} 旧形态兜底
  conversationId: function (url) {
    let match = url.pathname.match(/^\/a\/chat\/s\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    return null;
  },

  messageSelectors: [
    '.ds-message',
    '[class*="ds-message"]',
    '.fbb737a4'
  ],

  roleOf: function (el) {
    // 用户：元素自身或后代/祖先含 fbb737a4（用户文本类）
    if (el.matches && el.matches('.fbb737a4')) return 'user';
    if (el.querySelector && el.querySelector('.fbb737a4')) return 'user';
    if (el.closest && el.closest('.fbb737a4')) return 'user';
    if (el.matches && el.matches('[class*="d29f3d7d"]')) return 'user';
    // 助手：ds-message / ds-markdown 正文
    const cls = (el.className || '').toString();
    if (cls.includes('ds-message') || cls.includes('ds-markdown')) return 'assistant';
    if (el.querySelector && el.querySelector('[class*="ds-markdown"]')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    // 排除思维链与操作按钮
    clone.querySelectorAll('[class*="think"], [class*="reasoning"], button, [class*="action"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '已思考' && !line.startsWith('思考过程'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 816fea68-23be-45a4-9de7-a313a885d695，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_DEEPSEEK;
}
