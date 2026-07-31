import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAnchor } from './anchors.js';
import { queryFactsByOverlap } from './facts.js';

const COMPILER_VERSION = 'evidence-bundle-v1';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function classify(fact, anchor) {
  const isBoundary = fact.event_id === anchor.before_event_id || fact.event_id === anchor.after_event_id;
  const inside = fact.start_ms <= anchor.end_ms && fact.end_ms >= anchor.start_ms;
  const isBehavior = fact.kind === 'user.text.output' || fact.kind === 'user.control.click';
  let tier = 'context';
  if (isBoundary || (inside && isBehavior)) tier = 'core';
  else if (inside) tier = 'direct';
  let relation = 'nearby';
  if (fact.event_id === anchor.before_event_id) relation = 'before-output';
  else if (fact.event_id === anchor.after_event_id) relation = 'after-output';
  else if (inside) relation = 'transition-window';
  else if (fact.end_ms < anchor.start_ms) relation = 'before-context';
  else relation = 'after-context';
  return { tier, relation };
}

function memberView(fact, anchor) {
  const classification = classify(fact, anchor);
  return {
    event_id: fact.event_id,
    source: fact.source,
    kind: fact.kind,
    observed_at: fact.observed_at,
    ended_at: fact.ended_at,
    tier: classification.tier,
    relation: classification.relation,
    context: fact.context,
    payload: fact.payload,
    payload_ref: fact.payload_ref,
    source_file: fact.source_file,
    line_no: fact.line_no,
    content_hash: fact.content_hash
  };
}

function compactPayload(payload) {
  if (payload?.text) return payload.text;
  if (payload?.title && payload?.url) return `${payload.title} (${payload.url})`;
  if (payload?.title) return payload.title;
  if (payload?.command) return payload.command;
  return JSON.stringify(payload);
}

function renderPrompt(anchor, members, manifest) {
  const lines = [
    '# DCF 行为变化证据包',
    '',
    `- Anchor: \`${anchor.anchor_id}\``,
    `- Chain: \`${anchor.chain_id}\``,
    `- Window: ${new Date(anchor.start_ms).toISOString()} — ${new Date(anchor.end_ms).toISOString()}`,
    `- Bundle version: ${manifest.version}`,
    '',
    '## 已配齐的时间线',
    ''
  ];
  for (const member of members) {
    lines.push(`### ${member.observed_at} · ${member.tier} · ${member.kind}`);
    lines.push('');
    lines.push(`- 来源：${member.source}`);
    lines.push(`- 与行为变化的关系：${member.relation}`);
    if (Object.keys(member.context).length) lines.push(`- 上下文：\`${JSON.stringify(member.context)}\``);
    lines.push('');
    lines.push(compactPayload(member.payload));
    lines.push('');
  }
  lines.push('## 叙事任务');
  lines.push('');
  lines.push('请根据已经配齐的证据，直接整理这段连续个人行为叙事。说明用户前后输出、期间操作以及同期事实如何共同构成这段变化。不要自行搜索其他文件；不要把时间邻近冒充确定因果；证据不足处保留留白。');
  lines.push('');
  return lines.join('\n');
}

function latestBundle(db, anchorId) {
  return db.prepare('SELECT * FROM bundles WHERE anchor_id = ? ORDER BY version DESC LIMIT 1').get(anchorId) ?? null;
}

async function writeBundleDirectory(path, manifest, members, promptView) {
  const parent = join(path, '..');
  await mkdir(parent, { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });
  await writeFile(join(temp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(temp, 'timeline.jsonl'), `${members.map(member => JSON.stringify(member)).join('\n')}\n`);
  await writeFile(join(temp, 'prompt-view.md'), promptView);
  await rm(path, { recursive: true, force: true });
  await rename(temp, path);
}

export async function compileEvidenceBundle(db, anchorId, outputRoot, options = {}) {
  const anchor = getAnchor(db, anchorId);
  if (!anchor) throw new Error(`unknown anchor: ${anchorId}`);
  const paddingBeforeMs = options.paddingBeforeMs ?? 60_000;
  const paddingAfterMs = options.paddingAfterMs ?? 60_000;
  const facts = queryFactsByOverlap(db, anchor.start_ms - paddingBeforeMs, anchor.end_ms + paddingAfterMs);
  const members = facts.map(fact => memberView(fact, anchor));
  const sourceDigest = sha256(JSON.stringify({
    compiler: COMPILER_VERSION,
    anchor: { id: anchor.anchor_id, start_ms: anchor.start_ms, pivot_ms: anchor.pivot_ms, end_ms: anchor.end_ms },
    options: { paddingBeforeMs, paddingAfterMs },
    members: members.map(member => [member.event_id, member.content_hash, member.tier, member.relation])
  }));
  const previous = latestBundle(db, anchorId);
  if (previous?.source_digest === sourceDigest) {
    return { status: 'unchanged', version: previous.version, bundleId: previous.bundle_id, path: previous.output_path, memberCount: members.length };
  }
  const version = previous ? previous.version + 1 : 1;
  const bundleId = `${anchorId}:v${version}`;
  const path = join(outputRoot, safeName(anchorId), `v${String(version).padStart(4, '0')}`);
  const manifest = {
    schema: 'dcf.behavior-evidence-bundle.v1',
    compiler_version: COMPILER_VERSION,
    bundle_id: bundleId,
    anchor_id: anchor.anchor_id,
    chain_id: anchor.chain_id,
    version,
    source_digest: sourceDigest,
    generated_at: new Date().toISOString(),
    window: {
      evidence_start: new Date(anchor.start_ms - paddingBeforeMs).toISOString(),
      behavior_start: new Date(anchor.start_ms).toISOString(),
      pivot: new Date(anchor.pivot_ms).toISOString(),
      behavior_end: new Date(anchor.end_ms).toISOString(),
      evidence_end: new Date(anchor.end_ms + paddingAfterMs).toISOString()
    },
    boundary: { before_event_id: anchor.before_event_id, after_event_id: anchor.after_event_id },
    members
  };
  const promptView = renderPrompt(anchor, members, manifest);
  await writeBundleDirectory(path, manifest, members, promptView);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO bundles(bundle_id, anchor_id, version, source_digest, output_path, manifest_json, prompt_view, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bundleId, anchorId, version, sourceDigest, path, JSON.stringify(manifest), promptView, manifest.generated_at);
    const insertMember = db.prepare('INSERT INTO bundle_members(bundle_id, event_id, tier, relation) VALUES (?, ?, ?, ?)');
    for (const member of members) insertMember.run(bundleId, member.event_id, member.tier, member.relation);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: previous ? 'updated' : 'created', version, bundleId, path, memberCount: members.length };
}

export async function compileBundlesForRange(db, range, outputRoot, options = {}) {
  const rows = db.prepare(`
    SELECT anchor_id FROM anchors
    WHERE start_ms <= ? AND end_ms >= ?
    ORDER BY start_ms ASC, anchor_id ASC
  `).all(range.endMs, range.startMs);
  const results = [];
  for (const row of rows) results.push(await compileEvidenceBundle(db, row.anchor_id, outputRoot, options));
  return results;
}
