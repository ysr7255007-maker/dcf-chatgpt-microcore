import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';
import { ingestEvidenceRoot, queryFactsByOverlap } from '../src/facts.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dcf-facts-'));
  await mkdir(join(root, 'output'), { recursive: true });
  await mkdir(join(root, 'computer'), { recursive: true });
  await writeFile(join(root, 'output', '2026-08-01.jsonl'), [
    JSON.stringify({event_id:'out-1', source:'output-recorder', kind:'user.text.output', observed_at:'2026-08-01T00:00:10.000Z', ended_at:'2026-08-01T00:00:12.000Z', context:{app:'ChatGPT'}, payload:{text:'A'}}),
    JSON.stringify({event_id:'out-1', source:'output-recorder', kind:'user.text.output', observed_at:'2026-08-01T00:00:10.000Z', ended_at:'2026-08-01T00:00:12.000Z', context:{app:'ChatGPT'}, payload:{text:'A'}}),
    ''
  ].join('\n'));
  await writeFile(join(root, 'computer', '2026-08-01.jsonl'), [
    JSON.stringify({source:'computer-state', kind:'computer.window.changed', observed_at:'2026-08-01T00:00:11.000Z', payload:{title:'DCF'}}),
    ''
  ].join('\n'));
  return root;
}

test('imports independent JSONL facts, deduplicates, and queries interval overlap', async () => {
  const root = await fixture();
  const db = openDatabase(':memory:');
  const summary = await ingestEvidenceRoot(db, root);
  assert.equal(summary.inserted, 2);
  assert.equal(summary.duplicates, 1);
  const facts = queryFactsByOverlap(db, Date.parse('2026-08-01T00:00:10.500Z'), Date.parse('2026-08-01T00:00:11.500Z'));
  assert.deepEqual(facts.map(x => x.kind), ['user.text.output', 'computer.window.changed']);
  assert.equal(facts[0].source_file.endsWith('output/2026-08-01.jsonl'), true);
});

test('reports malformed envelopes without importing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcf-facts-invalid-'));
  await writeFile(join(root, 'bad.jsonl'), JSON.stringify({kind:'missing-time'}) + '\n');
  const db = openDatabase(':memory:');
  const summary = await ingestEvidenceRoot(db, root);
  assert.equal(summary.inserted, 0);
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0].message, /observed_at/);
});

test('same event id with different content is reported as a conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcf-facts-conflict-'));
  await writeFile(join(root, 'facts.jsonl'), [
    JSON.stringify({event_id:'same',source:'one',kind:'user.text.output',observed_at:'2026-08-01T00:00:00.000Z',payload:{text:'A'}}),
    JSON.stringify({event_id:'same',source:'one',kind:'user.text.output',observed_at:'2026-08-01T00:00:00.000Z',payload:{text:'B'}})
  ].join('\n') + '\n');
  const db = openDatabase(':memory:');
  const summary = await ingestEvidenceRoot(db, root);
  assert.equal(summary.inserted, 1);
  assert.equal(summary.duplicates, 0);
  assert.equal(summary.conflicts, 1);
  assert.match(summary.errors[0].message, /event_id conflict/);
});
