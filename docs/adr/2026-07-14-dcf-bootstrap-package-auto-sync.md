# ADR: Bootstrap-triggered first-party package synchronization

Date: 2026-07-14  
Status: accepted

## Context

DCF separates the Tampermonkey bootstrap from package-owned product capabilities. Catalog checks are normally throttled for six hours. After upgrading the userscript, that existing throttle state could suppress the first startup check, leaving the new bootstrap running with an older active first-party package revision. The user then had to open Package Management and manually click “检查更新” before the new functionality appeared.

## Decision

- Before normal state loading, boot reads the persisted root's previous `kernel_version` and compares it with the running `VERSION`.
- When the bootstrap version changed, every required first-party package is compared with the immutable revision embedded in the new userscript.
- If the embedded required revision is newer than the active revision, it is installed and activated through a new authoritative root revision before Runtime projection.
- Previous package revisions remain installed; synchronization never rewrites or deletes immutable history.
- The same startup also calls Catalog update with `force: true`, bypassing the ordinary six-hour throttle once for that bootstrap transition.
- On later reloads of the same bootstrap version, DCF does not force the embedded revision again. A user can deliberately switch to an older installed revision without every page refresh undoing the choice.
- Runtime exposes the detected previous kernel version and whether a bootstrap transition occurred for diagnosis.

## Why both local and remote synchronization

The embedded revision is the minimum capability baseline tested with that userscript and works without network access. The forced Catalog check can still discover a newer stable package published after the userscript artifact was built. Neither layer replaces the other.

## Rejected

- Only reducing the Catalog interval: still network-dependent and does not guarantee immediate availability after an upgrade.
- Activating the newest embedded package on every reload: would erase deliberate same-version rollback choices.
- Writing package contents directly into Runtime: would bypass the authoritative root and Environment projection lifecycle.
