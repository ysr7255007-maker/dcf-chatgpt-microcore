'use strict';
const $ = (selector) => document.querySelector(selector);
function statusClass(node, kind, text) { node.className = `status ${kind}`; node.textContent = text; }
async function load() {
  const status = await chrome.runtime.sendMessage({ type: 'host.status' });
  if (!status.ok) throw new Error(status.error || '无法读取 DCF 状态');
  statusClass($('#permission'), status.user_scripts_available ? 'good' : 'warn', status.user_scripts_available ? 'Chrome 用户脚本权限已开启' : '尚未开启“允许用户脚本”');
  const migration = status.product && status.product.migration || {};
  const migrationText = migration.status === 'success' ? `迁移完成：${migration.last_result && migration.last_result.imported || 0} 枚新弹药` : migration.status === 'partial' ? '迁移完成，但存在冲突；旧数据仍保留' : migration.status === 'failed' ? `迁移失败：${migration.last_result && migration.last_result.error || '请打开恢复页查看'}` : '尚未发现可迁移的旧版状态';
  statusClass($('#migration'), migration.status === 'success' ? 'good' : migration.status === 'failed' ? 'bad' : 'warn', migrationText);
  const snapshot = status.snapshots.candidate || status.snapshots.current;
  $('#snapshot').textContent = snapshot ? `${snapshot.entries.filter((entry) => entry.enabled !== false).length} 个受控代码单元 · ${status.snapshots.candidate ? '等待启动证据' : '已确认可用'}` : '尚无启动快照';
}
$('#open-settings').addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
$('#open-chatgpt').addEventListener('click', () => chrome.tabs.create({ url: 'https://chatgpt.com/' }));
$('#recovery').addEventListener('click', () => location.href = 'recovery.html');
$('#activate').addEventListener('click', async () => {
  $('#notice').textContent = '正在校验代码单元并建立启动集合…';
  const result = await chrome.runtime.sendMessage({ type: 'host.activate' });
  if (result.ok) $('#notice').textContent = result.status === 'candidate_pending_evidence' ? '代码集合已注册。打开 ChatGPT 后会自动完成启动确认。' : 'DCF 已恢复到当前启动集合。';
  else $('#notice').textContent = result.status === 'permission_required' ? 'Chrome 尚未开放用户脚本能力，请先开启“允许用户脚本”。' : `启用失败：${result.error || result.status}`;
  await load();
});
load().catch((error) => { $('#notice').textContent = String(error && error.message || error); });
