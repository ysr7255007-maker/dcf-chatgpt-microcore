# DCF Surface (Electron)

Independent desktop sidebar shell for the DCF (Dialog Control Framework) Surface.

This package wraps the existing `seed/surface/g2-dashboard.html` page into an
Electron `BrowserWindow` configured as a floating, frameless, always-on-top
sidebar, and bridges the renderer to the DCF Companion HTTP server
(`http://127.0.0.1:8472`) through a secure `contextBridge` preload.

## Layout

```
packages/desktop-electron/
├── package.json
├── src/
│   ├── main.js       # Electron main process: window + IPC handlers
│   └── preload.js    # contextBridge -> window.dcfBridge
└── README.md
```

## Runtime model

- **Zero extra npm runtime dependencies.** Only `electron` is declared as a
  `devDependency`. All HTTP forwarding uses the Node 18+ native `fetch`.
- The window loads the existing Surface page **without copying or modifying**
  anything under `seed/surface/`. The page is referenced in place via a
  relative path resolved from `src/main.js`.
- Code style follows `seed/companion/index.js`: CommonJS `require` + JSDoc.

## BrowserWindow configuration

| Option | Value | Purpose |
|---|---|---|
| `width` / `height` | `400` / `600` | Sidebar dimensions |
| `alwaysOnTop` | `true` | Floating over other windows |
| `transparent` | `true` | Transparent background |
| `frame` | `false` | Frameless window |
| `skipTaskbar` | `true` | Hidden from Dock/taskbar |
| `contextIsolation` | `true` | Isolated preload context |
| `nodeIntegration` | `false` | No Node in renderer |

## IPC surface (`window.dcfBridge`)

| Method | Channel | Behavior |
|---|---|---|
| `rpc(method, path, data)` | `dcf-rpc` | Forwards to Companion HTTP via native `fetch` |
| `requestRead()` | `dcf-request-read` | Phase 3 placeholder (returns `501`) |
| `sendCard(cardData)` | `dcf-send-card` | Phase 3 placeholder (returns `501`) |
| `onReadResult(callback)` | `dcf-read-response` | Subscribe to pushed read results |

`dcf-rpc` returns a normalized envelope `{ ok, status, body }`. When the
companion is unreachable it returns a synthetic
`{ ok:false, status:0, body:{ error:'companion-unreachable' } }` instead of
throwing, so the renderer can degrade gracefully.

## Usage

```bash
cd packages/desktop-electron
npm install        # installs electron
npm start          # launches the floating surface window
```

The window loads `seed/surface/g2-dashboard.html`. Start the Companion server
(`seed/companion/index.js`) separately if RPC forwarding is needed.

## Phase status

- **Phase 2 (this package):** scaffolding + window + RPC forwarding + placeholders.
- **Phase 3:** real `dcf-request-read` / `dcf-send-card` implementation against
  the active conversation surface.
