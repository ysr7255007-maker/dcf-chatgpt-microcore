'use strict';

const { RECEIPT_KEY } = require('./constants');
const { boundedPush, clone, nowIso } = require('./utils');

function createReceiptStore(storage, limit = 80) {
  function list() {
    const value = storage.get(RECEIPT_KEY, []);
    return Array.isArray(value) ? value : [];
  }
  function append(receipt) {
    const safe = clone(receipt);
    safe.at = safe.at || nowIso();
    storage.set(RECEIPT_KEY, boundedPush(list(), safe, limit));
    return safe;
  }
  function clear() {
    storage.set(RECEIPT_KEY, []);
  }
  return { list, append, clear };
}

module.exports = { createReceiptStore };
