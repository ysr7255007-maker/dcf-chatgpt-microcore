#!/usr/bin/env node
import { runDaily } from './daily.js';

function parseOffset(value) {
  if (value == null) return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('utc offset must use +HH:MM or -HH:MM');
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[++i];
    if (value == null || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
  }
  return { command, values };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, values } = parseArgs(argv);
  if (command !== 'daily') throw new Error('usage: dcf-evidence daily --date YYYY-MM-DD --evidence-root PATH --db PATH --bundles PATH [--utc-offset +09:00]');
  const result = await runDaily({
    date: values.date,
    evidenceRoot: values['evidence-root'],
    databasePath: values.db,
    bundleRoot: values.bundles,
    utcOffsetMinutes: parseOffset(values['utc-offset']),
    idleGapMs: values['idle-gap-minutes'] ? Number(values['idle-gap-minutes']) * 60_000 : undefined,
    paddingBeforeMs: values['padding-before-seconds'] ? Number(values['padding-before-seconds']) * 1000 : undefined,
    paddingAfterMs: values['padding-after-seconds'] ? Number(values['padding-after-seconds']) * 1000 : undefined
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
