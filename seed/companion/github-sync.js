#!/usr/bin/env node

/**
 * G3 Companion - GitHub Private Repository Sync Module
 *
 * Semantics (blueprint G3):
 * - The user's file on GitHub owns the canonical body ("用户编辑文件拥有正文").
 * - DCF only pushes three-way-merged revision CANDIDATES, never overwrites
 *   the user's canonical file.
 * - Candidate path decision: dedicated branch `dcf/candidates` + directory
 *   `dcf/candidates/` inside it. Rationale (reversibility): deleting that one
 *   branch removes every DCF artifact without touching any user branch, and
 *   the user's default branch never gains DCF commits.
 * - Conflicts: no push; the diff3 conflict text is returned verbatim so the
 *   caller can persist it as an event awaiting user decision.
 *
 * Transport:
 * - Primary channel: system `gh` CLI (already authenticated via keychain);
 *   used only for auth detection. Actual git transport uses plain `git`
 *   against either an https GitHub URL (gh credential helper) or a local
 *   bare-repo path (full offline verification path).
 * - All child processes use execFile with argv arrays; no shell strings.
 *
 * Zero npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const CANDIDATE_BRANCH = 'dcf/candidates';
const CANDIDATE_DIR = 'dcf/candidates';

/**
 * SHA-256 helper (content identity for immutable bodies)
 */
function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Run git with argv array (no shell). Returns a result object, never throws
 * for git-level failures.
 */
async function runGit(args, cwd) {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd,
            maxBuffer: 10 * 1024 * 1024
        });
        return { success: true, code: 0, stdout, stderr };
    } catch (error) {
        return {
            success: false,
            code: typeof error.code === 'number' ? error.code : 1,
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            error: error.message
        };
    }
}

/**
 * Detect gh CLI availability + authentication.
 * Honest degradation: when unavailable, sync against github.com is reported
 * as unavailable; local bare-repo remotes still work through plain git.
 */
async function checkGhAuth() {
    try {
        await execFileAsync('gh', ['auth', 'status'], { timeout: 10000 });
        return { available: true, detail: 'gh CLI authenticated' };
    } catch (error) {
        const detail = (error.stderr || error.message || 'gh unavailable').trim();
        return { available: false, detail };
    }
}

/**
 * Three-way merge via `git merge-file --diff3 -p`.
 * base  = content at last sync point
 * ours  = user's canonical GitHub body (owns the file)
 * theirs = DCF revision candidate
 *
 * Returns:
 *   clean   -> { hasConflict: false, mergedContent }
 *   conflict-> { hasConflict: true, conflictText } (standard diff3 markers, verbatim)
 */
async function threeWayMerge({ baseContent = '', oursContent = '', theirsContent = '' }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-merge-'));

    try {
        const oursFile = path.join(tmpDir, 'ours');
        const baseFile = path.join(tmpDir, 'base');
        const theirsFile = path.join(tmpDir, 'theirs');

        fs.writeFileSync(oursFile, oursContent);
        fs.writeFileSync(baseFile, baseContent);
        fs.writeFileSync(theirsFile, theirsContent);

        // -p prints result to stdout; exit code = number of conflicts
        const result = await runGit(
            ['merge-file', '--diff3', '-p',
             '-L', 'user-github', '-L', 'last-sync-base', '-L', 'dcf-candidate',
             oursFile, baseFile, theirsFile],
            tmpDir
        );

        if (result.code === 0) {
            return { hasConflict: false, mergedContent: result.stdout };
        }

        if (result.code > 0) {
            // Conflicts: stdout still carries the diff3-marked text
            return { hasConflict: true, conflictText: result.stdout };
        }

        return { hasConflict: true, conflictText: '', error: `git merge-file failed: ${result.error}` };
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
}

/**
 * Resolve a remote spec to a git URL.
 * - Local filesystem path (bare repo) -> used as-is (test/verification path)
 * - 'owner/repo' -> https GitHub URL (auth via gh credential helper)
 */
function resolveRemoteUrl(remote) {
    if (!remote || typeof remote !== 'string') {
        throw new Error('remote must be a non-empty string');
    }
    if (remote.startsWith('/') || remote.startsWith('file://') || fs.existsSync(remote)) {
        return remote;
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(remote)) {
        return `https://github.com/${remote}.git`;
    }
    return remote; // full URL passed through
}

/**
 * GitHubSync: one instance per remote repository.
 * Works identically against a real GitHub remote and a local bare repo.
 */
class GitHubSync {
    constructor({ remote, workDir = null, defaultBranch = 'main' }) {
        this.remote = remote;
        this.remoteUrl = resolveRemoteUrl(remote);
        this.defaultBranch = defaultBranch;
        this.candidateBranch = CANDIDATE_BRANCH;
        this.workDir = workDir || path.join(
            os.tmpdir(),
            `dcf-sync-${sha256(this.remoteUrl).slice(0, 12)}`
        );
    }

    /**
     * Clone the remote if missing, else fetch latest refs.
     */
    async ensureClone() {
        if (!fs.existsSync(path.join(this.workDir, '.git'))) {
            fs.mkdirSync(this.workDir, { recursive: true });
            const cloneResult = await runGit(['clone', this.remoteUrl, this.workDir], os.tmpdir());
            if (!cloneResult.success) {
                return { success: false, error: `clone failed: ${cloneResult.stderr || cloneResult.error}` };
            }
        }
        const fetchResult = await runGit(['fetch', 'origin', '--prune'], this.workDir);
        if (!fetchResult.success) {
            return { success: false, error: `fetch failed: ${fetchResult.stderr || fetchResult.error}` };
        }
        return { success: true };
    }

    /**
     * Read a file's content from a remote-tracking branch without checkout.
     * Returns null when the file (or branch) does not exist.
     */
    async readRemoteFile(branch, filePath) {
        const result = await runGit(['show', `origin/${branch}:${filePath}`], this.workDir);
        return result.success ? result.stdout : null;
    }

    /**
     * Push a merged revision candidate to the candidate branch.
     * NEVER writes to the user's canonical file path on the default branch.
     *
     * @returns clean:    { success: true, candidatePath, branch, mergedContent, mergedSha256, commitSha }
     *          conflict: { success: false, hasConflict: true, conflictText }
     */
    async pushCandidate({ entityId, filePath, candidateBody, baseContent = '' }) {
        const cloneStatus = await this.ensureClone();
        if (!cloneStatus.success) {
            return { success: false, error: cloneStatus.error };
        }

        // ours = user's canonical body (missing file -> empty)
        const oursContent = (await this.readRemoteFile(this.defaultBranch, filePath)) ?? '';

        const merge = await threeWayMerge({
            baseContent,
            oursContent,
            theirsContent: candidateBody
        });

        if (merge.hasConflict) {
            // Stop. No push. Conflict text is preserved verbatim for the caller.
            return { success: false, hasConflict: true, conflictText: merge.conflictText };
        }

        // Candidate branch: start from existing remote candidate branch when
        // present, otherwise branch off the user's default branch.
        const remoteCandidate = await runGit(
            ['rev-parse', '--verify', `origin/${this.candidateBranch}`], this.workDir);
        const startPoint = remoteCandidate.success
            ? `origin/${this.candidateBranch}`
            : `origin/${this.defaultBranch}`;

        const checkout = await runGit(['checkout', '-B', this.candidateBranch, startPoint], this.workDir);
        if (!checkout.success) {
            return { success: false, error: `checkout failed: ${checkout.stderr || checkout.error}` };
        }

        const candidatePath = `${CANDIDATE_DIR}/${entityId}.md`;
        const absCandidatePath = path.join(this.workDir, candidatePath);
        fs.mkdirSync(path.dirname(absCandidatePath), { recursive: true });
        fs.writeFileSync(absCandidatePath, merge.mergedContent);

        await runGit(['add', candidatePath], this.workDir);
        const commit = await runGit(
            ['-c', 'user.name=DCF Companion', '-c', 'user.email=dcf-companion@localhost',
             'commit', '-m', `dcf: revision candidate for ${entityId} (${filePath})`],
            this.workDir
        );
        if (!commit.success && !/nothing to commit/.test(commit.stdout + commit.stderr)) {
            return { success: false, error: `commit failed: ${commit.stderr || commit.error}` };
        }

        const push = await runGit(['push', 'origin', this.candidateBranch], this.workDir);
        if (!push.success) {
            return { success: false, error: `push failed: ${push.stderr || push.error}` };
        }

        const head = await runGit(['rev-parse', 'HEAD'], this.workDir);

        return {
            success: true,
            candidatePath,
            branch: this.candidateBranch,
            mergedContent: merge.mergedContent,
            mergedSha256: sha256(merge.mergedContent),
            commitSha: head.success ? head.stdout.trim() : null
        };
    }

    /**
     * Pull-back detection: read the user's canonical file at origin/<default>
     * and report its current content + sha256. Caller compares against the
     * last sync point and records evolution facts.
     */
    async fetchCanonical(filePath) {
        const cloneStatus = await this.ensureClone();
        if (!cloneStatus.success) {
            return { success: false, error: cloneStatus.error };
        }

        const content = await this.readRemoteFile(this.defaultBranch, filePath);
        if (content === null) {
            return { success: true, exists: false, content: null, sha256: null };
        }

        return { success: true, exists: true, content, sha256: sha256(content) };
    }

    /**
     * Remove the local working clone (cleanup for tests / disposable syncs).
     */
    cleanup() {
        try { fs.rmSync(this.workDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
}

/**
 * Create a local bare repository (simulated remote for offline verification).
 */
async function createLocalBareRepo(basePath = null) {
    const repoDir = basePath || fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-bare-'));
    fs.mkdirSync(repoDir, { recursive: true });
    const result = await runGit(['init', '--bare', '--initial-branch=main', repoDir], os.tmpdir());
    if (!result.success) {
        throw new Error(`Failed to create bare repo: ${result.stderr || result.error}`);
    }
    return repoDir;
}

module.exports = {
    CANDIDATE_BRANCH,
    CANDIDATE_DIR,
    sha256,
    runGit,
    checkGhAuth,
    threeWayMerge,
    resolveRemoteUrl,
    GitHubSync,
    createLocalBareRepo
};
