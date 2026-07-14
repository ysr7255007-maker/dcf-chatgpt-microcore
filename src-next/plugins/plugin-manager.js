'use strict';

const { clone, copyText } = require('../core/utils');

function pluginManagerPlugin() {
  return {
    id: 'dcf.next.plugin-manager',
    version: '1.0.0',
    title: '插件管理',
    description: '管理真实启动清单、顺序、组合和内嵌插件版本。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      let working = ctx.survival.currentManifest();
      let combinations = ctx.storage.get('combinations', {});
      let importText = '';

      function saveCombination(name, manifest = working) {
        const cleanName = String(name || '').trim();
        if (!cleanName) throw new Error('组合名称不能为空');
        combinations = { ...combinations, [cleanName]: clone(manifest) };
        ctx.storage.set('combinations', combinations);
      }
      function removeCombination(name) {
        const next = { ...combinations };
        delete next[String(name)];
        combinations = next;
        ctx.storage.set('combinations', combinations);
      }

      function availableMap() {
        const map = new Map();
        for (const plugin of ctx.survival.availablePlugins()) {
          if (!map.has(plugin.id)) map.set(plugin.id, []);
          map.get(plugin.id).push(plugin);
        }
        return map;
      }
      function persist({ restart = true } = {}) { ctx.survival.setManifest(working, { restart }); }
      function move(index, delta) {
        const next = index + delta;
        if (next < 0 || next >= working.length) return;
        [working[index], working[next]] = [working[next], working[index]];
        shell.refresh('plugins');
      }
      function setEnabled(index, enabled) { working[index] = { ...working[index], enabled }; shell.refresh('plugins'); }
      function setVersion(index, version) { working[index] = { ...working[index], version }; shell.refresh('plugins'); }

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const intro = document.createElement('div'); intro.className = 'dcf-muted'; intro.textContent = '这里修改的是生存盒实际读取的启动清单。保存后刷新；插件管理器本身不是唯一恢复入口。'; root.append(intro);
        const available = availableMap();
        working.forEach((entry, index) => {
          const info = available.get(entry.id)?.find((item) => item.version === entry.version) || { title: entry.id, description: '' };
          const card = document.createElement('article'); card.className = 'dcf-card dcf-stack';
          const header = document.createElement('div'); header.className = 'dcf-row';
          const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = entry.enabled !== false; toggle.onchange = () => setEnabled(index, toggle.checked);
          const title = document.createElement('div'); title.className = 'dcf-title'; title.style.flex = '1'; title.textContent = info.title;
          const order = document.createElement('span'); order.className = 'dcf-badge'; order.textContent = `#${index + 1}`;
          header.append(toggle, title, order); card.append(header);
          const technical = document.createElement('div'); technical.className = 'dcf-muted'; technical.textContent = `${entry.id}@${entry.version}${info.description ? ` · ${info.description}` : ''}`; card.append(technical);
          const controls = document.createElement('div'); controls.className = 'dcf-row';
          const versions = available.get(entry.id) || [];
          if (versions.length > 1) {
            const select = document.createElement('select');
            for (const optionInfo of versions) { const option = document.createElement('option'); option.value = optionInfo.version; option.textContent = optionInfo.version; option.selected = optionInfo.version === entry.version; select.append(option); }
            select.onchange = () => setVersion(index, select.value); controls.append(select);
          }
          const up = document.createElement('button'); up.className = 'dcf-btn'; up.textContent = '上移'; up.disabled = index === 0; up.onclick = () => move(index, -1);
          const down = document.createElement('button'); down.className = 'dcf-btn'; down.textContent = '下移'; down.disabled = index === working.length - 1; down.onclick = () => move(index, 1);
          controls.append(up, down); card.append(controls); root.append(card);
        });

        const actions = document.createElement('div'); actions.className = 'dcf-row';
        const save = document.createElement('button'); save.className = 'dcf-btn primary'; save.textContent = '保存并重启'; save.onclick = () => persist({ restart: true });
        const reset = document.createElement('button'); reset.className = 'dcf-btn'; reset.textContent = '放弃改动'; reset.onclick = () => { working = ctx.survival.currentManifest(); shell.refresh('plugins'); };
        const exportButton = document.createElement('button'); exportButton.className = 'dcf-btn'; exportButton.textContent = '复制启动清单'; exportButton.onclick = () => copyText(JSON.stringify({ schema: 'dcf.next.plugin-manifest.v1', plugins: working }, null, 2)).then(() => shell.notify('启动清单已复制'));
        actions.append(save, reset, exportButton); root.append(actions);

        const savedCard = document.createElement('section'); savedCard.className = 'dcf-card dcf-stack';
        const savedTitle = document.createElement('div'); savedTitle.className = 'dcf-title'; savedTitle.textContent = '组合'; savedCard.append(savedTitle);
        const nameInput = document.createElement('input'); nameInput.placeholder = '组合名称';
        const saveCombo = document.createElement('button'); saveCombo.className = 'dcf-btn'; saveCombo.textContent = '保存当前组合'; saveCombo.onclick = () => { try { saveCombination(nameInput.value, working); shell.notify('组合已保存'); shell.refresh('plugins'); } catch (error) { shell.notify(error.message, 'error'); } };
        const comboRow = document.createElement('div'); comboRow.className = 'dcf-row'; comboRow.append(nameInput, saveCombo); savedCard.append(comboRow);
        for (const [name, manifest] of Object.entries(combinations)) {
          const row = document.createElement('div'); row.className = 'dcf-row';
          const label = document.createElement('span'); label.style.flex = '1'; label.textContent = name;
          const load = document.createElement('button'); load.className = 'dcf-btn'; load.textContent = '载入'; load.onclick = () => { working = clone(manifest); shell.refresh('plugins'); };
          const remove = document.createElement('button'); remove.className = 'dcf-btn danger'; remove.textContent = '删除'; remove.onclick = () => { removeCombination(name); shell.refresh('plugins'); };
          row.append(label, load, remove); savedCard.append(row);
        }
        root.append(savedCard);

        const importCard = document.createElement('section'); importCard.className = 'dcf-card dcf-stack';
        const importTitle = document.createElement('div'); importTitle.className = 'dcf-title'; importTitle.textContent = '导入启动清单';
        const area = document.createElement('textarea'); area.placeholder = '粘贴 dcf.next.plugin-manifest.v1 JSON'; area.value = importText; area.oninput = () => { importText = area.value; };
        const apply = document.createElement('button'); apply.className = 'dcf-btn'; apply.textContent = '校验并载入'; apply.onclick = () => {
          try {
            const parsed = JSON.parse(importText);
            if (parsed.schema !== 'dcf.next.plugin-manifest.v1' || !Array.isArray(parsed.plugins)) throw new Error('启动清单格式不正确');
            const known = availableMap();
            for (const entry of parsed.plugins) if (!known.get(entry.id)?.some((candidate) => candidate.version === entry.version)) throw new Error(`当前 userscript 不包含 ${entry.id}@${entry.version}`);
            working = clone(parsed.plugins); shell.refresh('plugins'); shell.notify('清单已载入，尚未保存');
          } catch (error) { shell.notify(error.message, 'error'); }
        };
        importCard.append(importTitle, area, apply); root.append(importCard);
        container.append(root);
      }

      shell.registerPanel({ id: 'plugins', title: '插件', render });
      return { manifest: () => clone(working), reload: () => { working = ctx.survival.currentManifest(); shell.refresh('plugins'); } };
    }
  };
}

module.exports = { pluginManagerPlugin };
