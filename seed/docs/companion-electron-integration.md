# Companion Core - Electron 集成方案

## 核心结论

Companion HTTP 服务 (端口 8472) 在 Electron 内外均通过 `http://127.0.0.1:8472` 访问，无需修改。Electron 主进程使用 Node 18+ 原生 `fetch` 转发 RPC 请求，无需额外 HTTP 客户端依赖。

---

## 1. 端口配置与冲突处理

### 1.1 默认端口

```javascript
// seed/companion/index.js
const DEFAULT_PORT = 8472;
let PORT = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1]) || DEFAULT_PORT;
```

### 1.2 端口冲突检测

当端口 8472 被占用时，Companion 会启动失败并报错。解决方案：

```javascript
// Electron main.js - 启动前检测端口
const net = require('net');

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close();
        resolve(true);
      })
      .listen(port);
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 10; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port in range ${startPort}-${startPort + 9}`);
}
```

### 1.3 备选端口策略

| 优先级 | 端口 | 用途 |
|--------|------|------|
| 1 | 8472 | 默认 Companion HTTP |
| 2 | 8473 | 备选 1 |
| 3 | 8474 | 备选 2 |

Electron 启动时自动检测并将实际端口写入 `~/.dcf/companion.port` 文件。

---

## 2. Electron webRequest 与 Companion RPC 的兼容性

### 2.1 webRequest 拦截器

Electron 的 `session.webRequest` API 可以拦截和修改 HTTP 请求。默认情况下不会干扰 `http://127.0.0.1:8472` 的请求。

### 2.2 需要过滤的 URL 模式

```javascript
// main.js - 避免拦截 Companion RPC 请求
const { session } = require('electron');

session.defaultSession.webRequest.onBeforeRequest({
  urls: ['http://127.0.0.1:8472/*']
}, (details, callback) => {
  // 不拦截 Companion RPC 请求
  callback({ cancel: false });
});
```

### 2.3 CSP (Content Security Policy) 处理

Surface HTML 页面中的 CSP 可能阻止 `fetch('http://127.0.0.1:8472/...')`。解决方案：

```javascript
// main.js - 移除 CSP 限制以允许 Companion RPC
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval'"]
    }
  });
});
```

---

## 3. 本地数据库路径设计

### 3.1 跨平台路径

```javascript
const { app } = require('electron');
const path = require('path');

// 使用 Electron 的 userData 目录
const DB_DIR = app.getPath('userData');
const DB_PATH = path.join(DB_DIR, 'dcf.db');

// 平台对应的实际路径：
// macOS: ~/Library/Application Support/dcf-surface/dcf.db
// Windows: %APPDATA%\dcf-surface\dcf.db
// Linux: ~/.config/dcf-surface/dcf.db
```

### 3.2 与独立 Companion 的兼容性

当 Companion 作为独立进程运行时（非 Electron 内嵌），数据库路径为 `~/.dcf/dcf.db`。
当通过 Electron 启动时，可以使用 `--db` 参数指定数据库路径：

```bash
node seed/companion/index.js --port=8472 --db="$HOME/Library/Application Support/dcf-surface/dcf.db"
```

### 3.3 Electron app 环境变量

```javascript
// Electron 启动 Companion 时设置的环境变量
process.env.DCF_COMPANION_PORT = '8472';
process.env.DCF_COMPANION_DB = DB_PATH;
process.env.DCF_ELECTRON_VERSION = app.getVersion();
```

---

## 4. 待验证项

1. Companion 在 Electron 主进程中作为子进程运行时的信号处理
2. Electron 应用退出时 Companion 的优雅关闭（`SIGTERM` → `SIGKILL` 超时）
3. 多窗口场景下 Companion RPC 的并发处理能力

---

## 5. 已知限制

- ⚠️ Companion 独立运行和 Electron 内嵌运行不应同时使用同一数据库（SQLite 锁冲突）
- ⚠️ Electron 的 `contextIsolation: true` 阻止渲染进程直接访问 `http` 模块，必须通过 IPC 桥接
- ❌ Electron 打包后（asar 归档）无法直接运行 `seed/companion/index.js`，需要使用 `extraResources` 将其复制到打包外

---

*最后更新：2026-07-26*
*版本：v0.1 (Phase 1 Recon)*
