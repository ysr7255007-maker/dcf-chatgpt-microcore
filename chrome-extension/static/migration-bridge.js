'use strict';

const OLD_HOST_ID = 'dcf-chatgpt-microcore-host';
const ATTEMPT_ATTR = 'data-dcf-chrome-migration-attempted';

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function field(root, role) {
  const node = root.querySelector(`[data-role="${role}"]`);
  return node ? String(node.value || '') : '';
}

async function extractLegacyPayload(host) {
  const root = host && host.shadowRoot;
  if (!root) throw new Error('旧版 DCF 的 Shadow DOM 不可读取');
  const selectedTab = root.querySelector('.tabs button.on[data-tab]');
  const selectedTabId = selectedTab && selectedTab.dataset.tab || null;
  const ammoTab = root.querySelector('.tabs button[data-tab="ammo"]');
  if (!ammoTab) throw new Error('旧版 DCF 未提供语言弹药页');
  ammoTab.click();
  await delay(120);

  const ids = Array.from(root.querySelectorAll('[data-ammo-id]')).map((card) => String(card.dataset.ammoId || '')).filter(Boolean);
  const items = [];
  for (const id of ids) {
    const card = Array.from(root.querySelectorAll('[data-ammo-id]')).find((entry) => String(entry.dataset.ammoId) === id);
    const edit = card && card.querySelector('[data-action="ammo-edit"]');
    if (!edit) throw new Error(`旧版弹药 ${id} 缺少编辑入口`);
    edit.click();
    await delay(30);
    const body = field(root, 'ammo-draft-body');
    const item = {
      id: field(root, 'ammo-draft-id') || id,
      title: field(root, 'ammo-draft-title') || id,
      purpose: field(root, 'ammo-draft-purpose'),
      body
    };
    const tags = field(root, 'ammo-draft-tags').split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    if (tags.length) item.tags = tags;
    if (!item.body.trim()) throw new Error(`旧版弹药 ${id} 正文为空，迁移已停止`);
    items.push(item);
    const cancel = root.querySelector('[data-action="ammo-cancel"]');
    if (cancel) cancel.click();
    await delay(15);
  }

  const modeButton = root.querySelector('[data-action="ammo-mode"]');
  const shell = root.querySelector('.sh');
  const appearance = {};
  if (shell) {
    appearance.side = shell.dataset.side || null;
    appearance.anchor = shell.dataset.anchor || null;
    for (const name of ['--w', '--h', '--top', '--bottom']) {
      const value = shell.style.getPropertyValue(name);
      if (value) appearance[name.slice(2)] = value;
    }
  }

  if (selectedTabId && selectedTabId !== 'ammo') {
    const restore = root.querySelector(`.tabs button[data-tab="${selectedTabId}"]`);
    if (restore) restore.click();
  }

  return {
    schema: 'dcf.legacy.dom-export.v1',
    source: { kind: 'tampermonkey-open-shadow-dom', host_id: OLD_HOST_ID },
    items,
    settings: {
      ammo_fire_mode: modeButton && modeButton.dataset.commandState === 'send' ? 'send' : 'insert',
      appearance
    }
  };
}

async function attemptMigration() {
  const status = await chrome.runtime.sendMessage({ type: 'legacy.status' }).catch(() => null);
  if (status && status.ok && ['success', 'partial'].includes(status.migration && status.migration.status)) return;
  const host = document.getElementById(OLD_HOST_ID);
  if (!host || host.getAttribute(ATTEMPT_ATTR) === 'true') return;
  host.setAttribute(ATTEMPT_ATTR, 'true');
  try {
    const payload = await extractLegacyPayload(host);
    await chrome.runtime.sendMessage({ type: 'legacy.import', payload });
  } catch (error) {
    await chrome.runtime.sendMessage({ type: 'legacy.error', error: String(error && error.message || error) }).catch(() => undefined);
  }
}

setTimeout(attemptMigration, 1600);
new MutationObserver(() => {
  if (document.getElementById(OLD_HOST_ID)) attemptMigration();
}).observe(document.documentElement, { childList: true, subtree: true });
