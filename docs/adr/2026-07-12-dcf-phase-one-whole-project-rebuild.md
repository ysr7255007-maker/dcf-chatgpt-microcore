# ADR: DCF phase-one whole-project architecture rebuild

Date: 2026-07-12  
Status: accepted

## Context

DCF began from the language-ammunition loop and gradually extracted generic mechanisms for automatic intake, hot installation, updating, UI, commands, recovery, and diagnostics. That engineering inversion is correct: a reliable generic foundation must be built before the product module can evolve safely. The inversion becomes wrong only when architectural purity is used to reinterpret or reduce the original low-friction value goal.

The `0.10.0` package-source model fixed one major source of complexity, but the project still had multiple authority stores, a monolithic development artifact, whole-page text scanning, parallel command-trace and maintenance systems, duplicated hard-coded and declarative feature paths, and separate implementation logic for state changes, effects, migration, recovery, tests, and release.

## Decision

Phase one rebuilds the whole project around these relations:

1. Language ammunition owns the value goal; Core owns engineering structure.
2. Source is modular; release remains one complete userscript.
3. One root is authoritative; registry and UI are projections.
4. Every authoritative change uses one candidate/validate/commit transaction.
5. External domain formats compile to stable resource claims.
6. Replies, manual input, and GitHub are transports into one artifact path.
7. ChatGPT DOM belongs only to the Host Adapter.
8. Reply intake observes only the current/new reply and has history-independent cost.
9. State changes and external effects are separate.
10. Transaction/command/effect receipts replace parallel diagnostic universes.
11. Migration and rollback use the same candidate-validation path.
12. Product-critical ammo remains first-party and required; other modules prove extensibility without becoming a hypothetical public platform.

## Value constraint

No source-level simplification is accepted when it merely transfers internal complexity back to the user. Automatic extraction, loading, update, module installation, catalog update, and low-friction firing must be preserved or improved. When the cleanest architecture cannot retain these semantics, the architecture must be redesigned before the value goal is weakened.

## Performance constraint

DCF must not add work proportional to the full history of a long ChatGPT conversation. It may process the current reply and a fixed recovery window. It may not continuously observe `document.body`, read full-page text, enumerate all historical messages, or maintain DOM-block scan ledgers.

## Consequences

- `0.11.0` introduces modular source, one root, transactions, projections, typed artifacts, bounded Host Adapter intake, catalog transport, effects, and receipts.
- The former separate package/user/ops authorities become migration sources.
- Whole-page scanning, `seenBlocks` runtime logic, automatic success feedback into the conversation, hard-coded shell-adjustment bypasses, and test extraction from the generated userscript are superseded.
- Historical-message virtualization remains phase two.

## Verification

`npm run verify` must build and test the release. A real Chromium smoke test must additionally prove a newly inserted assistant `DCF_AMMO` reply is automatically loaded and can be fired into the ChatGPT composer.

## Reconsideration

Reconsider the structure only when a repeated real requirement cannot enter the same state/artifact/effect/projection mechanisms without reintroducing special paths, or when the mechanisms preserve formal consistency but measurably damage the language-ammunition value loop.
