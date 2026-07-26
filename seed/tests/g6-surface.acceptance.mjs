/**
 * G6 Surface Patch Management — Acceptance Test (E2E)
 *
 * End-to-end test that:
 * 1. Starts companion test server (in-process, temp DB)
 * 2. Exercises the full patch lifecycle through the API client functions
 *    (simulating UI interaction): Propose → Validate → Activate →
 *    Deactivate → Revalidate → Revert
 * 3. Also tests the Supersede path
 * 4. Verifies status changes are reflected in the UI rendering functions
 * 5. Takes HTML snapshots at key steps (saved to seed/docs/evidence/g6/)
 *
 * Zero npm dependencies. Uses createRequire to bridge CommonJS companion.
 *
 * Run: node seed/tests/g6-surface.acceptance.mjs
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Bridge CommonJS modules
const { startTestServer, stopTestServer } = require('../companion/index.js');
const CORE = require('../surface/g6-patches-core.js');

// ──────────────────────────────────────────────────────────────
// Test state
// ──────────────────────────────────────────────────────────────
let BASE_URL;
let testCtx;
let testsPassed = 0;
let testsFailed = 0;
const evidenceDir = path.join(REPO_ROOT, 'seed', 'docs', 'evidence', 'g6');

function assert(condition, message) {
    if (!condition) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message}`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message} (expected "${expected}", got "${actual}")`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

// ──────────────────────────────────────────────────────────────
// Evidence: HTML snapshot (zero-dependency "screenshot")
// ──────────────────────────────────────────────────────────────
function generateSnapshot(stepName, title, patches, extraInfo) {
    if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const counts = CORE.countByStatus(patches);
    const cardsHtml = patches.length > 0
        ? patches.map(p => CORE.formatPatchCard(p)).join('\n')
        : '<div class="empty-honest">暂无补丁</div>';

    const filterTabsHtml = CORE.PATCH_STATUSES.map(s => {
        const label = CORE.PATCH_STATUS_LABELS[s] || s;
        return `<span class="filter-tab" data-status="${s}">${label} <span class="tab-count">${counts[s] || 0}</span></span>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>G6 Acceptance — ${title}</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; background: #f4f5f7; color: #24292f; line-height: 1.55; padding: 16px; }
    h1 { font-size: 18px; margin-bottom: 8px; }
    .step-info { font-size: 12px; color: #656d76; margin-bottom: 12px; }
    .filter-tabs { background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 6px 8px; display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
    .filter-tab { padding: 5px 12px; border: 1px solid transparent; border-radius: 6px; font-size: 12px; font-weight: 600; background: #f6f8fa; color: #24292f; }
    .filter-tab .tab-count { display: inline-block; font-size: 10px; background: rgba(0,0,0,0.1); padding: 0 5px; border-radius: 8px; margin-left: 4px; }
    .patch-card { border: 1px solid #e1e4e8; border-left: 3px solid #d0d7de; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: #fafbfc; max-width: 700px; }
    .patch-card.st-proposed { border-left-color: #d0d7de; }
    .patch-card.st-validated { border-left-color: #0969da; }
    .patch-card.st-active { border-left-color: #2da44e; }
    .patch-card.st-needs_revalidation { border-left-color: #d29922; }
    .patch-card.st-reverted { border-left-color: #cf222e; }
    .patch-card.st-superseded { border-left-color: #8250df; }
    .patch-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
    .patch-card-title { font-weight: 600; font-size: 13px; flex: 1; }
    .patch-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 8px; white-space: nowrap; border: 1px solid; }
    .patch-card-desc { font-size: 12px; color: #57606a; margin: 4px 0; }
    .patch-card-meta { font-size: 11px; color: #656d76; display: flex; gap: 8px; flex-wrap: wrap; }
    .patch-card-env { margin-top: 4px; }
    .patch-card-actions { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
    .env-health-indicator { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid; }
    .env-health-time { font-size: 11px; color: #656d76; margin-left: 6px; }
    .patch-action { padding: 5px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; color: #fff; }
    .patch-action.green { background: #2da44e; }
    .patch-action.blue { background: #0969da; }
    .patch-action.red { background: #cf222e; }
    .patch-action.purple { background: #8250df; }
    .patch-action.secondary { background: #f6f8fa; color: #24292f; border: 1px solid #d0d7de; }
    .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
    .empty-honest { font-size: 12px; color: #656d76; background: #f6f8fa; border: 1px dashed #d0d7de; border-radius: 6px; padding: 10px 12px; max-width: 700px; }
    .extra-info { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 8px 12px; font-size: 12px; margin: 12px 0; max-width: 700px; font-family: ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<h1>🧩 G6 Patch Management — ${title}</h1>
<div class="step-info">Step: ${stepName} · Generated: ${new Date().toISOString()}</div>
${extraInfo ? `<div class="extra-info">${extraInfo}</div>` : ''}
<div class="filter-tabs">
    <span class="filter-tab" style="background:#0969da;color:#fff;">全部 <span class="tab-count" style="background:rgba(255,255,255,0.3);">${counts.all}</span></span>
    ${filterTabsHtml}
</div>
<div class="patch-list">
    ${cardsHtml}
</div>
</body>
</html>`;

    const filePath = path.join(evidenceDir, `${stepName}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`  📸 Snapshot saved: ${path.relative(REPO_ROOT, filePath)}`);
    return filePath;
}

// ──────────────────────────────────────────────────────────────
// Helper: fetch current patch state from server
// ──────────────────────────────────────────────────────────────
async function getPatch(patchId) {
    const res = await CORE.fetchPatches(BASE_URL, { patch_id: patchId, include_environment: true });
    if (res.ok && res.patches.length > 0) return res.patches[0];
    return null;
}

async function getAllPatches() {
    const res = await CORE.fetchPatches(BASE_URL, { include_environment: true });
    return res.ok ? res.patches : [];
}

// ──────────────────────────────────────────────────────────────
// Main test flow
// ──────────────────────────────────────────────────────────────
async function runAcceptanceTests() {
    console.log('\n🧪 G6 Surface Patch Management — Acceptance Tests\n');

    // ── Step 0: Start companion ──
    console.log('📦 Step 0: Start companion test server');
    testCtx = await startTestServer({ port: 0, dbPath: ':memory:' });
    BASE_URL = `http://127.0.0.1:${testCtx.port}`;
    assert(!!BASE_URL, 'companion test server started');
    console.log(`  ✓ Companion running at ${BASE_URL}`);

    try {
        // ── Step 1: Propose a patch ──
        console.log('\n📦 Step 1: Propose a new patch via API client');
        const proposeRes = await CORE.proposePatch(BASE_URL, {
            title: 'Fix login timeout issue',
            description: 'Increase session timeout from 5s to 30s to prevent premature logouts during slow network conditions.',
            patch_body_json: JSON.stringify({ file: 'src/auth/session.js', change: 'timeout: 5000 → 30000', line: 42 })
        });
        assert(proposeRes.ok, 'proposePatch returns ok');
        assertEqual(proposeRes.result.patch_status, 'proposed', 'proposed patch status = proposed');
        const patchId1 = proposeRes.result.patch_id;
        assert(CORE.isValidULID(patchId1), 'patch_id is valid ULID');

        // Verify via fetchPatches
        const patch1Proposed = await getPatch(patchId1);
        assert(!!patch1Proposed, 'fetchPatches returns the proposed patch');
        assertEqual(patch1Proposed.patch_status, 'proposed', 'queried patch status = proposed');

        // Verify UI rendering functions
        const cardHtml = CORE.formatPatchCard(patch1Proposed);
        assert(cardHtml.includes('st-proposed'), 'formatPatchCard renders proposed class');
        assert(cardHtml.includes('data-action="validate"'), 'card has validate action button');
        assert(cardHtml.includes('data-action="supersede"'), 'card has supersede action button');

        // Snapshot
        const allPatches1 = await getAllPatches();
        generateSnapshot('01-proposed', 'Propose — Patch Created', allPatches1,
            `patch_id: ${patchId1}\ntitle: Fix login timeout issue\nstatus: proposed`);

        // ── Step 2: Validate the patch ──
        console.log('\n📦 Step 2: Validate the patch');
        const validateRes = await CORE.validatePatch(BASE_URL, {
            patch_id: patchId1,
            validated_by: 'acceptance-tester',
            validation_notes_json: JSON.stringify({ checked: true, score: 0.95, notes: 'Code review passed, tests green' })
        });
        assert(validateRes.ok, 'validatePatch returns ok');
        assertEqual(validateRes.result.patch_status, 'validated', 'validated patch status = validated');
        assertEqual(validateRes.result.validated_by, 'acceptance-tester', 'validated_by preserved');

        const patch1Validated = await getPatch(patchId1);
        assertEqual(patch1Validated.patch_status, 'validated', 'queried status = validated');
        assertEqual(patch1Validated.validated_by, 'acceptance-tester', 'validated_by in projection');

        // Verify UI actions changed
        const actions2 = CORE.getStatusActions('validated');
        assert(actions2.includes('activate'), 'validated has activate action');
        assert(actions2.includes('revert'), 'validated has revert action');
        assert(actions2.includes('supersede'), 'validated has supersede action');

        const allPatches2 = await getAllPatches();
        generateSnapshot('02-validated', 'Validate — Patch Reviewed', allPatches2,
            `patch_id: ${patchId1}\nstatus: validated\nvalidated_by: acceptance-tester`);

        // ── Step 3: Activate the patch ──
        console.log('\n📦 Step 3: Activate the patch');
        const activateRes = await CORE.activatePatch(BASE_URL, { patch_id: patchId1 });
        assert(activateRes.ok, 'activatePatch returns ok');
        assertEqual(activateRes.result.patch_status, 'active', 'activated patch status = active');

        const patch1Active = await getPatch(patchId1);
        assertEqual(patch1Active.patch_status, 'active', 'queried status = active');
        assert(!!patch1Active.activated_at, 'activated_at is set');

        // Verify UI actions for active
        const actions3 = CORE.getStatusActions('active');
        assert(actions3.includes('deactivate'), 'active has deactivate action');
        assert(actions3.includes('revert'), 'active has revert action');

        const allPatches3 = await getAllPatches();
        generateSnapshot('03-active', 'Activate — Patch Live', allPatches3,
            `patch_id: ${patchId1}\nstatus: active\nactivated_at: ${patch1Active.activated_at}`);

        // ── Step 4: Deactivate the patch (→ needs_revalidation) ──
        console.log('\n📦 Step 4: Deactivate the patch (→ needs_revalidation)');
        const deactivateRes = await CORE.deactivatePatch(BASE_URL, { patch_id: patchId1 });
        assert(deactivateRes.ok, 'deactivatePatch returns ok');
        assertEqual(deactivateRes.result.patch_status, 'needs_revalidation', 'deactivated status = needs_revalidation');

        const patch1NeedsReval = await getPatch(patchId1);
        assertEqual(patch1NeedsReval.patch_status, 'needs_revalidation', 'queried status = needs_revalidation');

        // Verify UI actions for needs_revalidation
        const actions4 = CORE.getStatusActions('needs_revalidation');
        assert(actions4.includes('revalidate_valid'), 'needs_revalidation has revalidate_valid action');
        assert(actions4.includes('revalidate_invalid'), 'needs_revalidation has revalidate_invalid action');

        const allPatches4 = await getAllPatches();
        generateSnapshot('04-needs-revalidation', 'Deactivate — Needs Revalidation', allPatches4,
            `patch_id: ${patchId1}\nstatus: needs_revalidation\n(was active, now needs re-check)`);

        // ── Step 5: Revalidate as valid (→ validated) ──
        console.log('\n📦 Step 5: Revalidate as valid (→ validated)');
        const revalidateRes = await CORE.revalidatePatch(BASE_URL, {
            patch_id: patchId1,
            validation_result: 'valid',
            validated_by: 'acceptance-tester'
        });
        assert(revalidateRes.ok, 'revalidatePatch returns ok');
        assertEqual(revalidateRes.result.patch_status, 'validated', 'revalidated (valid) status = validated');

        const patch1Revalidated = await getPatch(patchId1);
        assertEqual(patch1Revalidated.patch_status, 'validated', 'queried status = validated after revalidate');

        const allPatches5 = await getAllPatches();
        generateSnapshot('05-revalidated', 'Revalidate — Back to Validated', allPatches5,
            `patch_id: ${patchId1}\nstatus: validated (via revalidate valid)\nvalidation_result: valid`);

        // ── Step 6: Activate again, then Revert ──
        console.log('\n📦 Step 6: Activate again, then Revert');
        const activate2Res = await CORE.activatePatch(BASE_URL, { patch_id: patchId1 });
        assert(activate2Res.ok, 'second activate returns ok');
        assertEqual(activate2Res.result.patch_status, 'active', 're-activated status = active');

        const revertRes = await CORE.revertPatch(BASE_URL, {
            patch_id: patchId1,
            reverted_by: 'acceptance-tester',
            revert_reason: 'Caused regression in production — users reported session conflicts'
        });
        assert(revertRes.ok, 'revertPatch returns ok');
        assertEqual(revertRes.result.patch_status, 'reverted', 'reverted status = reverted');
        assertEqual(revertRes.result.reverted_by, 'acceptance-tester', 'reverted_by preserved');

        const patch1Reverted = await getPatch(patchId1);
        assertEqual(patch1Reverted.patch_status, 'reverted', 'queried status = reverted');
        // Note: reverted_by is stored in the event payload, not in patches_projection
        // (companion schema design — analogous to source_reasoning in G4).
        // The API response carries it; the projection row has reverted_at only.
        assertEqual(revertRes.result.reverted_by, 'acceptance-tester', 'reverted_by in API response');
        assert(!!patch1Reverted.reverted_at, 'reverted_at is set in projection');

        // Verify UI: reverted has no actions
        const actions6 = CORE.getStatusActions('reverted');
        assertEqual(actions6.length, 0, 'reverted has 0 actions');

        const allPatches6 = await getAllPatches();
        generateSnapshot('06-reverted', 'Revert — Patch Rolled Back', allPatches6,
            `patch_id: ${patchId1}\nstatus: reverted\nreverted_by: acceptance-tester\nreason: Caused regression in production`);

        // ── Step 7: Supersede path ──
        console.log('\n📦 Step 7: Supersede path (propose patch2, validate, activate, supersede with patch3)');
        const propose2Res = await CORE.proposePatch(BASE_URL, {
            title: 'Improved timeout with exponential backoff',
            description: 'Replace fixed timeout with exponential backoff retry logic.',
            patch_body_json: JSON.stringify({ file: 'src/auth/session.js', change: 'add retryWithBackoff()', lines: '42-60' })
        });
        assert(propose2Res.ok, 'propose patch2 returns ok');
        const patchId2 = propose2Res.result.patch_id;

        const validate2Res = await CORE.validatePatch(BASE_URL, {
            patch_id: patchId2,
            validated_by: 'acceptance-tester'
        });
        assert(validate2Res.ok, 'validate patch2 returns ok');

        const activate3Res = await CORE.activatePatch(BASE_URL, { patch_id: patchId2 });
        assert(activate3Res.ok, 'activate patch2 returns ok');

        // Propose patch3 as replacement
        const propose3Res = await CORE.proposePatch(BASE_URL, {
            title: 'Configurable timeout via env variable',
            description: 'Make timeout configurable via SESSION_TIMEOUT_MS env variable.',
            patch_body_json: JSON.stringify({ file: 'src/auth/session.js', change: 'timeout = process.env.SESSION_TIMEOUT_MS || 30000' })
        });
        assert(propose3Res.ok, 'propose patch3 returns ok');
        const patchId3 = propose3Res.result.patch_id;

        // Validate patch3 so it's a valid replacement
        const validate3Res = await CORE.validatePatch(BASE_URL, {
            patch_id: patchId3,
            validated_by: 'acceptance-tester'
        });
        assert(validate3Res.ok, 'validate patch3 returns ok');

        // Supersede patch2 with patch3
        const supersedeRes = await CORE.supersedePatch(BASE_URL, {
            patch_id: patchId2,
            superseded_by_patch_id: patchId3
        });
        assert(supersedeRes.ok, 'supersedePatch returns ok');
        assertEqual(supersedeRes.result.patch_status, 'superseded', 'superseded status = superseded');
        assertEqual(supersedeRes.result.superseded_by, patchId3, 'superseded_by = patchId3');

        const patch2Superseded = await getPatch(patchId2);
        assertEqual(patch2Superseded.patch_status, 'superseded', 'queried patch2 status = superseded');
        assertEqual(patch2Superseded.superseded_by, patchId3, 'superseded_by in projection');

        // Verify UI: superseded has no actions
        const actions7 = CORE.getStatusActions('superseded');
        assertEqual(actions7.length, 0, 'superseded has 0 actions');

        const allPatches7 = await getAllPatches();
        generateSnapshot('07-superseded', 'Supersede — Patch Replaced', allPatches7,
            `patch2_id: ${patchId2}\npatch3_id: ${patchId3}\npatch2 status: superseded\nsuperseded_by: ${patchId3}`);

        // ── Step 8: Full lifecycle verification ──
        console.log('\n📦 Step 8: Verify all patches and their final states');
        const finalPatches = await getAllPatches();
        assert(finalPatches.length >= 3, 'at least 3 patches exist in system');

        const counts = CORE.countByStatus(finalPatches);
        assert(counts.reverted >= 1, 'at least 1 reverted patch');
        assert(counts.superseded >= 1, 'at least 1 superseded patch');
        assert(counts.validated >= 1, 'at least 1 validated patch (patch3)');

        // Verify the complete lifecycle was traced correctly
        const p1 = finalPatches.find(p => p.patch_id === patchId1);
        assertEqual(p1.patch_status, 'reverted', 'patch1 final state = reverted');

        const p2 = finalPatches.find(p => p.patch_id === patchId2);
        assertEqual(p2.patch_status, 'superseded', 'patch2 final state = superseded');

        const p3 = finalPatches.find(p => p.patch_id === patchId3);
        assertEqual(p3.patch_status, 'validated', 'patch3 final state = validated');

        // Generate final summary snapshot
        generateSnapshot('08-final-summary', 'Final Summary — All Patches', finalPatches,
            `Total patches: ${finalPatches.length}\n` +
            `Reverted: ${counts.reverted}, Superseded: ${counts.superseded}, Validated: ${counts.validated}\n` +
            `Lifecycle traced: proposed → validated → active → needs_revalidation → validated → active → reverted\n` +
            `Supersede traced: proposed → validated → active → superseded`);

        // ── Step 9: Environment health rendering ──
        console.log('\n📦 Step 9: Environment health indicator rendering');
        const healthHtml = CORE.buildHealthIndicator('healthy', '2026-07-26T10:00:00Z');
        assert(healthHtml.includes('健康'), 'health indicator shows healthy label');
        assert(healthHtml.includes('检查于'), 'health indicator shows last checked time');

        const degradedHtml = CORE.buildHealthIndicator('degraded');
        assert(degradedHtml.includes('降级'), 'health indicator shows degraded label');

        const unhealthyHtml = CORE.buildHealthIndicator('unhealthy');
        assert(unhealthyHtml.includes('不健康'), 'health indicator shows unhealthy label');

        // ── Step 10: Detail panel rendering ──
        console.log('\n📦 Step 10: Detail panel rendering');
        const detailHtml = CORE.formatPatchDetail(p1);
        assert(detailHtml.includes('patch-detail'), 'detail has patch-detail class');
        assert(detailHtml.includes('Fix login timeout issue'), 'detail shows patch title');
        assert(detailHtml.includes('回退时间'), 'detail shows revert timestamp section');
        // validated_by 'acceptance-tester' is shown in the validation section
        assert(detailHtml.includes('acceptance-tester'), 'detail shows validated_by value');

    } finally {
        await stopTestServer();
    }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
    try {
        await runAcceptanceTests();
    } catch (error) {
        testsFailed++;
        console.error('\n💥 Acceptance test crashed:', error.message);
        console.error(error.stack);
        try { await stopTestServer(); } catch (_) { /* best effort */ }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Passed: ${testsPassed}  ❌ Failed: ${testsFailed}`);
    console.log('═'.repeat(60) + '\n');
    process.exit(testsFailed > 0 ? 1 : 0);
}

main();
