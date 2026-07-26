# ADR: Dialogue control and delivery are separate survivability planes

Date: 2026-07-20
Status: accepted architecture; implementation and live acceptance pending under Issue #54

## Context

The Local Agent dialogue loop had already proved that a ChatGPT conversation can create an OpenCode session and receive a final result. The next boundary was not merely “more progress messages.” It was whether a long-running task could remain observable and controllable while the browser page, the local execution session and the return path were all changing independently.

Real-browser testing exposed two different failures.

Dialogue `.16` treated synchronous `sendArtifact()` as a Promise. A status ACK raised `sendArtifact(...).catch is not a function`, the module entered a failed state and later status/cancel artifacts were no longer useful. Dialogue `.17` corrected that contract and stopped one delivery exception from immediately destroying the control path.

The following live test still failed the product boundary. While the OpenCode task remained observable, the panel alternated between “本机执行中” and “回传暂时失败，控制仍可用”; status and cancel produced no visible ACK. Source inspection showed that execution polling was asynchronous and did not monopolize the JavaScript thread. The remaining failure was in the browser return path: global and weak streaming detection, one shared status label, and a serial outbox confirmation loop made it impossible to distinguish normal waiting, control consumption, control execution and actual delivery.

This matters because the user must not become the transport layer. A control feature is incomplete when it starts a task but requires the user to inspect panels, copy session IDs, carry logs or guess whether cancel was consumed.

## Decision

### 1. Separate four responsibilities

The dialogue plugin must model these as independent planes:

- **intake** — detecting and parsing new assistant artifacts;
- **execution** — observing the OpenCode task and its terminal state;
- **control** — resolving, consuming and applying status/steer/cancel commands;
- **delivery** — returning progress, ACKs, permissions and results through the ChatGPT composer.

A failure or wait in one plane must not be represented as failure of all four.

### 2. Control availability is a product invariant

While an underlying task is active, status, cancel and cancel-after-checkpoint remain available even when:

- the task itself has failed;
- the previous control command failed;
- an ACK could not yet be delivered;
- the composer is occupied;
- the page is temporarily generating;
- an outbox item is waiting for confirmation or retry.

Only a true initialization or core-dependency failure may make the whole module fatal. Even then, bounded diagnosis and abort should remain available where the platform permits.

### 3. Waiting is not failure

Transport states such as waiting for page idle, an empty composer, an enabled send button, confirmation or a retry deadline are normal states. They must not set a generic failure flag or overwrite the execution status.

Delivery becomes degraded only after a defined, evidence-backed threshold or an unrecoverable condition. The UI must show execution, latest control and delivery independently.

### 4. Delivery is a persistent non-blocking state machine

The outbox must advance by short ticks. A send action records its baseline, timestamps, deadline, attempts and next retry, then releases the scheduler. Later ticks perform one bounded observation and move the item to delivered, retry-wait or degraded.

No item may hold the pump through an internal sleep loop. One unconfirmed progress event must not delay a later cancel ACK or terminal result.

Critical items receive explicit priority. Heartbeats and stale progress may be coalesced; cancel ACKs, results and permission requests may not be silently discarded.

### 5. Browser state must be inferred narrowly

“ChatGPT is streaming” must be derived from the active composer/send region and a visible, interactive current stop control. Hidden, zero-size, disabled, aria-hidden, residual or unrelated Stop buttons are not execution evidence.

DOM heuristics remain fallible. Their current result and reason must therefore be visible in bounded diagnostics rather than promoted directly to a global failure conclusion.

### 6. Consumption, side effect and delivery need separate evidence

Persist and display enough privacy-bounded evidence to answer:

- Was the command artifact detected?
- Was it parsed and uniquely resolved?
- Was the command consumed?
- Did the status snapshot, steer or abort side effect succeed?
- Was the ACK enqueued?
- What outbox state is it in?
- Was it delivered?
- Is the task still active or terminal?

This evidence must not include conversation text, hidden reasoning, credentials or complete sensitive payloads.

### 7. Diagnostics report facts before hypotheses

A session missing from `/session/status` is a neutral fact such as `not_listed_in_active_status`. It is not by itself proof that execution never started or failed. Known terminal state, session existence, messages and endpoint health must be considered first. Diagnostics Issue #62 remains separate from the outbox implementation but follows the same evidence discipline.

### 8. Acceptance is end-to-end

Unit and CI tests must exercise real state transitions with controllable DOM and time. They are necessary but do not close the ADR.

Live acceptance requires one long task in which the current conversation can, without user-carried identifiers or logs:

1. receive the first usable progress identity;
2. request status and receive a checkpoint;
3. steer the same session;
4. cancel the same session and observe that execution stopped;
5. repeat cancel without a second side effect or terminal result;
6. continue control processing when an earlier delivery is waiting or degraded;
7. distinguish command-not-consumed from command-executed-but-not-delivered.

## Rationale

DCF exists to absorb operational complexity for the user. Internal concurrency, retries and evidence may be complex; exposing that complexity as copying, waiting, guessing or repeated manual testing defeats the product.

A reliable control plane is not an optional diagnostic convenience. It is the condition that makes delegation safe enough to entrust with longer work. Starting work is easy; preserving the user's ability to understand, redirect and stop it is the real product boundary.

Deterministic machinery should handle queueing, retry, identity, idempotency and evidence. AI judgment should interpret that evidence and decide what to change. Neither source inspection nor CI conformance may be treated as proof of browser behavior.

## Rejected approaches

- one global `state.status` for task, control and delivery;
- converting every synchronous enqueue function into an assumed Promise contract;
- a blocking confirmation loop inside the serial outbox pump;
- page-wide Stop-button matching as streaming authority;
- marking normal composer/page waits as delivery failure;
- tests that assert only source tokens or function names;
- asking the user to copy session IDs, logs or control outcomes between the panel and the conversation;
- declaring success because the task eventually ended while the control result remained unknowable.

## Current boundary

- Dialogue `.17` is merged at baseline `4b94bd224c2b910c9e4a1497e9a9118df7a549de`.
- `.17` fixes the synchronous `sendArtifact` crash and contains control errors, but the long-task control/outbox live acceptance failed.
- Issue #54 remains open for the non-blocking outbox, narrow streaming detection, split status channels and control/delivery evidence.
- Issue #62 remains open for diagnostics that over-interpret absence from `/session/status`.
- The ADR becomes fully accepted only after the end-to-end live boundary above passes.
