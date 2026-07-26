# P0 repository unification evidence

- Generated at: `2026-07-26T09:05:15+09:00`
- Repository: `ysr7255007-maker/dcf-chatgpt-microcore`
- Evidence scope: remote Git facts, fresh-clone verification, merge dry-run, preservation decision
- Status: `repository_unification_published`; local-only dirty artifacts remain `blocked_unavailable`

## Observed remote facts

After a fresh `git fetch`/clone:

| Ref | SHA | Observed meaning |
| --- | --- | --- |
| `main` | `05eebb495ec4a1b9513ca67b939e0751b1c7febe` | old `0.18.2` tree plus the current from-zero vision ADR |
| `rebuild/chrome-native-host-v2` | `2fa7fc0f544fd7fea50f5e05c7d56a9990a08ac3` | complete `rc.3` old-world branch plus one later exploratory vision record |
| old-world implementation commit | `bdaaad474880667f927c0affc22755db36f712c3` | last code-bearing commit on rebuild; full rc.3 source, DORC ADR and tests |
| `work/control-plane-reconcile-rc3` | `fc186dfc906d52e51eb06677d935098c407c2f3a` | alternate reconciliation implementation; not selected |
| `stable` | `4f1f9a20cc410b9c929d8615fd161aab9ec8a32f` | last published trusted pointer; intentionally unchanged |
| common ancestor | `ea7194f485db5c2a9953f043b3fed5a23ffa7887` | old `0.18.2` world before the Chrome rebuild and new vision diverged |

Branch relations at observation time:

```text
main...rebuild                         1 / 79
rebuild...work/control-plane-reconcile 2 / 24
```

The first number is commits reachable only from the left ref; the second is commits reachable only from the right ref.

## File and lineage checks

- `main` contains `docs/vision/2026-07-26-dcf-from-zero-vision-adr.md`.
- `rebuild` contains `docs/adr/2026-07-21-dcf-control-plane-desired-observed-committed-reconcile.md`.
- `rebuild@2fa7fc0` differs from `bdaaad4` only by `docs/adr/2026-07-26-dcf-vision-reweaving.md`.
- `work/control-plane-reconcile-rc3` deletes the DORC ADR and substitutes `docs/adr/2026-07-21-dcf-control-plane-reconciliation.md`; it also collapses several host-runtime modules. That route is preserved as history and not merged as implementation.
- `git merge-tree --write-tree main rebuild/chrome-native-host-v2` produced tree `3c7c16451cb486acd30122ced2984a388aee6a63` with no conflicts.
- The dry-run tree contains both the current from-zero vision ADR and the exploratory vision-reweaving record.

## Verification evidence

Environment:

```text
Node v24.14.0
npm 11.9.0
git 2.51.1
Linux 6.12.13 x86_64
```

Fresh-clone `main@05eebb4`:

```text
command: npm run verify
result: exit 0
scope: build + 23 legacy test scripts
worktree after verification: clean
```

Fresh-clone `rebuild@2fa7fc0`:

```text
command: npm run verify
result: exit 0
scope: Chrome build + 11 Chrome test scripts + 23 legacy test scripts + syntax/JSON checks
generated Chrome candidate: 1.0.0-rc.3
default snapshot: sha256:5f3212944175ae1f88d73a576703a8df2ae0218c1c1388c6238a45dcb176b337
worktree after verification: clean
```

Merged P0 tree on `work/seed-p0-unification-20260726`:

```text
command: npm run verify
result: exit 0
scope: Chrome build + 11 Chrome test scripts + 23 legacy test scripts + syntax/JSON checks
generated Chrome candidate: 1.0.0-rc.3
default snapshot: sha256:5f3212944175ae1f88d73a576703a8df2ae0218c1c1388c6238a45dcb176b337
```

These commands prove deterministic source/build behavior in this environment. They do not prove real Chrome Canary activation, current-page migration or user-visible G1 behavior.

`git diff --cached --check` reports Markdown hard-break whitespace already present in the selected rc.3 history. The new blueprint ADR was corrected; a comparison from `rebuild@2fa7fc0` to the final P0 tree introduces no new whitespace errors. The inherited lines were left byte-for-byte intact to avoid rewriting the preserved old-world baseline.

## Baseline decision

1. `bdaaad4` is the accurate old-world implementation baseline because it is the final code-bearing rc.3 commit and both Chrome and legacy verification pass.
2. `2fa7fc0` is preserved as a later documentation lineage point, not used as the semantic meaning of `old-world-baseline`.
3. `fc186df` is preserved as an alternate architecture route and not merged.
4. `main` receives the selected rebuild history and the current from-zero vision in one merge lineage.
5. `stable@4f1f9a2` remains unchanged until new-system behavior is actually verified.
6. New implementation work is confined to `seed/`.

Local preservation refs created in the execution clone:

```text
old-world-baseline                    -> bdaaad4
archive/vision-reweaving-exploration -> 2fa7fc0
archive/control-plane-reconcile-rc3  -> fc186df
```

Published remote result:

```text
P0 main cutover commit                    -> ce95ecb2268894712607886948638b910123b35b
verified P0 tree                          -> 6d3df42af1b70cad3c5726003cca179dc8fa21b7
work/seed-p0-unification-20260726         -> ce95ecb2268894712607886948638b910123b35b
archive/old-world-baseline                -> bdaaad474880667f927c0affc22755db36f712c3
archive/vision-reweaving-exploration      -> 2fa7fc0f544fd7fea50f5e05c7d56a9990a08ac3
archive/control-plane-reconcile-rc3       -> fc186dfc906d52e51eb06677d935098c407c2f3a
stable                                    -> 4f1f9a20cc410b9c929d8615fd161aab9ec8a32f
```

The P0 cutover commit `ce95ecb` is a two-parent merge of `05eebb4` and `2fa7fc0`. Its tree is byte-identical to the locally verified P0 tree. Evidence-only child commits may advance `main` without changing this cutover identity. The available GitHub write surface did not expose annotated-tag creation, so remote archive branches provide equivalent immutable checkpoints while the annotated tag names remain local. No remote tag is claimed.

## Unavailable local-only artifacts

The executable blueprint reports another local checkout with:

```text
3 modified files
8 untracked verification/guard scripts
```

Known names include `AGENTS.md`, `doctor.js`, push-guard/hook material and extension-loading helpers. A complete search of all fetched Git objects found none of these paths, and Library title/content searches did not recover the reported files. This fresh execution environment cannot read the other machine's dirty worktree.

Decision:

- do not recreate unknown contents from filenames;
- do not delete or reset the source checkout;
- do not claim those files were incorporated;
- preserve every remote branch and record the missing local payload as `blocked_unavailable`;
- treat the committed, verified rc.3 tree as the repository baseline while keeping this evidence visible.

This unknown does not authorize silently replacing those local files. If they later enter any reachable Git object, they must be compared against the recorded baseline and incorporated only as explicit verification/guard changes.

## Evidence classification

| Claim | State |
| --- | --- |
| remote branch topology | `observed` |
| main legacy verification | `behavior_passed` in Node test scope |
| rebuild Chrome/legacy verification | `behavior_passed` in Node test scope |
| conflict-free merge tree | `observed` |
| published `main` tree equals locally verified tree | `observed` |
| accurate old-world implementation commit | `observed` + execution-layer decision |
| real Chrome rc.3 activation | `not_tested` |
| local dirty artifact capture | `blocked_unavailable` |
| new G1 behavior | `not_tested` |
