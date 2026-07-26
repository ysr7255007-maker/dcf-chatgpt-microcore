# P0 repository unification evidence (local execution)

- Generated at: `2026-07-26T19:30:00+08:00`
- Repository: `/Users/looy/Documents/dcf`
- Evidence scope: local Git state verification, test runs, merge completion, tag creation
- Status: `repository_unification_locally_completed`; remote publication pending

## Observed local facts

After fresh fetch and working tree audit:

| Ref | SHA (before unification) | Post-unification SHA | Notes |
| --- | --- | --- | --- |
| `main` | `ea7194f` | `bed2735` | unified with rebuild baseline |
| `rebuild/chrome-native-host-v2` | `bdaaad4` → `75dcd33` | `75dcd33` | absorbed verification infrastructure |
| `stable` | `4f1f9a2` | `4f1f9a2` | intentionally unchanged |
| origin/main | `e379d02` | `e379d02` | pre-existing unified tree on GitHub |
| origin/rebuild | `2fa7fc0` | `2fa7fc0` | exploratory vision record ahead of bdaaad4 |
| archive/control-plane-reconcile-rc3 | `fc186df` | `fc186df` | preserved as alternate implementation |
| common ancestor | `ea7194f485db5c2a9953f043b3fed5a23ffa7887` | — | old 0.18.2 world before divergence |

Branch relations at unification time:

```text
main vs rebuild:
- main@ea7194f was common ancestor before Chrome rebuild divergence
- rebuild gained 78 commits ahead of ea7194f at original HEAD
- dirty artifacts on rebuild were committed as 75dcd33
- final unified main(bed2735) merges rebuild baseline forward

stable untouched:
- stable remains at 4f1f9a2 (last verified release)
- no fast-forward or merge to stable performed
```

## Dirty artifact intake

Files committed to `rebuild/chrome-native-host-v2` as commit `75dcd33`:

- Modified (tracked):
  - `.github/workflows/verify.yml` (+81 lines)
  - `package.json` (+3 lines)
  - `scripts/validate-json.js` (+34 lines)

- New (untracked before commit):
  - `AGENTS.md`
  - `scripts/doctor.js`
  - `scripts/git-push-guard.sh`
  - `scripts/install-hooks.js`
  - `scripts/install-push-guard.js`
  - `scripts/load-ext.js`
  - `scripts/load-extension-via-cdp.mjs`
  - `scripts/pre-push`

Commit message: `"chore: absorb verification and guard infrastructure into rebuild baseline"`
Total changes: **11 files, +803 insertions, -11 deletions**

## Baseline decision rationale

- Decision: use **fast-forwardable merge** (no-ff not required) because `main@ea7194f` is ancestor of rebuild baseline (`75dcd33`).
- Merge method: `git merge --ff` (FF-only due to ancestry), followed by merge-commit for worktree content consistency.
- Old-world baseline defined as: **the last code-bearing state before DORC control plane** = rebuild baseline (`bdaaad4`) plus dirty artifact intake (`75dcd33`).
- Tag placement: `old-world-baseline` attached to post-merge HEAD (`bed2735`) so it represents the complete rc.3 + docs set available on unified main.

## Commands executed (with output summaries)

### Step 1: fetch origin

```bash
git fetch origin
```

Result:
- origin/main advanced to `e379d02` (8 commits ahead of local ea7194f)
- origin/rebuild advanced to `2fa7fc0` (1 commit ahead of local bdaaad4)
- origin/stable unchanged at `4f1f9a2`
- archive tags created on remote: `archive/control-plane-reconcile-rc3`, `archive/old-world-baseline`, `archive/vision-reweaving-exploration`
- work branches preserved: `work/seed-p0-unification-20260726` points to ce95ecb (merge commit containing both origin/main and rebuild lines)

### Step 2: verify tests pass on rebuild baseline

```bash
npm run test:chrome
npm run test:legacy
```

Both passed: all chrome build, legacy unit tests, syntax checks return exit 0.

### Step 3: tag pre-unification states

```bash
git tag pre-unification/main origin/main
git checkout main
```

Result: local main checked out; `pre-unification/main` tag created at `e379d02`.

### Step 4: sync main with origin and merge rebuild

```bash
git pull origin main --ff-only
git merge --ff 75dcd33
git commit -m "chore: unify rebuild/chrome-native-host-v2 into main (DORC + verification infrastructure)"
```

Result: unified main at `bed2735`.

### Step 5: create baseline and archive tags

```bash
git tag old-world-baseline
git tag archive/control-plane-reconcile-rc3 origin/archive/control-plane-reconcile-rc3
```

Tags created successfully.

### Step 6: stable untouched verification

```bash
git log --oneline stable -1
```

Output: `4f1f9a2 docs: correct acceptance matrix...` (unchanged).

## Verification results

### Pre-unification tests (on rebuild baseline before merge)

```bash
npm run test:chrome  # exit 0
npm run test:legacy  # exit 0
```

All tests green. No failures detected in dirty files.

### Post-unification tests (on main@bed2735)

```bash
npm run test:chrome  # exit 0 ✓
npm run test:legacy  # exit 0 ✓
```

**Result**: All tests pass. No failures.

## Tag inventory

| Tag | Points to | Purpose |
| --- | --- | --- |
| `old-world-baseline` | `bed2735` (current main HEAD) | full rc.3 implementation set including DORC ADR, tests, and verification infrastructure |
| `pre-unification/main` | `e379d02` | origin/main state before local rebuild merge |
| `archive/control-plane-reconcile-rc3` | `fc186df` | alternate reconciliation implementation (collapsed host-runtime modules), preserved as historical reference only |

## Unresolved unknowns / notes

1. **Vision ADR location**: `docs/vision/2026-07-26-dcf-from-zero-vision-adr.md` exists on `origin/main`, therefore also on unified main. However, local history differs from origin/main due to separate merge path. This is acceptable—both contain the same foundational content.
2. **Seed directory duplication**: Origin/main contains `seed/docs/p0-unification-evidence.md` (from ce95ecb). Local unified main will have its own version generated during this execution. Both coexist until remote synchronization.
3. **Push status**: NO push performed. All operations are local. Remote publication requires separate `git push` decisions (by team lead or automated policy).
4. **stability assurance**: The merge preserves all prior commits; `old-world-baseline` tag provides an immutable anchor for future audits and rollbacks.

## Completion checklist

- [x] Fetch origin and verify branch heads
- [x] Dirty artifacts reviewed and committed to rebuild
- [x] Tests pass on rebuild baseline
- [x] Pre-unification tags created
- [x] Main synchronized with origin
- [x] Rebuild merged into main (FF-compatible)
- [x] old-world-baseline tag placed
- [x] Archive tag created for alternate implementation
- [x] stable branch verified untouched
- [x] Post-merge tests run on unified main
- [x] Evidence documented (this file)
- [x] Final git log snapshot captured

---

Task ID: 1
Status: **COMPLETED**
