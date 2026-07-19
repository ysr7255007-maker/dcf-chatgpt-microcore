# ADR: DCF browser runtime evidence bridge

Date: 2026-07-20

Status: accepted for Issue #58

## Context

DCF's pure Chrome base deliberately has no product-specific background API, Native Host, CDP proxy, or browser automation interface. The Local Agent plugin is a browser client of OpenCode's loopback HTTP API. That API exposes OpenCode state, not DCF's Chrome runtime, plugin registrations, Shell mount, Dialogue observer, page lifecycle, or outbox state. It cannot be used as a reverse browser-state transport without modifying OpenCode.

The browser still needs to provide bounded, structured evidence to a local agent without exposing conversation text, raw DOM, browser storage, cookies, credentials, or console logs.

## Decision

Add two small, separately owned pieces:

1. `dcf.firstparty.runtime-evidence` is an ordinary first-party user-script plugin. It is installed with DCF but disabled by default. When enabled it collects only an explicit field whitelist from DCF Host status and public plugin runtime summaries. It publishes a versioned `dcf.runtime.snapshot.v1` and bounded `dcf.runtime.event.v1` batch to loopback.
2. `scripts/dcf-runtime-evidence-bridge.js` is a dependency-free local HTTP collector, bound to `127.0.0.1:4178` by default. It is intentionally not a Native Host and does not become part of the Chrome extension installation. A local agent starts it when runtime inspection is required; failure to start or reach it leaves DCF unchanged.

The collector offers deterministic, read-only local APIs:

- `GET /dcf/runtime/connection`
- `GET /dcf/runtime/snapshot`
- `GET /dcf/runtime/events?since=<seq>`
- `POST /dcf/runtime/checks/run`
- `POST /dcf/runtime/diagnostic/start`
- `POST /dcf/runtime/diagnostic/stop`

Diagnostic requests are commands for the page-diagnostics plugin only. They cannot execute arbitrary browser actions. The browser polls a fixed command route and acknowledges only `diagnostic.start` and `diagnostic.stop`.

## Security and privacy

- The collector binds to IPv4 loopback by default and emits CORS headers only for ChatGPT origins.
- The browser endpoint validator permits only a loopback origin with no path, query, credentials, or fragment.
- No endpoint accepts arbitrary commands, DOM selectors, scripts, console expressions, OpenCode credentials, or write operations against DCF.
- Event batches are capped at 64 per publish; the collector keeps at most 256 events for 30 minutes. Query and diagnostic activity retains a 128-entry bounded audit trail.
- The bridge uses a field whitelist. The snapshot explicitly records that conversation text, Assistant text, credentials, cookies, raw DOM, raw logs, and reasoning are absent.
- Disabling the plugin stops publishing immediately. An unreachable collector is recorded locally by the plugin and cannot block DCF's normal UI, Dialogue, or Local Agent operation.

## Consequences

This introduces a minimal local process because the existing OpenCode API is not a reverse-state channel and the Chrome architecture intentionally lacks a host proxy. It remains optional, has no installation hook, and has no privileged browser or OS access.

Before merging, the bridge must consume the actual Issue #52/#53 fields from the merged PR #57 implementation. It must not invent outbox confirmation or lifecycle signals.
