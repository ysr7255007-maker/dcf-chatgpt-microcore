const HOST = 'com.dcf.evidence_writer';
const QUEUE_KEY = 'dcfEvidenceQueue';
let port = null;

async function enqueue(fact) {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  queue.push(fact);
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-5000) });
}

function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST);
  port.onDisconnect.addListener(() => { port = null; });
  port.onMessage.addListener(async response => {
    if (!response?.ok) console.warn('evidence writer rejected record', response?.error);
  });
  return port;
}

async function sendFact(fact) {
  try {
    ensurePort().postMessage(fact);
  } catch (error) {
    await enqueue({ ...fact, recorder_error: error.message });
  }
}

async function flushQueue() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  if (!queue.length) return;
  await chrome.storage.local.set({ [QUEUE_KEY]: [] });
  for (const fact of queue) await sendFact(fact);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'DCF_BROWSER_FACT') return;
  const fact = {
    source: 'browser-visible',
    kind: message.kind,
    observed_at: message.observed_at || new Date().toISOString(),
    context: {
      tab_id: sender.tab?.id ?? null,
      window_id: sender.tab?.windowId ?? null,
      frame_id: sender.frameId ?? 0
    },
    payload: message.payload || {}
  };
  sendFact(fact);
});

chrome.runtime.onStartup.addListener(flushQueue);
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.local.get(['captureVisibleText']);
  if (settings.captureVisibleText == null) await chrome.storage.local.set({ captureVisibleText: false });
  await flushQueue();
});
