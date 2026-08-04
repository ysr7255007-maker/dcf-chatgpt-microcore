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

const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const { CompanionAdapterClient } = require('./companion-adapter-client');

/**
 * Companion HTTP RPC base URL.
 * @type {string}
 */
const COMPANION_BASE = process.env.DCF_COMPANION_URL || 'http://127.0.0.1:8472';

/**
 * Adapter command client (enqueue + wait, honest failures).
 * @type {CompanionAdapterClient}
 */
const adapterClient = new CompanionAdapterClient({ baseUrl: COMPANION_BASE });

/** Panel geometry per task spec: 340 wide; height follows screen workArea. */
const PANEL_WIDTH = 340;
/** Collapsed floating-ball window size: small unobtrusive translucent dot. */
const BALL_SIZE = 44;

/**
 * 贴边几何：面板贴主屏右边缘、高度=工作区高度（不含菜单栏/Dock），
 * 修复「1200px 超过屏幕长度」与「居中栏位」两个形态错误。
 */
function getPanelBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - PANEL_WIDTH, y: workArea.y, width: PANEL_WIDTH, height: workArea.height };
}

/**
 * Path to DCF Surface views (Three Cognitive Lens Architecture)
 *
 * In development (npm start):
 *   - Task View: seed/surface/views/task/index.html
 *   - Exploration View: seed/surface/views/exploration/index.html
 *   - Reflection View: seed/surface/views/reflection/index.html
 * 
 * In packaged app: resolves from process.resourcesPath/seed/surface/views/
 */
const SURFACE_VIEWS = {
  task: app.isPackaged
    ? path.join(process.resourcesPath, 'seed', 'surface', 'views', 'task', 'index.html')
    : path.join(__dirname, '../../../seed/surface/views/task/index.html'),
  
  exploration: app.isPackaged
    ? path.join(process.resourcesPath, 'seed', 'surface', 'views', 'exploration', 'index.html')
    : path.join(__dirname, '../../../seed/surface/views/exploration/index.html'),
  
  reflection: app.isPackaged
    ? path.join(process.resourcesPath, 'seed', 'surface', 'views', 'reflection', 'index.html')
    : path.join(__dirname, '../../../seed/surface/views/reflection/index.html')
};

/** Current view mode: 'task' | 'exploration' | 'reflection' */
let currentViewMode = 'task';

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {BrowserWindow|null} */
let ballWindow = null;

/**
 * Create the floating surface panel window with specified view mode.
 * @param {string} viewMode - 'task', 'exploration', or 'reflection'
 */
function createSurfaceWindow(viewMode = 'task') {
  const bounds = getPanelBounds();
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    alwaysOnTop: true,
    transparent: true,
    // macOS 真透明三件套（缺一则渲染白底圆角方块，像 APP 图标底板）：
    // transparent + 显式全透背景色 + 禁用系统圆角
    backgroundColor: '#00000000',
    roundedCorners: false,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // macOS Space 修复（随时任意界面悬浮展开初衷）：
  // 未设跨工作区可见时，在全屏 App 的 Space 中 show()/focus() 会被 macOS
  // 强制切到窗口所属桌面。visibleOnFullScreen 让窗口可悬浮于全屏 Space 上方。
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 提升置顶层级，确保盖在全屏应用上方（Spotlight/Raycast 同级）
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  // 悬浮面板自身不应进入全屏模式
  mainWindow.setFullScreenable(false);

  const viewPath = SURFACE_VIEWS[viewMode] || SURFACE_VIEWS.task;
  mainWindow.loadFile(viewPath);

  // Inject collapse control into the fixed header for each view
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`(function () {
      if (document.getElementById('dcf-collapse-btn')) return;
      var btn = document.createElement('button');
      btn.id = 'dcf-collapse-btn';
      btn.className = 'dcf-collapse-inline';
      btn.textContent = '\u25CF';
      btn.title = '\u6536\u8d77\u4e3a\u60ac\u6d6e\u7403';
      btn.setAttribute('aria-label', '\u6536\u8d77\u4e3a\u60ac\u6d6e\u7403');
      btn.addEventListener('click', function () {
        if (window.dcfBridge && window.dcfBridge.collapsePanel) {
          window.dcfBridge.collapsePanel();
        }
      });
      // 插入固定 header 末尾：不随内容滚动，永远可点；无 header 时回退 fixed
      var header = document.querySelector('.view-header');
      if (header) {
        header.appendChild(btn);
      } else {
        btn.style.cssText = 'position:fixed;top:6px;right:6px;z-index:99999;' +
          'width:24px;height:24px;border-radius:50%;border:none;cursor:pointer;' +
          'background:rgba(88,166,255,0.3);color:#58a6ff;font-size:10px;line-height:1;';
        document.body.appendChild(btn);
      }
      // 自动展开/收起已移除（hover 展开导致球不可拖拽，光标轮询有性能损耗）。
      // 保留简单交互：点击球展开，点击面板按钮收起。
    })();`).catch(() => { /* injection is cosmetic; never fatal */ });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create the collapsed floating-ball window (small translucent sphere).
 */
function createBallWindow() {
  ballWindow = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 悬浮球同样跨工作区可见：任何桌面/全屏 App 中都应可点击展开
  ballWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ballWindow.setAlwaysOnTop(true, 'screen-saver');
  ballWindow.setFullScreenable(false);

  ballWindow.loadFile(path.join(__dirname, 'ball.html'));

  // 默认停靠右边缘（用户拖拽后位置由 macOS 记忆，不再强制）
  const { workArea } = screen.getPrimaryDisplay();
  ballWindow.setPosition(workArea.x + workArea.width - BALL_SIZE - 6, workArea.y + 120);

  ballWindow.on('closed', () => {
    ballWindow = null;
  });
}

/**
 * Collapse: hide the panel and show the floating ball docked to the right
 * screen edge (resident trigger).
 */
function collapseToBall() {
  if (!ballWindow) {
    createBallWindow();
  }
  if (mainWindow) {
    const { workArea } = screen.getPrimaryDisplay();
    ballWindow.setPosition(workArea.x + workArea.width - BALL_SIZE - 6, workArea.y + 120);
    mainWindow.hide();
  }
  ballWindow.show();
}

/**
 * Expand: hide the ball and restore the panel docked to the right edge,
 * full workArea height.
 */
function expandToPanel() {
  if (!mainWindow) {
    createSurfaceWindow(currentViewMode);
  }
  mainWindow.setBounds(getPanelBounds());
  if (ballWindow) {
    ballWindow.hide();
  }
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Switch between different cognitive lens views
 * @param {string} newViewMode - 'task', 'exploration', or 'reflection'
 */
function switchViewMode(newViewMode) {
  const validModes = ['task', 'exploration', 'reflection'];
  if (!validModes.includes(newViewMode)) {
    console.error('Invalid view mode:', newViewMode);
    return;
  }
  
  currentViewMode = newViewMode;
  
  // Reload current window with new view
  if (mainWindow) {
    const viewPath = SURFACE_VIEWS[newViewMode];
    mainWindow.loadFile(viewPath);
  }
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
 * dcf-request-read: enqueue a read-conversation command through the
 * companion durable queue and wait (500ms poll, 15s default timeout) for
 * the Chrome adapter to execute it against the active tab.
 * Honest outcome: {ok:false, error} on timeout/failure — no fake 501.
 */
ipcMain.handle('dcf-request-read', async (_event, options) => {
  const payload = { limit: (options && options.limit) || 20 };
  return adapterClient.execute('read-conversation', payload, options && options.timeout_ms);
});

/**
 * dcf-send-card: enqueue a send-card command (inject only by default;
 * auto_send must be explicitly true to click send) and wait for the result.
 * Honest outcome: {ok:false, error} on timeout/failure — no fake 501.
 */
ipcMain.handle('dcf-send-card', async (_event, cardData) => {
  const payload = {
    text: (cardData && cardData.text) || '',
    auto_send: Boolean(cardData && cardData.auto_send)
  };
  if (!payload.text) {
    return { ok: false, error: 'send-card requires a non-empty text payload' };
  }
  return adapterClient.execute('send-card', payload, cardData && cardData.timeout_ms);
});

/** dcf-collapse-panel: switch to the floating-ball state. */
ipcMain.on('dcf-collapse-panel', () => {
  collapseToBall();
});

/** dcf-expand-panel: restore the 340x1200 panel from the ball. */
ipcMain.on('dcf-expand-panel', () => {
  expandToPanel();
});

/** dcf-switch-view: switch between Task/Exploration/Reflection views */
ipcMain.on('dcf-switch-view', (_event, newViewMode) => {
  switchViewMode(newViewMode);
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // 前台应用声明：全部窗口 skipTaskbar 时 Electron 会将 activation policy 降为
  // accessory（UIElement，无 Dock 图标、无法切换关闭）。显式恢复 regular，
  // 让 Dock 有占位图标、Cmd+Q / Dock 右键可退出。
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    app.dock.show();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ]));
  }

  // 启动默认悬浮球状态（面板等首次展开再创建，避免「闪一下」）
  createBallWindow();

  app.on('activate', () => {
    // Dock 图标点击：无窗口时恢复悬浮球（而不是空转）
    if (BrowserWindow.getAllWindows().length === 0) {
      createBallWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
