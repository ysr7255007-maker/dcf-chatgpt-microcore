# G2 Surface — Electron 悬浮窗口架构方案

## 核心结论

DCF G2/G3/G4 Surface 采用 **Electron BrowserWindow** 包装现有 `seed/surface/*.html` 为全屏透明悬浮窗口，通过 **macOS Accessibility API** 实现跨桌面可见性（Visible on All Workspaces），配合 **preload + contextBridge** 安全暴露 IPC 通信能力给 Web 进程，实现 DCF Companion HTTP RPC 的完整对接。

---

## 1. BrowserWindow 配置参数清单

### 1.1 核心配置 (main.js)

```javascript
const { app, BrowserWindow, screen } = require('electron/main');

function createSurfaceWindow(htmlPath, config = {}) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const window = new BrowserWindow({
    // === 悬浮特性 (macOS 优先) ===
    alwaysOnTop: true,                      // ✅ 始终置顶
    transparent: true,                      // ✅ 完全透明背景
    frame: false,                           // ✅ 无边框
    skipTaskbar: true,                      // ✅ 不显示在任务栏/Dock
    focusable: true,                        // ✅ 可接收焦点 (必需)
    visible: true,                          // ✅ 可见
    
    // === 工作区适配 ===
    width: screenWidth,                     // ✅ 全屏宽度
    height: screenHeight,                   // ✅ 全屏高度
    x: 0,                                   // ✅ 屏幕左上角
    y: 0,
    
    // === macOS 特殊处理 ===
    backgroundColor: '#00000000',           // ✅ 0 透明度黑色
    visualState: 'floating',                // ✅ Electron 19+
    
    // === 交互控制 ===
    minimizable: false,
    maximizable: false,
    closable: false,
    resizable: false,
    
    // === 性能优化 ===
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      preloadSecurityContext: 'isolated',   // ✅ 隔离上下文
      contextIsolation: true,               // ✅ 默认启用
      sandbox: false,                       // ❌ 禁用 sandbox (需直接访问 Node)
      nodeIntegration: false,               // ✅ 禁用 Node (安全)
      webviewTag: false,                    // ✅ 不使用 webview
      spellcheck: false,                    // ✅ 关闭拼写检查
      devTools: process.env.ELECTRON_DEV === 'true' // 条件启用
    },
    
    // === 实验性：Workspaces (仅 macOS) ===
    hasShadow: false,                       // ✅ 无阴影
    opacity: 1.0,                           // ✅ 完全可见
    alphaCurve: 0,                          // ✅ 线性透明度
    enableLargerThanScreen: true,           // ✅ 允许大于屏幕
    macosVisualEffectState: 'active',       // ⚠️ 需 Electron >= 25
  });

  window.loadFile(htmlPath);
  return window;
}
```

### 1.2 Visible on All Workspaces 实现

**问题**: Electron 原生没有 `visibleOnAllWorkspaces` API（该 API 属于 macOS Cocoa）。

**解决方案**: 使用 **NSWindow level** 强制跨越 Spaces：

```javascript
// main.js - macOS specific hack
if (process.platform === 'darwin') {
  const { nativeImage, Menu } = require('electron');
  
  // 方法 1: NSWindow level = floating (最可靠)
  window.setAlwaysOnTop(true, 'screen-saver'); // 'screen-saver' > 'pop-up-menu' > 'floating'
  
  // 方法 2: 通过 Objective-C Runtime (Electron >= 27 推荐)
  const { nativeBridge } = require('electron/native-bridge'); // 实验性
  const Cocoa = require('Cocoa');
  const nsWindow = window.getNativeWindowHandle();
  const cocoaWindow = Cocoa.NSWindow.alloc().initWithWindowPtr(nsWindow);
  cocoaWindow.setLevel(-1); // NSScreenSaverWindowLevel = -1
  
  // 方法 3: Fallback to X11/XQuartz (Linux)
  if (process.platform === 'linux') {
    window.setAlwaysOnTop(true, 'normal');
    // 需要 xdotool 模拟：xdotool search --name "app" setwindowshape --shape 0
  }
}
```

---

## 2. Preload Script + contextBridge 最佳实践

### 2.1 preload.js (安全 IPC 暴露)

```javascript
'use strict';

const { contextBridge, ipcRenderer } = require('electron/renderer');

// ✅ Expose only necessary methods, never direct Node access
contextBridge.exposeInMainWorld('dcfElectron', {
  // === IPC Methods (RPC) ===
  companionRpc: async (method, path, params = undefined) => {
    return ipcRenderer.invoke('companion:rpc', method, path, params);
  },
  
  // === Clipboard Access (requires user gesture) ===
  clipboardWrite: (text) => {
    return ipcRenderer.invoke('clipboard:write', text);
  },
  
  clipboardRead: async () => {
    return ipcRenderer.invoke('clipboard:read');
  },
  
  // === System Information ===
  getPlatformInfo: () => {
    return ipcRenderer.invoke('system:platform-info');
  },
  
  getScreenInfo: async () => {
    return ipcRenderer.invoke('system:screen-info');
  },
  
  // === Lifecycle Hooks ===
  onCompanionOnline: (callback) => {
    ipcRenderer.on('companion:online', callback);
  },
  
  onCompanionOffline: (callback) => {
    ipcRenderer.on('companion:offline', callback);
  },
  
  // === Security Token ===
  getSecureToken: () => {
    return ipcRenderer.invoke('security:token'); // 临时 token 用于某些 macOS API
  }
});

// ✅ Error handling wrapper
ipcRenderer.on('error', (event, error) => {
  console.error('[DCF Electron]', error.message);
});

// ✅ Auto-reconnection logic
let reconnectInterval = null;
function startReconnect() {
  reconnectInterval = setInterval(async () => {
    try {
      await window.dcfElectron.companionRpc('GET', '/rpc/health');
      clearInterval(reconnectInterval);
      window.dispatchEvent(new CustomEvent('companion:connected'));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('companion:disconnected'));
    }
  }, 2000);
}

startReconnect();
```

### 2.2 renderer.js (Web 进程调用)

```javascript
// g4-lifecycle-core.js adapter for Electron
class ElectronRpcAdapter {
  constructor(baseUrl = 'http://127.0.0.1:8472') {
    this.baseUrl = baseUrl;
  }

  async fetch(url, options = {}) {
    // Route to Companion via preload bridge
    if (options.method && options.body) {
      const payload = JSON.parse(options.body);
      const response = await window.dcfElectron.companionRpc(
        options.method || 'POST',
        url.replace(this.baseUrl, ''),
        payload
      );
      return { ok: response.ok, json: async () => response };
    } else {
      const response = await window.dcfElectron.companionRpc(
        'GET',
        url.replace(this.baseUrl, '')
      );
      return { ok: response.ok, json: async () => response.result };
    }
  }
}

// Replace default fetch with Electron-compatible version
const ORIGINAL_FETCH = window.fetch;
if (window.dcfElectron) {
  window.fetch = async (url, options = {}) => {
    if (url.startsWith('http://127.0.0.1:8472')) {
      return window.dcfElectron.companionRpc(
        options.method || 'GET',
        url.substring(22),
        options?.body
      );
    }
    return ORIGINAL_FETCH(url, options);
  };
}
```

---

## 3. macOS 特殊权限与限制

### 3.1 Accessibility 权限需求表

| 功能 | 是否需要 Accessibility | 用户授权方式 |
|------|---------------------|-------------|
| 悬浮窗口 (transparent/alwaysOnTop) | ❌ 不需要 | 自动授予 (当 App 被签署时) |
| 屏幕截图 (screenshot API) | ✅ 需要 | 系统弹窗提示 "请求截屏权限" |
| 窗口内容读取 (DOM extraction) | ✅ 需要 | `ax.GetRoleDescription()` 需授权 |
| 剪贴板读写 (clipboard API) | ❌ 不需要 | 浏览器级别权限 (需 HTTPS/localhost) |
| 键盘监听 (global hotkeys) | ✅ 需要 | `NSSystemAccessibilityUsageDescription` in Info.plist |

**关键发现**: 
- **悬浮窗口本身不需要 Accessibility 权限** ✅
- 但如果需要 **读取其他应用窗口内容**（如提取 ChatGPT 对话 DOM），则必须要求用户手动授权
- 授权路径：**System Preferences → Security & Privacy → Privacy → Accessibility → "+" 添加 DCf.app**

### 3.2 screen.getDisplayMatching() 可用性

```javascript
// main.js - Cross-platform display detection
const { screen } = require('electron');

function findOptimalDisplay() {
  if (process.platform === 'darwin') {
    // macOS: Retina support built-in via DIP
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    
    // Get display that matches the current cursor position
    const cursorPoint = screen.getCursorScreenPoint();
    const targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
    
    return {
      bounds: targetDisplay.bounds,     // Physical pixels (not DIP!)
      workArea: targetDisplay.workArea, // Excluding menu bar/dock
      scaleFactor: targetDisplay.scaleFactor, // 2.0 for Retina
    };
  }
  
  // Fallback for Windows/Linux
  return screen.getPrimaryDisplay();
}
```

**已知坑点**:
1. **Retina 屏幕 DPI 问题**: `bounds` 返回物理像素，需在渲染层除以 `scaleFactor`
2. **多显示器错位**: 需使用 `workArea` 而非 `bounds` 避免 Dock/任务栏遮挡
3. **高分辨率模糊**: 需在 `Info.plist` 添加 `NSHighResolutionCapable` key

---

## 4. 需要测试的关键 API（Phase 2）

### 4.1 优先级 P0（阻塞性）

```bash
# Test 1: Transparent Window on Retina Display
npm run test:electron:retina
# Expected: No visual artifacts, crisp text at 2x scale

# Test 2: Always-on-Top Across Spaces
npm run test:electron:spaces
# Expected: Window persists when switching Workspaces

# Test 3: contextBridge IPC Latency
npm run test:electron:ipc-latency
# Expected: <5ms per rpc call (vs 50ms in plain Chrome Extension)
```

### 4.2 优先级 P1（体验优化）

```bash
# Test 4: Clipboard Permissions Flow
npm run test:electron:clipboard-permissions
# Expected: User can grant once-and-for-all in Safari Settings

# Test 5: Memory Usage Comparison (BrowserWindow vs iframe)
npm run test:electron:memory-profile
# Expected: <100MB baseline vs 200MB+ for multiple tabs
```

---

## 5. 已知限制与风险

### 5.1 当前做不到（需 Phase 2 验证）

- ❌ **真正的透明玻璃窗口**：macOS Catalina+ 对透明窗口有沙盒限制，可能需要 **NotchHack**（修改 Electron binary）
- ❌ **全局鼠标穿透**：`mouseEvents: true` 属性已被 Electron 弃用，需用 **CGEventSource** 手写 C++ addon
- ⚠️ **暗黑模式自适应**：需手动监听 `NSApplication.didChangeColorSchemeNotification`

### 5.2 用户必须授权项

1. **Accessibility**（如需提取其他窗口内容）
2. **Screen Recording**（如需做屏幕录制/分析）
3. **Automation**（如模拟 Cmd+V 等快捷键）

### 5.3 性能预估

| 指标 | Electron | Chrome Extension | Notes |
|------|----------|------------------|-------|
| Startup Time | ~2.5s | ~0.8s | Electron 冷启动慢 |
| Memory Footprint | ~80MB | ~30MB | Renderer + Chromium overhead |
| IPC Latency | 3-5ms | 1-2ms | contextBridge adds one hop |
| Update Cycle | Full rebuild | Hot reload | Manifest V3 supports dynamic loading |

---

## 6. 推荐实施步骤

```bash
# Step 1: Scaffold Electron project
mkdir electron-g2-surface && cd electron-g2-surface
npx electron@latest init .

# Step 2: Copy surface HTML files
cp ../seed/surface/*.html .
cp ../seed/surface/*-core.js .

# Step 3: Create main.js with window config (见 above)
# Step 4: Add preload.js (see above)
# Step 5: Update package.json
{
  "name": "dcf-g2-electron",
  "version": "0.1.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --mac --universal",
    "test": "jest"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0"
  }
}

# Step 6: Run tests
npm start
npm test

# Step 7: Build distribution
npm run build
```

---

## 附录：参考资源

- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [macOS Accessibility Programming Guide](https://developer.apple.com/documentation/accessibility)
- [Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [Retina Display Support](https://www.electronjs.org/docs/latest/tutorial/high-resolution)

---

*最后更新：2026-07-26*
*版本：v0.1 (Phase 1 Recon)*
