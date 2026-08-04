#!/usr/bin/env node
/**
 * DCF Surface smoke test (plan 4.4 / CI: surface-dev.yml).
 *
 * Verifies without a browser or npm dependencies that:
 *  1. Every lens view ships its expected files with the required DOM anchors.
 *  2. All view scripts parse (new Function syntax check).
 *  3. The Companion boots and serves the three projection endpoints
 *     (/rpc/projection/tasks|graph|weekly-digest) with the honest envelope.
 *  4. The companion-side reducers/search modules load and produce sane output.
 *
 * Exit code 0 = all checks pass; 1 = at least one failure (with a report).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VIEWS = path.join(ROOT, 'seed', 'surface', 'views');
const PORT = 8479; // dedicated smoke-test port, avoids clashing with a dev Companion

let failures = 0;
function check(name, ok, detail) {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// 1. Static file + DOM anchor checks
// ---------------------------------------------------------------------------

function read(rel) {
  const p = path.join(VIEWS, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function staticChecks() {
  console.log('\n== Static surface checks ==');

  const expectations = [
    ['companion-client.js', ['CompanionClient', '/rpc/projection/tasks']],
    ['voice-command-bar.js', ['DCFVoiceCommandBar', '暂停记录', 'SpeechRecognition']],
    ['task/index.html', ['high-priority-tasks', 'medium-priority-tasks', 'low-priority-tasks', 'voice-command-bar.js']],
    ['task/controller.js', ['TaskViewController', 'getTasks']],
    ['exploration/index.html', ['graph-container', 'node-details-panel', 'voice-command-bar.js']],
    ['exploration/graph.js', ['ForceSimulation', 'KnowledgeGraphExplorer']],
    ['reflection/index.html', ['digest-root', 'current-week-label', 'voice-command-bar.js']],
    ['reflection/feed.js', ['ReflectionFeed', 'getWeeklyDigest']]
  ];

  for (const [rel, anchors] of expectations) {
    const content = read(rel);
    check(`file exists: ${rel}`, content !== null);
    if (content === null) continue;
    for (const anchor of anchors) {
      check(`  anchor "${anchor}" in ${rel}`, content.includes(anchor));
    }
  }

  // Syntax-check all view scripts.
  for (const rel of ['companion-client.js', 'voice-command-bar.js', 'task/controller.js',
                     'exploration/graph.js', 'reflection/feed.js']) {
    const content = read(rel);
    if (content === null) continue;
    try {
      new Function(content);
      check(`syntax ok: ${rel}`, true);
    } catch (err) {
      check(`syntax ok: ${rel}`, false, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Companion module checks (reducers + hybrid search)
// ---------------------------------------------------------------------------

function moduleChecks() {
  console.log('\n== Companion module checks ==');

  try {
    const digest = require(path.join(ROOT, 'seed', 'companion', 'reducers', 'weekly-digest.ts'));
    const sample = digest.generateWeeklyDigest(digest.getISOWeek(new Date()), [
      { id: '1', ts: Date.now(), text: '我们决定采用三层认知透镜架构，这个方案很好' },
      { id: '2', ts: Date.now(), text: '今天讨论了知识图谱的力导向布局' }
    ]);
    check('weekly-digest: generates digest', !!sample && typeof sample.week === 'string');
    check('weekly-digest: extracts topics', Array.isArray(sample.topics));
    check('weekly-digest: sentiment classified',
      ['positive', 'neutral', 'negative'].includes(sample.sentimentTrend));
  } catch (err) {
    check('weekly-digest module loads', false, err.message);
  }

  try {
    const search = require(path.join(ROOT, 'seed', 'companion', 'search', 'hybrid-search.ts'));
    const result = search.hybridSearch('认知透镜', [
      { id: '1', text: '三层认知透镜架构设计' },
      { id: '2', text: '完全无关的内容' }
    ]);
    check('hybrid-search: returns hits', result && Array.isArray(result.hits));
    check('hybrid-search: ranks relevant first',
      result.hits.length > 0 && result.hits[0].eventId === '1');
  } catch (err) {
    check('hybrid-search module loads', false, err.message);
  }
}

// ---------------------------------------------------------------------------
// 3. Live Companion projection endpoint checks
// ---------------------------------------------------------------------------

function httpGetJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(data); } catch (_) { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: { error: 'timeout' } }); });
  });
}

function waitForCompanion(retries) {
  return httpGetJson(`http://127.0.0.1:${PORT}/rpc/health`).then((res) => {
    if (res.status === 200) return true;
    if (retries <= 0) return false;
    return new Promise((r) => setTimeout(r, 500)).then(() => waitForCompanion(retries - 1));
  });
}

async function liveChecks() {
  console.log('\n== Live Companion projection checks ==');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-smoke-'));
  const child = spawn(process.execPath, [
    path.join(ROOT, 'seed', 'companion', 'index.js'),
    `--port=${PORT}`,
    `--dcf-dir=${tmpDir}`
  ], { stdio: 'ignore' });

  try {
    const up = await waitForCompanion(20);
    check('companion boots and answers /rpc/health', up);
    if (!up) return;

    for (const endpoint of ['tasks', 'graph', 'weekly-digest']) {
      const res = await httpGetJson(`http://127.0.0.1:${PORT}/rpc/projection/${endpoint}`);
      check(`GET /rpc/projection/${endpoint} responds 200`, res.status === 200,
        res.status !== 200 ? `status=${res.status}` : undefined);
      check(`  ${endpoint}: JSON envelope present`,
        res.body !== null && typeof res.body === 'object');
    }
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

(async function main() {
  console.log('DCF Surface smoke test');
  staticChecks();
  moduleChecks();
  await liveChecks();

  console.log(`\n${failures === 0 ? '✅ SMOKE TEST PASSED' : `❌ SMOKE TEST FAILED (${failures} failures)`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
