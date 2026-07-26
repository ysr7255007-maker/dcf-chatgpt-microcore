# DCF Target Adapter (Chrome Extension MV3)

DCF Surface（Electron 应用）的薄插件层。不持有权威事实，只负责静默观察目标窗口（如 ChatGPT）的对话内容，并将 Surface 下发的卡片文本翻译为输入框写入动作。

## 目录结构

```
packages/target-adapter-chrome/
├── manifest.json   # MV3 清单
├── background.js   # Service Worker（消息中转）
├── content.js      # 对话读取 + 卡片注入
├── cpaste.js       # 剪贴板模拟工具
├── popup.html      # 连接状态 popup
├── popup.js
└── README.md
```

## 消息协议

### 内部消息（popup → background → content）

| 请求 type | 方向 | 说明 |
|-----------|------|------|
| `dcf-read-request` | popup → bg | 读取当前标签对话 |
| `dcf-send-card-request` | popup → bg | 向当前标签发送卡片（携带 `text`） |
| `dcf-ping` | popup → bg | 存活检测 |

background 转换为 content script 动作：

| content action | 说明 |
|----------------|------|
| `read-conversation` | 提取对话轮次 |
| `send-card` | 写入输入框（携带 `text`） |
| `ping` | 存活检测 |

### 外部消息（DCF Surface → background）

通过 `chrome.runtime.onMessageExternal` 接收，复用同一 `type` 集合。需在 Surface 侧调用：

```js
chrome.runtime.sendMessage('<extension-id>', { type: 'dcf-read-request' }, cb);
```

`manifest.json` 中 `externally_connectable.matches` 已开放为 `*://*/*`，生产环境应收敛到 Surface 实际来源。

## 读取策略

`content.js` 按优先级尝试多组选择器：

1. `[data-testid="conversation-turn"]`（ChatGPT 官方结构）
2. `article[class*="message"]`
3. `article`
4. `[class*="message"]:not([class*="input"])`
5. `[class*="markdown"]`

角色判定优先看 `[data-testid="user-message"]`，其次用 turn 序号奇偶兜底。

## 卡片发送策略

1. 查找输入框（`textarea#prompt-textarea` → `textarea` → `[contenteditable]`）
2. 写入文本并派发 `input`/`change` 事件以兼容 React 受控组件
3. 辅助：`cpaste.js` 同步写入剪贴板，便于手动粘贴兜底

`cpaste.js` 优先 `navigator.clipboard.writeText`，失败降级 `execCommand('copy')`。Chrome 138 已移除 `clipboard-unrestricted-read-write` flag，故需自动降级。

## 加载与验证

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 `packages/target-adapter-chrome/` 目录
4. 打开 https://chatgpt.com/ 并登录
5. 点击工具栏扩展图标 →「Test Read」→ 确认返回对话数据

## 约束

- 纯原生 JS，零依赖
- MV3 Service Worker，非持久 background page
- 不持有权威事实，仅做观察与动作翻译
