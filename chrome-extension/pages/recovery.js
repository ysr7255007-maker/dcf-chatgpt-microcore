'use strict';
const $ = (selector) => document.querySelector(selector);
let lastReport = null;

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function snapshotHtml(label, snapshot) {
  if (!snapshot) {
    return `<div class="unit"><div class="unit-title">${esc(label)}</div><div class="muted">无</div></div>`;
  }
  return `<div class="unit">
    <div class="unit-title">${esc(label)}</div>
    <div class="technical">${esc(snapshot.id)}</div>
    <div>${snapshot.entries.filter((entry) => entry.enabled !== false).map((entry) =>
      `${esc(entry.id)} @ ${esc(entry.version)}<br><span class="technical">${esc(entry.artifact_id || `sha256:${entry.hash}`)}</span>`
    ).join('<br>') || '空组合'}</div>
  </div>`;
}

async function load() {
  const response = await chrome.runtime.sendMessage({ type: 'host.diagnostics' });
  if (!response.ok) throw new Error(response.error || '诊断失败');
  lastReport = response.report;
  const report = lastReport;
  const activationFailed = report.desired?.status === 'failed';
  const activationPending = ['declared', 'proving'].includes(report.desired?.status);
  const healthy = report.user_scripts_available && report.deviations.length === 0 && !activationFailed;
  $('#health').className = `status ${healthy ? activationPending ? 'warn' : 'good' : report.user_scripts_available ? 'warn' : 'bad'}`;
  $('#health').textContent = !report.user_scripts_available
    ? 'Chrome 尚未开放用户脚本权限'
    : activationFailed
      ? `目标激活失败：${report.desired.last_error || '请查看证据'}`
      : activationPending
        ? '当前组合可用；新目标正在 Canary 证明'
        : healthy
          ? 'DCF 已收敛'
          : `发现 ${report.deviations.length} 项运行偏差`;

  $('#snapshots').innerHTML =
    snapshotHtml('Desired', report.desired?.snapshot || null) +
    snapshotHtml('Current', report.current_snapshot) +
    snapshotHtml('LKG', report.last_known_good_snapshot) +
    snapshotHtml('Stable', report.stable_snapshot);

  $('#actual').innerHTML = report.actual_registered_scripts.length
    ? report.actual_registered_scripts.map((item) =>
      `<div class="unit"><div class="unit-title">${esc(item.id)}</div><div class="technical">${esc(item.world || '')} · ${esc(item.worldId || '')}</div></div>`
    ).join('')
    : '<div class="muted">没有 DCF 功能脚本注册</div>';

  const status = await chrome.runtime.sendMessage({ type: 'host.status' });
  const current = status.committed?.current || status.committed?.last_known_good;
  $('#units').innerHTML = Object.entries(status.code_units || {}).map(([id, versions]) => {
    const enabled = !!(current && current.entries.find((entry) => entry.id === id && entry.enabled !== false));
    return `<div class="unit">
      <div class="unit-title">${esc(id)}</div>
      <div class="technical">语义版本：${esc(versions.join(', '))}</div>
      <div class="actions"><button data-toggle="${esc(id)}" data-enabled="${enabled ? 'true' : 'false'}">${enabled ? '停用' : '启用'}</button></div>
    </div>`;
  }).join('') || '<div class="muted">本地插件库为空</div>';

  for (const button of document.querySelectorAll('[data-toggle]')) {
    button.addEventListener('click', async () => {
      const next = button.dataset.enabled !== 'true';
      $('#notice').textContent = `正在声明并调和${next ? '启用' : '停用'}目标：${button.dataset.toggle}…`;
      const result = await chrome.runtime.sendMessage({
        type: 'host.set_unit_enabled',
        id: button.dataset.toggle,
        enabled: next
      });
      $('#notice').textContent = result.ok
        ? result.status === 'completed' ? '目标已提交并开始迁移现有页面。' : `目标状态：${result.status}`
        : `失败：${result.error || result.status}`;
      await load();
    });
  }
  $('#evidence').textContent = JSON.stringify({
    desired: report.desired,
    committed: report.committed,
    observed: report.observed,
    activation_records: report.activation_records,
    reconcile_records: report.reconcile_records,
    recent_evidence: report.recent_evidence
  }, null, 2);
}

async function action(type, pending) {
  $('#notice').textContent = pending;
  const result = await chrome.runtime.sendMessage({ type });
  $('#notice').textContent = result.ok ? '操作已完成。' : `操作失败：${result.error || result.status || '未知原因'}`;
  await load();
}

$('#reconcile').onclick = () => action('host.activate', '正在根据 Desired / Observed / Committed 重新调和…');
$('#restore').onclick = () => action('host.restore_lkg', '正在声明并恢复最近可用组合…');
$('#updates').onclick = () => action('host.check_all_updates', '正在检查功能插件与底座更新…');
$('#onboarding').onclick = () => { location.href = 'onboarding.html'; };
$('#copy').onclick = async () => {
  if (!lastReport) return;
  await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
  $('#notice').textContent = '结构化诊断包已复制，可直接交给 AI。';
};

load().catch((error) => {
  $('#notice').textContent = String(error && error.message || error);
});
