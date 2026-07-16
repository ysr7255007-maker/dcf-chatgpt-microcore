'use strict';

const constants = require('./core-review-constants');
const storage = require('./core-review-storage');
const modules = require('./core-review-modules');
const pack = require('./core-review-pack');
const { createCoreReview } = require('./core-review-runtime');

async function main() {
  const core = createCoreReview();
  const result = await core.boot();
  globalThis.DCF_CORE_REVIEW = Object.freeze({
    version: constants.CORE_REVIEW_VERSION,
    result,
    state: core.state,
    importBundle: core.importBundle,
    activateRecommendation: core.activateRecommendation,
    setManifest: core.setManifest,
    runtime: core.runtime,
    showRecovery: () => core.renderRecovery('manual')
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  main().catch((error) => {
    console.error('[DCF Core Review fatal]', error);
    try {
      const host = document.createElement('pre');
      host.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;max-width:520px;background:#8b1e1e;color:#fff;padding:12px;border-radius:8px;white-space:pre-wrap';
      host.textContent = `DCF Core Review fatal: ${error?.message || String(error)}`;
      document.documentElement.append(host);
    } catch (_ignored) {}
  });
}

module.exports = { ...constants, ...storage, ...modules, ...pack, createCoreReview };
