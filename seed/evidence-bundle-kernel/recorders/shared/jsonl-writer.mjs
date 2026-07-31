import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createFact({ eventId, source, kind, observedAt = new Date().toISOString(), endedAt, context = {}, payload = {}, payloadRef }) {
  if (!source || !kind) throw new Error('source and kind are required');
  const observed = new Date(observedAt);
  if (!Number.isFinite(observed.getTime())) throw new Error('observedAt must be a valid timestamp');
  const ended = endedAt == null ? null : new Date(endedAt);
  if (ended && (!Number.isFinite(ended.getTime()) || ended < observed)) throw new Error('endedAt must not precede observedAt');
  const fact = {
    source: String(source),
    kind: String(kind),
    observed_at: observed.toISOString(),
    ...(ended ? { ended_at: ended.toISOString() } : {}),
    context,
    payload,
    ...(payloadRef ? { payload_ref: payloadRef } : {})
  };
  const canonical = stable(fact);
  return { event_id: eventId || `sha256:${hash(canonical)}`, ...fact };
}

export async function appendFact(root, fact) {
  const normalized = createFact({
    eventId: fact.event_id,
    source: fact.source,
    kind: fact.kind,
    observedAt: fact.observed_at,
    endedAt: fact.ended_at,
    context: fact.context,
    payload: fact.payload,
    payloadRef: fact.payload_ref
  });
  const date = normalized.observed_at.slice(0, 10);
  const sourceDir = String(normalized.source).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const directory = join(root, sourceDir);
  const path = join(directory, `${date}.jsonl`);
  await mkdir(directory, { recursive: true });
  await appendFile(path, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', flag: 'a' });
  return path;
}
