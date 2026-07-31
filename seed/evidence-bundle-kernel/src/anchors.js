import { createHash } from 'node:crypto';
import { listBehaviorFacts } from './facts.js';

const DETECTOR_VERSION = 'continuity-v1';

function digest(parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function splitChains(actions, idleGapMs) {
  const chains = [];
  let current = [];
  for (const action of actions) {
    const previous = current.at(-1);
    if (previous && action.start_ms - previous.end_ms > idleGapMs) {
      chains.push(current);
      current = [];
    }
    current.push(action);
  }
  if (current.length) chains.push(current);
  return chains;
}

export function detectBehaviorAnchors(db, options = {}) {
  const idleGapMs = options.idleGapMs ?? 30 * 60 * 1000;
  if (!Number.isFinite(idleGapMs) || idleGapMs < 0) throw new Error('idleGapMs must be non-negative');
  const actions = listBehaviorFacts(db);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO anchors(
      anchor_id, chain_id, before_event_id, after_event_id,
      start_ms, pivot_ms, end_ms, chain_start_ms, chain_end_ms,
      chain_action_count, detector_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const summary = { inserted: 0, existing: 0, chains: 0 };
  for (const chain of splitChains(actions, idleGapMs)) {
    summary.chains += 1;
    const chainId = `chain:${digest([chain[0].event_id, String(chain[0].start_ms)])}`;
    const outputs = chain.filter(action => action.kind === 'user.text.output');
    for (let i = 1; i < outputs.length; i += 1) {
      const before = outputs[i - 1];
      const after = outputs[i];
      const anchorId = `anchor:${digest([before.event_id, after.event_id, DETECTOR_VERSION])}`;
      const result = insert.run(
        anchorId,
        chainId,
        before.event_id,
        after.event_id,
        before.start_ms,
        after.start_ms,
        after.end_ms,
        chain[0].start_ms,
        chain.at(-1).end_ms,
        chain.length,
        DETECTOR_VERSION,
        new Date().toISOString()
      );
      if (result.changes === 1) summary.inserted += 1;
      else summary.existing += 1;
    }
  }
  return summary;
}

export function listAnchors(db, range = {}) {
  const startMs = range.startMs ?? Number.MIN_SAFE_INTEGER;
  const endMs = range.endMs ?? Number.MAX_SAFE_INTEGER;
  return db.prepare(`
    SELECT * FROM anchors
    WHERE start_ms <= ? AND end_ms >= ?
    ORDER BY start_ms ASC, pivot_ms ASC, anchor_id ASC
  `).all(endMs, startMs);
}

export function getAnchor(db, anchorId) {
  return db.prepare('SELECT * FROM anchors WHERE anchor_id = ?').get(anchorId) ?? null;
}
