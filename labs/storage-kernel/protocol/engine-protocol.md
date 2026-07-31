# DCF Storage Lab External Engine Protocol v1

Protocol identifier: `dcf.storage-lab.engine.v1`.

An engine executable is a long-lived child process. It reads one UTF-8 JSON object per line from stdin and writes exactly one UTF-8 JSON response line to stdout for each request. Diagnostics belong on stderr only.

## Envelope

Request:

```json
{
  "protocol_version": "dcf.storage-lab.engine.v1",
  "request_id": "req-1",
  "op": "count",
  "binding": {
    "engine_id": "utf8-a1",
    "engine_kind": "utf8_self_index",
    "run_id": "run-...",
    "dataset_id": "...",
    "dataset_sha256": "...",
    "config_sha256": "..."
  },
  "payload": {}
}
```

Success response:

```json
{
  "protocol_version": "dcf.storage-lab.engine.v1",
  "request_id": "req-1",
  "ok": true,
  "binding": { "...": "the exact request binding" },
  "result": {},
  "error": null
}
```

Failure response:

```json
{
  "protocol_version": "dcf.storage-lab.engine.v1",
  "request_id": "req-1",
  "ok": false,
  "binding": { "...": "the exact request binding when supplied" },
  "result": null,
  "error": {
    "code": "manifest_mismatch",
    "message": "human-readable explanation",
    "details": {}
  }
}
```

The harness rejects responses whose protocol version, request id or binding differs from the request.

## Operations

### `hello`

No binding. The process must confirm protocol support.

### `build`

Payload:

```json
{
  "canonical_path": "/absolute/read-only/path/canonical.bin",
  "segment_dir": "/absolute/path/to/engine-output",
  "engine_config": {}
}
```

The engine must write to a temporary sibling directory and atomically publish a completed segment. It must never modify `canonical_path`.

Result:

```json
{
  "segment_dir": "/absolute/path/to/engine-output",
  "storage_components": [
    { "name": "wavelet", "bytes": 123 }
  ],
  "notes": []
}
```

### `open`

Payload contains `segment_dir` and `engine_config`.

Result:

```json
{
  "capabilities": {
    "count": true,
    "locate": true,
    "extract": true,
    "recover_all": true,
    "independent_text_store": false
  }
}
```

The engine must refuse to open a segment whose persisted dataset/config binding differs from the request binding.

### `count`

Payload: `{ "query_hex": "e69e..." }`.

Result: `{ "count": 48 }`.

Empty queries must fail explicitly.

### `locate`

Payload: `{ "query_hex": "...", "limit": 10 }`.

Result:

```json
{
  "spans": [
    {
      "text_id": "dataset-text-id",
      "start": 100,
      "end": 112
    }
  ]
}
```

Every span is a half-open canonical UTF-8 byte range. Unicode engines must perform codepoint-to-byte recovery internally; the harness does not repair approximate positions.

### `extract`

Payload contains one canonical span. Result contains `bytes_hex`.

### `recover_all`

Result contains the complete canonical corpus in `bytes_hex`. This operation is only valid for self-contained engines.

### `measure_storage`

Result contains a component list. The list must include every persisted byte required to open and use the segment, including directories, samples, maps, manifests and completion markers.

### `shutdown`

No binding. The engine should exit cleanly after responding.

## Timing boundary

The harness keeps the process alive during a benchmark run. Engine process startup is measured separately from query latency. Query responses must not include unrelated background work. Local wrappers must state whether files are application-hot, OS-page-cache-hot, or storage-cold; the engine must not label these states on its own.
