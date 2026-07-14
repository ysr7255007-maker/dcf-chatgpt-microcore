'use strict';

const { DEFAULT_GEOMETRY } = require('./shell');

function appearancePlugin() {
  return {
    id: 'dcf.next.appearance',
    version: '1.0.0',
    title: '外观与位置',
    description: '侧栏停靠、尺寸、位置与恢复默认值。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      let geometry = { ...DEFAULT_GEOMETRY, ...ctx.storage.get('geometry', {}) };
      shell.setGeometry(geometry);
      const unsubscribe = shell.onGeometry((next) => { geometry = { ...next }; ctx.storage.set('geometry', geometry); });

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const makeField = (label, key, type = 'number', options = null) => {
          const wrap = document.createElement('label'); wrap.className = 'dcf-field';
          const caption = document.createElement('span'); caption.textContent = label;
          const input = document.createElement(options ? 'select' : 'input');
          if (options) {
            for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = geometry[key] === value; input.append(option); }
          } else { input.type = type; input.value = geometry[key]; }
          input.onchange = () => {
            const value = options ? input.value : Number(input.value);
            geometry = { ...geometry, [key]: value }; shell.setGeometry(geometry); ctx.storage.set('geometry', geometry);
          };
          wrap.append(caption, input); root.append(wrap);
        };
        makeField('停靠', 'side', 'text', [['right', '右侧'], ['left', '左侧']]);
        makeField('宽度（px）', 'width');
        makeField('顶部位置（px）', 'top');
        makeField('高度（px）', 'height');
        makeField('边距（px）', 'margin');
        const reset = document.createElement('button'); reset.className = 'dcf-btn'; reset.textContent = '恢复默认位置';
        reset.onclick = () => { geometry = { ...DEFAULT_GEOMETRY }; ctx.storage.set('geometry', geometry); shell.setGeometry(geometry); shell.refresh('appearance'); };
        root.append(reset); container.append(root);
      }

      shell.registerPanel({ id: 'appearance', title: '外观', render });
      return { get: () => ({ ...geometry }), set: (next) => { geometry = { ...geometry, ...next }; ctx.storage.set('geometry', geometry); shell.setGeometry(geometry); }, destroy: unsubscribe };
    }
  };
}

module.exports = { appearancePlugin };
