import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFact, createFact } from '../recorders/shared/jsonl-writer.mjs';
import { encodeNativeMessage, decodeNativeFrames } from '../recorders/native-writer/native-writer-host.mjs';

test('shared recorder appends a thin timestamped fact envelope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcf-recorder-'));
  const fact = createFact({
    source:'browser-visible',
    kind:'browser.visible.page',
    observedAt:'2026-08-01T03:04:05.000Z',
    context:{app:'Chrome'},
    payload:{title:'DCF'}
  });
  const path = await appendFact(root, fact);
  const stored = JSON.parse((await readFile(path,'utf8')).trim());
  assert.equal(stored.source, 'browser-visible');
  assert.equal(stored.observed_at, '2026-08-01T03:04:05.000Z');
  assert.match(stored.event_id, /^sha256:/);
});

test('native messaging framing decodes multiple partial frames', () => {
  const first = encodeNativeMessage({kind:'browser.visible.page', observed_at:'2026-08-01T00:00:00.000Z'});
  const second = encodeNativeMessage({kind:'browser.visible.selection', observed_at:'2026-08-01T00:00:01.000Z'});
  const combined = Buffer.concat([first, second]);
  const state = {buffer:Buffer.alloc(0)};
  const a = decodeNativeFrames(state, combined.subarray(0, 7));
  assert.deepEqual(a, []);
  const b = decodeNativeFrames(state, combined.subarray(7));
  assert.deepEqual(b.map(x=>x.kind), ['browser.visible.page','browser.visible.selection']);
});
