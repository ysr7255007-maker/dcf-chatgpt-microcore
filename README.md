# dcf-chatgpt-microcore

Public GitHub distribution source for a personally maintained DCF Tampermonkey runtime. The repository is public for update delivery, not operated as a community plugin platform.

## Runtime model

DCF `0.10.0` separates immutable package sources, user-owned state, and the derived runtime registry:

```text
package sources + user state -> deterministic candidate build -> runtime registry cache
```

Packages never edit the previous registry in place. Install, update, disable, uninstall, and revision rollback all change the active input set and rebuild a candidate result before commit.

## Verification

```bash
npm ci
npm test
```

The tests cover package-source migration, deterministic rebuilds, precise package removal, user-state preservation, resource conflicts, command evidence, privacy and consent boundaries, and viewport containment.
