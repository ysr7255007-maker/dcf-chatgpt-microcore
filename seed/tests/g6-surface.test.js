/**
 * G6 Surface Patch Management — Unit Tests
 *
 * Tests cover:
 * - All 8 API client functions (mock fetch): fetchPatches, proposePatch,
 *   validatePatch, activatePatch, deactivatePatch, revertPatch,
 *   revalidatePatch, supersedePatch
 * - Status color mapping (6 statuses)
 * - Status-to-actions mapping (6 statuses)
 * - Environment health color + indicator rendering (4 statuses)
 * - Card formatting (formatPatchCard)
 * - Detail formatting (formatPatchDetail)
 * - Filter + count helpers
 * - Payload builders + validation
 * - Full lifecycle flow through UI functions
 *
 * Run: node seed/tests/g6-surface.test.js
 */

const assert = require('assert');
const CORE = require('../surface/g6-patches-core');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    return Promise.resolve()
        .then(() => fn())
        .then(() => {
            testsPassed++;
            console.log(`  ✅ PASS: ${name}`);
        })
        .catch(err => {
            testsFailed++;
            console.log(`  ❌ FAIL: ${name}`);
            console.log(`          ${err.message}`);
        });
}

// ──────────────────────────────────────────────────────────────
// Mock fetch helper
// ──────────────────────────────────────────────────────────────
function createMockFetch(responses) {
    // responses: array of { url, method, status, body }
    // or a function(url, opts) => { status, body }
    let callLog = [];
    const handler = typeof responses === 'function' ? responses : null;
    const queue = Array.isArray(responses) ? [...responses] : null;

    const mockFetch = async (url, opts) => {
        callLog.push({ url: String(url), method: opts?.method || 'GET', opts });
        if (handler) {
            const r = handler(String(url), opts);
            return {
                ok: r.status >= 200 && r.status < 300,
                status: r.status,
                json: async () => r.body
            };
        }
        const next = queue.shift() || { status: 404, body: { error: { message: 'no more mock responses' } } };
        return {
            ok: next.status >= 200 && next.status < 300,
            status: next.status,
            json: async () => next.body
        };
    };
    mockFetch.callLog = callLog;
    return mockFetch;
}

const ORIGINAL_FETCH = global.fetch;

function setMockFetch(mockFn) {
    global.fetch = mockFn;
}

function restoreFetch() {
    global.fetch = ORIGINAL_FETCH;
}

// ──────────────────────────────────────────────────────────────
// Test constants
// ──────────────────────────────────────────────────────────────
const BASE = 'http://127.0.0.1:8472';
const FAKE_ULID_1 = '01JXY9M6000000000000000001';
const FAKE_ULID_2 = '01JXY9M6000000000000000002';

function makePatch(overrides) {
    return Object.assign({
        patch_id: FAKE_ULID_1,
        title: 'Test Patch',
        description: 'A test patch description',
        patch_body_json: JSON.stringify({ file: 'test.js', change: 'fix' }),
        patch_status: 'proposed',
        environment_health: 'healthy',
        source_ref: null,
        validated_by: null,
        validated_at: null,
        activated_at: null,
        reverted_at: null,
        superseded_by: null,
        validation_notes_json: null,
        created_at: '2026-07-26T10:00:00.000Z',
        updated_at: '2026-07-26T10:00:00.000Z'
    }, overrides || {});
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────
async function runAllTests() {
    console.log('\n🧪 G6 Surface Patch Management — Unit Tests\n');

    // =================================================================
    // 1. fetchPatches (4 tests)
    // =================================================================
    console.log('📦 fetchPatches:');
    await test('fetchPatches returns patches array on success', async () => {
        const mock = createMockFetch([
            { status: 200, body: { jsonrpc: '2.0', result: { patches: [makePatch()], count: 1 } } }
        ]);
        setMockFetch(mock);
        const res = await CORE.fetchPatches(BASE, {});
        assert.ok(res.ok, 'should be ok');
        assert.strictEqual(res.patches.length, 1);
        assert.strictEqual(res.count, 1);
        restoreFetch();
    });

    await test('fetchPatches passes status filter in query string', async () => {
        const mock = createMockFetch((url) => {
            assert.ok(url.includes('status=active'), 'URL should contain status=active');
            return { status: 200, body: { jsonrpc: '2.0', result: { patches: [], count: 0 } } };
        });
        setMockFetch(mock);
        await CORE.fetchPatches(BASE, { status: 'active' });
        restoreFetch();
    });

    await test('fetchPatches passes include_environment=true', async () => {
        const mock = createMockFetch((url) => {
            assert.ok(url.includes('include_environment=true'), 'URL should contain include_environment=true');
            return { status: 200, body: { jsonrpc: '2.0', result: { patches: [], count: 0 } } };
        });
        setMockFetch(mock);
        await CORE.fetchPatches(BASE, { include_environment: true });
        restoreFetch();
    });

    await test('fetchPatches handles server error gracefully', async () => {
        const mock = createMockFetch([
            { status: 500, body: { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' } } }
        ]);
        setMockFetch(mock);
        const res = await CORE.fetchPatches(BASE, {});
        assert.ok(!res.ok, 'should not be ok');
        assert.strictEqual(res.patches.length, 0);
        assert.ok(res.failure.message.includes('Internal error'));
        restoreFetch();
    });

    // =================================================================
    // 2. proposePatch (3 tests)
    // =================================================================
    console.log('\n📦 proposePatch:');
    await test('proposePatch sends correct payload and returns patch_id', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.title, 'Fix login');
            assert.ok(body.patch_body_json);
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'proposed' } } };
        });
        setMockFetch(mock);
        const res = await CORE.proposePatch(BASE, {
            title: 'Fix login',
            description: 'timeout fix',
            patch_body_json: JSON.stringify({ file: 'auth.js' })
        });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_id, FAKE_ULID_1);
        assert.strictEqual(res.result.patch_status, 'proposed');
        restoreFetch();
    });

    await test('proposePatch rejects missing title (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.proposePatch(BASE, { patch_body_json: '{}' });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('title'));
        restoreFetch();
    });

    await test('proposePatch rejects missing patch_body_json (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.proposePatch(BASE, { title: 'Test' });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('patch_body_json'));
        restoreFetch();
    });

    // =================================================================
    // 3. validatePatch (3 tests)
    // =================================================================
    console.log('\n📦 validatePatch:');
    await test('validatePatch sends correct payload', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.patch_id, FAKE_ULID_1);
            assert.strictEqual(body.validated_by, 'tester');
            assert.strictEqual(body.validation_notes_json, '{"score":0.9}');
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'validated', validated_by: 'tester', validated_at: '2026-07-26T10:00:00Z' } } };
        });
        setMockFetch(mock);
        const res = await CORE.validatePatch(BASE, {
            patch_id: FAKE_ULID_1,
            validated_by: 'tester',
            validation_notes_json: '{"score":0.9}'
        });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_status, 'validated');
        restoreFetch();
    });

    await test('validatePatch rejects invalid patch_id (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.validatePatch(BASE, { patch_id: 'bad', validated_by: 'x' });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('patch_id'));
        restoreFetch();
    });

    await test('validatePatch rejects missing validated_by (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.validatePatch(BASE, { patch_id: FAKE_ULID_1 });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('validated_by'));
        restoreFetch();
    });

    // =================================================================
    // 4. activatePatch (2 tests)
    // =================================================================
    console.log('\n📦 activatePatch:');
    await test('activatePatch sends patch_id and returns active status', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.patch_id, FAKE_ULID_1);
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'active', activated_at: '2026-07-26T11:00:00Z' } } };
        });
        setMockFetch(mock);
        const res = await CORE.activatePatch(BASE, { patch_id: FAKE_ULID_1 });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_status, 'active');
        restoreFetch();
    });

    await test('activatePatch rejects invalid patch_id (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.activatePatch(BASE, { patch_id: 'invalid' });
        assert.ok(!res.ok);
        restoreFetch();
    });

    // =================================================================
    // 5. deactivatePatch (2 tests)
    // =================================================================
    console.log('\n📦 deactivatePatch:');
    await test('deactivatePatch sends patch_id and returns needs_revalidation', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.patch_id, FAKE_ULID_1);
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'needs_revalidation' } } };
        });
        setMockFetch(mock);
        const res = await CORE.deactivatePatch(BASE, { patch_id: FAKE_ULID_1 });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_status, 'needs_revalidation');
        restoreFetch();
    });

    await test('deactivatePatch rejects missing patch_id (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.deactivatePatch(BASE, {});
        assert.ok(!res.ok);
        restoreFetch();
    });

    // =================================================================
    // 6. revertPatch (3 tests)
    // =================================================================
    console.log('\n📦 revertPatch:');
    await test('revertPatch sends patch_id, reverted_by, revert_reason', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.patch_id, FAKE_ULID_1);
            assert.strictEqual(body.reverted_by, 'looy');
            assert.strictEqual(body.revert_reason, 'caused regression');
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'reverted', reverted_at: '2026-07-26T12:00:00Z', reverted_by: 'looy' } } };
        });
        setMockFetch(mock);
        const res = await CORE.revertPatch(BASE, {
            patch_id: FAKE_ULID_1,
            reverted_by: 'looy',
            revert_reason: 'caused regression'
        });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_status, 'reverted');
        restoreFetch();
    });

    await test('revertPatch rejects missing reverted_by (client-side)', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.revertPatch(BASE, { patch_id: FAKE_ULID_1 });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('reverted_by'));
        restoreFetch();
    });

    await test('revertPatch works without revert_reason (optional)', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.ok(!body.revert_reason, 'revert_reason should be absent');
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'reverted', reverted_at: 'now', reverted_by: 'x' } } };
        });
        setMockFetch(mock);
        const res = await CORE.revertPatch(BASE, { patch_id: FAKE_ULID_1, reverted_by: 'x' });
        assert.ok(res.ok);
        restoreFetch();
    });

    // =================================================================
    // 7. revalidatePatch (3 tests)
    // =================================================================
    console.log('\n📦 revalidatePatch:');
    await test('revalidatePatch sends validation_result=valid', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.patch_id, FAKE_ULID_1);
            assert.strictEqual(body.validation_result, 'valid');
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'validated', validation_result: 'valid' } } };
        });
        setMockFetch(mock);
        const res = await CORE.revalidatePatch(BASE, { patch_id: FAKE_ULID_1, validation_result: 'valid', validated_by: 'x' });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_status, 'validated');
        restoreFetch();
    });

    await test('revalidatePatch rejects invalid validation_result', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.revalidatePatch(BASE, { patch_id: FAKE_ULID_1, validation_result: 'maybe' });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('validation_result'));
        restoreFetch();
    });

    await test('revalidatePatch rejects invalid patch_id', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.revalidatePatch(BASE, { patch_id: 'bad', validation_result: 'valid' });
        assert.ok(!res.ok);
        restoreFetch();
    });

    // =================================================================
    // 8. supersedePatch (2 tests)
    // =================================================================
    console.log('\n📦 supersedePatch:');
    await test('supersedePatch sends both patch IDs', async () => {
        const mock = createMockFetch((url, opts) => {
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.patch_id, FAKE_ULID_1);
            assert.strictEqual(body.superseded_by_patch_id, FAKE_ULID_2);
            return { status: 200, body: { jsonrpc: '2.0', result: { patch_id: FAKE_ULID_1, event_id: FAKE_ULID_2, patch_status: 'superseded', superseded_by: FAKE_ULID_2 } } };
        });
        setMockFetch(mock);
        const res = await CORE.supersedePatch(BASE, { patch_id: FAKE_ULID_1, superseded_by_patch_id: FAKE_ULID_2 });
        assert.ok(res.ok);
        assert.strictEqual(res.result.patch_status, 'superseded');
        restoreFetch();
    });

    await test('supersedePatch rejects missing superseded_by_patch_id', async () => {
        setMockFetch(() => ({ status: 200, body: {} }));
        const res = await CORE.supersedePatch(BASE, { patch_id: FAKE_ULID_1 });
        assert.ok(!res.ok);
        assert.ok(res.failure.message.includes('superseded_by_patch_id'));
        restoreFetch();
    });

    // =================================================================
    // 9. Status color mapping (6 tests)
    // =================================================================
    console.log('\n📦 Status color mapping:');
    await test('getStatusColor(proposed) returns gray scheme', () => {
        const c = CORE.getStatusColor('proposed');
        assert.ok(c.bg, 'should have bg');
        assert.ok(c.text);
        assert.ok(c.border);
    });

    await test('getStatusColor(validated) returns blue scheme', () => {
        const c = CORE.getStatusColor('validated');
        assert.strictEqual(c.border, '#0969da');
    });

    await test('getStatusColor(active) returns green scheme', () => {
        const c = CORE.getStatusColor('active');
        assert.strictEqual(c.border, '#2da44e');
    });

    await test('getStatusColor(needs_revalidation) returns orange scheme', () => {
        const c = CORE.getStatusColor('needs_revalidation');
        assert.strictEqual(c.border, '#d29922');
    });

    await test('getStatusColor(reverted) returns red scheme', () => {
        const c = CORE.getStatusColor('reverted');
        assert.strictEqual(c.border, '#cf222e');
    });

    await test('getStatusColor(superseded) returns purple scheme', () => {
        const c = CORE.getStatusColor('superseded');
        assert.strictEqual(c.border, '#8250df');
    });

    await test('getStatusColor(unknown) falls back to proposed', () => {
        const c = CORE.getStatusColor('nonexistent');
        assert.strictEqual(c.border, '#d0d7de');
    });

    // =================================================================
    // 10. Status-to-actions mapping (6 tests)
    // =================================================================
    console.log('\n📦 Status-to-actions mapping:');
    await test('getStatusActions(proposed) = [validate, supersede]', () => {
        const actions = CORE.getStatusActions('proposed');
        assert.deepStrictEqual(actions, ['validate', 'supersede']);
    });

    await test('getStatusActions(validated) = [activate, revert, supersede]', () => {
        const actions = CORE.getStatusActions('validated');
        assert.deepStrictEqual(actions, ['activate', 'revert', 'supersede']);
    });

    await test('getStatusActions(active) = [deactivate, revert, supersede]', () => {
        const actions = CORE.getStatusActions('active');
        assert.deepStrictEqual(actions, ['deactivate', 'revert', 'supersede']);
    });

    await test('getStatusActions(needs_revalidation) = [revalidate_valid, revalidate_invalid]', () => {
        const actions = CORE.getStatusActions('needs_revalidation');
        assert.deepStrictEqual(actions, ['revalidate_valid', 'revalidate_invalid']);
    });

    await test('getStatusActions(reverted) = []', () => {
        const actions = CORE.getStatusActions('reverted');
        assert.deepStrictEqual(actions, []);
    });

    await test('getStatusActions(superseded) = []', () => {
        const actions = CORE.getStatusActions('superseded');
        assert.deepStrictEqual(actions, []);
    });

    // =================================================================
    // 11. Environment health indicator (5 tests)
    // =================================================================
    console.log('\n📦 Environment health indicator:');
    await test('buildHealthIndicator(healthy) renders green indicator', () => {
        const html = CORE.buildHealthIndicator('healthy');
        assert.ok(html.includes('健康'));
        assert.ok(html.includes('#dafbe1'));
    });

    await test('buildHealthIndicator(degraded) renders orange indicator', () => {
        const html = CORE.buildHealthIndicator('degraded');
        assert.ok(html.includes('降级'));
        assert.ok(html.includes('#fff8c5'));
    });

    await test('buildHealthIndicator(unhealthy) renders red indicator', () => {
        const html = CORE.buildHealthIndicator('unhealthy');
        assert.ok(html.includes('不健康'));
        assert.ok(html.includes('#ffebe9'));
    });

    await test('buildHealthIndicator(unknown) renders gray indicator', () => {
        const html = CORE.buildHealthIndicator('unknown');
        assert.ok(html.includes('未知'));
        assert.ok(html.includes('#eaeef2'));
    });

    await test('buildHealthIndicator includes lastChecked timestamp when provided', () => {
        const html = CORE.buildHealthIndicator('healthy', '2026-07-26T10:00:00Z');
        assert.ok(html.includes('检查于'));
    });

    // =================================================================
    // 12. Card formatting (4 tests)
    // =================================================================
    console.log('\n📦 Card formatting:');
    await test('formatPatchCard renders full patch card', () => {
        const html = CORE.formatPatchCard(makePatch());
        assert.ok(html.includes('patch-card'));
        assert.ok(html.includes('Test Patch'));
        assert.ok(html.includes('proposed'));
        assert.ok(html.includes('data-patch-id'));
    });

    await test('formatPatchCard includes action buttons for proposed status', () => {
        const html = CORE.formatPatchCard(makePatch({ patch_status: 'proposed' }));
        assert.ok(html.includes('data-action="validate"'));
        assert.ok(html.includes('data-action="supersede"'));
    });

    await test('formatPatchCard includes action buttons for active status', () => {
        const html = CORE.formatPatchCard(makePatch({ patch_status: 'active' }));
        assert.ok(html.includes('data-action="deactivate"'));
        assert.ok(html.includes('data-action="revert"'));
    });

    await test('formatPatchCard returns empty string for null/undefined', () => {
        assert.strictEqual(CORE.formatPatchCard(null), '');
        assert.strictEqual(CORE.formatPatchCard(undefined), '');
    });

    // =================================================================
    // 13. Detail formatting (2 tests)
    // =================================================================
    console.log('\n📦 Detail formatting:');
    await test('formatPatchDetail renders empty state for null', () => {
        const html = CORE.formatPatchDetail(null);
        assert.ok(html.includes('empty-honest'));
    });

    await test('formatPatchDetail renders full detail with all fields', () => {
        const patch = makePatch({
            patch_status: 'active',
            validated_by: 'tester',
            validated_at: '2026-07-26T10:30:00Z',
            activated_at: '2026-07-26T11:00:00Z',
            validation_notes_json: '{"score":0.95}'
        });
        const html = CORE.formatPatchDetail(patch);
        assert.ok(html.includes('patch-detail'));
        assert.ok(html.includes('tester'));
        assert.ok(html.includes('验证者'));
        assert.ok(html.includes('激活时间'));
    });

    // =================================================================
    // 14. Filter + count helpers (4 tests)
    // =================================================================
    console.log('\n📦 Filter + count helpers:');
    await test('filterByStatus returns all when filter is "all"', () => {
        const patches = [makePatch(), makePatch({ patch_id: FAKE_ULID_2, patch_status: 'active' })];
        const filtered = CORE.filterByStatus(patches, 'all');
        assert.strictEqual(filtered.length, 2);
    });

    await test('filterByStatus filters by status correctly', () => {
        const patches = [
            makePatch({ patch_status: 'proposed' }),
            makePatch({ patch_id: FAKE_ULID_2, patch_status: 'active' })
        ];
        const filtered = CORE.filterByStatus(patches, 'active');
        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].patch_status, 'active');
    });

    await test('countByStatus counts all 6 statuses + total', () => {
        const patches = [
            makePatch({ patch_status: 'proposed' }),
            makePatch({ patch_id: FAKE_ULID_2, patch_status: 'active' }),
            makePatch({ patch_id: '01JXY9M6000000000000000003', patch_status: 'active' }),
            makePatch({ patch_id: '01JXY9M6000000000000000004', patch_status: 'reverted' })
        ];
        const counts = CORE.countByStatus(patches);
        assert.strictEqual(counts.all, 4);
        assert.strictEqual(counts.proposed, 1);
        assert.strictEqual(counts.active, 2);
        assert.strictEqual(counts.reverted, 1);
        assert.strictEqual(counts.validated, 0);
    });

    await test('filterByStatus with null/empty filter returns all', () => {
        const patches = [makePatch(), makePatch({ patch_id: FAKE_ULID_2 })];
        assert.strictEqual(CORE.filterByStatus(patches, null).length, 2);
        assert.strictEqual(CORE.filterByStatus(patches, '').length, 2);
    });

    // =================================================================
    // 15. Payload builders (5 tests)
    // =================================================================
    console.log('\n📦 Payload builders:');
    await test('buildProposePayload throws on missing title', () => {
        assert.throws(() => CORE.buildProposePayload({ patch_body_json: '{}' }), /title/);
    });

    await test('buildValidatePayload creates correct payload', () => {
        const p = CORE.buildValidatePayload(FAKE_ULID_1, 'tester', '{"x":1}');
        assert.strictEqual(p.patch_id, FAKE_ULID_1);
        assert.strictEqual(p.validated_by, 'tester');
        assert.strictEqual(p.validation_notes_json, '{"x":1}');
    });

    await test('buildRevertPayload throws on missing reverted_by', () => {
        assert.throws(() => CORE.buildRevertPayload(FAKE_ULID_1, ''), /reverted_by/);
    });

    await test('buildRevalidatePayload only accepts valid/invalid', () => {
        assert.throws(() => CORE.buildRevalidatePayload(FAKE_ULID_1, 'maybe'), /validation_result/);
        const p = CORE.buildRevalidatePayload(FAKE_ULID_1, 'invalid', 'x');
        assert.strictEqual(p.validation_result, 'invalid');
    });

    await test('buildSupersedePayload throws on invalid ULIDs', () => {
        assert.throws(() => CORE.buildSupersedePayload('bad', FAKE_ULID_2), /patch_id/);
        assert.throws(() => CORE.buildSupersedePayload(FAKE_ULID_1, 'bad'), /superseded_by/);
    });

    // =================================================================
    // 16. Full lifecycle flow through UI functions (3 tests)
    // =================================================================
    console.log('\n📦 Full lifecycle flow:');
    await test('lifecycle: formatPatchCard reflects status at each stage', () => {
        const stages = ['proposed', 'validated', 'active', 'needs_revalidation', 'validated', 'reverted'];
        for (const status of stages) {
            const html = CORE.formatPatchCard(makePatch({ patch_status: status }));
            assert.ok(html.includes('st-' + status), `card should have class st-${status}`);
            const actions = CORE.getStatusActions(status);
            for (const action of actions) {
                assert.ok(html.includes('data-action="' + action + '"'), `card should have action ${action} for status ${status}`);
            }
        }
    });

    await test('lifecycle: actions change correctly through full flow', () => {
        // proposed → has validate
        assert.ok(CORE.getStatusActions('proposed').includes('validate'));
        // validated → has activate
        assert.ok(CORE.getStatusActions('validated').includes('activate'));
        // active → has deactivate
        assert.ok(CORE.getStatusActions('active').includes('deactivate'));
        // needs_revalidation → has revalidate_valid
        assert.ok(CORE.getStatusActions('needs_revalidation').includes('revalidate_valid'));
        // reverted → empty
        assert.strictEqual(CORE.getStatusActions('reverted').length, 0);
        // superseded → empty
        assert.strictEqual(CORE.getStatusActions('superseded').length, 0);
    });

    await test('lifecycle: status badges render distinct colors per stage', () => {
        const statuses = ['proposed', 'validated', 'active', 'needs_revalidation', 'reverted', 'superseded'];
        const colors = new Set();
        for (const s of statuses) {
            const badge = CORE.buildStatusBadge(s);
            const c = CORE.getStatusColor(s);
            colors.add(c.border);
            assert.ok(badge.includes(c.bg), `badge for ${s} should contain its bg color`);
        }
        // All 6 should have distinct border colors
        assert.strictEqual(colors.size, 6, 'all 6 statuses should have distinct border colors');
    });

    // =================================================================
    // 17. Edge cases (3 tests)
    // =================================================================
    console.log('\n📦 Edge cases:');
    await test('buildActionButtons returns empty for reverted/superseded', () => {
        assert.strictEqual(CORE.buildActionButtons('reverted', FAKE_ULID_1), '');
        assert.strictEqual(CORE.buildActionButtons('superseded', FAKE_ULID_1), '');
    });

    await test('truncate handles null/undefined gracefully', () => {
        assert.strictEqual(CORE.truncate(null, 10), '');
        assert.strictEqual(CORE.truncate(undefined, 10), '');
        assert.strictEqual(CORE.truncate('short', 10), 'short');
        assert.strictEqual(CORE.truncate('a very long text here', 10), 'a very lon…');
    });

    await test('formatTimestamp returns dash for null', () => {
        assert.strictEqual(CORE.formatTimestamp(null), '—');
        assert.strictEqual(CORE.formatTimestamp(undefined), '—');
    });
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
    try {
        await runAllTests();
    } catch (error) {
        testsFailed++;
        console.error('\n💥 Test run crashed:', error.message);
        console.error(error.stack);
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Passed: ${testsPassed}  ❌ Failed: ${testsFailed}`);
    console.log('═'.repeat(60) + '\n');
    process.exit(testsFailed > 0 ? 1 : 0);
}

main();
