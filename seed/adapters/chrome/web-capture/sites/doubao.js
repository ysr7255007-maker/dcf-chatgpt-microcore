/**
 * 豆包 (Doubao) Site Adapter
 *
 * URL: doubao.com（匿名可用；登录态继承不强制）
 * 侦察证据（2026-07-29，BrowserClaw 实测 /chat/{digits}）：
 * - 消息行容器 class 含稳定 token `max-w-(--content-max-width)`
 * - 用户气泡 class 含设计系统 token `bg-g-send-msg-bubble-bg`
 * - assistant 行内建议追问块 class 含 `suggest-`（textOf 须排除）
 * - 会话 URL：/chat/{digits}（发送首条消息后跳转）
 */
'use strict';

const __SITE_DOUBAO = {
  host: 'doubao.com',

  matches: [
    'https://www.doubao.com/*',
    'https://*.doubao.com/*'
  ],

  // /chat/{id} 提取会话 ID；首页 /chat/ 无 ID 返回 null（不采集）
  conversationId: function (url) {
    const match = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // 消息级容器（降级：行容器 → 消息列表子级 → 用户气泡）
  messageSelectors: [
    '[class*="max-w-(--content-max-width)"]',
    '[class*="message-list"] > div',
    '[class*="bg-g-send-msg-bubble-bg"]'
  ],

  roleOf: function (el) {
    if (el.matches && el.matches('[class*="bg-g-send-msg-bubble-bg"]')) return 'user';
    if (el.querySelector && el.querySelector('[class*="bg-g-send-msg-bubble-bg"]')) return 'user';
    if (el.closest && el.closest('[class*="bg-g-send-msg-bubble-bg"]')) return 'user';
    // 排除快捷操作栏/建议区：按钮或链接文本占主导的容器不是消息
    const text = (el.textContent || '').replace(/\s+/g, '');
    if (!text) return null;
    const btnText = Array.from(el.querySelectorAll('button, a'))
      .map((b) => (b.textContent || '').replace(/\s+/g, ''))
      .join('');
    if (btnText.length > 0 && btnText.length >= text.length * 0.6) return null;
    return 'assistant';
  },

  // 克隆排除法：去掉建议追问/登录引导/下载推广，取正文
  textOf: function (el) {
    const clone = el.cloneNode(true);
    const junk = clone.querySelectorAll('[class*="suggest-"], [class*="login"], a[href*="download"], [class*="download"], [class*="think"], [class*="Collapsible"], [class*="collapsible"]');
    junk.forEach((n) => n.remove());
    const text = (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('下载豆包') && line !== '已完成思考' && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 38436223105438466，6/6 断言）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_DOUBAO;
}
