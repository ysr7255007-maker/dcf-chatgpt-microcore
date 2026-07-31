import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openDatabase } from './database.js';
import { ingestEvidenceRoot } from './facts.js';
import { detectBehaviorAnchors } from './anchors.js';
import { compileBundlesForRange } from './bundles.js';

export function dateRange(date, utcOffsetMinutes = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must use YYYY-MM-DD');
  if (!Number.isFinite(utcOffsetMinutes)) throw new Error('utcOffsetMinutes must be finite');
  const localMidnightAsUtc = Date.parse(`${date}T00:00:00.000Z`);
  const startMs = localMidnightAsUtc - utcOffsetMinutes * 60_000;
  return { startMs, endMs: startMs + 86_400_000 - 1 };
}

export async function runDaily(options) {
  const required = ['date', 'evidenceRoot', 'databasePath', 'bundleRoot'];
  for (const key of required) if (!options?.[key]) throw new Error(`${key} is required`);
  const range = dateRange(options.date, options.utcOffsetMinutes ?? 0);
  const db = openDatabase(options.databasePath);
  const ingest = await ingestEvidenceRoot(db, options.evidenceRoot);
  const anchors = detectBehaviorAnchors(db, { idleGapMs: options.idleGapMs });
  const bundles = await compileBundlesForRange(db, range, options.bundleRoot, {
    paddingBeforeMs: options.paddingBeforeMs,
    paddingAfterMs: options.paddingAfterMs
  });
  const dailyIndexPath = join(options.bundleRoot, 'daily', `${options.date}.json`);
  await mkdir(dirname(dailyIndexPath), { recursive: true });
  const index = {
    schema: 'dcf.daily-evidence-index.v1',
    date: options.date,
    utc_offset_minutes: options.utcOffsetMinutes ?? 0,
    generated_at: new Date().toISOString(),
    range: { start: new Date(range.startMs).toISOString(), end: new Date(range.endMs).toISOString() },
    ingest,
    anchors,
    bundles
  };
  await writeFile(dailyIndexPath, `${JSON.stringify(index, null, 2)}\n`);
  return { ...index, dailyIndexPath };
}
