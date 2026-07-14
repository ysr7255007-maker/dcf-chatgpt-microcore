'use strict';

const { VERSION, ROOT_KEY } = require('./core/constants');
const { clone, compareRevision } = require('./core/utils');
const { buildProjection } = require('./core/projection');
const { loadOrMigrate, addPackRevision, finalizeCandidate } = require('./core/state');
const { decodeArtifacts } = require('./core/artifacts');
const { createReceiptStore } = require('./core/receipts');
const { createTransactionEngine } = require('./core/transactions');
const { createStorage } = require('./runtime/storage');
const { createEffectRunner } = require('./runtime/effects');
const { createCommandRunner } = require('./runtime/commands');
const { createCapabilityReconciler } = require('./runtime/reconciler');
const { createChatGPTHost } = require('./host/chatgpt');
const { createConversationPerformanceController } = require('./host/conversation-performance');
const { createConversationTurnAttribution } = require('./host/conversation-turn-attribution');
const { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES } = require('./modules/standard-packages');
const { createAmmoModule } = require('./modules/ammo');
const { createCatalogTransport } = require('./modules/catalog');
const { createPackageManager } = require('./modules/package-manager');
const { createHealthReporter } = require('./modules/health');
const { createMaintenanceModule } = require('./modules/maintenance');
const { createApp } = require('./ui/app');

function activateEmbeddedRevision(candidate, pack) {
  const entry = candidate.packages.packages[pack.pack_id];
  const alreadyInstalled = !!(entry && entry.revisions && entry.revisions[pack.revision]);
  if (!alreadyInstalled) addPackRevision(candidate, pack, { kind: 'embedded-standard-bootstrap-sync', bootstrap_version: VERSION });
  const active = candidate.packages.packages[pack.pack_id];
  if (!active) throw new Error(`embedded package ${pack.pack_id}@${pack.revision} was not installed`);
  if (active.active_revision !== pack.revision || active.enabled === false) {
    active.active_revision = pack.revision;
    active.enabled = true;
    active.source = { kind: 'embedded-standard-bootstrap-sync', bootstrap_version: VERSION };
    if (alreadyInstalled) candidate.packages.revision += 1;
  }
}

function ensureProductBaseline(root, options = {}) {
  let current = root;
  const projection = buildProjection(current);
  const candidate = clone(current);
  const bootstrapChanged = options.bootstrapChanged === true;
  let changed = false;
  for (const packageId of REQUIRED_PRODUCT_PACKAGES) {
    const pack = STANDARD_PACKS.find((item) => item.pack_id === packageId);
    if (!pack) throw new Error(`required embedded package ${packageId} missing`);
    const entry = candidate.packages.packages[packageId];
    const resourceMissing = packageId === 'dcf.standard.ammo' && (!projection.ok || !projection.registry.contentTypes.ammo);
    const uiMissing = packageId === 'dcf.ui.package-management' && (!projection.ok || !projection.registry.uiViews || !projection.registry.uiViews.packages);
    const embeddedAhead = !!(bootstrapChanged && entry && compareRevision(pack.revision, entry.active_revision) > 0);
    if (!entry) {
      addPackRevision(candidate, pack, { kind: 'embedded-standard' });
      changed = true;
    } else if (embeddedAhead) {
      activateEmbeddedRevision(candidate, pack);
      changed = true;
    } else if (entry.enabled === false || resourceMissing || uiMissing) {
      entry.enabled = true;
      candidate.packages.revision += 1;
      changed = true;
    }
  }
  return changed ? finalizeCandidate(current, candidate) : current;
}

function boot(api = globalThis) {
  const windowObject = api.window || (typeof window !== 'undefined' ? window : null);
  const storage = createStorage(api);
  const persistedRoot = storage.get(ROOT_KEY, null);
  const previousKernelVersion = persistedRoot && persistedRoot.kernel_version || null;
  const bootstrapChanged = previousKernelVersion !== VERSION;
  const receiptStore = createReceiptStore(storage);
  let initialRoot = loadOrMigrate(storage, STANDARD_PACKS);
  initialRoot = ensureProductBaseline(initialRoot, { bootstrapChanged, previousKernelVersion });
  const engine = createTransactionEngine(storage, receiptStore, { initialRoot });
  engine.initialize();
  const host = createChatGPTHost(windowObject);
  const conversationPerformance = createConversationPerformanceController(windowObject, { findConversationRoot: host.findConversationRoot, isStreaming: host.isStreaming });
  conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});
  const conversationTurnAttribution = createConversationTurnAttribution(conversationPerformance, { windowObject });
  const effects = createEffectRunner(host, receiptStore, conversationPerformance, conversationTurnAttribution);
  const catalog = createCatalogTransport(storage, engine, api);
  const ammo = createAmmoModule(engine, effects);
  let app = null;
  const reconciler = createCapabilityReconciler(engine, catalog, receiptStore, {
    onCommitted: () => {
      conversationPerformance.syncPolicy(engine.getRegistry().policies && engine.getRegistry().policies.conversation_performance || {});
      if (app) app.render();
    }
  });
  catalog.setApplyResolved((resolved) => reconciler.applyResolved(resolved));
  const packageManager = createPackageManager(engine, catalog, reconciler);
  const health = createHealthReporter(engine, receiptStore, storage, host, REQUIRED_PRODUCT_PACKAGES, {
    windowObject,
    getApp: () => app,
    getRuntime: () => api.__DCF_RUNTIME__ || null,
    getPerformance: () => Object.assign({}, conversationPerformance.diagnostics(), { turn_attribution: conversationTurnAttribution.status() })
  });
  const maintenance = createMaintenanceModule(engine, receiptStore, effects, storage, health, reconciler);
  const commandRunner = createCommandRunner(engine, effects, receiptStore, () => {
    if (!app || !app.shell) return null;
    const rect = app.shell.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }, reconciler);
  app = createApp({
    engine, ammo, packageManager, maintenance, commandRunner, reconciler, storage, version: VERSION,
    getRuntimeUiState: () => ({
      conversation_performance: conversationPerformance.diagnostics(),
      conversation_turn_attribution: conversationTurnAttribution.status()
    })
  });

  async function processReply(reply) {
    const decoded = decodeArtifacts(reply.text);
    let changed = false;
    let referenced = false;
    for (const artifact of decoded.artifacts) {
      const result = await Promise.resolve(reconciler.accept(artifact, { kind: 'chatgpt-reply', completed_at: reply.completed_at }));
      if (result.status === 'committed') changed = true;
      if (result.input_mode === 'reference') referenced = true;
    }
    for (const error of decoded.errors) receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'artifact.decode', source: reply.source }, status: 'rejected', error: error.error, marker: error.marker, preview: error.preview });
    if (changed) app.setNotice(referenced ? 'DCF 已拉取并协调指定能力包' : 'DCF 工件已协调到当前 Runtime');
    if (changed || decoded.errors.length) app.render();
  }

  host.startSendObserver((signal) => {
    const state = conversationTurnAttribution.onSend(signal);
    if (state.accepted && app) app.refreshCommandStates();
  });
  host.startReplyObserver((reply) => {
    const completed = conversationTurnAttribution.onReplyComplete({ source: reply.source, completed_at: reply.completed_at, at_epoch_ms: reply.at_epoch_ms, quiet_ms: reply.quiet_ms });
    if (completed.completed && app) { app.setNotice('本轮问答归因已完成，可复制报告'); app.render(); }
    processReply(reply).catch((error) => receiptStore.append({ schema: 'dcf.receipt.v1', intent: { type: 'reply.reconcile' }, status: 'rejected', stage: 'runtime', error: String(error && error.message || error) }));
  }, {
    onReplyStart: (meta) => {
      const state = conversationTurnAttribution.onReplyStart(meta);
      if (state.accepted && app) app.refreshCommandStates();
    }
  });
  api.setTimeout(() => catalog.check({ force: bootstrapChanged }).then((result) => {
    if (result && result.applied && result.applied.length) {
      app.setNotice(bootstrapChanged ? 'DCF 已随底座升级自动协调能力包' : 'DCF 能力包已自动协调到最新版本');
      app.render();
    }
  }), 1600);

  if (typeof api.GM_registerMenuCommand === 'function') {
    api.GM_registerMenuCommand('DCF：检查能力包更新', () => catalog.check({ force: true }).then(() => app.render()));
    api.GM_registerMenuCommand('DCF：一键 Runtime 体检并复制', () => maintenance.copyHealthReport());
    api.GM_registerMenuCommand('DCF：复制简要诊断', () => maintenance.copySummary());
  }

  const runtime = {
    version: VERSION,
    bootstrap: { previous_kernel_version: previousKernelVersion, changed: bootstrapChanged },
    engine,
    getEnvironment: () => engine.getEnvironment(),
    host,
    conversationPerformance,
    conversationTurnAttribution,
    app,
    catalog,
    reconciler,
    receiptStore,
    health,
    maintenance
  };
  Object.defineProperty(runtime, 'environment', { enumerable: true, get: () => engine.getEnvironment() });
  api.__DCF_RUNTIME__ = runtime;
  return runtime;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot(globalThis);

module.exports = { boot, ensureProductBaseline };
