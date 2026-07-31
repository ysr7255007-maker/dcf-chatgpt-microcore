import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';
import { ingestEvidenceRoot } from '../src/facts.js';
import { detectBehaviorAnchors, listAnchors } from '../src/anchors.js';

async function seed(db) {
  const root = await mkdtemp(join(tmpdir(), 'dcf-anchors-'));
  await mkdir(join(root, 'behavior'), { recursive: true });
  const facts = [
    {event_id:'o1', source:'output', kind:'user.text.output', observed_at:'2026-08-01T00:00:00.000Z', payload:{text:'A'}},
    {event_id:'c1', source:'click', kind:'user.control.click', observed_at:'2026-08-01T00:00:05.000Z', payload:{role:'button', title:'Send'}},
    {event_id:'o2', source:'output', kind:'user.text.output', observed_at:'2026-08-01T00:01:00.000Z', payload:{text:'B'}},
    {event_id:'c2', source:'click', kind:'user.control.click', observed_at:'2026-08-01T01:00:00.000Z', payload:{role:'button', title:'Open'}},
    {event_id:'o3', source:'output', kind:'user.text.output', observed_at:'2026-08-01T01:00:10.000Z', payload:{text:'C'}},
    {event_id:'o4', source:'output', kind:'user.text.output', observed_at:'2026-08-01T01:00:30.000Z', payload:{text:'D'}}
  ];
  await writeFile(join(root, 'behavior', 'facts.jsonl'), facts.map(JSON.stringify).join('\n') + '\n');
  await ingestEvidenceRoot(db, root);
}

test('derives deterministic output-to-output anchors and preserves clicks in continuity chains', async () => {
  const db = openDatabase(':memory:');
  await seed(db);
  const first = detectBehaviorAnchors(db, { idleGapMs: 10 * 60 * 1000 });
  assert.equal(first.inserted, 2);
  const anchors = listAnchors(db);
  assert.deepEqual(anchors.map(a => [a.before_event_id, a.after_event_id]), [['o1','o2'], ['o3','o4']]);
  assert.equal(anchors[0].chain_action_count, 3);
  assert.notEqual(anchors[0].chain_id, anchors[1].chain_id);
  const second = detectBehaviorAnchors(db, { idleGapMs: 10 * 60 * 1000 });
  assert.equal(second.inserted, 0);
  assert.equal(second.existing, 2);
  assert.deepEqual(listAnchors(db).map(a => a.anchor_id), anchors.map(a => a.anchor_id));
});
