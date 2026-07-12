# DCF 当前架构

Updated: 2026-07-12  
Current release: `0.11.1`

## 1. Value and engineering dependency

DCF exists to improve the user's thinking and dialogue quality through a low-friction language-ammunition loop:

```text
valuable dialogue
→ extract
→ automatically load
→ manage / update
→ insert or send
→ improve later dialogue
→ extract again
```

Language ammunition owns product value: the architecture may change its implementation but may not quietly remove automatic extraction, loading, updating, installation, or low-friction firing. The generic kernel owns engineering structure: ammo is a first-party core module built on the same package, resource, command, transaction, effect, and projection mechanisms available to other modules.

## 2. Source and release

Source is modular under `src/`. `scripts/build-userscript.js` deterministically bundles it into the complete root userscript and metadata files. Tampermonkey still installs one file. Runtime JavaScript download/eval, chunk bootloaders, and local-storage-as-code are not used.

## 3. One authoritative state root and one authoritative backend

`dcf.state.root.v1` is the only authoritative runtime state. It contains package sources, user-owned data/preferences, and minimal system metadata.

When Tampermonkey GM storage is available, GM storage is the sole authoritative write backend. Page `localStorage` is not a second authority. It remains readable only as a bounded migration source for pre-`0.11.1` state.

The following are non-authoritative derived or bounded operational stores:

- `dcf.runtime.registry.v3`: rebuildable projection;
- `dcf.state.snapshots.v1`: bounded recovery snapshots;
- `dcf.receipts.v1`: bounded diagnostic/effect receipts;
- `dcf.ui.session.v1`: disposable UI location;
- `dcf.catalog.state.v1`: catalog-check status.

Legacy package/user/ops/registry stores are migration inputs only. Old `seenBlocks` and `badBlocks` ledgers are summarized during migration rather than carried into the new authority.

## 4. Unified transaction

All local authoritative changes follow one path:

```text
Intent or typed Artifact
→ pure candidate transition
→ root and resource validation
→ deterministic projection
→ snapshot previous root
→ one root commit
→ publish derived registry
→ append receipt
```

Package install/update/enable/disable/uninstall/revision switch, content upsert/remove, settings, appearance, and rollback do not maintain separate save or reverse-patch systems. A rejected transition leaves the previous root and projection unchanged.

## 5. Packages and resources

Package revisions are immutable. Friendly external package fields compile to stable internal resource claims such as module, Surface, content type, content default, setting default, module display, appearance variable, and style source.

Exclusive conflicts fail before commit. Replacement must be explicit. Package styles keep source identity and may not own `.sh` geometry. User data and preferences override package defaults and survive optional package removal.

`dcf.standard.ammo` is required by the product value loop and cannot be disabled or uninstalled through the package manager. Other first-party modules, including the shell adjuster, use ordinary declarative module commands and remain optional.

## 6. Artifact transports

The same artifact decoder and transaction path accept:

- `DCF_AMMO` from a completed assistant reply;
- `DCF_MODULE_PACK` from a completed assistant reply;
- package JSON pasted into the package manager;
- immutable package JSON downloaded from the fixed private-project catalog.

Artifact identity, not DOM-block history, provides idempotence. Same package revision with different content is rejected.

## 7. ChatGPT host adapter

Core code does not access ChatGPT DOM. The host adapter owns reply discovery, completion detection, composer insertion/sending, clipboard, notification, navigation changes, and privacy-safe host diagnostics.

Reply intake has a history-independent cost model:

- bind to the stable `main` / `[role=main]` host root, never `document.body`;
- inspect only mutation `addedNodes`;
- temporarily observe only the current assistant reply while streaming;
- decode once after completion;
- recovery walks backward only until a fixed number of recent assistant replies are found, with a hard visit limit;
- never read full-page text or enumerate the entire conversation.

ChatGPT historical-message virtualization is a separate phase-two module and is not part of phase one.

## 8. Commands, effects, and receipts

Declarative module commands use one interpreter. Existing top-level commands and `blocks[].commands` remain supported.

Local state transitions and external effects are separate. Composer insert/send, clipboard, and notification go through the host effect runner. Effect failure does not corrupt unrelated authoritative state.

Transactions, commands, and effects emit bounded receipts. Conversational bodies, prompts, content, tokens, credentials, and similar values are represented by redacted length/hash summaries. Success remains local and quiet; failures are available for explicit diagnostic copying.

## 9. UI projection and one-click health report

The sidebar is a projection of current state and active resources. The ammo view is a first-party product view. Generic module cards consume module, Surface, area/order, and module-display projections. Package management and maintenance are first-party modules outside Core.

Maintenance exposes a privacy-safe `dcf.health.report.v1`. It is a diagnostic projection, not another authority store. It compares GM and page localStorage inventories; validates root/hash/projection; lists packages, modules, Surfaces, command counts and providers; reports migration/bridge coverage; inspects Host Adapter connection and composer state; and summarizes recent failures. It excludes conversation text, ammo bodies, package payloads, command arguments and authentication data.

Shell geometry has one source of truth in user appearance state and is finally constrained by the actual `visualViewport` and shell rectangle. The shell adjuster is declarative; no second hard-coded adjustment path exists.

## 10. Migration, storage bridge, and recovery

`0.10.0` package/user/ops stores and older registries may exist in page `localStorage`, while `0.11.x` authority lives in GM storage. Boot therefore inspects both backends before runtime initialization.

If a GM root already exists, legacy local data is merged into a candidate root rather than replacing current state. Current values win; missing packages, revisions, ammo, settings, module display and appearance values are recovered. Every missing package is projection-tested before acceptance. Conflicting packages are skipped with explicit reasons in `system.storage_bridge`. The bridge result is recorded and does not replay on every load.

Older registries are converted into synthetic immutable packages plus user-owned state. Geometry-owning legacy CSS is quarantined rather than allowed to break boot.

Rollback selects a previous root snapshot and passes it through the same validation, projection, commit, and receipt path as every other state change.

## 11. Verification boundary

Acceptance requires:

- value loop preserved: automatic ammo intake and low-friction firing work;
- source modules build to one deterministic userscript;
- one authoritative state root and one authoritative storage backend;
- all authoritative writes use the transaction engine;
- Core has no ChatGPT DOM dependency;
- reply intake work does not grow with total conversation rounds;
- legacy localStorage modules/commands and user data survive migration into GM storage;
- storage bridge is idempotent and records skipped conflicts;
- one-click health report can establish cross-layer state without leaking content;
- GitHub and reply artifacts share the same application path;
- no runtime remote-code execution;
- real-browser smoke proves reply → auto-load → fire → composer.