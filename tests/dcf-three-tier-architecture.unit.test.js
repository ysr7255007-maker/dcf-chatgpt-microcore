#!/usr/bin/env node

/**
 * tests/dcf-three-tier-architecture.unit.test.js
 *
 * DCF 三级体质复合架构验收测试（对应 spec「四、验证标准」）：
 *   1. 笼子关闭：不经 HTTP 直接调 index.js，非法输入入口拒、坏输出出口拒
 *   2. 事件 contract：未注册事件名 / 坏 payload 立即抛错
 *   3. 主流程可追溯：workflows.js 顺序调用链（显式编排，无事件驱动）
 *   4. 复杂度消解：查重走 SQL 集合运算（insertConversationBatch），无 per-record 往返
 *   5. 隔离强制：dependency-cruiser 0 违规 + trap 测试
 *
 * 运行：node tests/dcf-three-tier-architecture.unit.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const TMP_DB = path.join(os.tmpdir(), `dcf-arch-test-${process.pid}.db`);

let passed = 0;
let failed = 0;

function ok(name, cond) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}`); }
}

async function test(name, fn) {
    try {
        await fn();
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name} — threw: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// 1. core/event-bus：事件 contract（未注册名抛错、坏 payload 抛错、合法送达）
// ---------------------------------------------------------------------------
async function testEventBusContracts() {
    console.log('\n[event-bus contracts]');
    const { bus, EventType } = require('../seed/core/event-bus');

    bus.clear();
    let received = null;
    bus.on(EventType.DebugLog, (p) => { received = p; });
    ok('listener registered', bus.listenerCount(EventType.DebugLog) === 1);

    // 合法事件正常送达
    bus.publish(EventType.DebugLog, { message: 'test', context: { key: 'value' } });
    ok('valid event delivered', received && received.message === 'test');

    // 未注册事件名立即抛错
    let unregisteredThrew = false;
    try { bus.publish('unregistered.event', {}); }
    catch (e) { unregisteredThrew = e.message.includes('Unregistered event type'); }
    ok('unregistered event name throws', unregisteredThrew);

    // 坏 payload 立即抛错（message 应为 string）
    let badPayloadThrew = false;
    try { bus.publish(EventType.DebugLog, { message: 123 }); }
    catch (e) { badPayloadThrew = true; }
    ok('bad payload throws at publish boundary', badPayloadThrew);

    // handler 抛错不影响 publish 返回
    let handlerThrew = false;
    bus.on(EventType.DebugLog, () => { handlerThrew = true; throw new Error('boom'); });
    bus.publish(EventType.DebugLog, { message: 'ok' });
    ok('handler error does not break publish', handlerThrew === true);

    bus.clear();
    ok('clear removes all listeners', bus.listenerCount(EventType.DebugLog) === 0);
}

// ---------------------------------------------------------------------------
// 2. core/repository：集合运算查重（insertConversationBatch）
// ---------------------------------------------------------------------------
async function testSetBasedDedup() {
    console.log('\n[repository: set-based dedup]');
    try { fs.unlinkSync(TMP_DB); } catch (_) {}

    const { repo } = require('../seed/core/repository');
    await repo.initialize(TMP_DB);
    ok('repository initialized', repo.initialized === true);

    const mkRecord = (n, hashSuffix) => ({
        id: `dedup-conv-${n}`,
        title: `Dedup Test ${n}`,
        summary: null,
        first_message_text: `first ${n}`,
        last_message_text: `last ${n}`,
        total_turns: 2, user_turns: 1, ai_turns: 1,
        created_at: new Date(`2026-07-1${n}T00:00:00Z`),
        updated_at: new Date(`2026-07-1${n}T00:00:00Z`),
        imported_at: new Date(),
        source_type: 'manual-import', source_name: 'dedup-test', source_id: `src-${n}`,
        source_origin: null, content_hash: hashSuffix.repeat(64),
        metadata: '{}', is_starred: false, is_sensitive: false,
        marked_as_duplicate: false, exclusion_reason: null,
        topic_cluster_id: null, popularity_score: 0
    });

    // 第一批：2 条全新记录
    const batch1 = [mkRecord(1, 'a'), mkRecord(2, 'b')];
    const result1 = await repo.conversations.insertConversationBatch(batch1);
    ok('first batch: 2 inserted, 0 skipped', result1.inserted === 2 && result1.duplicatesSkipped === 0);

    // 第二批：1 条三元组重复 + 1 条 content_hash 重复 + 1 条全新
    const batch2 = [mkRecord(1, 'a'), mkRecord(3, 'b'), mkRecord(4, 'c')];
    const result2 = await repo.conversations.insertConversationBatch(batch2);
    ok('second batch: 1 inserted, 2 skipped (triple key + content_hash)',
        result2.inserted === 1 && result2.duplicatesSkipped === 2);

    // 批内自身重复：同一批次内 2 条相同三元组 → GROUP BY 去重后入库 1 条
    const batch3 = [mkRecord(5, 'd'), mkRecord(5, 'd')];
    const result3 = await repo.conversations.insertConversationBatch(batch3);
    ok('intra-batch dedup: GROUP BY keeps first, 1 inserted 1 skipped',
        result3.inserted === 1 && result3.duplicatesSkipped === 1);

    // filters 下推 SQL：keyword 过滤
    const batch4 = [mkRecord(6, 'e'), mkRecord(7, 'f')];
    const result4 = await repo.conversations.insertConversationBatch(batch4, { keyword: 'Test 6' });
    ok('filters pushed to SQL: keyword="Test 6" inserts only matching',
        result4.inserted === 1);

    // 审计：duplicate_trails 有记录
    const trails = await repo.executeSql('SELECT COUNT(*) as cnt FROM duplicate_trails', []);
    ok('duplicate_trails audit logged', trails[0].cnt >= 2);
}

// ---------------------------------------------------------------------------
// 3. core/query-engine：intent → SQL 编译器（无 planner 语义）
// ---------------------------------------------------------------------------
async function testQueryEngine() {
    console.log('\n[query-engine]');
    const { repo } = require('../seed/core/repository');
    const { queryEngine } = require('../seed/core/query-engine/QueryEngine');

    await queryEngine.initialize(repo);
    ok('query engine initialized', queryEngine.initialized === true);

    // compile 是纯函数：返回 { sql, params }
    const compiled = queryEngine.compile({ recentRounds: 10, keyword: 'test' });
    ok('compile returns { sql, params }', compiled.sql && Array.isArray(compiled.params));
    ok('SQL contains LIMIT placeholder', compiled.sql.includes('LIMIT ?'));
    ok('params order matches placeholders', compiled.params.length === 3); // keyword×2 + limit

    // excludeGenerated: 有 artifact 的对话被排除
    await repo.artifacts.insert({
        id: 'art-q1', conversation_id: 'dedup-conv-1', type: 'card',
        title: 'card', summary: 's', content: '{}', status: 'generated',
        created_at: new Date(), generated_at: new Date()
    });
    const available = await queryEngine.getAvailableConversations(10);
    const ids = available.map(r => r.id);
    ok('excludeGenerated filters artifact-linked', !ids.includes('dedup-conv-1'));

    // select 执行查询
    const results = await queryEngine.select({ keyword: 'Dedup Test', excludeGenerated: false });
    ok('select executes compiled SQL', results.length > 0);

    // healthCheck 委托给 repository.stats
    const stats = await queryEngine.healthCheck();
    ok('healthCheck returns counts', typeof stats.total_conversations === 'number');
}

// ---------------------------------------------------------------------------
// 4. 笼子关闭：3 模块各一例入口拒 + 1 例出口拒
// ---------------------------------------------------------------------------
async function testContractCages() {
    console.log('\n[contract cages: entry + exit]');

    // data-import 入口：recentRounds=-5 拒
    const dataImportFn = require('../seed/functions/data-import');
    await dataImportFn.initialize(TMP_DB);
    let diEntryRejected = false;
    try { await dataImportFn.fullImport({ recentRounds: -5 }); }
    catch (e) { diEntryRejected = true; }
    ok('data-import entry cage: recentRounds=-5 rejected', diEntryRejected);

    // data-import 出口：mock service 返回坏 payload
    const diService = require('../seed/functions/data-import/service').dataImportService;
    const origFullImport = diService.fullImport;
    diService.fullImport = async () => ({ imported: 'not-a-number', duplicatesSkipped: 0, failed: 0 });
    let diExitRejected = false;
    try { await dataImportFn.fullImport({}); }
    catch (e) { diExitRejected = true; }
    ok('data-import exit cage: bad output rejected', diExitRejected);
    diService.fullImport = origFullImport; // restore

    // conversation-query 入口：recentRounds=0 拒
    const conversationQueryFn = require('../seed/functions/conversation-query');
    await conversationQueryFn.initialize(TMP_DB);
    let cqEntryRejected = false;
    try { await conversationQueryFn.executeIntent({ recentRounds: 0 }); }
    catch (e) { cqEntryRejected = true; }
    ok('conversation-query entry cage: recentRounds=0 rejected', cqEntryRejected);

    // task-generation 入口：kind='essay' 拒
    const taskGenerationFn = require('../seed/functions/task-generation');
    await taskGenerationFn.initialize({ dbPath: TMP_DB });
    let tgEntryRejected = false;
    try { await taskGenerationFn.generate({ kind: 'essay', prompt: 'x' }); }
    catch (e) { tgEntryRejected = true; }
    ok('task-generation entry cage: kind="essay" rejected', tgEntryRejected);

    // z.coerce.date()：ISO 字符串日期通过出口校验
    const diContract = require('../seed/functions/data-import/contract.js');
    const coerced = diContract.ConversationRecordSchema.parse({
        id: 'coerce-test', title: 't', summary: null, first_message_text: 'f', last_message_text: 'l',
        total_turns: 1, user_turns: 1, ai_turns: 0,
        created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', imported_at: '2026-07-01T00:00:00Z',
        source_type: 'manual-import', source_name: 'test', source_id: null, source_origin: null,
        metadata: '{}', is_starred: false, is_sensitive: false, marked_as_duplicate: false,
        exclusion_reason: null, topic_cluster_id: null, popularity_score: 0, content_hash: null
    });
    ok('z.coerce.date() accepts ISO string', coerced.created_at instanceof Date);
}

// ---------------------------------------------------------------------------
// 5. 主流程显式编排：workflows.js 顺序调用链
// ---------------------------------------------------------------------------
async function testExplicitOrchestration() {
    console.log('\n[workflows: explicit orchestration]');
    const { importThenQuery } = require('../seed/companion/workflows');

    // importThenQuery: import → query 顺序调用
    const result = await importThenQuery({ sourceTypes: [], recentRounds: 5 });
    ok('importThenQuery returns { imported, available }',
        result && typeof result.imported !== 'undefined' && typeof result.available !== 'undefined');
    ok('imported has ImportResult shape',
        typeof result.imported.imported === 'number' && typeof result.imported.duplicatesSkipped === 'number');
    ok('available is array of conversations', Array.isArray(result.available));
}

// ---------------------------------------------------------------------------
// 6. 隔离强制：dependency-cruiser 0 违规 + trap 测试
// ---------------------------------------------------------------------------
async function testDependencyIsolation() {
    console.log('\n[dependency-cruiser isolation]');
    let output = '';
    let exitOk = true;
    try {
        output = execFileSync('npx', [
            'depcruise', 'seed/core', 'seed/functions', 'seed/companion/index.js', 'seed/companion/workflows.js',
            '--config', '.dependency-cruiser.js'
        ], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        exitOk = false;
        output = (e.stdout || '') + (e.stderr || '');
    }
    ok('dependency-cruiser 0 violations', exitOk && /no dependency violations found/.test(output));

    // trap: functions/* 互相 require 必被抓
    const trapFile = path.join(REPO_ROOT, 'seed/functions/data-import/__isolation_trap__.js');
    fs.writeFileSync(trapFile, "require('../conversation-query/service.js');\n");
    let trapCaught = false;
    try {
        execFileSync('npx', [
            'depcruise', 'seed/functions',
            '--config', '.dependency-cruiser.js'
        ], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        trapCaught = /no-functions-to-functions/.test((e.stdout || '') + (e.stderr || ''));
    } finally {
        fs.unlinkSync(trapFile);
    }
    ok('functions/* cross-require is caught by dependency-cruiser', trapCaught);
}

// ---------------------------------------------------------------------------
// 7. hot-path/ 为空（测量驱动，无代码）
// ---------------------------------------------------------------------------
async function testHotPathEmpty() {
    console.log('\n[hot-path: empty by design]');
    const hotPathDir = path.join(REPO_ROOT, 'seed/core/hot-path');
    const files = fs.readdirSync(hotPathDir).filter(f => f !== '.gitkeep');
    ok('hot-path/ contains only .gitkeep (no code)', files.length === 0);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
    console.log('DCF three-tier architecture acceptance tests');
    await test('event-bus contracts', testEventBusContracts);
    await test('set-based dedup', testSetBasedDedup);
    await test('query-engine', testQueryEngine);
    await test('contract cages', testContractCages);
    await test('explicit orchestration', testExplicitOrchestration);
    await test('dependency isolation', testDependencyIsolation);
    await test('hot-path empty', testHotPathEmpty);

    // Cleanup
    try {
        const { repo } = require('../seed/core/repository');
        await repo.close();
    } catch (_) {}
    try { fs.unlinkSync(TMP_DB); } catch (_) {}

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
    console.error('Fatal test error:', err);
    try { fs.unlinkSync(TMP_DB); } catch (_) {}
    process.exit(1);
});
