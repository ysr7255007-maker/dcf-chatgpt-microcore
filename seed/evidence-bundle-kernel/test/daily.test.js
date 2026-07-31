import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaily } from '../src/daily.js';

test('daily pipeline turns independent fact files into an indexed AI-ready bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcf-daily-evidence-'));
  const state = await mkdtemp(join(tmpdir(), 'dcf-daily-state-'));
  await mkdir(join(root,'output'), {recursive:true});
  await mkdir(join(root,'computer'), {recursive:true});
  await writeFile(join(root,'output','day.jsonl'), [
    {event_id:'a',source:'output',kind:'user.text.output',observed_at:'2026-08-01T02:00:00.000Z',payload:{text:'先前输出'}},
    {event_id:'b',source:'output',kind:'user.text.output',observed_at:'2026-08-01T02:02:00.000Z',payload:{text:'后续输出'}}
  ].map(JSON.stringify).join('\n')+'\n');
  await writeFile(join(root,'computer','day.jsonl'), JSON.stringify({event_id:'m',source:'computer',kind:'computer.file.changed',observed_at:'2026-08-01T02:01:00.000Z',payload:{path:'report.json'}})+'\n');
  const result = await runDaily({
    date:'2026-08-01',
    evidenceRoot:root,
    databasePath:join(state,'index.sqlite'),
    bundleRoot:join(state,'bundles'),
    utcOffsetMinutes:0,
    idleGapMs:10*60*1000,
    paddingBeforeMs:0,
    paddingAfterMs:0
  });
  assert.equal(result.ingest.inserted, 3);
  assert.equal(result.anchors.inserted, 1);
  assert.equal(result.bundles.length, 1);
  const index = JSON.parse(await readFile(result.dailyIndexPath,'utf8'));
  assert.equal(index.bundles.length, 1);
  assert.match(await readFile(join(index.bundles[0].path,'prompt-view.md'),'utf8'),/report\.json/);
});
