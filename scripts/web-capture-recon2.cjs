// 全站点侦察：每站开新页 → 发唯一标记消息 → 等回复 → 输出 DOM 结构证据（单进程顺序执行）
'use strict';
const fs = require('fs');
const path = require('path');
const { McpClient, collectText, extractEvalValue } = require('./web-capture-mcp-client.cjs');

const EVIDENCE_DIR = path.join(__dirname, '..', 'docs', 'acceptance', 'web-capture');

const SITES = [
  { key: 'doubao', url: 'https://www.doubao.com/chat/' },
  { key: 'kimi', url: 'https://www.kimi.com/' },
  { key: 'deepseek', url: 'https://chat.deepseek.com/' },
  { key: 'grok', url: 'https://grok.com/' },
  { key: 'z-ai', url: 'https://chat.z.ai/' },
  { key: 'minimax', url: 'https://agent.minimaxi.com/' },
  { key: 'xiaomimimo', url: 'https://aistudio.xiaomimimo.com/' }
];

const DOM_PROBE = (marker) => `
return (() => {
  const out = { url: location.href, beacon: document.documentElement.getAttribute('data-dcf-web-capture') };
  function chainOf(el) {
    const c = [];
    let cur = el;
    for (let i = 0; i < 7 && cur && cur !== document.body; i++) {
      c.push({ tag: cur.tagName.toLowerCase(), cls: (cur.className || '').toString().slice(0, 90), role: cur.getAttribute && (cur.getAttribute('data-role') || cur.getAttribute('data-message-author-role') || cur.getAttribute('data-testid')) });
      cur = cur.parentElement;
    }
    return c;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let userNode = null;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes('${marker}')) { userNode = walker.currentNode.parentElement; break; }
  }
  out.userChain = userNode ? chainOf(userNode) : null;
  let aiEl = null, aiLen = 0;
  for (const el of document.querySelectorAll('[class*="markdown"], [class*="message"], [class*="response"], [class*="answer"], [class*="bubble"], [class*="content"]')) {
    const t = (el.innerText || '').trim();
    if (t.length > aiLen && t.length < 3000 && !t.includes('${marker}')) { aiLen = t.length; aiEl = el; }
  }
  out.aiChain = aiEl ? chainOf(aiEl) : null;
  out.aiText = aiEl ? (aiEl.innerText || '').slice(0, 160) : null;
  out.stopBtns = ['button[aria-label*="Stop"]', 'button[aria-label*="停止"]', '[class*="stop"]', '[data-testid*="stop"]'].map(s => ({ s, n: document.querySelectorAll(s).length })).filter(x => x.n > 0);
  return out;
})();`;

(async () => {
  const mcp = new McpClient('http://127.0.0.1:9010/mcp');
  await mcp.initialize();
  await mcp.callTool('name_session', { name: 'sites recon v2' }).catch(() => {});

  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const report = {};

  for (const site of SITES) {
    if (only && !only.includes(site.key)) continue;
    console.log(`\n========== ${site.key} ==========`);
    let pageId = null;
    try {
      const t = await mcp.callTool('tabs', { action: 'new', url: site.url });
      pageId = parseInt((collectText(t).match(/page (\d+)/i) || [])[1], 10);
      console.log('page:', pageId);
      await new Promise(r => setTimeout(r, 10000));

      // composer 就绪
      let ready = false;
      for (let i = 0; i < 10; i++) {
        try {
          ready = extractEvalValue(await mcp.callTool('evaluate', {
            page: pageId,
            code: `return !!document.querySelector('div[contenteditable="true"], textarea, [contenteditable="true"]');`
          })) === true;
        } catch (_) { ready = false; }
        if (ready) break;
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log('composer ready:', ready);
      if (!ready) { report[site.key] = { error: 'composer not ready' }; continue; }

      // 找 textbox ref
      const snap = await mcp.callTool('snapshot', { page: pageId });
      const refLine = collectText(snap).split('\n').find(l => /textbox|searchbox/i.test(l));
      const ref = refLine && refLine.match(/\[ref=(\w+)\]/) && refLine.match(/\[ref=(\w+)\]/)[1];
      if (!ref) { report[site.key] = { error: 'no textbox ref' }; console.log('no textbox ref'); continue; }

      const marker = 'DCFRCN' + Date.now().toString(36).toUpperCase();
      const msg = `${marker}：请用一句话介绍你自己。`;
      await mcp.callTool('act', { page: pageId, kind: 'fill', ref, value: msg });
      await new Promise(r => setTimeout(r, 1200));

      // 发送：优先按钮
      const snap2 = await mcp.callTool('snapshot', { page: pageId });
      const sendLine = collectText(snap2).split('\n').find(l => /button/.test(l) && /发送|send/i.test(l));
      const sendRef = sendLine && sendLine.match(/\[ref=(\w+)\]/) && sendLine.match(/\[ref=(\w+)\]/)[1];
      if (sendRef) await mcp.callTool('act', { page: pageId, kind: 'click', ref: sendRef });
      else await mcp.callTool('act', { page: pageId, kind: 'press', key: 'Enter' });
      console.log('sent via', sendRef ? 'button' : 'enter');

      // 等 URL 变化（SPA 会话创建）
      let convUrl = null;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const u = String(extractEvalValue(await mcp.callTool('evaluate', { page: pageId, code: 'return location.href;' })));
        if (u !== site.url) { convUrl = u; break; }
      }
      console.log('convUrl:', convUrl || '(unchanged)');

      // 等回复稳定
      let lastLen = -1, stable = 0;
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const st = extractEvalValue(await mcp.callTool('evaluate', { page: pageId, code: 'return ({ len: document.body.innerText.length });' }));
        if (st.len === lastLen) { stable++; if (stable >= 2) break; } else stable = 0;
        lastLen = st.len;
      }

      // DOM 侦察
      const probe = await mcp.callTool('evaluate', { page: pageId, code: DOM_PROBE(marker) });
      const recon = extractEvalValue(probe);
      report[site.key] = { pageId, convUrl, marker, ...recon };
      console.log(JSON.stringify(recon, null, 2).slice(0, 3000));
    } catch (e) {
      console.error(`${site.key} failed:`, e.message);
      report[site.key] = { error: e.message };
    }
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'recon-v2.json'), JSON.stringify(report, null, 2));
  console.log('\n=== recon saved to docs/acceptance/web-capture/recon-v2.json ===');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
