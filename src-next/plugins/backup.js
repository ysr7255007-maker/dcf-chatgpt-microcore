'use strict';

const { nowIso, downloadText } = require('../core/utils');
const { STATE_KEY, PLUGIN_STORAGE_PREFIX } = require('../survival/constants');

function validateBackup(data) {
  if (!data || data.schema !== 'dcf.next.backup.v1' || !data.values || typeof data.values !== 'object') throw new Error('备份格式不正确');
  for (const key of Object.keys(data.values)) {
    if (key !== STATE_KEY && !key.startsWith(PLUGIN_STORAGE_PREFIX)) throw new Error(`备份包含不允许恢复的键：${key}`);
  }
  return data;
}

function backupPlugin() {
  return {
    id: 'dcf.next.backup',
    version: '1.0.0',
    title: '数据备份与恢复',
    description: '导出和恢复新版插件数据、外观与启动组合。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      let importText = '';

      function buildBackup() {
        const values = {};
        for (const key of ctx.rawStorage.listRaw()) {
          if (key === STATE_KEY || key.startsWith(PLUGIN_STORAGE_PREFIX)) values[key] = ctx.rawStorage.readRaw(key, null);
        }
        return { schema: 'dcf.next.backup.v1', version: ctx.survival.version, exported_at: nowIso(), values };
      }
      function restore(data) {
        validateBackup(data);
        const snapshot = buildBackup();
        ctx.storage.set('pre_restore_backup', snapshot);
        for (const [key, value] of Object.entries(data.values)) ctx.rawStorage.writeRaw(key, value);
      }

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const exportCard = document.createElement('section'); exportCard.className = 'dcf-card dcf-stack';
        const title = document.createElement('div'); title.className = 'dcf-title'; title.textContent = '导出当前数据';
        const note = document.createElement('div'); note.className = 'dcf-muted'; note.textContent = '包括语言弹药、插件设置、外观、启动清单与组合；不包含对话正文、Cookie 或认证信息。';
        const button = document.createElement('button'); button.className = 'dcf-btn primary'; button.textContent = '下载 JSON 备份';
        button.onclick = () => downloadText(`dcf-next-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildBackup(), null, 2));
        exportCard.append(title, note, button); root.append(exportCard);

        const importCard = document.createElement('section'); importCard.className = 'dcf-card dcf-stack';
        const importTitle = document.createElement('div'); importTitle.className = 'dcf-title'; importTitle.textContent = '恢复备份';
        const area = document.createElement('textarea'); area.placeholder = '粘贴 dcf.next.backup.v1 JSON'; area.value = importText; area.oninput = () => { importText = area.value; };
        const restoreButton = document.createElement('button'); restoreButton.className = 'dcf-btn danger'; restoreButton.textContent = '校验、恢复并重启';
        restoreButton.onclick = () => {
          try {
            const parsed = validateBackup(JSON.parse(importText));
            if (!confirm(`恢复 ${Object.keys(parsed.values).length} 个数据项？当前数据会先自动备份。`)) return;
            restore(parsed); ctx.survival.restart();
          } catch (error) { shell.notify(error.message, 'error'); }
        };
        importCard.append(importTitle, area, restoreButton); root.append(importCard);
        container.append(root);
      }

      shell.registerPanel({ id: 'backup', title: '备份', render });
      return { exportData: buildBackup, restore, validateBackup };
    }
  };
}

module.exports = { backupPlugin, validateBackup };
