'use strict';
const $ = (selector) => document.querySelector(selector);
let lastReport = null;
function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function snapshotHtml(label, snapshot) {
  if (!snapshot) return `<div class="unit"><div class="unit-title">${esc(label)}</div><div class="muted">无</div></div>`;
  return `<div class="unit"><div class="unit-title">${esc(label)}</div><div class="technical">${esc(snapshot.id)}</div><div>${snapshot.entries.filter((entry)=>entry.enabled!==false).map((entry)=>`${esc(entry.id)} @ ${esc(entry.version)}`).join('<br>') || '空集合'}</div></div>`;
}
async function load() {
  const response = await chrome.runtime.sendMessage({ type: 'host.diagnostics' });
  if (!response.ok) throw new Error(response.error || '诊断失败');
  lastReport = response.report;
  const report = lastReport;
  const healthy = report.user_scripts_available && report.deviations.length === 0;
  $('#health').className = `status ${healthy ? 'good' : report.user_scripts_available ? 'warn' : 'bad'}`;
  $('#health').textContent = !report.user_scripts_available ? 'Chrome 尚未开放用户脚本权限' : healthy ? '目标快照与实际注册集合一致' : `发现 ${report.deviations.length} 项注册偏差`;
  $('#snapshots').innerHTML = snapshotHtml('候选', report.candidate_snapshot) + snapshotHtml('当前', report.current_snapshot) + snapshotHtml('最近可用', report.last_known_good_snapshot);
  $('#actual').innerHTML = report.actual_registered_scripts.length ? report.actual_registered_scripts.map((item)=>`<div class="unit"><div class="unit-title">${esc(item.id)}</div><div class="technical">${esc(item.world || '')} · ${esc(item.worldId || '')}</div></div>`).join('') : '<div class="muted">没有 DCF 用户脚本注册</div>';
  const status = await chrome.runtime.sendMessage({ type: 'host.status' });
  $('#units').innerHTML = Object.entries(status.code_units || {}).map(([id, versions]) => `<div class="unit"><div class="unit-title">${esc(id)}</div><div class="technical">已保存版本：${esc(versions.join(', '))}</div><div class="actions"><button class="danger" data-disable="${esc(id)}">从候选组合停用</button></div></div>`).join('') || '<div class="muted">本地代码库为空</div>';
  for (const button of document.querySelectorAll('[data-disable]')) button.addEventListener('click', async () => { $('#notice').textContent = `正在停用 ${button.dataset.disable}…`; const result = await chrome.runtime.sendMessage({ type: 'host.disable_unit', id: button.dataset.disable }); $('#notice').textContent = result.ok ? '已建立并验证停用候选。' : `失败：${result.error || result.status}`; await load(); });
  $('#evidence').textContent = JSON.stringify(report.recent_evidence, null, 2);
}
async function action(type, pending) { $('#notice').textContent = pending; const result = await chrome.runtime.sendMessage({ type }); $('#notice').textContent = result.ok ? '操作完成。' : `操作失败：${result.error || result.status}`; await load(); }
$('#reconcile').addEventListener('click', () => action('host.activate', '正在重新建立目标注册集合…'));
$('#restore').addEventListener('click', () => action('host.restore_lkg', '正在恢复最近可用快照…'));
$('#updates').addEventListener('click', () => action('host.check_updates', '正在取得并校验官方代码单元…'));
$('#onboarding').addEventListener('click', () => location.href = 'onboarding.html');
$('#copy').addEventListener('click', async () => { if (!lastReport) await load(); await navigator.clipboard.writeText(`<<<DCF_CHROME_DIAGNOSTICS\n${JSON.stringify(lastReport, null, 2)}\nDCF_CHROME_DIAGNOSTICS>>>`); $('#notice').textContent = '完整诊断包已复制。'; });
load().catch((error) => { $('#notice').textContent = String(error && error.message || error); });
