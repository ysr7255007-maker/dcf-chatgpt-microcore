# dcf-chatgpt-microcore

DCF is a personally maintained ChatGPT Tampermonkey system whose value goal is a low-friction language-ammunition loop. The repository is public for update delivery, not operated as a community plugin platform.

## Current architecture

DCF `0.11.0` separates the product goal from the engineering dependency:

```text
language-ammunition loop
        ↓ product constraints
first-party ammo module
        ↓ uses
generic DCF kernel
```

The kernel is developed as modular source and released as one complete userscript. One authoritative state root is changed only through a unified transaction path:

```text
intent or artifact
→ candidate state
→ invariant validation
→ atomic root commit
→ derived runtime projection
→ receipt / host effect
```

ChatGPT replies and the private GitHub catalog are transports. They decode typed artifacts and enter the same transaction engine. DCF observes only newly added/current assistant replies; it does not rescan the whole conversation history.

See `docs/architecture-current.md` for the current structure and `docs/adr/status-index.md` for the canonical ADR status.

## Build and verification

```bash
npm run verify
```

This builds the complete `.user.js`, generates the catalog, and verifies state transactions, resource conflicts, migration, legacy commands, bounded reply intake, automatic artifact application, catalog updates, viewport containment, release integrity, and deterministic output.
