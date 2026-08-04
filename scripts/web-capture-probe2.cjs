// MiMo 思维链 DOM 结构探查
'use strict';
const { McpClient, collectText, extractEvalValue } = require('./web-capture-mcp-client.cjs');

(async () => {
  const mcp = new McpClient('http://127.0.0.1:9010/mcp');
  await mcp.initialize();

  const t = await mcp.callTool('tabs', { action: 'new', url: 'https://aistudio.xiaomimimo.com/#/chat/7c407c66dccec70ab82a6f6dcc077d0d' });
  const pageId = parseInt((collectText(t).match(/page (\d+)/i) || [])[1], 10);
  await new Promise(r => setTimeout(r, 9000));

  const probe = extractEvalValue(await mcp.callTool('evaluate', {
    page: pageId,
    code: `return (() => {
      const md = document.querySelector('.markdown-prose, [class*="Markdown_markdown"]');
      if (!md) return { error: 'no markdown container' };
      function walk(el, depth) {
        if (depth > 4) return null;
        return {
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 70),
          textPreview: (el.childNodes.length <= 1 ? (el.textContent || '') : '').slice(0, 50),
          children: Array.from(el.children).slice(0, 6).map(c => walk(c, depth + 1))
        };
      }
      return walk(md, 0);
    })();`
  }));
  console.log(JSON.stringify(probe, null, 2).slice(0, 3500));
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
