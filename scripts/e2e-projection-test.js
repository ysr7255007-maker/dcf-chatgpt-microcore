// End-to-end projection test with REAL data flowing through the event log.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateULID } = require(path.join(__dirname, '..', 'seed', 'companion', 'ulid.js'));

const PORT = 8481;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-e2e-'));

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + urlPath, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitHealth(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await req('GET', '/rpc/health'); if (r.status === 200) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const child = spawn('node', ['seed/companion/index.js', `--port=${PORT}`, `--dcf-dir=${tmpdir}`], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => process.env.DEBUG && console.error(String(d)));

  if (!await waitHealth()) { console.error('❌ companion did not boot'); child.kill('SIGTERM'); process.exit(1); }

  // 1. Ingest conversation events (source of truth for graph + weekly digest)
  const convo = [
    'AI 伦理与模型对齐是本周讨论的核心话题，涉及价值观对齐与安全性评估',
    '性能优化方面决定采用本地优先计算，决定使用懒加载策略降低首屏耗时',
    'AI 伦理问题再次出现，讨论了模型偏见与数据隐私保护的关系',
    '前端架构确定使用 Bento Grid 布局配合 Glassmorphism 视觉风格'
  ];
  for (const text of convo) {
    const r = await req('POST', '/rpc/events/ingest', { event: {
      event_id: generateULID(),
      source_id: generateULID(),
      event_type: 'conversation.message',
      payload_json: { text }
    } });
    check('ingest conversation.message', r.status === 200, `status=${r.status}`);
  }

  // 2. Ingest a recommendation.proposed event -> recommendations_projection
  const recId = generateULID();
  const rRec = await req('POST', '/rpc/events/ingest', { event: {
    event_id: generateULID(),
    source_id: recId,
    event_type: 'recommendation.proposed',
    payload_json: {
      recommendation_id: recId,
      source_entity_type: 'card',
      source_entity_id: generateULID(),
      recommendation_text: '整理 AI 伦理讨论要点并输出对齐评估清单',
      suggested_action: 'create_task',
      materiality_score: 0.82,
      priority_level: 2
    }
  } });
  check('ingest recommendation.proposed', rRec.status === 200, `status=${rRec.status}`);

  // 3. Tasks projection must surface the pending recommendation as 'recommended'
  const tasks = await req('GET', '/rpc/projection/tasks?status=recommended&limit=10');
  const taskItems = tasks.body?.data || [];
  const arr = Array.isArray(taskItems) ? taskItems : (taskItems.items || []);
  check('tasks projection returns the recommendation', tasks.status === 200 && arr.length === 1, `status=${tasks.status} count=${arr.length}`);
  if (arr.length) {
    const t = arr[0];
    check('  task.id matches recommendation', t.id === recId, t.id);
    check('  task.priority = high (level 2)', t.priority === 'high', t.priority);
    check('  task.maturityScore = 82', t.maturityScore === 82, String(t.maturityScore));
    check('  task.status = recommended', t.status === 'recommended', t.status);
  }

  // 4. Accept it through the real endpoint, then it must disappear from 'recommended'
  const acc = await req('POST', '/rpc/recommendation/accept', { recommendation_id: recId });
  check('accept recommendation', acc.status === 200, `status=${acc.status}`);
  const tasks2 = await req('GET', '/rpc/projection/tasks?status=recommended&limit=10');
  const arr2raw = tasks2.body?.data || [];
  const arr2 = Array.isArray(arr2raw) ? arr2raw : (arr2raw.items || []);
  check('accepted rec no longer in recommended list', arr2.length === 0, `count=${arr2.length}`);
  const tasks3 = await req('GET', '/rpc/projection/tasks?status=accepted&limit=10');
  const arr3raw = tasks3.body?.data || [];
  const arr3 = Array.isArray(arr3raw) ? arr3raw : (arr3raw.items || []);
  check('accepted rec appears in accepted list', arr3.length === 1, `count=${arr3.length}`);

  // 5. Graph projection must contain topic nodes derived from conversations
  const graph = await req('GET', '/rpc/projection/graph?depth=2');
  const g = graph.body?.data || {};
  const topicNodes = (g.nodes || []).filter(n => n.type === 'topic');
  const eventNodes = (g.nodes || []).filter(n => n.type === 'event');
  check('graph has topic nodes', graph.status === 200 && topicNodes.length > 0, `topics=${topicNodes.length}`);
  check('graph has event nodes', eventNodes.length > 0, `events=${eventNodes.length}`);
  check('graph has edges', (g.edges || []).length > 0, `edges=${(g.edges||[]).length}`);
  check('graph has clusters', (g.clusters || []).length > 0, `clusters=${(g.clusters||[]).length}`);

  // 6. Weekly digest for the current ISO week must count real messages
  const wd = require(path.join(__dirname, '..', 'seed', 'companion', 'reducers', 'weekly-digest.ts'));
  const week = wd.getISOWeek(new Date());
  const digest = await req('GET', `/rpc/projection/weekly-digest?week=${week}`);
  const d = digest.body?.data || {};
  check('weekly digest responds 200', digest.status === 200, `status=${digest.status}`);
  check('  digest.week matches', d.week === week, d.week);
  check('  digest counts real messages', d.totalMessages >= 4, `totalMessages=${d.totalMessages}`);
  check('  digest has topics', Array.isArray(d.topics) && d.topics.length > 0, `topics=${(d.topics||[]).length}`);
  check('  digest has highlights', Array.isArray(d.highlights) && d.highlights.length > 0, `highlights=${(d.highlights||[]).length}`);

  // 7. Bad week format -> 400
  const bad = await req('GET', '/rpc/projection/weekly-digest?week=banana');
  check('invalid week rejected with 400', bad.status === 400, `status=${bad.status}`);

  child.kill('SIGTERM');
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (_) {}
  console.log(failures === 0 ? '\n✅ E2E PROJECTION TEST PASSED' : `\n❌ E2E PROJECTION TEST FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('❌ fatal:', e); process.exit(1); });
