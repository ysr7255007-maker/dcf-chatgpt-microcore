'use strict';

const { createBrowserStorage } = require('./survival/storage');
const { createSurvivalLoader } = require('./survival/loader');
const { renderRecovery } = require('./survival/recovery-ui');
const { createPluginRegistry, defaultManifest } = require('./plugin-registry');

async function main() {
  const registry = createPluginRegistry();
  const storage = createBrowserStorage();
  const loader = createSurvivalLoader({
    registry,
    storage,
    defaultManifest: defaultManifest(registry),
    renderRecovery,
    platform: { window: globalThis.window, document: globalThis.document }
  });
  const result = await loader.boot();
  globalThis.DCF_NEXT = Object.freeze({ version: loader.getState().survival_version, result, state: () => loader.getState() });
}

main().catch((error) => {
  console.error('[DCF Next fatal]', error);
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;top:16px;max-width:420px;background:#8b1e1e;color:white;padding:14px;border-radius:10px;font:13px system-ui';
    host.textContent = `DCF Next 无法进入生存盒：${error?.message || String(error)}。请重新安装上一份可用 userscript。`;
    document.documentElement.append(host);
  } catch (_ignored) {}
});
