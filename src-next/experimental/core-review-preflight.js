'use strict';

const { nowIso, sanitizeState } = require('./core-review-storage');

function probeDynamicExecution(FunctionCtor = Function) {
  try {
    const fn = new FunctionCtor('return 0xDCF;');
    if (fn() !== 0xDCF) throw new Error('dynamic_execution_probe_result_invalid');
    return true;
  } catch (error) {
    const wrapped = new Error(`dynamic_execution_unavailable:${error?.message || String(error)}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function recordDynamicExecutionFailure(storage, error) {
  const state = sanitizeState(storage.getState(null));
  const at = nowIso();
  state.boot = {
    status: 'failed',
    attempt_id: `${Date.now()}-preflight`,
    started_at: at,
    completed_at: at,
    plugins: [],
    error: {
      stage: 'dynamic_execution',
      message: error?.message || String(error)
    }
  };
  state.force_recovery = true;
  state.recovery_reason = 'dynamic_execution_unavailable';
  storage.setState(state);
  return state;
}

function assertDynamicExecutionEnvironment({ storage, FunctionCtor = Function } = {}) {
  try {
    return probeDynamicExecution(FunctionCtor);
  } catch (error) {
    if (storage) recordDynamicExecutionFailure(storage, error);
    throw error;
  }
}

module.exports = {
  probeDynamicExecution,
  recordDynamicExecutionFailure,
  assertDynamicExecutionEnvironment
};
