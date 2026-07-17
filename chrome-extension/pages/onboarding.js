'use strict';
const $ = (selector) => document.querySelector(selector);
function statusClass(node, kind, text) { node.className = `status ${kind}`; node.textContent = text; }
async function load() {
  const status = await chrome.runtime.sendMessage({ type: 'host.status' });
  if (!status.ok) throw new Error(status.error || '无法读取 DCF 状态');
  statusClass($('#permission'), status.user_scripts_available ? 'good' : 'warn', status.user_scripts_available ? 'Chrome 用户脚本权限已开启' : '尚未开启“允许用户脚本”');
  const migration = status.migration && status.migration.next || {};
  const result = migration.last_result || {};
  const migrationText = migration.status === 'success' ? `接续完成：新增 ${result.added || 0}，更新 ${result.updated || 0}` : migration.status === 'failed' ? `接续失败：${result.error || '请打开恢复页查看'}` : '尚未发现可接续的 DCF Next 状态';
  statusClass($('#migration'), migration.status === 'success' ? 'good' : migration.status === 'failed' ? 'bad' : 'warn', migrationText);
  const snapshot = status.snapshots.candidate || status.snapshots.current;
  $('#snapshot').textContent = snapshot ? `${snapshot.entries.filter((entry) => entry.enabled !== false).length} 项独立功能 · ${status.snapshots.candidate ? '等待启动确认' : '已确认可用'}` : '尚未取得默认功能组合';
}
$('#open-settings').addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
$('#open-chatgpt').addEventListener('click', () => chrome.tabs.create({ url: 'https://chatgpt.com/' }));
$('#recovery').addEventListener('click', () => location.href = 'recovery.html');
$('#activate').addEventListener('click', async () => {
  $('#notice').textContent = '正在从 GitHub 取得默认功能并建立启动组合…';
  const result = await chrome.runtime.sendMessage({ type: 'host.activate' });
  if (result.ok) $('#notice').textContent = result.status === 'candidate_pending_evidence' || result.status === 'installed_default' ? '功能已注册。打开 ChatGPT 后会自动完成启动确认。' : 'DCF 已恢复到当前功能组合。';
  else $('#notice').textContent = result.status === 'permission_required' ? '请先开启“允许用户脚本”。' : `启用失败：${result.error || result.status}`;
  await load();
});
load().catch((error) => { $('#notice').textContent = String(error && error.message || error); });
