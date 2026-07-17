'use strict';
const $ = (selector) => document.querySelector(selector);
let lastReport = null;
function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function snapshotHtml(label, snapshot) {
  if (!snapshot) return `<div class="unit"><div class="unit-title">${esc(label)}</div><div class="muted">无</div></div>`;
  return `<div class="unit"><div class="unit-title">${esc(label)}</div><div class="technical">${esc(snapshot.id)}</div><div>${snapshot.entries.filter((entry)=>entry.enabled!==false).map((entry)=>`${esc(entry.id)} @ ${esc(entry.version)}`).join('<br>') || '空组合'}</div></div>`;
}
async function load() {
  const response = await chrome.runtime.sendMessage({ type: 'host.diagnostics' });
  if (!response.ok) throw new Error(response.error || '诊断失败');
  lastReport = response.report;
  const report = lastReport;
  const healthy = report.user_scripts_available && report.deviations.length === 0;
  $('#health').className = `status ${healthy ? 'good' : report.user_scripts_available ? 'warn' : 'bad'}`;
  $('#health').textContent = !report.user_scripts_available ? 'Chrome 尚未开放用户脚本权限' : healthy ? 'DCF 正常' : `发现 ${report.deviations.length} 项运行偏差`;
  $('#snapshots').innerHTML = snapshotHtml('候选', report.candidate_snapshot) + snapshotHtml('当前', report.current_snapshot) + snapshotHtml('最近可用', report.last_known_good_snapshot);
  $('#actual').innerHTML = report.actual_registered_scripts.length ? report.actual_registered_scripts.map((item)=>`<div class="unit"><div class="unit-title">${esc(item.id)}</div><div class="technical">${esc(item.world || '')} · ${esc(item.worldId || '')}</div></div>`).join('') : '<div class="muted">没有 DCF 功能脚本注册</div>';
  const status = await chrome.runtime.sendMessage({ type: 'host.status' });
  const current = status.snapshots.current || status.snapshots.last_known_good;
  $('#units').innerHTML = Object.entries(status.code_units || {}).map(([id, versions]) => {
    const enabled = !!(current && current.entries.find((entry) => entry.id === id && entry.enabled !== false));
    return `<div class="unit"><div class="unit-title">${esc(id)}</div><div class="technical">已保存：${esc(versions.join(', '))}</div><div class="actions"><button data-toggle="${esc(id)}" data-enabled="${enabled ? 'true' : 'false'}">${enabled ? '停用' : '启用'}</button></div></div>`;
  }).join('') || '<div class="muted">本地插件库为空</div>';
  for (const button of document.querySelectorAll('[data-toggle]')) button.addEventListener('click', async () => {
    const next = button.dataset.enabled !== 'true';
    $('#notice').textContent = `正在${next ? '启用' : '停用'} ${button.dataset.toggle}…`;
    const result = await chrome.runtime.sendMessage({ type: 'host.set_unit_enabled', id: button.dataset.toggle, enabled: next });
    $('#notice').textContent = result.ok ? '已建立新的候选组合。' : `失败：${result.error || result.status}`;
    await load();
  });
  $('#evidence').textContent = JSON.stringify(report.recent_evidence, null, 2);
}
async function action(type, pending) {
  $('#notice').textContent = pending;
  const result = await chrome.runtime.sendMessage({ type });
  $('#notice').textContent = result.ok ? '操作已完成。' : `操作失败：${result.error || result.status || '未知原因'}`;
  await load();
}
$('#reconcile').onclick = () => action('host.activate', '正在重新建立当前组合…');
$('#restore').onclick = () => action('host.restore_lkg', '正在恢复最近可用组合…');
$('#updates').onclick = () => action('host.check_all_updates', '正在检查功能插件与底座更新…');
$('#onboarding').onclick = () => location.href = 'onboarding.html';
$('#copy').onclick = async () => { if (!lastReport) return; await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2)); $('#notice').textContent = '诊断包已复制，可直接交给 AI。'; };
load().catch((error) => { $('#notice').textContent = String(error && error.message || error); });
