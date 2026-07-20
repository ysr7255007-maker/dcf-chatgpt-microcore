'use strict';

const BRIDGE_VERSION = '1.0.0-rc.2.2';
const NEXT_HOST_ID = 'dcf-next-shell-host';
const ATTEMPT_ATTR = 'data-dcf-chrome-next-migration-attempted';
const DCF_HOST_ID = 'dcf-chrome-shell-host';
const SURVIVAL_FALLBACK_ID = 'dcf-chrome-survival-fallback';
const SURVIVAL_RELOAD_KEY = 'dcf.chrome.survival.reload.v1';
const PAGE_INSTANCE_KEY = 'dcf.chrome.page.instance.v1';
const SURVIVAL_RETRY_WINDOW_MS = 30 * 1000;

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function text(node) { return String(node && (node.value ?? node.textContent) || '').trim(); }
function buttonByText(root, label) { return Array.from(root.querySelectorAll('button')).find((node) => text(node) === label); }
function fieldByLabel(root, label) {
  const wrap = Array.from(root.querySelectorAll('.dcf-field,label')).find((node) => text(node.querySelector('span')) === label || text(node.firstElementChild) === label);
  return wrap && wrap.querySelector('input,textarea,select');
}
function pageInstanceId() {
  try {
    const existing = sessionStorage.getItem(PAGE_INSTANCE_KEY);
    if (existing) return existing;
    const created = `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(PAGE_INSTANCE_KEY, created);
    return created;
  } catch (_) {
    return `page-${Date.now().toString(36)}`;
  }
}
const PAGE_INSTANCE_ID = pageInstanceId();

async function extractNextPayload(host) {
  const root = host && host.shadowRoot;
  if (!root) throw new Error('DCF Next Shadow DOM 不可读取');
  const tabs = Array.from(root.querySelectorAll('.tabs button'));
  const previous = tabs.find((node) => node.classList.contains('active'));
  const ammoTab = tabs.find((node) => text(node) === '弹药');
  if (!ammoTab) throw new Error('DCF Next 未提供弹药页面');
  ammoTab.click();
  await delay(160);
  const panel = root.querySelector('[data-panel-id="ammo"]') || root.querySelector('.panel:not([hidden])');
  if (!panel) throw new Error('DCF Next 弹药面板不可读取');
  const cards = Array.from(panel.querySelectorAll('.dcf-card')).filter((card) => card.querySelector('.dcf-badge') && buttonByText(card, '编辑'));
  const items = [];
  for (let index = 0; index < cards.length; index += 1) {
    const currentPanel = root.querySelector('[data-panel-id="ammo"]') || root.querySelector('.panel:not([hidden])');
    const currentCards = Array.from(currentPanel.querySelectorAll('.dcf-card')).filter((card) => card.querySelector('.dcf-badge') && buttonByText(card, '编辑'));
    const edit = buttonByText(currentCards[index], '编辑');
    if (!edit) throw new Error(`DCF Next 第 ${index + 1} 枚弹药缺少编辑入口`);
    edit.click();
    await delay(50);
    const editor = root.querySelector('[data-panel-id="ammo"]') || root.querySelector('.panel:not([hidden])');
    const id = text(fieldByLabel(editor, '稳定 ID'));
    const body = text(fieldByLabel(editor, '正文'));
    if (!id || !body) throw new Error(`DCF Next 第 ${index + 1} 枚弹药数据不完整`);
    const item = {
      id,
      title: text(fieldByLabel(editor, '标题')) || id,
      purpose: text(fieldByLabel(editor, '用途')),
      body
    };
    const tags = text(fieldByLabel(editor, '标签（逗号分隔）')).split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    if (tags.length) item.tags = tags;
    items.push(item);
    const cancel = buttonByText(editor, '取消');
    if (cancel) cancel.click();
    await delay(40);
  }
  const restoredPanel = root.querySelector('[data-panel-id="ammo"]') || root.querySelector('.panel:not([hidden])');
  const mode = restoredPanel && restoredPanel.querySelector('select');
  const shell = root.querySelector('.shell');
  const appearance = {};
  if (shell) {
    appearance.side = shell.classList.contains('left') ? 'left' : 'right';
    for (const [key, cssName] of [['width','--dcf-width'],['top','--dcf-top'],['height','--dcf-height'],['margin','--dcf-margin']]) {
      const value = shell.style.getPropertyValue(cssName);
      if (value) appearance[key] = Number.parseFloat(value) || value;
    }
    appearance.collapsed = shell.classList.contains('collapsed');
  }
  if (previous && previous !== ammoTab) previous.click();
  return {
    schema: 'dcf.next.dom-export.v1',
    source: { kind: 'dcf-next-open-shadow-dom', host_id: NEXT_HOST_ID },
    items,
    settings: { fire_mode: mode && mode.value === 'send' ? 'send' : 'insert' },
    appearance
  };
}
async function attemptMigration() {
  const status = await chrome.runtime.sendMessage({ type: 'migration.status' }).catch(() => null);
  if (status && status.ok && status.migration && status.migration.next && status.migration.next.status === 'success') return;
  const host = document.getElementById(NEXT_HOST_ID);
  if (!host || host.getAttribute(ATTEMPT_ATTR) === 'true') return;
  host.setAttribute(ATTEMPT_ATTR, 'true');
  try {
    const payload = await extractNextPayload(host);
    await chrome.runtime.sendMessage({ type: 'migration.import_next', payload });
  } catch (error) {
    host.removeAttribute(ATTEMPT_ATTR);
    await chrome.runtime.sendMessage({ type: 'migration.error', error: String(error && error.message || error) }).catch(() => undefined);
  }
}

function pageProbe() {
  const shellHost = document.getElementById(DCF_HOST_ID);
  const shellRoot = shellHost && shellHost.shadowRoot;
  const panels = shellRoot ? shellRoot.querySelectorAll('[data-dcf-panel-root="true"]') : [];
  return {
    ok: true,
    schema: 'dcf.chrome.page_probe.v1',
    generated_at: new Date().toISOString(),
    bridge_version: BRIDGE_VERSION,
    static_bridge_present: true,
    page_instance_id: PAGE_INSTANCE_ID,
    ready_state: document.readyState,
    visibility: document.visibilityState,
    has_focus: document.hasFocus(),
    shell_present: Boolean(shellHost && shellHost.isConnected),
    shell_shadow_root_present: Boolean(shellRoot),
    mounted_panel_count: panels.length,
    recovery_present: Boolean(document.getElementById(SURVIVAL_FALLBACK_ID))
  };
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'host.page_probe') return undefined;
  sendResponse(pageProbe());
  return false;
});

function clearSurvivalFallback() {
  document.getElementById(SURVIVAL_FALLBACK_ID)?.remove();
}
function markSurvivalHealthy() {
  try { sessionStorage.removeItem(SURVIVAL_RELOAD_KEY); } catch (_) {}
  clearSurvivalFallback();
}
function showSurvivalFallback(detail) {
  if (document.getElementById(SURVIVAL_FALLBACK_ID)) return;
  const host = document.createElement('div');
  host.id = SURVIVAL_FALLBACK_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:12px;bottom:12px;font:13px/1.4 system-ui;color:#202124';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'DCF 恢复';
  button.title = `DCF 动态功能尚未恢复${detail ? `：${detail}` : ''}`;
  button.style.cssText = 'all:initial;display:block;box-sizing:border-box;padding:9px 12px;border:1px solid #999;border-radius:10px;background:#fff;color:#202124;box-shadow:0 6px 24px #0003;cursor:pointer;font:600 13px/1.2 system-ui';
  button.onclick = () => chrome.runtime.sendMessage({ type: 'host.open_recovery' }).catch(() => undefined);
  host.append(button);
  document.documentElement.append(host);
}
async function ensureDcfHost() {
  if (document.getElementById(DCF_HOST_ID)) {
    markSurvivalHealthy();
    return;
  }
  let activation;
  try {
    activation = await chrome.runtime.sendMessage({ type: 'host.activate' });
  } catch (error) {
    showSurvivalFallback(String(error && error.message || error));
    return;
  }
  if (!activation || activation.ok === false) {
    showSurvivalFallback(String(activation && (activation.error || activation.status) || '底座激活失败'));
    return;
  }
  await delay(450);
  if (document.getElementById(DCF_HOST_ID)) {
    markSurvivalHealthy();
    return;
  }
  let previous = 0;
  try { previous = Number(sessionStorage.getItem(SURVIVAL_RELOAD_KEY) || 0); } catch (_) {}
  if (!previous || Date.now() - previous > SURVIVAL_RETRY_WINDOW_MS) {
    try { sessionStorage.setItem(SURVIVAL_RELOAD_KEY, String(Date.now())); } catch (_) {}
    location.reload();
    return;
  }
  showSurvivalFallback('已重新注册功能，但当前页面仍未注入');
}

setTimeout(attemptMigration, 1800);
setTimeout(ensureDcfHost, 1600);
new MutationObserver(() => {
  if (document.getElementById(NEXT_HOST_ID)) attemptMigration();
  if (document.getElementById(DCF_HOST_ID)) markSurvivalHealthy();
}).observe(document.documentElement, { childList: true, subtree: true });
