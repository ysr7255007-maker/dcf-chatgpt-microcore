'use strict';

const { CATALOG_URL, CATALOG_STATE_KEY } = require('../core/constants');
const { compareRevision, hash, nowIso } = require('../core/utils');
const { normalizePackage } = require('../core/artifacts');

function createCatalogTransport(storage, engine, api = globalThis) {
  let applyResolved = (resolved) => engine.applyArtifact(resolved.artifact, resolved.source);

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

  function validateCatalog(catalog) {
    if (!catalog || catalog.schema !== 'dcf.catalog.v1' || !Array.isArray(catalog.packages)) throw new Error('invalid catalog');
    return catalog;
  }

  async function loadCatalog(options = {}) {
    const url = options.url || CATALOG_URL;
    return { url, catalog: validateCatalog(await requestJson(url)) };
  }

  function selectEntry(catalog, reference) {
    const packageId = String(reference.package_id || '');
    const channel = String(reference.channel || 'stable');
    const target = String(reference.target || 'latest');
    const matches = catalog.packages.filter((entry) => String(entry.package_id) === packageId && String(entry.channel || 'stable') === channel);
    if (!matches.length) throw new Error(`catalog package ${packageId} not found on ${channel}`);
    if (target !== 'latest' && target !== 'stable') {
      const exact = matches.find((entry) => String(entry.revision) === target);
      if (!exact) throw new Error(`catalog package revision ${packageId}@${target} not found`);
      return exact;
    }
    return matches.slice().sort((a, b) => compareRevision(b.revision, a.revision))[0];
  }

  async function resolveFromCatalog(catalogInfo, reference) {
    const entry = selectEntry(catalogInfo.catalog, reference);
    const pack = await requestJson(entry.url);
    const expected = String(entry.hash || '');
    const actual = hash(pack);
    if (expected && expected !== actual) throw new Error(`catalog hash mismatch ${entry.package_id}@${entry.revision}`);
    const artifact = normalizePackage(pack);
    if (artifact.payload.pack_id !== String(entry.package_id) || artifact.payload.revision !== String(entry.revision)) {
      throw new Error(`catalog identity mismatch ${entry.package_id}@${entry.revision}`);
    }
    return {
      schema: 'dcf.resolved.artifact.v1',
      input_mode: 'reference',
      artifact,
      reference: Object.assign({}, reference),
      catalog_entry: { package_id: entry.package_id, revision: entry.revision, channel: entry.channel || 'stable', hash: expected },
      source: { kind: 'github-catalog-reference', catalog_url: catalogInfo.url, package_url: entry.url }
    };
  }

  async function resolve(reference, options = {}) {
    if (reference.catalog_url && !options.url && reference.catalog_url !== CATALOG_URL) throw new Error('untrusted catalog_url');
    const catalogInfo = await loadCatalog({ url: options.url || reference.catalog_url || CATALOG_URL });
    return resolveFromCatalog(catalogInfo, reference);
  }

  async function check(options = {}) {
    const currentState = storage.get(CATALOG_STATE_KEY, { last_checked_at: null, last_result: null });
    const minInterval = Number(options.minIntervalMs || 6 * 60 * 60 * 1000);
    if (!options.force && currentState.last_checked_at && Date.now() - Date.parse(currentState.last_checked_at) < minInterval) {
      return { ok: true, skipped: true, reason: 'interval' };
    }
    try {
      const catalogInfo = await loadCatalog({ url: options.url || CATALOG_URL });
      const installed = engine.getRoot().packages.packages;
      const applied = [];
      for (const local of Object.values(installed)) {
        if (!local || local.enabled === false) continue;
        let resolved;
        try {
          resolved = await resolveFromCatalog(catalogInfo, { package_id: local.package_id, target: 'latest', channel: 'stable' });
        } catch (error) {
          if (/not found/.test(String(error && error.message || error))) continue;
          throw error;
        }
        if (compareRevision(resolved.artifact.payload.revision, local.active_revision) <= 0) continue;
        const result = await Promise.resolve(applyResolved(resolved));
        applied.push({ package_id: local.package_id, revision: resolved.artifact.payload.revision, status: result && result.status || result && result.receipt && result.receipt.status || null });
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

  function setApplyResolved(handler) {
    if (typeof handler === 'function') applyResolved = handler;
  }

  return { check, resolve, loadCatalog, setApplyResolved };
}

module.exports = { createCatalogTransport };
