'use strict';
(function initHostProduct(root) {
  const H = root.DCFHost;
  const C = H.C;
  const TRUSTED_REMOTE_ORIGIN = 'https://raw.githubusercontent.com';
  const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let configPromise = null;

  H.loadConfig = function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(chrome.runtime.getURL('config.json')).then((response) => {
        if (!response.ok) throw new Error(`config HTTP ${response.status}`);
        return response.json();
      });
    }
    return configPromise;
  };

  H.fetchPluginIndex = async function fetchPluginIndex() {
    const config = await H.loadConfig();
    const url = new URL(String(config.plugin_index_url || ''));
    if (url.origin !== TRUSTED_REMOTE_ORIGIN) throw new Error(`untrusted plugin index origin ${url.origin}`);
    const response = await fetch(url.href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`plugin index HTTP ${response.status}`);
    const index = await response.json();
    if (!index || !['dcf.plugin_index.v1', 'dcf.plugin_index.v2'].includes(index.schema) || !Array.isArray(index.units)) {
      throw new Error('invalid plugin index');
    }
    return { index, url: url.href };
  };

  H.downloadIndexUnits = async function downloadIndexUnits(index) {
    const units = [];
    for (const ref of index.units) {
      const url = new URL(String(ref.code_url || ''));
      if (url.origin !== TRUSTED_REMOTE_ORIGIN) throw new Error(`untrusted plugin origin ${url.origin}`);
      const response = await fetch(url.href, { cache: 'no-store' });
      if (!response.ok) throw new Error(`plugin ${ref.id} HTTP ${response.status}`);
      const code = await response.text();
      units.push(await C.verifyUnit({
        id: ref.id,
        version: ref.version,
        title: ref.title,
        description: ref.description,
        code,
        hash: ref.hash,
        source: {
          kind: 'github-personal-plugin-library',
          index_version: index.version,
          index_snapshot_id: index.default_snapshot && index.default_snapshot.id || null,
          code_url: url.href
        },
        matches: ref.matches,
        run_at: ref.run_at,
        world_id: ref.world_id,
        host_api: ref.host_api,
        phase: ref.phase,
        required: ref.required,
        default_enabled: ref.default_enabled
      }));
    }
    return units;
  };

  H.checkRemoteUpdates = async function checkRemoteUpdates(reason = 'user', options = {}) {
    const checkedAt = C.nowIso();
    try {
      const { index, url } = await H.fetchPluginIndex();
      const units = await H.downloadIndexUnits(index);
      const state = await H.storageGet();
      const target = state.desired.snapshot || state.committed.current;
      const changed = units.filter((unit) => {
        const current = target && target.entries.find((entry) => entry.id === unit.id);
        return !current || current.version !== unit.version || current.hash !== unit.hash;
      });

      await H.mutate(async (next) => {
        for (const unit of units) C.storeUnit(next, unit);
        next.update.plugins = {
          last_checked_at: checkedAt,
          last_result: {
            status: changed.length ? 'downloaded' : 'current',
            reason,
            index_url: url,
            index_version: index.version,
            index_snapshot_id: index.default_snapshot && index.default_snapshot.id || null,
            changed: changed.map((unit) => C.unitRefKey(unit))
          }
        };
        C.appendEvidence(next, {
          type: 'plugin.update.checked',
          reason,
          changed: changed.map((unit) => C.unitRefKey(unit)),
          index_version: index.version,
          index_snapshot_id: index.default_snapshot && index.default_snapshot.id || null
        });
      });

      const refreshed = await H.storageGet();
      const noCommittedState = !refreshed.committed.current && !refreshed.committed.last_known_good && !refreshed.desired.snapshot;
      if (noCommittedState) {
        await H.stageSnapshotFromVersions(
          Object.fromEntries(units.map((unit) => [unit.id, { version: unit.version, hash: unit.hash }])),
          'first-install-github-default',
          { replace: true, writer_id: 'dcf.chrome.first-install' }
        );
        const activation = await H.reconcile('first-install-github-default', {
          preferred_tab_id: options.preferred_tab_id,
          retry_failed: true,
          writer_id: 'dcf.chrome.first-install'
        });
        return {
          ok: activation.ok,
          status: activation.status === 'committed' ? 'installed_default' : activation.status,
          downloaded: units.length,
          activation
        };
      }

      if (!changed.length) {
        const activation = await H.reconcile('github-index-current', {
          preferred_tab_id: options.preferred_tab_id,
          writer_id: 'dcf.chrome.update'
        });
        return {
          ok: activation.ok,
          status: activation.status === 'converged' || activation.status === 'no_desired_snapshot' ? 'current' : activation.status,
          downloaded: 0,
          activation
        };
      }

      await H.stageSnapshotFromVersions(
        Object.fromEntries(changed.map((unit) => [unit.id, { version: unit.version, hash: unit.hash }])),
        'github-plugin-update',
        { writer_id: 'dcf.chrome.update' }
      );
      const activation = await H.reconcile('github-plugin-update', {
        preferred_tab_id: options.preferred_tab_id,
        retry_failed: true,
        writer_id: 'dcf.chrome.update'
      });
      return {
        ok: activation.ok,
        status: activation.status === 'committed' ? 'committed' : activation.status,
        downloaded: changed.length,
        activation
      };
    } catch (error) {
      const message = String(error && error.message || error);
      await H.mutate(async (state) => {
        state.update.plugins = {
          last_checked_at: checkedAt,
          last_result: { status: 'failed', reason, error: message }
        };
        C.appendEvidence(state, {
          type: 'plugin.update.failed',
          reason,
          detail: message
        });
      });
      return { ok: false, status: 'failed', error: message };
    }
  };

  H.maybeCheckRemoteUpdates = async function maybeCheckRemoteUpdates(reason) {
    const state = await H.storageGet();
    const last = Date.parse(state.update.plugins.last_checked_at || 0) || 0;
    if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return { ok: true, status: 'throttled' };
    return H.checkRemoteUpdates(reason || 'automatic');
  };

  H.checkBaseUpdate = async function checkBaseUpdate() {
    const checkedAt = C.nowIso();
    try {
      if (typeof chrome.runtime.requestUpdateCheck !== 'function') throw new Error('base_update_check_unavailable');
      const result = await chrome.runtime.requestUpdateCheck();
      await H.mutate(async (state) => {
        state.update.base = {
          last_checked_at: checkedAt,
          available_version: result && result.version || null,
          last_result: C.clone(result || { status: 'unknown' })
        };
        C.appendEvidence(state, {
          type: 'base.update.checked',
          result: C.clone(result || {})
        });
      });
      return { ok: true, result };
    } catch (error) {
      const message = String(error && error.message || error);
      await H.mutate(async (state) => {
        state.update.base = {
          ...state.update.base,
          last_checked_at: checkedAt,
          last_result: { status: 'failed', error: message }
        };
      });
      return { ok: false, error: message };
    }
  };

  H.importNextMigration = async function importNextMigration(payload) {
    if (!payload || payload.schema !== 'dcf.next.dom-export.v1') throw new Error('invalid_next_migration');
    const items = Array.isArray(payload.items) ? payload.items : [];
    const unique = new Map();
    for (const raw of items) {
      if (!raw || !String(raw.id || '').trim() || !String(raw.body || '').trim()) throw new Error('invalid_next_ammo_item');
      const item = {
        id: String(raw.id).trim(),
        title: String(raw.title || raw.id).trim(),
        purpose: String(raw.purpose || '').trim(),
        body: String(raw.body).trim()
      };
      const tags = Array.isArray(raw.tags) ? raw.tags.map(String).map((value) => value.trim()).filter(Boolean) : [];
      if (tags.length) item.tags = tags;
      unique.set(item.id, item);
    }
    return H.mutate(async (state) => {
      const ammoData = C.isObject(state.plugin_data['dcf.firstparty.ammo']) ? state.plugin_data['dcf.firstparty.ammo'] : {};
      const currentItems = C.isObject(ammoData.items) ? ammoData.items : {};
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      for (const [id, item] of unique) {
        const existing = currentItems[id];
        if (!existing) {
          currentItems[id] = item;
          added += 1;
        } else if (C.canonicalJson(existing) === C.canonicalJson(item)) {
          unchanged += 1;
        } else {
          currentItems[id] = item;
          updated += 1;
        }
      }
      state.plugin_data['dcf.firstparty.ammo'] = {
        ...ammoData,
        items: currentItems,
        settings: {
          ...(C.isObject(ammoData.settings) ? ammoData.settings : {}),
          fire_mode: payload.settings && payload.settings.fire_mode === 'send' ? 'send' : 'insert'
        }
      };
      if (C.isObject(payload.appearance)) {
        state.plugin_data['dcf.firstparty.appearance'] = {
          ...(C.isObject(state.plugin_data['dcf.firstparty.appearance']) ? state.plugin_data['dcf.firstparty.appearance'] : {}),
          ...C.clone(payload.appearance)
        };
      }
      const result = {
        status: 'success',
        at: C.nowIso(),
        source_count: items.length,
        added,
        updated,
        unchanged,
        target_count: Object.keys(currentItems).length
      };
      state.migration.next = { status: 'success', last_result: result };
      C.appendEvidence(state, { type: 'next.migration', result });
      return result;
    });
  };

  H.statusPayload = async function statusPayload() {
    const state = await H.storageGet();
    let scripts = [];
    let available = true;
    try {
      scripts = await H.actualDcfScripts();
      await H.observeRegistrations(true, scripts, null);
    } catch (_) {
      available = false;
      await H.observeRegistrations(false, [], null).catch(() => undefined);
    }
    const refreshed = await H.storageGet();
    return {
      ok: true,
      host_version: C.HOST_VERSION,
      user_scripts_available: available,
      state_revision: refreshed.revision,
      desired: C.clone(refreshed.desired),
      committed: C.clone(refreshed.committed),
      observed: C.clone(refreshed.observed),
      snapshots: C.compatibilitySnapshots(refreshed),
      code_units: C.installedUnitVersions(refreshed),
      actual_scripts: scripts.map((item) => item.id),
      migration: C.clone(refreshed.migration),
      update: C.clone(refreshed.update),
      plugin_ids: Object.keys(refreshed.plugin_data).sort(),
      activation_records: C.clone(refreshed.activation_records.slice(-12)),
      reconcile_records: C.clone(refreshed.reconcile_records.slice(-20))
    };
  };
})(self);
