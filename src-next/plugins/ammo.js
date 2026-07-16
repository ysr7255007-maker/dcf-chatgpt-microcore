'use strict';

const {
  normalizeAmmo,
  decodeAmmoArtifacts,
  encodeAmmoLibrary,
  decodeAmmoLibrary,
  classifyLibraryMerge,
  buildInvocation,
  buildUpdateRequest,
  buildExtractRequest
} = require('./ammo-artifacts');
const { clone, nowIso, copyText } = require('../core/utils');

const LEGACY_ROOT_KEY = 'dcf.state.root.v1';
const DEFAULT_LIBRARY_URL = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/language-ammo-library/data/language-ammo/library.json';

function collectLegacyAmmo(raw) {
  const items = raw?.user?.content?.ammo || raw?.content?.ammo || raw?.ammo || {};
  return Object.values(items || {}).map((item) => normalizeAmmo(item));
}

function requestText(url) {
  if (typeof GM_xmlhttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        onload(response) {
          if (response.status >= 200 && response.status < 300) resolve(String(response.responseText || ''));
          else reject(new Error(`language_ammo_library_http_${response.status}`));
        },
        onerror() { reject(new Error('language_ammo_library_network_error')); },
        ontimeout() { reject(new Error('language_ammo_library_timeout')); }
      });
    });
  }
  if (typeof fetch === 'function') {
    return fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`language_ammo_library_http_${response.status}`);
      return response.text();
    });
  }
  return Promise.reject(new Error('language_ammo_library_transport_unavailable'));
}

function ammoPlugin() {
  return {
    id: 'dcf.next.ammo',
    version: '1.0.0',
    title: '语言弹药工作台',
    description: '语言弹药的数据、界面、发射、更新、自动装填和跨系统便携库。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const host = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell) throw new Error('shell_plugin_required');
      if (!host) throw new Error('chatgpt_plugin_required');

      let items = ctx.storage.get('items', {});
      let settings = {
        fire_mode: 'insert',
        library_url: DEFAULT_LIBRARY_URL,
        ...ctx.storage.get('settings', {})
      };
      let search = '';
      let editingId = null;

      function persist() {
        ctx.storage.set('items', items);
        ctx.storage.set('settings', settings);
      }
      function list() {
        return Object.values(items).filter((item) => {
          const haystack = `${item.title} ${item.purpose} ${(item.tags || []).join(' ')}`.toLowerCase();
          return !search || haystack.includes(search.toLowerCase());
        }).sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'));
      }
      function get(id) { return items[id] ? clone(items[id]) : null; }
      function upsert(raw, source = 'manual', options = {}) {
        const item = normalizeAmmo(raw);
        const previous = items[item.id];
        const timestamp = nowIso();
        items[item.id] = {
          ...previous,
          ...item,
          created_at: previous?.created_at || item.created_at || timestamp,
          updated_at: options.preserveTimestamps && item.updated_at ? item.updated_at : timestamp,
          source: source || item.source || previous?.source || 'manual'
        };
        persist();
        shell.refresh('ammo');
        return clone(items[item.id]);
      }
      function remove(id) {
        delete items[id];
        persist();
        shell.refresh('ammo');
      }

      async function exportLibrary() {
        const text = encodeAmmoLibrary(Object.values(items));
        await copyText(text);
        ctx.storage.set('last_library_export', {
          exported_at: nowIso(),
          count: Object.keys(items).length
        });
        return { count: Object.keys(items).length, text };
      }

      function importLibraryText(text, source = 'portable-library') {
        const library = decodeAmmoLibrary(text);
        const classified = classifyLibraryMerge(items, library.items);
        for (const item of [...classified.added, ...classified.updated]) {
          upsert(item, source, { preserveTimestamps: true });
        }
        const result = {
          imported_at: nowIso(),
          source,
          exported_at: library.exported_at,
          added: classified.added.length,
          updated: classified.updated.length,
          unchanged: classified.unchanged.length,
          total: library.items.length
        };
        ctx.storage.set('last_library_import', result);
        return result;
      }

      async function loadLibrary() {
        const text = await requestText(settings.library_url);
        return importLibraryText(text, 'github-library');
      }

      function actionError(error) {
        shell.notify(error?.message || String(error), 'error');
      }
      async function fire(item) {
        const text = buildInvocation(item);
        try {
          if (settings.fire_mode === 'send') await host.send(text);
          else await host.insert(text);
          shell.notify(settings.fire_mode === 'send' ? '弹药已发送' : '弹药已填入输入框');
        } catch (error) { actionError(error); }
      }
      async function requestUpdate(item) {
        try {
          await host.send(buildUpdateRequest(item));
          shell.notify('更新请求已发送');
        } catch (error) { actionError(error); }
      }
      async function requestExtract() {
        try {
          await host.send(buildExtractRequest());
          shell.notify('提取请求已发送');
        } catch (error) { actionError(error); }
      }

      function field(label, value, multiline = false) {
        const wrap = document.createElement('label');
        wrap.className = 'dcf-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        const input = document.createElement(multiline ? 'textarea' : 'input');
        input.value = value || '';
        wrap.append(caption, input);
        return { wrap, input };
      }

      function renderEditor(container, initial = {}) {
        container.replaceChildren();
        const stack = document.createElement('div');
        stack.className = 'dcf-stack';
        const id = field('稳定 ID', initial.id || '');
        const title = field('标题', initial.title || '');
        const purpose = field('用途', initial.purpose || '', true);
        const tags = field('标签（逗号分隔）', (initial.tags || []).join(', '));
        const body = field('正文', initial.body || '', true);
        body.input.style.minHeight = '220px';
        const actions = document.createElement('div');
        actions.className = 'dcf-row';
        const save = document.createElement('button');
        save.className = 'dcf-btn primary';
        save.textContent = '保存';
        const cancel = document.createElement('button');
        cancel.className = 'dcf-btn';
        cancel.textContent = '取消';
        save.onclick = () => {
          try {
            const stableId = id.input.value.trim();
            if (!stableId) throw new Error('必须填写稳定 ID');
            if (editingId && editingId !== stableId && items[stableId]) throw new Error('新的 ID 已经存在');
            if (editingId && editingId !== stableId) delete items[editingId];
            upsert({
              id: stableId,
              title: title.input.value,
              purpose: purpose.input.value,
              body: body.input.value,
              tags: tags.input.value.split(',').map((value) => value.trim()).filter(Boolean)
            });
            editingId = null;
            shell.refresh('ammo');
          } catch (error) { actionError(error); }
        };
        cancel.onclick = () => {
          editingId = null;
          shell.refresh('ammo');
        };
        actions.append(save, cancel);
        stack.append(id.wrap, title.wrap, purpose.wrap, tags.wrap, body.wrap, actions);
        container.append(stack);
      }

      function render(container) {
        container.replaceChildren();
        if (editingId !== null) {
          renderEditor(container, editingId ? items[editingId] : {});
          return;
        }

        const root = document.createElement('div');
        root.className = 'dcf-stack';
        const controls = document.createElement('div');
        controls.className = 'dcf-row';
        const input = document.createElement('input');
        input.placeholder = '搜索标题、用途或标签';
        input.value = search;
        input.style.flex = '1';
        input.oninput = () => {
          search = input.value;
          shell.refresh('ammo');
        };
        const create = document.createElement('button');
        create.className = 'dcf-btn primary';
        create.textContent = '新建';
        create.onclick = () => {
          editingId = '';
          shell.refresh('ammo');
        };
        const extract = document.createElement('button');
        extract.className = 'dcf-btn';
        extract.textContent = '从当前对话提取';
        extract.onclick = requestExtract;
        const mode = document.createElement('select');
        for (const [value, label] of [['insert', '填入输入框'], ['send', '直接发送']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = settings.fire_mode === value;
          mode.append(option);
        }
        mode.onchange = () => {
          settings.fire_mode = mode.value;
          persist();
        };
        controls.append(input, create, extract, mode);
        root.append(controls);

        const library = document.createElement('div');
        library.className = 'dcf-card dcf-stack';
        const libraryTitle = document.createElement('div');
        libraryTitle.className = 'dcf-title';
        libraryTitle.textContent = '跨系统便携库';
        const libraryText = document.createElement('div');
        libraryText.className = 'dcf-muted';
        libraryText.textContent = '复制后粘贴给 AI 代为上传；其他系统和 AI 从同一 GitHub 文件读取。';
        const libraryActions = document.createElement('div');
        libraryActions.className = 'dcf-row';
        const copyLibrary = document.createElement('button');
        copyLibrary.className = 'dcf-btn';
        copyLibrary.textContent = '复制便携库';
        copyLibrary.onclick = async () => {
          try {
            const result = await exportLibrary();
            shell.notify(`已复制 ${result.count} 枚语言弹药`);
          } catch (error) { actionError(error); }
        };
        const loadLibraryButton = document.createElement('button');
        loadLibraryButton.className = 'dcf-btn';
        loadLibraryButton.textContent = '从 GitHub 加载';
        loadLibraryButton.onclick = async () => {
          try {
            const result = await loadLibrary();
            shell.notify(`GitHub 载入完成：新增 ${result.added}，更新 ${result.updated}，未变 ${result.unchanged}`);
          } catch (error) { actionError(error); }
        };
        libraryActions.append(copyLibrary, loadLibraryButton);
        library.append(libraryTitle, libraryText, libraryActions);
        root.append(library);

        const shown = list();
        if (!shown.length) {
          const empty = document.createElement('div');
          empty.className = 'dcf-empty';
          empty.textContent = '还没有语言弹药';
          root.append(empty);
        }
        for (const item of shown) {
          const card = document.createElement('article');
          card.className = 'dcf-card dcf-stack';
          const header = document.createElement('div');
          header.className = 'dcf-row';
          const titleNode = document.createElement('div');
          titleNode.className = 'dcf-title';
          titleNode.textContent = item.title;
          titleNode.style.flex = '1';
          const idNode = document.createElement('span');
          idNode.className = 'dcf-badge';
          idNode.textContent = item.id;
          header.append(titleNode, idNode);
          card.append(header);
          if (item.purpose) {
            const purposeNode = document.createElement('div');
            purposeNode.className = 'dcf-muted';
            purposeNode.textContent = item.purpose;
            card.append(purposeNode);
          }
          const actions = document.createElement('div');
          actions.className = 'dcf-row';
          const button = (label, handler, extra = '') => {
            const node = document.createElement('button');
            node.className = `dcf-btn ${extra}`;
            node.textContent = label;
            node.onclick = handler;
            actions.append(node);
          };
          button('发射', () => fire(item), 'primary');
          button('复制正文', () => copyText(item.body).then(() => shell.notify('正文已复制')).catch(actionError));
          button('更新', () => requestUpdate(item));
          button('编辑', () => {
            editingId = item.id;
            shell.refresh('ammo');
          });
          button('删除', () => {
            if (confirm(`删除“${item.title}”？`)) remove(item.id);
          }, 'danger');
          card.append(actions);
          root.append(card);
        }
        container.append(root);
      }

      shell.registerPanel({ id: 'ammo', title: '弹药', render });
      host.onReplyCompleted(({ text }) => {
        const decoded = decodeAmmoArtifacts(text);
        for (const item of decoded.items) upsert(item, 'assistant-reply');
        if (decoded.items.length) shell.notify(`已自动装填 ${decoded.items.length} 枚语言弹药`);
        if (decoded.errors.length) shell.notify(`发现 DCF_AMMO，但有 ${decoded.errors.length} 个解析失败`, 'error');
      });

      return {
        list: () => Object.values(items).map(clone),
        get,
        upsert,
        remove,
        settings: () => clone(settings),
        setFireMode(mode) {
          if (!['insert', 'send'].includes(mode)) throw new Error('invalid_fire_mode');
          settings.fire_mode = mode;
          persist();
          shell.refresh('ammo');
        },
        exportLibrary,
        importLibraryText,
        loadLibrary,
        exportData: () => ({
          schema: 'dcf.next.ammo.export.v1',
          exported_at: nowIso(),
          items: Object.values(items),
          settings: clone(settings)
        }),
        importData(data) {
          for (const item of data?.items || []) upsert(item, 'import');
          if (data?.settings?.fire_mode) settings.fire_mode = data.settings.fire_mode;
          persist();
        }
      };
    }
  };
}

module.exports = {
  ammoPlugin,
  collectLegacyAmmo,
  requestText,
  DEFAULT_LIBRARY_URL
};
