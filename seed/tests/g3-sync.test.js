/**
 * G3 GitHub Sync - Tests (local bare repo as simulated remote)
 * - three-way merge: clean path & conflict path (diff3 markers verbatim)
 * - pushCandidate: candidate branch only, user canonical NEVER overwritten
 * - conflict: no push, conflict text preserved for event ingestion
 * - pull-back: remote change detected via sha256 and ingested as event
 *
 * Zero dependencies; run: node seed/tests/g3-sync.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    threeWayMerge,
    runGit,
    sha256,
    GitHubSync,
    createLocalBareRepo,
    CANDIDATE_BRANCH,
    CANDIDATE_DIR
} = require('../companion/github-sync');
const { CompanionDB } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { MaterialProcessor } = require('../companion/materials');
const { generateULID } = require('../companion/ulid');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (!condition) {
        testsFailed++;
        console.log(`  ❌ FAIL: ${message}`);
    } else {
        testsPassed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'test-g3-sync-'));
const GIT_ID = ['-c', 'user.name=g3-test', '-c', 'user.email=g3-test@localhost'];

/**
 * Commit content to the bare repo's main branch as the "user" would.
 */
async function userCommit(bareRepo, filePath, content, message) {
    const workDir = fs.mkdtempSync(path.join(tmpBase, 'user-'));
    await runGit(['clone', bareRepo, workDir], tmpBase);
    const abs = path.join(workDir, filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    await runGit(['add', filePath], workDir);
    const commit = await runGit([...GIT_ID, 'commit', '-m', message], workDir);
    if (!commit.success) throw new Error(`user commit failed: ${commit.stderr}`);
    const push = await runGit(['push', 'origin', 'HEAD:main'], workDir);
    if (!push.success) throw new Error(`user push failed: ${push.stderr}`);
    fs.rmSync(workDir, { recursive: true, force: true });
}

async function runAllTests() {
    console.log('\n🧪 G3 GitHub Sync - Local Bare Repo Tests\n');

    // -------------------------------------------------------------
    console.log('\n📦 Test 1: three-way merge - clean path');
    {
        const base = 'line1\nline2\nline3\n';
        const ours = 'line1-user-edit\nline2\nline3\n';      // user edited line 1
        const theirs = 'line1\nline2\nline3-dcf-edit\n';     // DCF edited line 3
        const result = await threeWayMerge({ baseContent: base, oursContent: ours, theirsContent: theirs });
        assert(result.hasConflict === false, 'non-overlapping edits merge cleanly');
        assert(result.mergedContent === 'line1-user-edit\nline2\nline3-dcf-edit\n', 'merged content combines both edits');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 2: three-way merge - conflict path (diff3 markers verbatim)');
    {
        const base = 'title\n';
        const ours = 'title by user\n';
        const theirs = 'title by dcf\n';
        const result = await threeWayMerge({ baseContent: base, oursContent: ours, theirsContent: theirs });
        assert(result.hasConflict === true, 'overlapping edits conflict');
        assert(result.conflictText.includes('<<<<<<<') && result.conflictText.includes('|||||||')
            && result.conflictText.includes('>>>>>>>'), 'diff3 conflict markers preserved verbatim');
        assert(result.conflictText.includes('title by user') && result.conflictText.includes('title by dcf'),
            'both sides visible in conflict text');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 3: pushCandidate clean - candidate branch only, canonical untouched');
    const bareRepo = await createLocalBareRepo(path.join(tmpBase, 'remote.git'));
    const canonicalPath = 'notes/topic.md';
    const baseV1 = '# Topic\n\nintro\n\nsection A\n';
    await userCommit(bareRepo, canonicalPath, baseV1, 'user: initial notes');

    const entityId = generateULID();
    const sync = new GitHubSync({ remote: bareRepo, workDir: path.join(tmpBase, 'sync-work') });
    {
        // DCF candidate appends a section; user canonical unchanged since base
        const candidateBody = '# Topic\n\nintro\n\nsection A\n\nsection B (dcf revision)\n';
        const result = await sync.pushCandidate({
            entityId,
            filePath: canonicalPath,
            candidateBody,
            baseContent: baseV1
        });
        assert(result.success === true, 'clean merge pushed');
        assert(result.branch === CANDIDATE_BRANCH, `candidate went to dedicated branch ${CANDIDATE_BRANCH}`);
        assert(result.candidatePath === `${CANDIDATE_DIR}/${entityId}.md`, 'candidate written under dcf/candidates/');
        assert(result.mergedSha256 === sha256(candidateBody), 'merged sha256 matches candidate content');

        // User canonical on main must be byte-identical to before
        const canonicalNow = await runGit(['show', `origin/main:${canonicalPath}`], sync.workDir);
        assert(canonicalNow.stdout === baseV1, 'user canonical file on main NEVER overwritten');

        // Candidate file must NOT exist on main
        const candidateOnMain = await runGit(['show', `origin/main:${CANDIDATE_DIR}/${entityId}.md`], sync.workDir);
        assert(candidateOnMain.success === false, 'no DCF artifact leaked onto user default branch');

        // Candidate file exists on the candidate branch
        const candidateOnBranch = await runGit(['show', `origin/${CANDIDATE_BRANCH}:${CANDIDATE_DIR}/${entityId}.md`], sync.workDir);
        assert(candidateOnBranch.success === true && candidateOnBranch.stdout.includes('section B (dcf revision)'),
            'candidate content readable from candidate branch');
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 4: pushCandidate conflict - no push, conflict text returned');
    {
        // User rewrites the intro on main; DCF candidate (from old base) rewrites it too
        const userV2 = '# Topic\n\nintro rewritten by user\n\nsection A\n';
        await userCommit(bareRepo, canonicalPath, userV2, 'user: rewrite intro');

        const before = await runGit(['rev-parse', `origin/${CANDIDATE_BRANCH}`], sync.workDir);

        const conflictCandidate = '# Topic\n\nintro rewritten by dcf\n\nsection A\n';
        const result = await sync.pushCandidate({
            entityId,
            filePath: canonicalPath,
            candidateBody: conflictCandidate,
            baseContent: baseV1
        });
        assert(result.success === false && result.hasConflict === true, 'conflict stops the push');
        assert(result.conflictText.includes('<<<<<<<') && result.conflictText.includes('intro rewritten by user')
            && result.conflictText.includes('intro rewritten by dcf'), 'conflict text carries both sides verbatim');

        await runGit(['fetch', 'origin', '--prune'], sync.workDir);
        const after = await runGit(['rev-parse', `origin/${CANDIDATE_BRANCH}`], sync.workDir);
        assert(before.stdout === after.stdout, 'candidate branch unchanged (nothing pushed on conflict)');

        // Conflict is ingestible as an honest event
        const db = new CompanionDB(path.join(tmpBase, 'sync.db'));
        await db.initialize();
        const ep = new EventProcessor(db);
        const mp = new MaterialProcessor({ db, eventProcessor: ep });
        const evt = await mp.recordSyncEvent('material.sync.conflict_detected', {
            entity_id: entityId,
            remote: bareRepo,
            file_path: canonicalPath,
            conflict_text: result.conflictText
        });
        assert(evt.success === true, 'conflict recorded as event awaiting user decision');
        const stored = db.getAllRawEventsOfType('material.sync.conflict_detected');
        const payload = JSON.parse(stored[0].payload_json);
        assert(payload.conflict_text === result.conflictText, 'conflict text stored verbatim in event log');
        db.close();
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 5: pull-back - remote change detected via sha256 and ingested');
    {
        const db = new CompanionDB(path.join(tmpBase, 'pull.db'));
        await db.initialize();
        const ep = new EventProcessor(db);
        const mp = new MaterialProcessor({ db, eventProcessor: ep });

        // Last sync point = user V2 (recorded before the change)
        const fetchBefore = await sync.fetchCanonical(canonicalPath);
        assert(fetchBefore.success === true && fetchBefore.exists === true, 'canonical readable');
        const lastSyncSha = fetchBefore.sha256;

        // No change -> shas match
        const fetchSame = await sync.fetchCanonical(canonicalPath);
        assert(fetchSame.sha256 === lastSyncSha, 'unchanged remote -> same sha256 (no pull-back event)');

        // User edits on GitHub side
        const userV3 = '# Topic\n\nintro rewritten by user\n\nsection A\n\nsection C by user\n';
        await userCommit(bareRepo, canonicalPath, userV3, 'user: add section C');

        const fetchAfter = await sync.fetchCanonical(canonicalPath);
        assert(fetchAfter.sha256 !== lastSyncSha, 'changed remote -> different sha256');
        assert(fetchAfter.content === userV3, 'pulled content matches user edit');

        const evt = await mp.recordSyncEvent('material.sync.pulled_back', {
            entity_id: entityId,
            remote: bareRepo,
            file_path: canonicalPath,
            remote_sha256: fetchAfter.sha256,
            previous_sha256: lastSyncSha,
            remote_content: fetchAfter.content
        });
        assert(evt.success === true, 'pull-back ingested as evolution fact');
        const stored = db.getAllRawEventsOfType('material.sync.pulled_back');
        assert(stored.length === 1 && JSON.parse(stored[0].payload_json).remote_sha256 === fetchAfter.sha256,
            'pull-back event carries the new content identity');
        db.close();
    }

    // -------------------------------------------------------------
    console.log('\n📦 Test 6: reversibility - deleting candidate branch removes all DCF artifacts');
    {
        const del = await runGit(['push', 'origin', '--delete', CANDIDATE_BRANCH], sync.workDir);
        assert(del.success === true, 'candidate branch deletable in one operation');
        await runGit(['fetch', 'origin', '--prune'], sync.workDir);
        const gone = await runGit(['rev-parse', '--verify', `origin/${CANDIDATE_BRANCH}`], sync.workDir);
        assert(gone.success === false, 'no DCF artifact remains after branch deletion');
        const canonicalStill = await runGit(['show', `origin/main:${canonicalPath}`], sync.workDir);
        assert(canonicalStill.success === true, 'user content fully intact');
    }

    sync.cleanup();
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) { /* best effort */ }

    console.log(`\n\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
});
