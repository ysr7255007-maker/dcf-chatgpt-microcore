/**
 * DCF Surface - Electron Main Process
 *
 * Wraps the existing seed/surface/g2-dashboard.html page as an independent
 * floating sidebar window. IPC handlers bridge the renderer to the DCF
 * Companion HTTP server (http://127.0.0.1:8472) via preload + contextBridge.
 *
 * Zero extra npm runtime dependencies; uses Node 18+ native fetch.
 *
 * Code style: CommonJS require + JSDoc, aligned with seed/companion/index.js.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

/**
 * Companion HTTP RPC base URL.
 * @type {string}
 */
const COMPANION_BASE = 'http://127.0.0.1:8472';

/**
 * Path to the existing DCF Surface dashboard page.
 *
 * In development (npm start): resolves from src/ -> desktop-electron/ -> packages/ -> root -> seed/surface/
 * In packaged app: resolves from process.resourcesPath/seed/surface/ (extraResources config)
 *
 * @type {string}
 */
const SURFACE_HTML = app.isPackaged
  ? path.join(process.resourcesPath, 'seed', 'surface', 'g2-dashboard.html')
  : path.join(__dirname, '../../../seed/surface/g2-dashboard.html');

/** @type {BrowserWindow|null} */
let mainWindow = null;

/**
 * Create the floating surface window.
 */
function createSurfaceWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(SURFACE_HTML);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Forward an RPC call to the Companion HTTP server using native fetch.
 *
 * @param {string} method - HTTP method (GET/POST/PUT/DELETE).
 * @param {string} rpcPath - Path portion beginning with '/'.
 * @param {*} [data] - Optional request body (JSON-serializable).
 * @returns {Promise<{ok:boolean, status:number, body:*}>} Normalized response.
 */
async function forwardToCompanion(method, rpcPath, data) {
  const url = COMPANION_BASE + (rpcPath.startsWith('/') ? rpcPath : '/' + rpcPath);
  const upper = (method || 'GET').toUpperCase();
  const options = { method: upper, headers: { 'Accept': 'application/json' } };
  if (data !== undefined && upper !== 'GET' && upper !== 'HEAD') {
    options.headers['Content-Type'] = 'application/json';
    options.body = typeof data === 'string' ? data : JSON.stringify(data);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

/**
 * dcf-rpc: forward renderer RPC calls to the Companion HTTP server.
 * Returns a normalized { ok, status, body } envelope. When the companion is
 * unreachable, returns a synthetic error envelope instead of throwing.
 */
ipcMain.handle('dcf-rpc', async (_event, method, rpcPath, data) => {
  try {
    return await forwardToCompanion(method, rpcPath, data);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: 'companion-unreachable', message: err && err.message ? err.message : String(err) }
    };
  }
});

/**
 * dcf-request-read: Phase 3 placeholder.
 * Real implementation will pull a read snapshot from the active browser surface.
 */
ipcMain.handle('dcf-request-read', async () => {
  return {
    ok: false,
    status: 501,
    body: { error: 'not-implemented', phase: 3, message: 'dcf-request-read is a Phase 3 placeholder' }
  };
});

/**
 * dcf-send-card: Phase 3 placeholder.
 * Real implementation will push a card payload into the active conversation surface.
 */
ipcMain.handle('dcf-send-card', async (_event, _cardData) => {
  return {
    ok: false,
    status: 501,
    body: { error: 'not-implemented', phase: 3, message: 'dcf-send-card is a Phase 3 placeholder' }
  };
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createSurfaceWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSurfaceWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
