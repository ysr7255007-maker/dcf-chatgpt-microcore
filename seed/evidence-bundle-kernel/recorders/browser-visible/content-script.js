let lastSignature = '';
let timer = null;

function visibleTextExcerpt(limit = 8000) {
  const text = document.body?.innerText || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

async function emitPageState(reason) {
  if (document.visibilityState !== 'visible') return;
  const settings = await chrome.storage.local.get(['captureVisibleText']);
  const payload = {
    reason,
    url: location.href,
    title: document.title,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    ...(settings.captureVisibleText ? { visible_text_excerpt: visibleTextExcerpt() } : {})
  };
  const signature = JSON.stringify(payload);
  if (signature === lastSignature) return;
  lastSignature = signature;
  chrome.runtime.sendMessage({
    type: 'DCF_BROWSER_FACT',
    kind: 'browser.visible.page',
    observed_at: new Date().toISOString(),
    payload
  });
}

function schedule(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => emitPageState(reason), 250);
}

addEventListener('pageshow', () => schedule('pageshow'));
addEventListener('focus', () => schedule('focus'));
document.addEventListener('visibilitychange', () => schedule('visibilitychange'));
new MutationObserver(() => schedule('document-change')).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['title']
});

let selectionTimer = null;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    const text = String(getSelection()?.toString() || '').trim();
    if (!text) return;
    chrome.runtime.sendMessage({
      type: 'DCF_BROWSER_FACT',
      kind: 'browser.visible.selection',
      observed_at: new Date().toISOString(),
      payload: { url: location.href, title: document.title, text: text.slice(0, 8000) }
    });
  }, 400);
});

schedule('content-script-start');
