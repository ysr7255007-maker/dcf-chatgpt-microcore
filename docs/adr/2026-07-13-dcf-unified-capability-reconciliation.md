# ADR: Unified capability reconciliation and package-owned declarative UI

Date: 2026-07-13  
Status: accepted

## Context

DCF already accepted complete package values from ChatGPT replies and independently scanned a GitHub catalog for newer installed packages. These paths eventually called the same transaction engine, but resolution, control intent, activation and user-visible ownership remained separate. Normal UI changes still modified the userscript bootstrap, contradicting the low-friction self-update direction.

## Decision

1. Treat `root.packages` as the authoritative desired capability set. Do not add a second desired-state store.
2. Treat complete `DCF_MODULE_PACK` as by-value artifact input.
3. Add `DCF_PACKAGE_UPDATE` as by-reference artifact input with package ID, target and channel.
4. Resolve references through the trusted catalog into the same immutable package artifact used by by-value input.
5. Route manual JSON, reply artifacts, explicit references and catalog scans through one capability Reconciler. It performs apply, receives the atomic transaction receipt and exposes one `dcf.reconcile.result.v1` result.
6. Rebuild the Runtime projection after every committed package change and rerender the current UI. A failed resolve or candidate leaves the previous root and Runtime intact.
7. Add `ui-view:*` as a package resource. `dcf.ui.package-management` is the first required package-owned view. It controls visible text, density, operation order and style while Core retains safe rendering and recovery operations.
8. Keep remote JavaScript, eval and localStorage-as-code prohibited. Package-owned UI is declarative.
9. Upgrade the userscript only when the bootstrap boundary changes. Ordinary functions, presentation and declarative UI evolve through package revisions.

## Consequences

- Direct conversation delivery and GitHub-controlled delivery differ only before resolution.
- Package management can update its own normal presentation through the same package mechanism.
- Catalog auto-update and explicit single-package update share activation and receipts.
- The userscript remains a trusted bootstrap and recovery root rather than the normal product release unit.
- Structural UI capabilities remain limited to the declarative view schema supported by the bootstrap renderer; new schema primitives may still require a bootstrap upgrade.

## Reconsider when

- a required UI behavior cannot be represented safely by declarative resources;
- package lifecycle requires explicit deactivate/activate hooks beyond projection and rerender;
- catalog trust, signatures or multi-source resolution need a stronger resolver policy.
