'use strict';
(function initHostRuntime(root) {
  const H = root.DCFHost;
  H.runtimeControl = H.runtimeControl || {
    CANARY_TIMEOUT_MINUTES: 2,
    EXECUTE_TIMEOUT_MS: 8000,
    TAB_READY_TIMEOUT_MS: 30000,
    ACTIVE_RUNTIME_STATUSES: new Set(['loaded', 'ready', 'degraded']),
    reconcileQueue: Promise.resolve()
  };
})(self);
