# dcf-chatgpt-microcore

DCF is a personally maintained ChatGPT Tampermonkey system whose value goal is a low-friction language-ammunition loop. The repository is public for update delivery, not operated as a community plugin platform.

## Current architecture

DCF `0.11.6` keeps a generic modular kernel under the first-party language-ammunition product goal. Source is modular, while Tampermonkey still installs one complete userscript.

One authoritative state root changes only through the unified transaction path:

```text
intent or artifact
→ candidate state
→ invariant validation
→ atomic root commit
→ derived runtime projection
→ receipt / host effect
```

ChatGPT replies, manual package JSON, and the fixed GitHub catalog are transports into the same artifact and transaction path. Reply intake observes only newly added/current assistant replies.

The UI distinguishes:

- installed packages in **包管理**;
- runtime modules in the registry;
- daily functions in **功能**;
- probes, diagnostics, layout, authoring, acceptance, and recovery tools in **维护**.

`hidden` is not a product role. All non-ammo runtime modules remain discoverable in either daily or maintenance. Module cards use expand/collapse to control density; fold state lives only in disposable `dcf.ui.session.v1` and never rewrites package or authoritative user state.

**一键 Runtime 体检并复制** observes the actual browser instance rather than dumping internal state. It compares persisted storage, in-memory Runtime, real Shadow DOM entries, host count and geometry, ChatGPT observer/composer connection, and recent failed operations. A healthy report contains `deviations: []`; abnormal reports include only the minimum evidence for each Runtime mismatch.

See `docs/architecture-current.md` for the current structure and `docs/adr/status-index.md` for canonical decision status.

## Build and verification

```bash
npm run verify
```

This builds the complete `.user.js`, generates the catalog, and verifies transactions, resource conflicts, migration, legacy commands, role/fold separation, Runtime health privacy and deviation detection, bounded reply intake, catalog updates, viewport containment, release integrity, and deterministic output.
