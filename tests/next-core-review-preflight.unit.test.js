'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  createCoreStorage,
  probeDynamicExecution,
  assertDynamicExecutionEnvironment
} = require('../src-next/experimental/core-review');

function memoryStorage() {
  const values = new Map();
  return createCoreStorage({
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))),
    deleteValue: (key) => values.delete(key),
    listValues: () => Array.from(values.keys())
  });
}

assert.equal(probeDynamicExecution(Function), true);
function BlockedFunction() { throw new Error('blocked-by-csp'); }
assert.throws(() => probeDynamicExecution(BlockedFunction), /dynamic_execution_unavailable:blocked-by-csp/);

const storage = memoryStorage();
assert.throws(
  () => assertDynamicExecutionEnvironment({ storage, FunctionCtor: BlockedFunction }),
  /dynamic_execution_unavailable:blocked-by-csp/
);
const state = storage.getState(null);
assert.equal(state.force_recovery, true);
assert.equal(state.recovery_reason, 'dynamic_execution_unavailable');
assert.equal(state.boot.error.stage, 'dynamic_execution');
assert.deepEqual(state.boot.plugins, []);

const generated = fs.readFileSync('dcf-chatgpt-next-core-review.user.js', 'utf8');
assert(generated.includes('// @sandbox      DOM'));
assert(generated.includes('// @version      0.1.0-alpha.2'));

console.log('next core review preflight tests passed');
