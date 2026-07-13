'use strict';

const { clone, hash, isObject } = require('./utils');

const BLOCKS = [
  { marker: 'DCF_AMMO', type: 'ammo' },
  { marker: 'DCF_MODULE_PACK', type: 'package' },
  { marker: 'DCF_PACKAGE_UPDATE', type: 'package-reference' }
];

function extractBlocks(text, marker) {
  const source = String(text || '');
  const startToken = `<<<${marker}`;
  const endToken = `${marker}>>>`;
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(startToken, cursor);
    if (start < 0) break;
    const end = source.indexOf(endToken, start + startToken.length);
    if (end < 0) break;
    const bodyStart = source.indexOf('{', start + startToken.length);
    if (bodyStart < 0 || bodyStart >= end) { cursor = end + endToken.length; continue; }
    blocks.push(source.slice(bodyStart, end).trim());
    cursor = end + endToken.length;
  }
  return blocks;
}

function normalizeAmmo(payload) {
  if (!isObject(payload) || !payload.id) throw new Error('DCF_AMMO requires id');
  const item = clone(payload);
  item.id = String(item.id);
  item.title = String(item.title || item.id);
  item.body = String(item.body || '');
  return {
    schema: 'dcf.artifact.v1',
    type: 'ammo',
    identity: `ammo:${item.id}:${hash(item)}`,
    logical_id: `ammo:${item.id}`,
    payload: item
  };
}

function normalizePackage(payload) {
  if (!isObject(payload) || !(payload.pack_id || payload.package_id) || !payload.revision) throw new Error('DCF_MODULE_PACK requires pack_id and revision');
  const pack = clone(payload);
  pack.pack_id = String(pack.pack_id || pack.package_id);
  pack.revision = String(pack.revision);
  pack.schema = pack.schema || 'dcf.module_pack.v1';
  const contentHash = hash(pack);
  return {
    schema: 'dcf.artifact.v1',
    type: 'package',
    identity: `package:${pack.pack_id}:${pack.revision}:${contentHash}`,
    logical_id: `package:${pack.pack_id}:${pack.revision}`,
    payload: pack
  };
}

function normalizePackageReference(payload) {
  if (!isObject(payload) || !(payload.package_id || payload.pack_id)) throw new Error('DCF_PACKAGE_UPDATE requires package_id');
  const reference = {
    schema: 'dcf.package.reference.v1',
    package_id: String(payload.package_id || payload.pack_id),
    target: String(payload.target || payload.revision || 'latest'),
    channel: String(payload.channel || 'stable')
  };
  if (payload.catalog_url) reference.catalog_url = String(payload.catalog_url);
  return {
    schema: 'dcf.artifact.v1',
    type: 'package-reference',
    identity: `package-reference:${hash(reference)}`,
    logical_id: `package-reference:${reference.package_id}:${reference.target}`,
    payload: reference
  };
}

function decodeArtifacts(text) {
  const artifacts = [];
  const errors = [];
  for (const block of BLOCKS) {
    for (const raw of extractBlocks(text, block.marker)) {
      const trimmed = raw.trim();
      if (!trimmed || /^(?:\.\.\.|…+|placeholder|example)$/i.test(trimmed)) continue;
      if (!trimmed.startsWith('{') || !/["'](?:schema|id|pack_id|package_id)["']\s*:/.test(trimmed)) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (block.type === 'ammo') artifacts.push(normalizeAmmo(payload));
        else if (block.type === 'package') artifacts.push(normalizePackage(payload));
        else artifacts.push(normalizePackageReference(payload));
      } catch (error) {
        errors.push({ marker: block.marker, error: String(error && error.message || error), preview: { redacted: true, length: raw.length, hash: hash(raw) } });
      }
    }
  }
  return { artifacts, errors };
}

module.exports = { decodeArtifacts, normalizeAmmo, normalizePackage, normalizePackageReference, extractBlocks };
