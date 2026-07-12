'use strict';

const { VERSION } = require('./core/constants');
const { clone } = require('./core/utils');
const { buildProjection } = require('./core/projection');
const { loadOrMigrate, addPackRevision, finalizeCandidate } = require('./core/state');
const { decodeArtifacts } = require('./core/artifacts');
const { createReceiptStore } = require('./core/receipts');
const { createTransactionEngine } = require('./core/transactions');
const { createStorage } = require('./runtime/storage');
const { createEffectRunner } = require('./runtime/effects');
const { createCommandRunner } = require('./runtime/commands');
const { createChatGPTHost } = require('./host/chatgpt');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('./modules/standard-packages');
const { createAmmoModule } = require('./modules/ammo');
const { createCatalogTransport } = require('./modules/catalog');
const { createPackageManager } = require('./modules/package-manager');
const { createHealthReporter } = require('./modules/health');
const { createMaintenanceModule } = require('./modules/maintenance');
const { createApp } = require('./ui/app');

function ensureProductBaseline(root) {
  let current = root;
  const ammoPack = STANDARD_PACKS.find((pack) => pack.pack_id === REQUIRED_PRODUCT_PACKAGES[0]);
  const entry = current.packages.packages[ammoPack.pack_id];
  const projection = buildProjection(current);
  const needsAmmo = !projection.ok || !projection.registry.contentTypes.ammo || !entry || entry.enabled === false;
  if (!needsAmmo) return current;
  const candidate = clone(current);
  if (!entry) addPackRevision(candidate, ammoPack, { kind: 'embedded-standard' });
  else {
    candidate.packages.packages[ammoPack.pack_id].enabled = true;
    candidate.packages.revision += 1;
  }
  return finalizeCandidate(current, candidate);
}

function boot(api = globalThis) {
  const storage = createStorage(api);
  const receiptStore = createReceiptStore(storage);
  let initialRoot = loadOrMigrate(storage, STANDARD_PACKS);
  initialRoot = ensureProductBaseline(initialRoot);
  const engine = createTransactionEngine(storage, receiptStore, { initialRoot });
  engine.initialize();
  const host = createChatGPTHost(api.window || window);
  const effects = createEffectRunner(host, receiptStore);
  const catalog = createCatalogTransport(storage, engine, api);
  const ammo = createAmmoModule(engine, effects);
  const packageManager = createPackageManager(engine, catalog);
  const health = createHealthReporter(engine, receiptStore, storage, host, REQUIRED_PRODUCT_PACKAGES);
  const maintenance = createMaintenanceModule(engine, receiptStore, effects, storage, health);
  let app = null;
  const commandRunner = createCommandRunner(engine, effects, receiptStore, () => {
    if (!app || !app.shell) return null;
    const rect = app.shell.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
  app = createApp({ engine, ammo, packageManager, maintenance, commandRunner, storage, version: VERSION });

  function processReply(reply) {
    const decoded = decodeArtifacts(reply.text);
    let changed = false;
    for (const artifact of decoded.artifacts) {
      const receipt = engine.applyArtifact(artifact, { kind: 'chatgpt-reply', completed_at: reply.completed_at });
      if (receipt.status === 'committed') changed = true;
    }
    for (const error of decoded.errors) receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'artifact.decode', source: reply.source }, status: 'rejected', error: error.error, marker: error.marker, preview: error.preview });
    if (changed) app.setNotice('DCF 工件已自动应用');
    if (changed || decoded.errors.length) app.render();
  }

  host.startReplyObserver(processReply);
  api.setTimeout(() => catalog.check().then((result) => { if (result && result.applied && result.applied.length) { app.setNotice('DCF 模块已自动更新'); app.render(); } }), 1600);

  if (typeof api.GM_registerMenuCommand === 'function') {
    api.GM_registerMenuCommand('DCF：检查模块更新', () => catalog.check({ force: true }).then(() => app.render()));
    api.GM_registerMenuCommand('DCF：一键体检并复制', () => maintenance.copyHealthReport());
    api.GM_registerMenuCommand('DCF：复制简要诊断', () => maintenance.copySummary());
  }

  api.__DCF_RUNTIME__ = { version: VERSION, engine, host, app, catalog, receiptStore, health };
  return api.__DCF_RUNTIME__;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot(globalThis);

module.exports = { boot, ensureProductBaseline };