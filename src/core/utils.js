'use strict';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergeShallow(base, extra) {
  return Object.assign({}, isObject(base) ? base : {}, isObject(extra) ? extra : {});
}

function deepMerge(base, extra) {
  if (!isObject(base)) return clone(extra);
  const out = clone(base);
  if (!isObject(extra)) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

function boundedPush(list, value, limit) {
  const out = Array.isArray(list) ? list.slice() : [];
  out.push(value);
  return out.slice(-Math.max(1, Number(limit) || 1));
}

function compareRevision(a, b) {
  const tokenize = (value) => String(value || '').split(/[._-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const aa = tokenize(a);
  const bb = tokenize(b);
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) {
    const av = aa[i] == null ? 0 : aa[i];
    const bv = bb[i] == null ? 0 : bb[i];
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av > bv ? 1 : -1;
    return String(av).localeCompare(String(bv));
  }
  return 0;
}

module.exports = {
  isObject,
  clone,
  mergeShallow,
  deepMerge,
  stableStringify,
  hash,
  nowIso,
  safeId,
  boundedPush,
  compareRevision
};
