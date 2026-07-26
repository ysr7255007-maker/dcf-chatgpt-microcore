# ADR: DCF Chrome 原生动态宿主

Date: 2026-07-17  
Status: superseded by `2026-07-17-dcf-chrome-pure-base-personal-plugins.md`

This ADR records the `1.0.0-rc.1` decision that proved Chrome `userScripts`, immutable code units, exact candidate/current/LKG snapshots, startup evidence, extension-update reconstruction and static recovery.

`rc.2` retains those mechanisms but supersedes the product boundary:

- the extension is now a pure base rather than bundling the ammo unit;
- complete product functions come from independent GitHub personal plugins;
- the product baseline is DCF Next before Core Review;
- data continuity is DCF Next plus Chrome rc.1, not a separate `0.18.2` migration;
- plugin updates pull from GitHub and base updates are intended for non-public Chrome Web Store distribution.

The historical rc.1 details remain available in commit `b34f007fa7c3c9abf7a7fe8da72b36b5e3ef92b0`.
