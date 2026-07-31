# Independent evidence recorders

These recorders are **not DCF plugins**. They know nothing about DCF storage, narrative chains, anchors, or AI. Their complete contract is:

```text
observe one fact
→ attach system time
→ append one JSON object to a recorder-owned JSONL file
```

All facts use the thin envelope documented in the parent README. Source-specific data remains inside `context` and `payload`.

## Included frameworks

### `shared/jsonl-writer.mjs`

Verified in Node. It creates content-addressed event IDs when a recorder does not supply one and appends facts under:

```text
$DCF_EVIDENCE_ROOT/<source>/YYYY-MM-DD.jsonl
```

### `native-writer/native-writer-host.mjs`

Verified at protocol level in Node. It accepts Chrome native-messaging frames on stdin and appends the contained facts with the shared writer. Configure `DCF_EVIDENCE_ROOT` in the wrapper that launches the host. Copy and edit `com.dcf.evidence_writer.example.json` for the local Chrome installation.

### `browser-visible/`

Framework only; Chrome runtime execution is not verified in this environment.

The extension records visible-page state and explicit text selections. Full visible text is disabled by default and can be enabled through the `captureVisibleText` value in `chrome.storage.local`. If the native host is unavailable, the service worker retains a bounded local queue and retries after restart/install.

### `computer-state/macos-state-poller.mjs`

Framework only; macOS Accessibility/System Events execution is not verified in this Linux environment. It polls the frontmost application and window title and writes only state changes. It deliberately does not infer user intent.

## `behavior-macos/`

Framework only; native macOS compilation and runtime permission behavior are not verified in this Linux environment. The Swift reference recorder emits the two narrative-backbone facts:

```text
user.text.output
user.control.click
```

It reads final visible text only at Return, Tab, or click boundaries, excludes secure fields, resolves clicked Accessibility controls, and writes through the same thin envelope without calling DCF. See its README for build commands and known semantic limits.
