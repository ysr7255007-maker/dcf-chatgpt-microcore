# BrowserClaw E2E 测试环境准备指南

## 前提条件

### 1. BrowserClaw 浏览器
- BrowserClaw 浏览器已安装并运行
- 已登录 ChatGPT 账号（https://chatgpt.com/）
- BrowserClaw MCP 服务已配置（`browserclaw` server）

### 2. Companion HTTP 服务
```bash
cd /Users/looy/Documents/dcf
node seed/companion/index.js --port=8472
```
验证：`curl http://127.0.0.1:8472/rpc/health` 返回 `{"status":"healthy"}`

### 3. Chrome Extension（可选，用于完整 E2E）
- 在 BrowserClaw 浏览器中打开 `chrome://extensions`
- 启用开发者模式
- 加载已解压的扩展程序：`packages/target-adapter-chrome`

---

## BrowserClaw MCP 工具清单

| 工具 | 用途 | 示例 |
|------|------|------|
| `tabs` (action=new) | 打开新标签页 | `tabs(action=new, url=https://chatgpt.com/)` |
| `snapshot` | 获取页面 DOM 快照 | `snapshot(page=12)` |
| `act` | 执行页面交互 | `act(kind=fill, page=12, ref=e17, value=text)` |
| `evaluate` | 在页面执行 JS | `evaluate(page=12, code=...)` |
| `screenshot` | 截图 | `screenshot(page=12)` |
| `wait` | 等待 | `wait(page=12, time=5000)` |

---

## 测试场景清单

### T1: 读取真实 ChatGPT 对话
1. `tabs(action=new, url=https://chatgpt.com/)` → 获取 page ID
2. `act(kind=fill, page=X, ref=input, value=test message)` → 填入消息
3. `act(kind=click, page=X, ref=sendButton)` → 发送
4. `wait(page=X, time=5000)` → 等待回复
5. `evaluate(page=X, code=DOM_READER_SCRIPT)` → 读取对话
6. 断言：返回的 messages 数组包含用户消息和 AI 回复

### T2: 边界设置持久化
1. `POST /rpc/boundary/update` 设置 `OBSERVE_AND_ARCHIVE`
2. 刷新页面
3. `GET /rpc/events/query` 验证 boundary 事件已持久化

### T3: 发送卡片到 ChatGPT
1. `evaluate(page=X, code=CARD_INJECTION_SCRIPT)` → 注入卡片文本
2. `screenshot(page=X)` → 截图验证输入框包含卡片文本

### T4: 会话绑定显式确认
1. `POST /rpc/events/ingest` 创建 task.created 事件
2. `GET /rpc/task/query?task_id=X` 验证任务已创建
3. 断言：execution_agent 字段正确

### T5: 检查点保存与恢复
1. `POST /rpc/task/checkpoint` 保存检查点
2. `GET /rpc/task/query?task_id=X` 验证 checkpoint_event_id 已更新

---

## 已知问题

- BrowserClaw 无法直接操作非 agent 创建的标签页（需用 `tabs new` 创建新页面）
- ChatGPT 页面的 React 组件需要 `nativeInputValueSetter` 才能正确触发状态更新
- `chrome.runtime.onMessageExternal` 需要扩展的 `externally_connectable` 配置

---

*最后更新：2026-07-26*
