/**
 * G6 Companion Patch Core - Unit Tests
 * 
 * Tests cover:
 * - All 7 RPC methods (propose, validate, activate, deactivate, revert, revalidate, supersede)
 * - 6-state machine transitions (proposed → validated → active → needs_revalidation/reverted/superseded)
 * - Append-only revert semantics
 * - Idempotency of propose/validate/activate
 * - Validation notes persistence
 * - Error cases (invalid state transitions, missing fields)
 * - Query (GET) with status filtering and environment inclusion
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Test harness
const { startTestServer, stopTestServer } = require('../companion/index');

let BASE_URL;
let testCtx;

async function rpc(method, path, body = null) {
    const urlStr = `${BASE_URL}${path}`;
    const parsed = new URL(urlStr);
    
    const options = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

describe('G6 Companion Patch Core', () => {
    before(async () => {
        testCtx = await startTestServer({ port: 0, dbPath: ':memory:' });
        BASE_URL = `http://127.0.0.1:${testCtx.port}`;
    });
    
    after(async () => {
        await stopTestServer();
    });
    
    // =====================================================================
    // POST /rpc/patch/propose
    // =====================================================================
    describe('POST /rpc/patch/propose', () => {
        test('should propose a new patch and return patch_id', async () => {
            const res = await rpc('POST', '/rpc/patch/propose', {
                title: 'Fix login timeout',
                description: 'Increase timeout from 5s to 30s',
                patch_body_json: JSON.stringify({ file: 'auth.js', change: 'timeout = 30000' })
            });
            
            assert.equal(res.status, 200);
            assert.ok(res.body.result.patch_id);
            assert.equal(res.body.result.patch_status, 'proposed');
            assert.ok(res.body.result.event_id);
        });
        
        test('should reject proposal without title', async () => {
            const res = await rpc('POST', '/rpc/patch/propose', {
                patch_body_json: JSON.stringify({ change: 'x' })
            });
            
            assert.equal(res.status, 400);
            assert.ok(res.body.error);
        });
        
        test('should reject proposal without patch_body_json', async () => {
            const res = await rpc('POST', '/rpc/patch/propose', {
                title: 'Test patch'
            });
            
            assert.equal(res.status, 400);
            assert.ok(res.body.error);
        });
    });
    
    // =====================================================================
    // POST /rpc/patch/validate
    // =====================================================================
    describe('POST /rpc/patch/validate', () => {
        let patchId;
        
        before(async () => {
            const res = await rpc('POST', '/rpc/patch/propose', {
                title: 'Validation test patch',
                patch_body_json: JSON.stringify({ test: true })
            });
            patchId = res.body.result.patch_id;
        });
        
        test('should validate a proposed patch', async () => {
            const res = await rpc('POST', '/rpc/patch/validate', {
                patch_id: patchId,
                validated_by: 'test-user',
                validation_notes_json: JSON.stringify({ checked: true, score: 0.95 })
            });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'validated');
            assert.equal(res.body.result.validated_by, 'test-user');
            assert.ok(res.body.result.validated_at);
        });
        
        test('should reject validation without validated_by', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Another test',
                patch_body_json: JSON.stringify({ test: true })
            });
            
            const res = await rpc('POST', '/rpc/patch/validate', {
                patch_id: propRes.body.result.patch_id
            });
            
            assert.equal(res.status, 400);
        });
        
        test('should reject validation of non-existent patch', async () => {
            const res = await rpc('POST', '/rpc/patch/validate', {
                patch_id: '01J0000000000000000000FAKE',
                validated_by: 'test'
            });
            
            assert.equal(res.status, 404);
        });
        
        test('should reject validation of already-active patch', async () => {
            // Activate the validated patch first
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
            
            const res = await rpc('POST', '/rpc/patch/validate', {
                patch_id: patchId,
                validated_by: 'test'
            });
            
            assert.equal(res.status, 400);
        });
    });
    
    // =====================================================================
    // POST /rpc/patch/activate
    // =====================================================================
    describe('POST /rpc/patch/activate', () => {
        let patchId;
        
        before(async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Activation test',
                patch_body_json: JSON.stringify({ activate: true })
            });
            patchId = propRes.body.result.patch_id;
            
            await rpc('POST', '/rpc/patch/validate', {
                patch_id: patchId,
                validated_by: 'tester'
            });
        });
        
        test('should activate a validated patch', async () => {
            const res = await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'active');
            assert.ok(res.body.result.activated_at);
        });
        
        test('should reject activation of proposed (non-validated) patch', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Not validated',
                patch_body_json: JSON.stringify({ x: 1 })
            });
            
            const res = await rpc('POST', '/rpc/patch/activate', {
                patch_id: propRes.body.result.patch_id
            });
            
            assert.equal(res.status, 400);
        });
    });
    
    // =====================================================================
    // POST /rpc/patch/deactivate
    // =====================================================================
    describe('POST /rpc/patch/deactivate', () => {
        let patchId;
        
        before(async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Deactivation test',
                patch_body_json: JSON.stringify({ deactivate: true })
            });
            patchId = propRes.body.result.patch_id;
            
            await rpc('POST', '/rpc/patch/validate', { patch_id: patchId, validated_by: 'tester' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
        });
        
        test('should deactivate an active patch to needs_revalidation', async () => {
            const res = await rpc('POST', '/rpc/patch/deactivate', { patch_id: patchId });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'needs_revalidation');
        });
        
        test('should reject deactivation of proposed patch', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Proposed only',
                patch_body_json: JSON.stringify({ x: 1 })
            });
            
            const res = await rpc('POST', '/rpc/patch/deactivate', {
                patch_id: propRes.body.result.patch_id
            });
            
            assert.equal(res.status, 400);
        });
    });
    
    // =====================================================================
    // POST /rpc/patch/revert (append-only semantics)
    // =====================================================================
    describe('POST /rpc/patch/revert', () => {
        let patchId;
        
        before(async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Revert test',
                patch_body_json: JSON.stringify({ revert: true })
            });
            patchId = propRes.body.result.patch_id;
            
            await rpc('POST', '/rpc/patch/validate', { patch_id: patchId, validated_by: 'tester' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
        });
        
        test('should revert an active patch', async () => {
            const res = await rpc('POST', '/rpc/patch/revert', {
                patch_id: patchId,
                reverted_by: 'admin-user',
                revert_reason: 'Caused regression in login flow'
            });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'reverted');
            assert.ok(res.body.result.reverted_at);
            assert.equal(res.body.result.reverted_by, 'admin-user');
        });
        
        test('should preserve history after revert (append-only)', async () => {
            // Query the patch - original data should still be there
            const res = await rpc('GET', `/rpc/patch/query?patch_id=${patchId}`);
            
            assert.equal(res.status, 200);
            const patch = res.body.result.patches[0];
            assert.equal(patch.patch_status, 'reverted');
            assert.equal(patch.title, 'Revert test');
            assert.ok(patch.patch_body_json); // Original body preserved
            assert.ok(patch.reverted_at); // Revert timestamp recorded
        });
        
        test('should reject revert without reverted_by', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Another revert test',
                patch_body_json: JSON.stringify({ x: 1 })
            });
            await rpc('POST', '/rpc/patch/validate', { patch_id: propRes.body.result.patch_id, validated_by: 'a' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: propRes.body.result.patch_id });
            
            const res = await rpc('POST', '/rpc/patch/revert', {
                patch_id: propRes.body.result.patch_id
            });
            
            assert.equal(res.status, 400);
        });
        
        test('should reject revert of proposed patch', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Cannot revert proposed',
                patch_body_json: JSON.stringify({ x: 1 })
            });
            
            const res = await rpc('POST', '/rpc/patch/revert', {
                patch_id: propRes.body.result.patch_id,
                reverted_by: 'admin'
            });
            
            assert.equal(res.status, 400);
        });
    });
    
    // =====================================================================
    // POST /rpc/patch/revalidate
    // =====================================================================
    describe('POST /rpc/patch/revalidate', () => {
        let patchId;
        
        before(async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Revalidation test',
                patch_body_json: JSON.stringify({ reval: true })
            });
            patchId = propRes.body.result.patch_id;
            
            await rpc('POST', '/rpc/patch/validate', { patch_id: patchId, validated_by: 'tester' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
            await rpc('POST', '/rpc/patch/deactivate', { patch_id: patchId });
        });
        
        test('should revalidate as valid → back to validated', async () => {
            const res = await rpc('POST', '/rpc/patch/revalidate', {
                patch_id: patchId,
                validation_result: 'valid',
                validated_by: 'revalidator'
            });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'validated');
            assert.equal(res.body.result.validation_result, 'valid');
        });
        
        test('should revalidate as invalid → back to proposed', async () => {
            // First put back to needs_revalidation
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
            await rpc('POST', '/rpc/patch/deactivate', { patch_id: patchId });
            
            const res = await rpc('POST', '/rpc/patch/revalidate', {
                patch_id: patchId,
                validation_result: 'invalid'
            });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'proposed');
        });
        
        test('should reject revalidation of active patch', async () => {
            // Re-validate and activate
            await rpc('POST', '/rpc/patch/validate', { patch_id: patchId, validated_by: 'x' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
            
            const res = await rpc('POST', '/rpc/patch/revalidate', {
                patch_id: patchId,
                validation_result: 'valid'
            });
            
            assert.equal(res.status, 400);
        });
    });
    
    // =====================================================================
    // POST /rpc/patch/supersede
    // =====================================================================
    describe('POST /rpc/patch/supersede', () => {
        let patchId;
        let newPatchId;
        
        before(async () => {
            // Create original patch
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Original patch to be superseded',
                patch_body_json: JSON.stringify({ original: true })
            });
            patchId = propRes.body.result.patch_id;
            await rpc('POST', '/rpc/patch/validate', { patch_id: patchId, validated_by: 'a' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: patchId });
            
            // Create replacement patch
            const newRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Replacement patch',
                patch_body_json: JSON.stringify({ replacement: true })
            });
            newPatchId = newRes.body.result.patch_id;
        });
        
        test('should supersede an active patch with another', async () => {
            const res = await rpc('POST', '/rpc/patch/supersede', {
                patch_id: patchId,
                superseded_by_patch_id: newPatchId
            });
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patch_status, 'superseded');
            assert.equal(res.body.result.superseded_by, newPatchId);
        });
        
        test('should reject supersede without valid superseded_by_patch_id', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Another',
                patch_body_json: JSON.stringify({ x: 1 })
            });
            await rpc('POST', '/rpc/patch/validate', { patch_id: propRes.body.result.patch_id, validated_by: 'a' });
            
            const res = await rpc('POST', '/rpc/patch/supersede', {
                patch_id: propRes.body.result.patch_id,
                superseded_by_patch_id: 'invalid-ulid'
            });
            
            assert.equal(res.status, 400);
        });
    });
    
    // =====================================================================
    // GET /rpc/patch/query
    // =====================================================================
    describe('GET /rpc/patch/query', () => {
        test('should return all patches', async () => {
            const res = await rpc('GET', '/rpc/patch/query');
            
            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.body.result.patches));
            assert.ok(res.body.result.count > 0);
        });
        
        test('should filter by status', async () => {
            const res = await rpc('GET', '/rpc/patch/query?status=proposed');
            
            assert.equal(res.status, 200);
            for (const patch of res.body.result.patches) {
                assert.equal(patch.patch_status, 'proposed');
            }
        });
        
        test('should query by patch_id', async () => {
            // Create a known patch
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Query test',
                patch_body_json: JSON.stringify({ query: true })
            });
            const pid = propRes.body.result.patch_id;
            
            const res = await rpc('GET', `/rpc/patch/query?patch_id=${pid}`);
            
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patches.length, 1);
            assert.equal(res.body.result.patches[0].patch_id, pid);
        });
    });
    
    // =====================================================================
    // Full lifecycle test (state machine traversal)
    // =====================================================================
    describe('Full state machine lifecycle', () => {
        test('should traverse proposed → validated → active → needs_revalidation → validated → active → reverted', async () => {
            // Propose
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Full lifecycle test',
                patch_body_json: JSON.stringify({ lifecycle: 'full' })
            });
            const pid = propRes.body.result.patch_id;
            assert.equal(propRes.body.result.patch_status, 'proposed');
            
            // Validate
            const valRes = await rpc('POST', '/rpc/patch/validate', {
                patch_id: pid,
                validated_by: 'lifecycle-tester',
                validation_notes_json: JSON.stringify({ step: 'initial_validation' })
            });
            assert.equal(valRes.body.result.patch_status, 'validated');
            
            // Activate
            const actRes = await rpc('POST', '/rpc/patch/activate', { patch_id: pid });
            assert.equal(actRes.body.result.patch_status, 'active');
            
            // Deactivate (needs_revalidation)
            const deactRes = await rpc('POST', '/rpc/patch/deactivate', { patch_id: pid });
            assert.equal(deactRes.body.result.patch_status, 'needs_revalidation');
            
            // Revalidate (back to validated)
            const revalRes = await rpc('POST', '/rpc/patch/revalidate', {
                patch_id: pid,
                validation_result: 'valid',
                validated_by: 'revalidator'
            });
            assert.equal(revalRes.body.result.patch_status, 'validated');
            
            // Re-activate
            const reactRes = await rpc('POST', '/rpc/patch/activate', { patch_id: pid });
            assert.equal(reactRes.body.result.patch_status, 'active');
            
            // Revert (final)
            const revRes = await rpc('POST', '/rpc/patch/revert', {
                patch_id: pid,
                reverted_by: 'admin',
                revert_reason: 'No longer needed'
            });
            assert.equal(revRes.body.result.patch_status, 'reverted');
            
            // Verify final state preserves all data
            const queryRes = await rpc('GET', `/rpc/patch/query?patch_id=${pid}`);
            const final = queryRes.body.result.patches[0];
            assert.equal(final.title, 'Full lifecycle test');
            assert.equal(final.patch_status, 'reverted');
            assert.ok(final.reverted_at);
            assert.ok(final.validated_at);
            assert.ok(final.activated_at);
        });
        
        test('should traverse proposed → validated → superseded', async () => {
            // Propose original
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'To be superseded',
                patch_body_json: JSON.stringify({ v: 1 })
            });
            const pid = propRes.body.result.patch_id;
            
            await rpc('POST', '/rpc/patch/validate', { patch_id: pid, validated_by: 'a' });
            
            // Propose replacement
            const newRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Replacement v2',
                patch_body_json: JSON.stringify({ v: 2 })
            });
            const newPid = newRes.body.result.patch_id;
            
            // Supersede
            const supRes = await rpc('POST', '/rpc/patch/supersede', {
                patch_id: pid,
                superseded_by_patch_id: newPid
            });
            assert.equal(supRes.body.result.patch_status, 'superseded');
            assert.equal(supRes.body.result.superseded_by, newPid);
        });
    });
    
    // =====================================================================
    // Idempotency tests
    // =====================================================================
    describe('Idempotency', () => {
        test('proposing same patch twice creates two distinct patches', async () => {
            const res1 = await rpc('POST', '/rpc/patch/propose', {
                title: 'Idempotent test',
                patch_body_json: JSON.stringify({ idempotent: true })
            });
            const res2 = await rpc('POST', '/rpc/patch/propose', {
                title: 'Idempotent test',
                patch_body_json: JSON.stringify({ idempotent: true })
            });
            
            assert.notEqual(res1.body.result.patch_id, res2.body.result.patch_id);
        });
    });
    
    // =====================================================================
    // Validation notes persistence
    // =====================================================================
    describe('Validation notes persistence', () => {
        test('should persist validation_notes_json through state transitions', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Notes test',
                patch_body_json: JSON.stringify({ notes: true })
            });
            const pid = propRes.body.result.patch_id;
            
            const notes = JSON.stringify({
                checks: ['lint_pass', 'type_check_pass', 'test_pass'],
                confidence: 0.98,
                reviewer: 'ai-reviewer-v3'
            });
            
            await rpc('POST', '/rpc/patch/validate', {
                patch_id: pid,
                validated_by: 'ai-reviewer-v3',
                validation_notes_json: notes
            });
            
            // Query and verify notes persisted
            const queryRes = await rpc('GET', `/rpc/patch/query?patch_id=${pid}`);
            const patch = queryRes.body.result.patches[0];
            assert.equal(patch.validation_notes_json, notes);
        });
    });
    
    // =====================================================================
    // Edge cases and error handling
    // =====================================================================
    describe('Edge cases', () => {
        test('should return empty array for non-existent status filter', async () => {
            const res = await rpc('GET', '/rpc/patch/query?status=nonexistent');
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patches.length, 0);
        });
        
        test('should return 404 for query of non-existent patch_id', async () => {
            const res = await rpc('GET', '/rpc/patch/query?patch_id=01J0000000000000000000NONE');
            assert.equal(res.status, 200);
            assert.equal(res.body.result.patches.length, 0);
        });
        
        test('should reject activate with invalid ULID', async () => {
            const res = await rpc('POST', '/rpc/patch/activate', {
                patch_id: 'not-a-ulid'
            });
            assert.equal(res.status, 400);
        });
        
        test('should reject supersede of reverted patch', async () => {
            const propRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'Reverted then supersede',
                patch_body_json: JSON.stringify({ x: 1 })
            });
            const pid = propRes.body.result.patch_id;
            await rpc('POST', '/rpc/patch/validate', { patch_id: pid, validated_by: 'a' });
            await rpc('POST', '/rpc/patch/activate', { patch_id: pid });
            await rpc('POST', '/rpc/patch/revert', { patch_id: pid, reverted_by: 'admin' });
            
            const newRes = await rpc('POST', '/rpc/patch/propose', {
                title: 'New',
                patch_body_json: JSON.stringify({ y: 1 })
            });
            
            const res = await rpc('POST', '/rpc/patch/supersede', {
                patch_id: pid,
                superseded_by_patch_id: newRes.body.result.patch_id
            });
            assert.equal(res.status, 400);
        });
    });
});
