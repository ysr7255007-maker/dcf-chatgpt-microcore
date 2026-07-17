# ADR: DCF Chrome 纯底座、个人独立插件与双更新通道

Date: 2026-07-17  
Status: accepted for `1.0.0-rc.2`; pending product acceptance

## Context

`rc.1` proved Chrome-native dynamic code storage, exact startup snapshots and rollback, but shipped only a partial language-ammo product and still treated local ZIP installation plus `0.18.2` migration as primary facts. The user's actual target is a small personal plugin whose architecture removes complexity and user friction.

DCF Next before Core Review already established the desired product functions. Next Core failed to make Tampermonkey execute independently installed JavaScript and therefore is evidence for leaving that platform, not a source for the Chrome architecture.

## Decision

1. The Chrome extension is a pure static base. Ordinary product features live only in independent user-script plugins.
2. The initial personal library contains Shell, ammo, conversation performance, attribution, appearance, backup, plugin manager and diagnostics.
3. Each plugin is one immutable, self-contained built JavaScript with its own world, registration and generic data namespace.
4. The base stores code, exact candidate/current/LKG combinations, coordinates registrations, collects evidence and provides static recovery.
5. The fixed GitHub personal plugin index supplies first install and independent plugin updates.
6. The Chrome base is built from GitHub and automatically submitted to a non-public Chrome Web Store listing after one-time credentials are configured.
7. Internal plugin independence must not create user-facing assembly. The default complete combination installs automatically, successful updates remain quiet and failures roll back automatically.
8. Data continuity covers the complete DCF Next and Chrome rc.1 only. `0.18.2` is not a separate migration source because DCF Next already absorbed it.
9. Plugin versions are immutable per plugin and are derived from each plugin source. A change to one plugin must not manufacture new versions for unchanged plugins.
10. Shell owns tab selection and panel composition. Its visibility coordination must remain effective even when a mounted plugin Shadow DOM declares its own `:host` display style.

## Consequences

- normal feature development no longer changes the base;
- one plugin can update or fail without changing other plugin references;
- the user does not repeatedly download or reload local extension files;
- the base remains subject to Chrome Web Store review latency, so changing product features belongs in plugins whenever possible;
- actual store publication requires one-time external account/listing/secret configuration and cannot be claimed before that evidence exists.

## rc.2 Shell hotfix evidence

The first real-browser acceptance found that tab clicks changed Shell state but all plugin panels remained visible. Shell had relied on the HTML `hidden` attribute while plugin Shadow DOM styles declared `:host { display:block }`, so panel-local styling defeated the coordinator's visibility result.

The repair is a Shell-plugin update, not a static-base update:

- Shell `1.0.0-rc.2-shell.2` explicitly coordinates both `hidden` and an important host `display` value;
- before replacing an older Shell that does not yet know how to release panels, the new Shell first detaches all mounted panel hosts from the old Shell's open Shadow DOM; this makes the first real Shell-only update preserve the seven unchanged plugins;
- all later Shell replacements release mounted plugin panel hosts through the Shell cleanup boundary before removing the old host;
- the build reads immutable versions from each plugin source;
- the lifecycle test updates Shell alone and verifies that the other seven version/hash references are unchanged;
- both the full DCF verification workflow and Chrome candidate workflow passed for the isolated-update architecture before product acceptance.

Real ChatGPT acceptance still determines whether the repaired tabs behave correctly in the user's browser. The automated result proves the isolated-plugin update transaction and regression boundaries, not the final visible browser outcome.

## Rejected expansion

No public marketplace, third-party governance, browser-side npm, general dependency resolver, service container, permission platform, generalized event bus, Local Agent expansion or compiled combination families.
