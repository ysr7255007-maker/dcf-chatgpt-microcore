/**
 * 元宝 (Yuanbao) Site Adapter
 * 
 * URL: yuanbao.tencent.com
 */
'use strict';

const __SITE_YUANBAO = {
  host: 'yuanbao.tencent.com',
  
  matches: [
    'https://*.yuanbao.tencent.com/*',
    'http://localhost:*/*'
  ],
  
  // conversationId: extract from URL or localStorage
  conversationId: function(url) {
    const path = url.pathname;
    // Pattern: /chat/{chat_id} or /conv/{conversation_id}
    let match = path.match(/^\/chat\/([A-Za-z0-9_-]+)$/);
    if (match && match[1]) return match[1];
    
    match = path.match(/^\/conv\/([A-Za-z0-9_-]+)$/);
    if (match && match[1]) return match[1];
    
    // Fallback to localStorage/sessionStorage
    try {
      const currentConv = window.localStorage?.getItem('current_conversation');
      if (currentConv && currentConv !== 'null') return currentConv;
    } catch (e) {
      // Storage unavailable
    }
    
    return null;
  },
  
  messageSelectors: [
    '[class*="message-user"] .bubble-text',      // user messages
    '[class*="message-ai"] .bubble-text',          // AI responses
    '.user-bubble .text',                          // fallback user
    '.assistant-bubble .text'                       // fallback assistant
  ],
  
  roleOf: function(el) {
    if (el.closest('[class*="message-user"]')) return 'user';
    if (el.closest('[class*="message-ai"]')) return 'assistant';
    
    const parentClass = el.closest('div')?.className || '';
    if (parentClass.includes('user-bubble')) return 'user';
    if (parentClass.includes('assistant-bubble')) return 'assistant';
    if (parentClass.includes('me-message')) return 'user';
    if (parentClass.includes('tao-message')) return 'assistant';
    
    return null;
  },
  
  textOf: function(el) {
    let text = el.textContent.trim();
    // Remove UI elements, emojis, formatting artifacts
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 3) return '';
    return text;
  },
  
  stopButtonSelectors: [
    'button:contains("停止")',
    'button[aria-label*="stop"]',
    '[class*="stop-btn"]',
    '.stop-button'
  ],
  
  verified: false
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_YUANBAO;
}
