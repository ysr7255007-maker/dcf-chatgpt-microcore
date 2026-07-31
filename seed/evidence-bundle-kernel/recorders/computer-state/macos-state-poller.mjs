#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFact, createFact } from '../shared/jsonl-writer.mjs';

const execFileAsync = promisify(execFile);
const root = process.env.DCF_EVIDENCE_ROOT;
const intervalMs = Number(process.env.DCF_COMPUTER_POLL_MS || 2000);
if (!root) throw new Error('DCF_EVIDENCE_ROOT is required');
if (process.platform !== 'darwin') throw new Error('macos-state-poller requires macOS');

const appleScript = `
tell application "System Events"
  set frontProcess to first application process whose frontmost is true
  set appName to name of frontProcess
  set windowTitle to ""
  try
    set windowTitle to name of front window of frontProcess
  end try
  return appName & tab & windowTitle
end tell
`;

let previous = null;

async function sample() {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', appleScript]);
  const [application, windowTitle = ''] = stdout.trimEnd().split('\t');
  const current = { application, window_title: windowTitle };
  const signature = JSON.stringify(current);
  if (signature === previous) return;
  previous = signature;
  await appendFact(root, createFact({
    source: 'computer-state-macos',
    kind: 'computer.frontmost.changed',
    context: { platform: 'macos' },
    payload: current
  }));
}

async function loop() {
  try { await sample(); }
  catch (error) {
    await appendFact(root, createFact({
      source: 'computer-state-macos',
      kind: 'recorder.error',
      context: { platform: 'macos' },
      payload: { message: error.message }
    }));
  } finally {
    setTimeout(loop, intervalMs);
  }
}

loop();
