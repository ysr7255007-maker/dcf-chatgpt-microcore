# Verification evidence

Generated: `2026-08-01`

Environment:

```text
Node v22.16.0
npm 10.9.2
Linux sandbox
```

Fresh command:

```bash
npm run verify
```

Observed result:

```text
tests: 10
pass: 10
fail: 0
cancelled: 0
skipped: 0
node --check src/cli.js: exit 0
```

The test suite exercised temporal fact indexing, malformed-envelope isolation, duplicate/conflict handling, continuity chains, deterministic anchors, evidence tiers, idempotent compilation, late-fact versioning, configuration-derived versioning, daily compilation, JSONL recording, and native-messaging framing.

Additional syntax checks completed with exit `0` for:

```text
recorders/browser-visible/service-worker.js
recorders/browser-visible/content-script.js
recorders/computer-state/macos-state-poller.mjs
recorders/native-writer/native-writer-host.mjs
```

Not tested in this environment:

```text
Chrome extension installation
Chrome native-host registration
macOS System Events permission and real polling
macOS final-text and Accessibility click recorder
existing DCF Companion/Surface integration
root repository npm run verify
```

The sandbox could not resolve `github.com` for a local clone. Code was verified in an isolated mirror and then written to the GitHub feature branch through the GitHub connector. The local AI should rerun the package verification from a fresh checkout before modifying or integrating it.
