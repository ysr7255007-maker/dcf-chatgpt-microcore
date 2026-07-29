// 5 被墙站点状态重检（单进程）：登录态/额度/CF 放行是否变化
'use strict';
const { McpClient, collectText, extractEvalValue } = require('./web-capture-mcp-client.cjs');

const CHECKS = [
  { key: 'doubao', url: 'https://www.doubao.com/chat/', signal: `(() => { const t = document.body.innerText; return { quota_wall: t.includes('已达使用上限') || t.includes('登录以解锁'), login_link: !!document.querySelector('a[href*="login"], [class*="login"]'), composer: !!document.querySelector('textarea') }; })()` },
  { key: 'kimi', url: 'https://www.kimi.com/', signal: `(() => { const t = document.body.innerText; return { login_hint: t.includes('登录以同步') || t.includes('登录后'), composer: !!document.querySelector('div[contenteditable="true"]') }; })()` },
  { key: 'kimi-moonshot', url: 'https://kimi.moonshot.cn/', signal: `(() => { const t = document.body.innerText; return { url: location.href, login_hint: t.includes('登录'), composer: !!document.querySelector('div[contenteditable="true"], textarea') }; })()` },
  { key: 'deepseek', url: 'https://chat.deepseek.com/', signal: `(() => ({ url: location.href, signin: location.href.includes('sign_in'), composer: !!document.querySelector('textarea') }))()` },
  { key: 'yuanbao', url: 'https://yuanbao.tencent.com/chat', signal: `(() => { const t = document.body.innerText; return { unlogged: t.includes('未登录') || t.includes('微信登录'), composer: !!document.querySelector('div[contenteditable="true"], textarea') }; })()` },
  { key: 'claude', url: 'https://claude.ai/new', signal: `(() => { const t = document.body.innerText; return { cf: t.includes('安全验证') || t.includes('Cloudflare') || document.title.includes('请稍候'), composer: !!document.querySelector('div[contenteditable="true"]') }; })()` }
];

(async () => {
  const mcp = new McpClient('http://127.0.0.1:9010/mcp');
  await mcp.initialize();
  await mcp.callTool('name_session', { name: 'wall recheck' }).catch(() => {});

  for (const site of CHECKS) {
    let pageId = null;
    try {
      const t = await mcp.callTool('tabs', { action: 'new', url: site.url, background: true });
      pageId = parseInt((collectText(t).match(/page (\d+)/i) || [])[1], 10);
      await new Promise(r => setTimeout(r, site.key === 'claude' ? 20000 : 9000));
      const st = extractEvalValue(await mcp.callTool('evaluate', { page: pageId, code: `return (${site.signal});` }));
      console.log(`${site.key}:`, JSON.stringify(st));
    } catch (e) {
      console.log(`${site.key}: ERROR ${e.message}`);
    } finally {
      if (pageId) await mcp.callTool('tabs', { action: 'close', page: pageId }).catch(() => {});
    }
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
