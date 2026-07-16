(function () {
  'use strict';
  const UNIT_ID = 'dcf.firstparty.diagnostics';
  const UNIT_VERSION = '1.0.0-rc.1';
  if (globalThis.__DCF_FIRSTPARTY_DIAGNOSTICS__) {
    chrome.runtime.sendMessage({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }).catch(() => undefined);
    return;
  }
  globalThis.__DCF_FIRSTPARTY_DIAGNOSTICS__ = { version: UNIT_VERSION, started_at: new Date().toISOString() };
  try {
    if (!document.documentElement) throw new Error('document root unavailable');
    chrome.runtime.sendMessage({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }).catch(() => undefined);
  } catch (error) {
    chrome.runtime.sendMessage({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error && error.message || error) }).catch(() => undefined);
  }
})();
