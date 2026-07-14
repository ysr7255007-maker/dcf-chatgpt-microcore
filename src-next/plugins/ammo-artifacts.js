'use strict';

const { isObject } = require('../core/utils');

const START = '<<<DCF_AMMO';
const END = 'DCF_AMMO>>>';
const LIBRARY_SCHEMA = 'dcf.language-ammo.library.v1';

function extractAmmoBlocks(text) {
  const source = String(text || '');
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(START, cursor);
    if (start < 0) break;
    const end = source.indexOf(END, start + START.length);
    if (end < 0) break;
    const bodyStart = source.indexOf('{', start + START.length);
    if (bodyStart >= 0 && bodyStart < end) blocks.push(source.slice(bodyStart, end).trim());
    cursor = end + END.length;
  }
  return blocks;
}

function normalizeAmmo(payload) {
  if (!isObject(payload) || !payload.id) throw new Error('DCF_AMMO requires id');
  return {
    id: String(payload.id),
    title: String(payload.title || payload.id),
    purpose: String(payload.purpose || ''),
    body: String(payload.body || ''),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    created_at: payload.created_at ? String(payload.created_at) : null,
    updated_at: payload.updated_at ? String(payload.updated_at) : null,
    source: payload.source ? String(payload.source) : null
  };
}

function decodeAmmoArtifacts(text) {
  const items = [];
  const errors = [];
  for (const block of extractAmmoBlocks(text)) {
    try { items.push(normalizeAmmo(JSON.parse(block))); }
    catch (error) { errors.push({ message: error?.message || String(error), length: block.length }); }
  }
  return { items, errors };
}

function portableAmmo(raw) {
  const item = normalizeAmmo(raw);
  const portable = {
    id: item.id,
    title: item.title,
    purpose: item.purpose,
    body: item.body,
    tags: item.tags
  };
  if (item.created_at) portable.created_at = item.created_at;
  if (item.updated_at) portable.updated_at = item.updated_at;
  return portable;
}

function encodeAmmoLibrary(items, exportedAt = new Date().toISOString()) {
  const values = (Array.isArray(items) ? items : Object.values(items || {}))
    .map(portableAmmo)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({
    schema: LIBRARY_SCHEMA,
    exported_at: String(exportedAt),
    count: values.length,
    items: values
  }, null, 2);
}

function decodeAmmoLibrary(text) {
  let payload;
  try { payload = JSON.parse(String(text || '')); }
  catch (_error) { throw new Error('language_ammo_library_invalid_json'); }
  if (!isObject(payload) || payload.schema !== LIBRARY_SCHEMA) throw new Error('language_ammo_library_schema_mismatch');
  if (!Array.isArray(payload.items)) throw new Error('language_ammo_library_items_required');
  const seen = new Set();
  const items = payload.items.map((raw) => {
    const item = normalizeAmmo(raw);
    if (seen.has(item.id)) throw new Error(`language_ammo_library_duplicate_id:${item.id}`);
    seen.add(item.id);
    return item;
  });
  return {
    schema: LIBRARY_SCHEMA,
    exported_at: payload.exported_at ? String(payload.exported_at) : null,
    items
  };
}

function comparableAmmo(raw) {
  const item = portableAmmo(raw);
  return JSON.stringify({
    id: item.id,
    title: item.title,
    purpose: item.purpose,
    body: item.body,
    tags: item.tags
  });
}

function classifyLibraryMerge(currentItems, incomingItems) {
  const current = currentItems || {};
  const result = { added: [], updated: [], unchanged: [] };
  for (const raw of incomingItems || []) {
    const item = normalizeAmmo(raw);
    const previous = current[item.id];
    if (!previous) result.added.push(item);
    else if (comparableAmmo(previous) === comparableAmmo(item)) result.unchanged.push(item);
    else result.updated.push(item);
  }
  return result;
}

function buildInvocation(item) {
  return ['〔DCF·语言弹药〕', '', String(item?.body || '')].join('\n');
}

function buildUpdateRequest(item) {
  return [
    '〔DCF·弹药更新〕',
    '',
    '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
    '- 保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
    '- 吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
    '- 这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。',
    '',
    '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。',
    '',
    '当前弹药：',
    JSON.stringify(item, null, 2)
  ].join('\n');
}

function buildExtractRequest() {
  return [
    '请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。',
    '先结合完整语境判断真正稳定、可迁移的认识，不要只摘录一句话。',
    '返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
  ].join('\n');
}

module.exports = {
  LIBRARY_SCHEMA,
  extractAmmoBlocks,
  normalizeAmmo,
  decodeAmmoArtifacts,
  encodeAmmoLibrary,
  decodeAmmoLibrary,
  classifyLibraryMerge,
  buildInvocation,
  buildUpdateRequest,
  buildExtractRequest
};
