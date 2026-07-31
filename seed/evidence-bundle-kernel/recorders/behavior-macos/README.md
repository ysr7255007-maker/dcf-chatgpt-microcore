# macOS output and control-click recorder framework

`DCFBehaviorRecorder.swift` is a native reference implementation for the two facts that form the DCF behavior backbone:

```text
user.text.output
user.control.click
```

It does not import or call DCF. It listens at the macOS interaction boundary and appends timestamped JSONL under:

```text
$DCF_EVIDENCE_ROOT/behavior-macos/YYYY-MM-DD.jsonl
```

## Behavior

- Uses a listen-only `CGEventTap` for left-click and Return/Tab boundaries.
- Resolves clicked controls through the Accessibility API and records role, subrole, title, identifier, application, window and position.
- Before a click, Return or Tab, reads the currently focused text-like Accessibility element and emits its final visible value as `user.text.output`.
- Excludes secure text fields and emits only an exclusion marker.
- Never stores raw key events.
- Marks text semantics as `final-visible-text-at-boundary`; this is an observable approximation, not a claim that every captured value was submitted.

## Build on macOS

```bash
swiftc \
  -framework AppKit \
  -framework ApplicationServices \
  DCFBehaviorRecorder.swift \
  -o dcf-behavior-recorder

DCF_EVIDENCE_ROOT="$HOME/DCF-Evidence" ./dcf-behavior-recorder
```

Grant Accessibility permission. Input Monitoring may also be required for the event tap.

## Verification state

`not_tested` in the Linux implementation environment. The local AI should compile it first, then test at least:

1. Chinese input-method composition produces final visible text rather than raw key codes.
2. Password and secure fields never write text or identifying control metadata.
3. ChatGPT/Claude input plus Send click creates one text fact followed by one click fact.
4. Terminal behavior does not incorrectly store the entire scrollback as user output.
5. Repeated boundary events do not produce harmful duplicate outputs.

The likely first local refinement is source-specific extraction for terminals and rich editors. Those are semantic enhancements; the recorder must remain an independent timestamped file producer.
