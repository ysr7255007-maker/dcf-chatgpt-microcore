# ADR: DCF storage-backend bridge and one-click health report

Date: 2026-07-12  
Status: accepted

## Context

DCF `0.10.0` stored package sources, user state, operations, and the derived registry in the ChatGPT page's `localStorage`. DCF `0.11.0` added Tampermonkey GM storage grants and the new storage adapter correctly preferred GM storage for the authoritative root. However, the migration reader used that same preferred backend. The old page-local stores therefore became invisible to the new runtime even though they still physically existed.

This produced a misleading state: the new root, standard packages, and UI could all look healthy while old modules, Surfaces, display metadata, appearance values, and ammunition remained stranded in another browser storage namespace.

The same incident showed that the existing short maintenance summary was not sufficient for remote diagnosis. It described only the current root and recent receipts, so it could not reveal split storage backends, compare legacy and current module inventories, or establish whether Host Adapter intake and UI projections were actually connected.

## Decision

DCF `0.11.1` adds a one-time storage-backend bridge and a privacy-safe whole-runtime health report.

The storage adapter now exposes explicit backend reads and inventories. GM storage remains the sole authoritative write target when available. During boot, before normal runtime initialization, DCF also inspects page `localStorage` for:

- an earlier DCF root;
- `0.10.0` package, user, and ops stores;
- older registry-only state.

When an authoritative GM root already exists, legacy local data is merged into a candidate root instead of replacing current state. Current user choices win; missing legacy packages, revisions, ammunition, settings, module display data, and appearance values are recovered. Each missing legacy package is projection-tested before acceptance. Conflicting packages are skipped with explicit reasons in `system.storage_bridge` rather than silently discarded or allowed to break boot.

The bridge is idempotent. Its result is recorded in the authoritative root so it does not replay on every page load.

The maintenance UI and Tampermonkey menu now provide **一键体检并复制**. The resulting `dcf.health.report.v1` includes:

- both GM and localStorage DCF-key inventories;
- bridge and migration records;
- root, state hash, projection, build, snapshot, and receipt status;
- current package, module, Surface, command-count, and provider inventories;
- legacy/current package and module comparisons with missing IDs;
- required product-package checks;
- bounded Host Adapter observer and composer status;
- recent failure summaries.

The report excludes conversation text, ammunition bodies, package payloads, command arguments, credentials, cookies, and authentication data. It is copied inside a `DCF_HEALTH_REPORT` block so the user can paste it directly into a maintenance conversation.

## Consequences

- The observed missing-module problem is repaired at its source: storage namespaces are bridged before runtime projection.
- Future migration failures can be diagnosed from one report instead of relying on user descriptions or screenshots.
- The report is a local diagnostic projection, not a second authority store and not an enterprise audit system.
- Successful health checks remain silent except for the local copy confirmation.

## Reconsideration

Reconsider the bridge only after all supported pre-`0.11.1` states have passed their migration horizon and an explicit cleanup release can safely remove legacy readers. Keep the health-report contract even after that cleanup; its inventory and cross-layer checks remain useful for later architecture changes.