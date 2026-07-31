import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function listJsonl(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonl(root, path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files.sort();
}

export function normalizeFact(raw, sourceFile, lineNo) {
  if (!raw || typeof raw !== 'object') throw new Error('fact must be an object');
  if (!raw.observed_at) throw new Error('observed_at is required');
  if (!raw.kind || typeof raw.kind !== 'string') throw new Error('kind is required');
  const startMs = Date.parse(raw.observed_at);
  if (!Number.isFinite(startMs)) throw new Error('observed_at must be an ISO timestamp');
  const endMs = raw.ended_at ? Date.parse(raw.ended_at) : startMs;
  if (!Number.isFinite(endMs) || endMs < startMs) throw new Error('ended_at must not precede observed_at');
  const source = String(raw.source || 'unknown-recorder');
  const context = raw.context && typeof raw.context === 'object' ? raw.context : {};
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const canonical = stable({ source, kind: raw.kind, observed_at: raw.observed_at, ended_at: raw.ended_at ?? null, context, payload, payload_ref: raw.payload_ref ?? null });
  return {
    event_id: String(raw.event_id || `sha256:${sha256(canonical)}`),
    source,
    kind: raw.kind,
    start_ms: startMs,
    end_ms: endMs,
    observed_at: new Date(startMs).toISOString(),
    ended_at: raw.ended_at ? new Date(endMs).toISOString() : null,
    context,
    payload,
    payload_ref: raw.payload_ref ?? null,
    source_file: sourceFile,
    line_no: lineNo,
    content_hash: sha256(canonical)
  };
}

export async function ingestEvidenceRoot(db, root) {
  const files = await listJsonl(root);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO facts(
      event_id, source, kind, start_ms, end_ms, observed_at, ended_at,
      context_json, payload_json, payload_ref, source_file, line_no, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const summary = { files: files.length, inserted: 0, duplicates: 0, conflicts: 0, errors: [] };
  const existingById = db.prepare('SELECT content_hash FROM facts WHERE event_id = ?');
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        const fact = normalizeFact(JSON.parse(line), relative(root, file), index + 1);
        const result = insert.run(
          fact.event_id, fact.source, fact.kind, fact.start_ms, fact.end_ms,
          fact.observed_at, fact.ended_at, JSON.stringify(fact.context),
          JSON.stringify(fact.payload), fact.payload_ref, fact.source_file,
          fact.line_no, fact.content_hash
        );
        if (result.changes === 1) {
          summary.inserted += 1;
        } else {
          const existing = existingById.get(fact.event_id);
          if (existing?.content_hash === fact.content_hash) {
            summary.duplicates += 1;
          } else {
            summary.conflicts += 1;
            summary.errors.push({ file: relative(root, file), line: index + 1, message: `event_id conflict: ${fact.event_id}` });
          }
        }
      } catch (error) {
        summary.errors.push({ file: relative(root, file), line: index + 1, message: error.message });
      }
    }
  }
  return summary;
}

function hydrate(row) {
  return {
    ...row,
    context: JSON.parse(row.context_json),
    payload: JSON.parse(row.payload_json)
  };
}

export function queryFactsByOverlap(db, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error('invalid time interval');
  return db.prepare(`
    SELECT * FROM facts
    WHERE start_ms <= ? AND end_ms >= ?
    ORDER BY start_ms ASC, end_ms ASC, event_id ASC
  `).all(endMs, startMs).map(hydrate);
}

export function listBehaviorFacts(db) {
  return db.prepare(`
    SELECT * FROM facts
    WHERE kind IN ('user.text.output', 'user.control.click')
    ORDER BY start_ms ASC, end_ms ASC, event_id ASC
  `).all().map(hydrate);
}

export function getFact(db, eventId) {
  const row = db.prepare('SELECT * FROM facts WHERE event_id = ?').get(eventId);
  return row ? hydrate(row) : null;
}
