#!/usr/bin/env node
import { appendFact, createFact } from '../shared/jsonl-writer.mjs';

export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function decodeNativeFrames(state, chunk) {
  state.buffer = Buffer.concat([state.buffer ?? Buffer.alloc(0), chunk]);
  const messages = [];
  while (state.buffer.length >= 4) {
    const length = state.buffer.readUInt32LE(0);
    if (length > 16 * 1024 * 1024) throw new Error(`native message too large: ${length}`);
    if (state.buffer.length < 4 + length) break;
    messages.push(JSON.parse(state.buffer.subarray(4, 4 + length).toString('utf8')));
    state.buffer = state.buffer.subarray(4 + length);
  }
  return messages;
}

async function runHost() {
  const root = process.env.DCF_EVIDENCE_ROOT;
  if (!root) throw new Error('DCF_EVIDENCE_ROOT is required');
  const state = { buffer: Buffer.alloc(0) };
  process.stdin.on('data', async chunk => {
    process.stdin.pause();
    try {
      for (const message of decodeNativeFrames(state, chunk)) {
        const fact = createFact({
          eventId: message.event_id,
          source: message.source || 'browser-visible',
          kind: message.kind,
          observedAt: message.observed_at,
          endedAt: message.ended_at,
          context: message.context,
          payload: message.payload,
          payloadRef: message.payload_ref
        });
        const path = await appendFact(root, fact);
        process.stdout.write(encodeNativeMessage({ ok: true, event_id: fact.event_id, path }));
      }
    } catch (error) {
      process.stdout.write(encodeNativeMessage({ ok: false, error: error.message }));
    } finally {
      process.stdin.resume();
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHost().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
