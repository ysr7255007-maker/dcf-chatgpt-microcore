/**
 * Claude.ai Site Adapter
 * 
 * URL: claude.ai
 * Selector evidence: collected via BrowserClaw snapshot
 */
'use strict';

const __SITE_CLAUDE_AI = {
  host: 'claude.ai',
  
  // Matches: /c/uuid pattern for conversations
  matches: [
    'https://*.claude.ai/*',
    'http://localhost:*/*'
  ],
  
  // conversationId: 会话 URL 为 /chat/{uuid}；/c/ 为旧形态兑底
  conversationId: function(url) {
    const path = url.pathname;
    const chatMatch = path.match(/^\/chat\/([A-Za-z0-9_-]+)/);
    if (chatMatch) return chatMatch[1];
    const legacyMatch = path.match(/^\/c\/([A-Za-z0-9_-]+)/);
    if (legacyMatch) return legacyMatch[1];
    return null;
  },
  
  // Message container selectors (at least 2 candidates for fallback)
  messageSelectors: [
    '[data-message-role="assistant"] .prose',   // primary selector
    '[data-testid="message-assistant"] .text', // fallback
    '.chat-message-assistant p'                // tertiary
  ],
  
  // Determine role of a DOM element
  roleOf: function(el) {
    const roleAttr = el.getAttribute('data-message-role');
    if (roleAttr === 'user') return 'user';
    if (roleAttr === 'assistant') return 'assistant';
    
    // Fallback heuristics
    const parentRole = el.closest('[data-message-role]')?.getAttribute('data-message-role');
    if (parentRole === 'user') return 'user';
    if (parentRole === 'assistant') return 'assistant';
    
    return null;
  },
  
  // Extract text content from message element
  textOf: function(el) {
    // Get all text nodes, join and trim
    const texts = [];
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text) texts.push(text);
    }
    return texts.join(' ').trim();
  },
  
  // Stop button selectors for stream completion detection
  stopButtonSelectors: [
    '[aria-label="Stop generating"]',
    'button:contains("Stop")'
  ],
  
  verified: false // Must pass BrowserClaw acceptance before setting true
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __SITE_CLAUDE_AI;
}
