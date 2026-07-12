'use strict';

const { CATALOG_URL, CATALOG_STATE_KEY } = require('../core/constants');
const { compareRevision, hash, nowIso } = require('../core/utils');
const { normalizePackage } = require('../core/artifacts');

function createCatalogTransport(storage, engine, api = globalThis) {
  function requestJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof api.GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest unavailable'));
      api.GM_xmlhttpRequest({
        method: 'GET', url,
        onload(response) {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`HTTP ${response.status}`));
          try { resolve(JSON.parse(response.responseText)); } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('network timeout'))
      });
    });
  }

  async function check(options = {}) {
    const currentState = storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null });
    const minInterval = Number(options.minIntervalMs || 6 * 60 * 60 * 1000);
    if (!options.force && currentState.last_checked_at && Date.now() - Date.parse(currentState.last_checked_at) < minInterval) {
      return { ok: true, skipped: true, reason: 'interval' };
    }
    try {
      const catalog = await requestJson(options.url || CATALOG_URL);
      if (!catalog || catalog.schema !== 'dcf.catalog.v1' || !Array.isArray(catalog.packages)) throw new Error('invalid catalog');
      const installed = engine.getRoot().packages.packages;
      const applied = [];
      for (const entry of catalog.packages) {
        const local = installed[entry.package_id];
        if (!local || local.enabled === false) continue;
        if (compareRevision(entry.revision, local.active_revision) <= 0) continue;
        const pack = await requestJson(entry.url);
        const expected = String(entry.hash || '');
        const actual = hash(pack);
        if (expected && expected !== actual) throw new Error(`catalog hash mismatch ${entry.package_id}@${entry.revision}`);
        const artifact = normalizePackage(pack);
        const receipt = engine.applyArtifact(artifact, { kind: 'github-catalog', url: entry.url });
        applied.push({ package_id: entry.package_id, revision: entry.revision, status: receipt.status });
      }
      const result = { ok: true, skipped: false, applied };
      storage.set(CATALOG_STATE_KEY, { last_checked_at: nowIso(), last_result: result });
      return result;
    } catch (error) {
      const result = { ok: false, error: String(error && error.message || error) };
      storage.set(CATALOG_STATE_KEY, { last_checked_at: nowIso(), last_result: result });
      return result;
    }
  }

  return { check };
}

module.exports = { createCatalogTransport };
