'use strict';
(function initHostProduct(root) {
  const H = root.DCFHost;
  const C = H.C;
  const REMOTE_INDEX = 'https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/releases/chrome/official-index.json';
  const TRUSTED_REMOTE_ORIGIN = 'https://raw.githubusercontent.com';

  H.upsertAmmo = async function upsertAmmo(item, source) {
    return H.mutate(async (state) => {
      const normalized = C.normalizeAmmo(item);
      const previous = state.product.ammo[normalized.id];
      const record = await C.ammoRecord(normalized, previous);
      state.product.ammo[normalized.id] = record;
      C.appendEvidence(state, { type: previous ? 'ammo.updated' : 'ammo.created', item_id: normalized.id, content_hash: record._meta.content_hash, source: source || 'unknown' });
      return record;
    });
  };

  H.ingestAmmoText = async function ingestAmmoText(text, source) {
    const decoded = C.decodeAmmoArtifacts(text);
    const results = [];
    for (const item of decoded.items) results.push((await H.upsertAmmo(item, source)).result);
    if (decoded.errors.length) await H.mutate(async (state) => C.appendEvidence(state, { type: 'ammo.ingest.errors', count: decoded.errors.length, detail: decoded.errors.join('; ') }));
    return { imported: results.length, items: results.map((item) => ({ id: item.id, version: item._meta.version, hash: item._meta.content_hash })), errors: decoded.errors };
  };

  H.importLegacy = async function importLegacy(payload) {
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    const settings = payload && payload.settings || {};
    const normalized = items.map(C.normalizeAmmo);
    const unique = new Map(normalized.map((item) => [item.id, item]));
    if (unique.size !== normalized.length) throw new Error('legacy migration contains duplicate ammo ids');
    return H.mutate(async (state) => {
      let imported = 0;
      let updated = 0;
      const conflicts = [];
      for (const item of unique.values()) {
        const existing = state.product.ammo[item.id];
        const incomingHash = await C.sha256Text(C.canonicalJson(item));
        if (existing && existing._meta && existing._meta.content_hash !== incomingHash) { conflicts.push(item.id); continue; }
        const record = await C.ammoRecord(item, existing);
        state.product.ammo[item.id] = record;
        if (existing) updated += 1; else imported += 1;
      }
      if (settings.ammo_fire_mode === 'send' || settings.ammo_fire_mode === 'insert') state.product.settings.ammo_fire_mode = settings.ammo_fire_mode;
      if (C.isObject(settings.appearance)) state.product.settings.appearance = C.clone(settings.appearance);
      const result = {
        schema: 'dcf.legacy.migration.result.v1', at: C.nowIso(), source_count: items.length, unique_source_count: unique.size,
        imported, updated, conflicts, target_count: Object.keys(state.product.ammo).length,
        verified_ids: [...unique.keys()].filter((id) => !!state.product.ammo[id]),
        status: conflicts.length ? 'partial' : items.length === unique.size ? 'success' : 'failed'
      };
      state.product.migration = { status: result.status, last_result: result };
      C.appendEvidence(state, { type: 'legacy.migration', result });
      return result;
    });
  };

  H.checkRemoteUpdates = async function checkRemoteUpdates() {
    const checkedAt = C.nowIso();
    try {
      const indexUrl = new URL(REMOTE_INDEX);
      if (indexUrl.origin !== TRUSTED_REMOTE_ORIGIN) throw new Error('untrusted official index origin');
      const response = await fetch(indexUrl.href, { cache: 'no-store' });
      if (!response.ok) throw new Error(`official index HTTP ${response.status}`);
      const index = await response.json();
      if (!index || index.schema !== 'dcf.code_unit_index.v1' || !Array.isArray(index.units)) throw new Error('invalid official index');
      const downloaded = [];
      for (const ref of index.units) {
        const url = new URL(String(ref.code_url || ''));
        if (url.origin !== TRUSTED_REMOTE_ORIGIN) throw new Error(`untrusted unit origin ${url.origin}`);
        const unitResponse = await fetch(url.href, { cache: 'no-store' });
        if (!unitResponse.ok) throw new Error(`unit ${ref.id} HTTP ${unitResponse.status}`);
        const code = await unitResponse.text();
        const unit = await C.verifyUnit({
          schema: 'dcf.code_unit.v1', id: ref.id, version: ref.version, title: ref.title, description: ref.description,
          code, hash: ref.hash, source: { kind: 'official-github', release: index.version, code_url: url.href },
          matches: ref.matches, run_at: ref.run_at, world: 'USER_SCRIPT', world_id: ref.world_id,
          host_api: ref.host_api, phase: ref.phase, required: ref.required
        });
        downloaded.push(unit);
      }
      await H.mutate(async (state) => {
        for (const unit of downloaded) C.storeUnit(state, unit);
        state.update = { last_checked_at: checkedAt, last_result: { status: 'downloaded', units: downloaded.map((unit) => C.unitKey(unit.id, unit.version)) } };
      });
      await H.stageSnapshotFromVersions(Object.fromEntries(downloaded.map((unit) => [unit.id, unit.version])), 'official-remote-update');
      return { ok: true, downloaded: downloaded.length, activation: await H.reconcileTarget('official-remote-update') };
    } catch (error) {
      const message = String(error && error.message || error);
      await H.mutate(async (state) => { state.update = { last_checked_at: checkedAt, last_result: { status: 'failed', error: message } }; });
      return { ok: false, error: message };
    }
  };
})(self);
