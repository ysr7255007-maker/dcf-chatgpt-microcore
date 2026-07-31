import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';
import { ingestEvidenceRoot } from '../src/facts.js';
import { detectBehaviorAnchors, listAnchors } from '../src/anchors.js';
import { compileEvidenceBundle } from '../src/bundles.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dcf-bundle-evidence-'));
  const outputRoot = await mkdtemp(join(tmpdir(), 'dcf-bundles-'));
  for (const name of ['behavior','computer','browser','ai']) await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root,'behavior','facts.jsonl'), [
    {event_id:'o1',source:'output',kind:'user.text.output',observed_at:'2026-08-01T00:00:00.000Z',payload:{text:'旧判断'}},
    {event_id:'c1',source:'click',kind:'user.control.click',observed_at:'2026-08-01T00:00:20.000Z',payload:{role:'button',title:'打开'}},
    {event_id:'o2',source:'output',kind:'user.text.output',observed_at:'2026-08-01T00:01:00.000Z',payload:{text:'新判断'}}
  ].map(JSON.stringify).join('\n')+'\n');
  await writeFile(join(root,'computer','facts.jsonl'), [
    {event_id:'ctx-before',source:'computer',kind:'computer.window.changed',observed_at:'2026-07-31T23:59:50.000Z',payload:{title:'before'}},
    {event_id:'machine-1',source:'computer',kind:'computer.process.started',observed_at:'2026-08-01T00:00:30.000Z',payload:{command:'verify'}},
    {event_id:'ctx-after',source:'computer',kind:'computer.window.changed',observed_at:'2026-08-01T00:01:10.000Z',payload:{title:'after'}}
  ].map(JSON.stringify).join('\n')+'\n');
  await writeFile(join(root,'browser','facts.jsonl'), JSON.stringify({event_id:'browser-1',source:'browser',kind:'browser.visible.page',observed_at:'2026-08-01T00:00:25.000Z',ended_at:'2026-08-01T00:00:40.000Z',payload:{title:'Commit'}})+'\n');
  await writeFile(join(root,'ai','facts.jsonl'), JSON.stringify({event_id:'ai-1',source:'ai',kind:'ai.visible.response',observed_at:'2026-08-01T00:00:05.000Z',ended_at:'2026-08-01T00:00:15.000Z',payload:{text:'反例'}})+'\n');
  const db = openDatabase(':memory:');
  await ingestEvidenceRoot(db, root);
  detectBehaviorAnchors(db, {idleGapMs: 10*60*1000});
  return {root, outputRoot, db, anchor:listAnchors(db)[0]};
}

test('compiles a ready-to-narrate evidence bundle with core, direct, and context tiers', async () => {
  const {outputRoot, db, anchor} = await setup();
  const result = await compileEvidenceBundle(db, anchor.anchor_id, outputRoot, {paddingBeforeMs:15000,paddingAfterMs:15000});
  assert.equal(result.status, 'created');
  assert.equal(result.version, 1);
  const manifest = JSON.parse(await readFile(join(result.path,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.members.filter(x=>x.tier==='core').map(x=>x.event_id), ['o1','c1','o2']);
  assert.equal(manifest.members.some(x=>x.event_id==='machine-1' && x.tier==='direct'), true);
  assert.equal(manifest.members.some(x=>x.event_id==='browser-1' && x.tier==='direct'), true);
  assert.equal(manifest.members.some(x=>x.event_id==='ctx-before' && x.tier==='context'), true);
  assert.equal(manifest.members.some(x=>x.event_id==='ctx-after' && x.tier==='context'), true);
  const prompt = await readFile(join(result.path,'prompt-view.md'),'utf8');
  assert.match(prompt,/旧判断/);
  assert.match(prompt,/computer\.process\.started/);
  assert.match(prompt,/请根据已经配齐的证据/);
  const unchanged = await compileEvidenceBundle(db, anchor.anchor_id, outputRoot, {paddingBeforeMs:15000,paddingAfterMs:15000});
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.version, 1);
});

test('late overlapping facts create a new bundle version', async () => {
  const {root, outputRoot, db, anchor} = await setup();
  const first = await compileEvidenceBundle(db, anchor.anchor_id, outputRoot, {paddingBeforeMs:15000,paddingAfterMs:15000});
  await writeFile(join(root,'browser','late.jsonl'), JSON.stringify({event_id:'late-1',source:'browser',kind:'browser.visible.selection',observed_at:'2026-08-01T00:00:35.000Z',payload:{text:'late evidence'}})+'\n');
  await ingestEvidenceRoot(db, root);
  const second = await compileEvidenceBundle(db, anchor.anchor_id, outputRoot, {paddingBeforeMs:15000,paddingAfterMs:15000});
  assert.equal(first.version, 1);
  assert.equal(second.status, 'updated');
  assert.equal(second.version, 2);
  assert.match(await readFile(join(second.path,'prompt-view.md'),'utf8'),/late evidence/);
});

test('changing bundle window configuration creates a new derivative version', async () => {
  const {outputRoot, db, anchor} = await setup();
  const first = await compileEvidenceBundle(db, anchor.anchor_id, outputRoot, {paddingBeforeMs:15000,paddingAfterMs:15000});
  const second = await compileEvidenceBundle(db, anchor.anchor_id, outputRoot, {paddingBeforeMs:20000,paddingAfterMs:15000});
  assert.equal(first.version, 1);
  assert.equal(second.status, 'updated');
  assert.equal(second.version, 2);
});
