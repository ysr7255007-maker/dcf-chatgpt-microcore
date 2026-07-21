# ADR: One-click runtime acceptance and the personal-project maintenance loop

Date: 2026-07-18  
Expanded: 2026-07-20  
Status: accepted; original one-click acceptance passed; autonomous BrowserClaw maintenance loop and stable promotion pending implementation

## Context

The dialogue adapter exposed a visible card after a hot update, but its controls did not respond. The event binder stored its binding marker on a `ShadowRoot.dataset`; `ShadowRoot` has no `dataset`, so rendering succeeded while event registration failed.

The same acceptance round also exposed a product-level problem. The user was asked to verify several observable conditions one by one: hot remount, historical-message inactivity, button wording, clear behavior and pinned workspace preservation. These facts are already available to DCF runtime code. Turning them into a manual checklist transfers internal maintenance work and cognitive load back to the user.

The later BrowserClaw experiment exposed the same problem at the whole maintenance-loop level. The local AI could modify repository files, but the user still had to install or update the candidate, reload the extension, refresh the page, perform the test action, capture screenshots, copy diagnostics and carry the result back to the maintenance AI. BrowserClaw is valuable because it can give the local AI direct control of a real, logged-in Chromium test environment and allow it to complete the loop itself.

DCF is a single-user personal project. There is no independent reviewer, public integration queue or multi-person merge coordination. Pull requests and long-lived feature branches therefore add delay without adding a real responsibility boundary. Risk should be managed through small reversible commits, real-browser evidence, a known-good pointer and Git rollback rather than through approval before code reaches GitHub.

At the same time, direct development pushes must not force the user to run unaccepted code. The user's ordinary DCF environment and the local AI's maintenance environment serve different purposes and should be separated without requiring the user to switch versions manually.

## Decision

### Runtime acceptance

1. The dialogue adapter binds controls by comparing the actual `ShadowRoot` identity with an internal `boundMountRoot` reference. It does not attach metadata to `ShadowRoot`.
2. The adapter provides one primary action, `一键验收并回传`.
3. One invocation performs the acceptance operations that the plugin can safely observe, including clearing deduplication and recent-handoff state, rereading persisted plugin data, waiting for unintended replay, checking mount and event binding, checking status semantics and reading current Shell workspace tabs.
4. It emits one privacy-bounded `dcf.local-agent-dialogue.acceptance.v1` report between exact markers and automatically returns it to the current conversation, even when ordinary task-result auto-send is disabled.
5. The report includes versions and hash prefixes, bounded counters and pass/fail checks. It excludes message text, prompts, credentials, complete URLs and complete plugin payloads.
6. Runtime acceptance automation remains inside the owning plugin where it understands the relevant semantics.
7. DCF maintenance must not ask the user to manually transcribe or separately confirm facts that the running product or maintenance harness can observe and report. The user remains responsible only for irreducibly experiential judgments and decisions about value or direction.

### Personal-project source workflow

8. DCF uses one active development line. Normal maintenance does not create feature branches or pull requests.
9. One maintenance iteration produces one semantically complete, independently reversible commit. The commit represents a whole candidate behavior, not one file or an arbitrary intermediate step.
10. The local AI pushes that commit directly to the active development line. GitHub Actions may start immediately, but CI is an asynchronous evidence source rather than a gate that blocks real-browser testing.
11. Pushed code is not automatically considered accepted. Its state is `pending real-browser acceptance` until the exact user-visible behavior has been exercised in the maintenance environment.
12. Failure is handled by a follow-up atomic fix commit when the direction remains sound, or by `git revert` when the candidate should be removed. Published history is not silently rewritten merely to appear clean.
13. Every accepted checkpoint records the commit SHA, acceptance target, environment identity and bounded evidence reference.

### BrowserClaw maintenance harness

14. BrowserClaw is a development and acceptance harness for the local AI, not a runtime dependency or replacement architecture for ordinary foreground DCF.
15. The harness uses an explicit maintenance profile, a fixed development-extension directory, a known ChatGPT test surface and exact browser, tab, extension and commit identities. It must not guess targets from whichever tab happens to be active.
16. Within one bounded maintenance session, the local AI may perform:

    ```text
    reproduce and inspect the current failure
    → modify source
    → run fast deterministic checks
    → create and push one atomic commit
    → update or reload the exact DCF candidate
    → refresh or reopen the exact test surface
    → perform the bounded user-visible acceptance action
    → collect page, extension, console and DCF evidence
    → decide pass, continue fixing or revert
    ```

17. A reload request is not evidence of a reload. The harness must verify the exact extension version or hash, worker restart, page instance and DCF Shell remount before performing the acceptance action.
18. Repository state, build success, script registration and stored configuration are separate from current-page truth. Acceptance requires evidence from the actual page: Shell and ShadowRoot presence, panel mount, action completion or timeout, resulting plugin state, visible workspace result and relevant errors.
19. Evidence is bounded and privacy-aware. It includes the facts required to distinguish success, failure, timeout, wrong target, failed reload and unreachable diagnostics; it does not dump complete conversations, credentials, raw DOM or unlimited logs.
20. The user may interrupt the loop and remains the final product judge, but should not be asked to install each candidate, reload the extension, click deterministic test actions, copy diagnostics, report SHAs or shuttle screenshots and logs between AIs.

### Development head and stable promotion

21. DCF keeps one source history with two logical positions:

    ```text
    development HEAD
    = latest local-AI iteration awaiting or undergoing maintenance acceptance

    stable pointer
    = most recent commit accepted for the user's ordinary DCF environment
    ```

22. The stable pointer is not a second development branch. No work is authored there. It only identifies the last accepted source and publication state.
23. The user does not switch versions manually. Two environments are managed automatically:

    ```text
    ordinary browser profile
    → consumes the stable DCF release

    BrowserClaw maintenance profile
    → consumes the exact pending commit selected by the local AI
    ```

24. When technical real-browser acceptance passes, the maintenance system may promote the tested commit to the stable pointer automatically. When the remaining question is experiential or changes product meaning, it presents the already-working result to the user and promotes only after the user's judgment.
25. A failed candidate does not move the stable pointer and therefore does not disturb ordinary DCF use.
26. Promotion records the previous stable SHA so rollback remains deterministic.

### Source, plugin and base publication

27. Direct source Push, candidate loading and stable publication are distinct operations.
28. Ordinary personal plugins may be tested from the exact development commit in the maintenance profile. After acceptance, their stable index and immutable version/hash references are promoted for the ordinary profile.
29. Chrome base or static-survival changes are tested as a development extension in the BrowserClaw maintenance profile. They are published to the non-public Chrome Web Store only after the selected commit is accepted.
30. The ordinary profile must not be made to alternate between a development extension and the store extension. Isolation belongs to the maintenance environment, not to the user's manual routine.
31. Promotion and publication failure do not erase the accepted source commit. The publication target remains at, or is restored to, the previous stable release until a corrected publication succeeds.

## Consequences

- A rendered-but-unbound card can no longer pass startup acceptance.
- Historical replay, workspace preservation, status semantics and later maintenance evidence arrive as bounded machine-readable artifacts rather than user checklists.
- BrowserClaw accelerates DCF development without becoming part of the product's required runtime architecture.
- Pull requests and approval gates are removed from the normal DCF maintenance path.
- GitHub receives rapid, reversible atomic commits while the user's ordinary environment remains on the last accepted release.
- CI and real-browser acceptance run in parallel and cover different truth planes.
- The local AI owns deterministic reload, testing and evidence transport; the user owns value judgments and may stop the loop.
- The stable pointer and isolated maintenance profile prevent fast iteration from turning into manual version switching.

## Original live acceptance evidence

At `2026-07-18T15:47:13.321Z`, `local-agent-dialogue.8` returned a complete `dcf.local-agent-dialogue.acceptance.v1` artifact from the real ChatGPT page.

Observed evidence:

- the page had existed for about 6,654 seconds before the plugin update, so the report covered a true in-page hot replacement rather than a fresh page load;
- Shell host, Shell Shadow DOM, Local Agent panel, Local Agent Shadow DOM and dialogue mount were all connected;
- the Local Agent panel was mounted inside the Shell Shadow DOM;
- the dialogue event root was bound exactly once;
- the `local-agent` workspace remained pinned and active;
- all three existing assistant messages were treated as baseline history;
- no new assistant event, manual latest check, queued request or OpenCode task occurred during acceptance;
- one prior processed request and recent session were cleared, persisted as empty and did not re-enter the queue;
- installed versions and hash prefixes matched Shell `.5`, Local Agent `.2`, dialogue `.8` and plugin manager `.2`;
- all ten acceptance checks returned `true`, and the report-level `passed` value was `true`.

## First maintenance-loop acceptance

The first end-to-end BrowserClaw maintenance target is the reproduced foreground defect:

```text
Function manager → Appearance → 启用并添加
```

The local AI must independently load the exact candidate, prove the Shell and Function Manager are mounted, execute the action, distinguish completion from failure and timeout, verify the enabled state and pinned Appearance panel from current-page truth, collect bounded evidence and repeat after a further code change without user relay.

Completion requires at least two consecutive iterations of `modify → push → reload → test → evidence → decide`, followed by either a promoted stable checkpoint or a deterministic rollback.

## Reconsideration conditions

Reconsider the no-PR direct-push workflow only if DCF gains independent maintainers or a genuine external integration responsibility. Do not reintroduce PRs merely as a conventional safety ritual.

Reconsider automatic stable promotion if the harness cannot prove exact candidate identity and current-page acceptance. In that case, keep promotion explicit, but do not transfer deterministic installation and evidence work back to the user.