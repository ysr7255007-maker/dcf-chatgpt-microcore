'use strict';

const NEXT_HOST_ID = 'dcf-next-shell-host';
const ATTEMPT_ATTR = 'data-dcf-chrome-next-migration-attempted';
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function text(node) { return String(node && (node.value ?? node.textContent) || '').trim(); }
function buttonByText(root, label) { return Array.from(root.querySelectorAll('button')).find((node) => text(node) === label); }
function fieldByLabel(root, label) {
  const wrap = Array.from(root.querySelectorAll('.dcf-field,label')).find((node) => text(node.querySelector('span')) === label || text(node.firstElementChild) === label);
  return wrap && wrap.querySelector('input,textarea,select');
}
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
setTimeout(attemptMigration, 1800);
new MutationObserver(() => { if (document.getElementById(NEXT_HOST_ID)) attemptMigration(); }).observe(document.documentElement, { childList: true, subtree: true });
