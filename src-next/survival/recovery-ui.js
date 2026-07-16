'use strict';

const { copyText } = require('../core/utils');

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function renderRecovery(model) {
  const doc = globalThis.document;
  if (!doc?.documentElement) return;
  doc.getElementById('dcf-next-recovery-host')?.remove();
  const host = doc.createElement('div');
  host.id = 'dcf-next-recovery-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial} .box{position:fixed;z-index:2147483647;right:16px;top:16px;width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#171717;color:#f5f5f5;border:1px solid #555;border-radius:12px;padding:16px;font:13px/1.45 system-ui;box-shadow:0 16px 40px #0008}h2{margin:0 0 8px;font-size:16px}code{word-break:break-all}ul{padding-left:18px}.actions{display:flex;flex-wrap:wrap;gap:8px}button,a{border:1px solid #666;background:#292929;color:#fff;border-radius:8px;padding:7px 10px;text-decoration:none;cursor:pointer}.reason{color:#f8c36a}</style>`;
  const box = el('section'); box.className = 'box';
  box.append(el('h2', `DCF Next 安全模式 · ${model.version}`), el('p', `原因：${model.reason}`, { class: 'reason' }));
  const list = el('ul');
  for (const item of model.state.boot.plugins || []) list.append(el('li', `${item.id}@${item.version} — ${item.status}${item.error ? ` — ${item.error}` : ''}`));
  box.append(list);
  const actions = el('div'); actions.className = 'actions';
  const addButton = (label, action) => { const button = el('button', label); button.onclick = action; actions.append(button); };
  addButton('重试当前组合', model.retry);
  addButton('跳过失败插件', model.skipFailed);
  addButton('回到最近可用组合', model.loadKnownGood);
  addButton('加载最小组合', model.loadMinimal);
  addButton('复制诊断', () => copyText(model.diagnostics()));
  const reinstall = el('a', '重新安装审查脚本');
  reinstall.href = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/dcf-chatgpt-next.user.js';
  reinstall.target = '_blank'; actions.append(reinstall);
  box.append(actions); shadow.append(box); doc.documentElement.append(host);
}

module.exports = { renderRecovery };
