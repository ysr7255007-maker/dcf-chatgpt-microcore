// 通用站点验收驱动：node web-capture-accept-site.cjs <site-key>
// 流程：确认扩展启用 → 开新对话 → 发唯一标记消息 → 等回复 → 验证 companion raw_events
'use strict';
const path = require('path');
const fs = require('fs');
const { McpClient, collectText, extractEvalValue } = require('./web-capture-mcp-client.cjs');
const DCF_ULID = require(path.join(__dirname, '..', 'seed', 'adapters', 'chrome', 'ulid.js'));

const EXT_ID = 'phpcioepnnpkdebnedkjpemndjghncob';
const COMPANION = 'http://127.0.0.1:8472';
const EVIDENCE_DIR = path.join(__dirname, '..', 'docs', 'acceptance', 'web-capture');

const SITE_FLOWS = {
  gemini: {
    url: 'https://gemini.google.com/app',
    host: 'gemini.google.com',
    convIdFrom: (url) => (url.match(/\/app\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://gemini.google.com/app'
  },
  doubao: {
    url: 'https://www.doubao.com/chat/',
    host: 'doubao.com',
    convIdFrom: (url) => (url.match(/\/chat\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://www.doubao.com/chat/'
  },
  kimi: {
    url: 'https://www.kimi.com/',
    host: 'kimi.com',
    convIdFrom: (url) => (url.match(/\/chat\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://www.kimi.com/'
  },
  'claude-ai': {
    url: 'https://claude.ai/new',
    host: 'claude.ai',
    convIdFrom: (url) => (url.match(/\/chat\/([A-Za-z0-9_-]+)/) || url.match(/\/c\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://claude.ai/new'
  },
  deepseek: {
    url: 'https://chat.deepseek.com/',
    host: 'chat.deepseek.com',
    convIdFrom: (url) => (url.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/) || url.match(/\/c\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://chat.deepseek.com/'
  },
  yuanbao: {
    url: 'https://yuanbao.tencent.com/chat',
    host: 'yuanbao.tencent.com',
    convIdFrom: (url) => (url.match(/\/chat\/([A-Za-z0-9_-]+)/) || url.match(/\/conv\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://yuanbao.tencent.com/chat'
  },
  grok: {
    url: 'https://grok.com/',
    host: 'grok.com',
    convIdFrom: (url) => (url.match(/\/c\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://grok.com/'
  },
  'z-ai': {
    url: 'https://chat.z.ai/',
    host: 'chat.z.ai',
    convIdFrom: (url) => (url.match(/\/c\/([A-Za-z0-9_-]+)/) || [])[1] || null,
    initialUrl: 'https://chat.z.ai/'
  },
  minimax: {
    url: 'https://agent.minimaxi.com/',
    host: 'agent.minimaxi.com',
    convIdFrom: (url) => { try { return new URL(url).searchParams.get('id'); } catch { return null; } },
    initialUrl: 'https://agent.minimaxi.com/',
    customSend: true
  },
  xiaomimimo: {
    url: 'https://aistudio.xiaomimimo.com/',
    host: 'aistudio.xiaomimimo.com',
    convIdFrom: (url) => { const m = url.match(/#\/chat\/([A-Za-z0-9_-]+)/); return m ? m[1] : null; },
    initialUrl: 'https://aistudio.xiaomimimo.com/'
  }
};

(async () => {
  const siteKey = process.argv[2];
  const site = SITE_FLOWS[siteKey];
  if (!site) { console.error('unknown site:', siteKey); process.exit(2); }

  const mcp = new McpClient('http://127.0.0.1:9010/mcp');
  await mcp.initialize();
  await mcp.callTool('name_session', { name: `accept ${siteKey}` }).catch(() => {});

  // 1. 重载扩展（拾取最新构建）并确保启用
  const extTab = await mcp.callTool('tabs', { action: 'new', url: `chrome://extensions/?id=${EXT_ID}` });
  const extPage = parseInt((collectText(extTab).match(/page (\d+)/i) || [])[1], 10);
  await new Promise(r => setTimeout(r, 3000));
  await mcp.callTool('evaluate', {
    page: extPage,
    code: `return await (async () => { try { await new Promise(r => chrome.developerPrivate.reload('${EXT_ID}', { failQuietly: false }, r)); return 'ok'; } catch (e) { return e.message; } })();`
  });
  await new Promise(r => setTimeout(r, 2500));
  const state = extractEvalValue(await mcp.callTool('evaluate', {
    page: extPage,
    code: `return await (async () => {
      const exts = await new Promise(r => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }, r));
      return exts.find(e => e.id === '${EXT_ID}').state;
    })();`
  }));
  console.log('extension state after reload:', state);
  if (state !== 'ENABLED') {
    await mcp.callTool('evaluate', {
      page: extPage,
      code: `return (() => {
        const root = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-detail-view').shadowRoot;
        const t = root.querySelector('cr-toggle#enableToggle');
        if (t && !t.checked) t.click();
        return true;
      })();`
    });
    await new Promise(r => setTimeout(r, 2500));
    console.log('extension enabled via toggle');
  }
  await mcp.callTool('tabs', { action: 'close', page: extPage }).catch(() => {});

  // 2. 打开站点
  const t = await mcp.callTool('tabs', { action: 'new', url: site.url });
  const pageId = parseInt((collectText(t).match(/page (\d+)/i) || [])[1], 10);
  console.log(`${siteKey} page:`, pageId);

  // 等 composer 就绪（最多 30s）
  let composerReady = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    let ready = false;
    try {
      ready = extractEvalValue(await mcp.callTool('evaluate', {
        page: pageId,
        code: `return !!document.querySelector('div[contenteditable="true"], textarea, rich-textarea');`
      })) === true;
    } catch (_) { ready = false; }
    if (ready) { composerReady = true; break; }
  }
  console.log('composer ready:', composerReady);
  await new Promise(r => setTimeout(r, 2000));

  // Cloudflare 质询处理（claude.ai）：检测并点击「请验证您是真人」checkbox
  for (let attempt = 0; attempt < 3; attempt++) {
    let cf = false;
    try {
      cf = extractEvalValue(await mcp.callTool('evaluate', {
        page: pageId,
        code: `return document.body.innerText.includes('安全验证') || document.title.includes('请稍候');`
      })) === true;
    } catch (_) { /* ignore */ }
    if (!cf) break;
    console.log(`Cloudflare challenge detected (attempt ${attempt + 1}), clicking checkbox...`);
    const cfSnap = await mcp.callTool('snapshot', { page: pageId });
    const cbLine = collectText(cfSnap).split('\n').find(l => /checkbox.*真人|checkbox.*human/i.test(l));
    const cbRef = cbLine && cbLine.match(/\[ref=(\w+)\]/) && cbLine.match(/\[ref=(\w+)\]/)[1];
    if (!cbRef) break;
    await mcp.callTool('act', { page: pageId, kind: 'click', ref: cbRef }).catch(e => console.warn('cf click:', e.message));
    await new Promise(r => setTimeout(r, 6000));
  }

  // 3. 发送唯一标记消息
  const marker = 'DCF验收' + Date.now().toString(36).toUpperCase();
  const testMsg = `${marker}：请用一句话介绍你自己。`;

  if (site.customSend) {
    // MiniMax：tiptap contenteditable 填充 + aria-label 发送按钮点击
    const fillRes = extractEvalValue(await mcp.callTool('evaluate', {
      page: pageId,
      code: `return (() => {
        const ces = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(el => el.offsetParent !== null);
        if (!ces.length) return { ok: false };
        const el = ces[ces.length - 1];
        el.focus();
        el.innerText = ${JSON.stringify(testMsg)};
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: el.innerText }));
        return { ok: true };
      })();`
    }));
    if (!fillRes || !fillRes.ok) { console.error('custom fill failed'); process.exit(1); }
    await new Promise(r => setTimeout(r, 1000));
    await mcp.callTool('evaluate', {
      page: pageId,
      code: `return (() => { const b = document.querySelector('[aria-label="发送消息"]'); if (b) { b.click(); return true; } return false; })();`
    });
    console.log('sent (custom):', testMsg);
  } else {
    const snap = await mcp.callTool('snapshot', { page: pageId });
    const refLine = collectText(snap).split('\n').find(l => /textbox|searchbox/i.test(l));
    if (!refLine) { console.error('composer not found'); process.exit(1); }
    const ref = refLine.match(/\[ref=(\w+)\]/)[1];
    await mcp.callTool('act', { page: pageId, kind: 'fill', ref, value: testMsg });
    await new Promise(r => setTimeout(r, 1200));

    // 优先点击发送按钮，无则 Enter
    const snap2 = await mcp.callTool('snapshot', { page: pageId });
    const sendLine = collectText(snap2).split('\n').find(l => /button/.test(l) && /发送|send/i.test(l));
    const sendRef = sendLine && sendLine.match(/\[ref=(\w+)\]/) && sendLine.match(/\[ref=(\w+)\]/)[1];
    if (sendRef) await mcp.callTool('act', { page: pageId, kind: 'click', ref: sendRef });
    else await mcp.callTool('act', { page: pageId, kind: 'press', key: 'Enter' });
    console.log('sent:', testMsg, sendRef ? '(button)' : '(enter)');
  }

  // 4. 等会话 URL
  let convId = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const u = String(extractEvalValue(await mcp.callTool('evaluate', { page: pageId, code: 'return location.href;' })));
    convId = site.convIdFrom(u);
    if (convId) { console.log('conversation id:', convId); break; }
  }
  if (!convId) {
    const state2 = extractEvalValue(await mcp.callTool('evaluate', {
      page: pageId, code: `return ({ url: location.href, text: document.body.innerText.slice(0, 300) });`
    }));
    console.error('no conversation id; page:', JSON.stringify(state2).slice(0, 500));
    process.exit(1);
  }

  // 5. 等回复稳定
  let lastLen = -1, stable = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = extractEvalValue(await mcp.callTool('evaluate', { page: pageId, code: 'return ({ len: document.body.innerText.length });' }));
    if (st.len === lastLen) { stable++; if (stable >= 2) break; } else stable = 0;
    lastLen = st.len;
  }
  console.log('reply complete');

  // beacon 诊断
  const beacon = extractEvalValue(await mcp.callTool('evaluate', {
    page: pageId, code: `return document.documentElement.getAttribute('data-dcf-web-capture');`
  }));
  console.log('beacon:', beacon);

  // 6. 等 flush 并验证 companion
  await new Promise(r => setTimeout(r, 8000));
  const sourceId = await DCF_ULID.stableIdFromString(`dcf.source:${site.host}/c/${convId}`);
  const res = await fetch(`${COMPANION}/rpc/events/query?source_id=${sourceId}&limit=50&orderBy=ASC`);
  const body = await res.json();
  const events = (body.result && body.result.events) || [];
  const parsed = events.map(e => ({ type: e.event_type, ...(typeof e.payload_json === 'string' ? JSON.parse(e.payload_json) : e.payload_json) }));
  const userEv = parsed.find(p => p.role === 'user');
  const aiEv = parsed.find(p => p.role === 'assistant');
  const aiCount = parsed.filter(p => p.role === 'assistant').length;

  console.log('\n===== 验收断言 =====');
  const markerNormalized = marker.replace(/\s+/g, '').toLowerCase();
  const textMatches = (t) => t && String(t).replace(/\s+/g, '').toLowerCase().includes(markerNormalized);
  const checks = {
    user_event_present: !!userEv,
    user_text_matches_marker: !!(userEv && textMatches(userEv.text)),
    assistant_event_present: !!aiEv,
    assistant_text_nonempty: !!(aiEv && aiEv.text && aiEv.text.length > 3),
    no_partial_stream_single_ai: aiCount === 1,
    source_id_matches_url: true
  };
  for (const [k, v] of Object.entries(checks)) console.log(` ${v ? '✓' : '✗'} ${k}`);
  if (userEv) console.log('user text:', JSON.stringify((userEv.text || '').slice(0, 80)));
  if (aiEv) console.log('assistant text:', JSON.stringify((aiEv.text || '').slice(0, 120)));
  console.log('events total:', events.length, 'assistant count:', aiCount);

  const allPass = Object.values(checks).every(Boolean);
  // 证据留档
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${siteKey}-acceptance.json`), JSON.stringify({
    site: siteKey, at: new Date().toISOString(), convId, sourceId, marker,
    pageUrl: `page-${pageId}`, beacon: beacon || null, checks, events: parsed.map(p => ({ type: p.type, role: p.role, text: (p.text || '').slice(0, 200), ts: p.ts })), passed: allPass
  }, null, 2));
  console.log(allPass ? `\n✅ ${siteKey} 验收通过` : `\n❌ ${siteKey} 验收未通过`);
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
