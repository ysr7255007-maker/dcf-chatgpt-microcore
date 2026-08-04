# OpenCode Bridge Contract — Phase 5

Date: 2026-07-27
Status: accepted (implementation complete, offline acceptance pending)
Related ADRs:
- [2026-07-17-dcf-chrome-local-agent-bridge-plan.md](../adr/2026-07-17-dcf-chrome-local-agent-bridge-plan.md)
- [2026-07-18-dcf-local-agent-dialogue-loop.md](../adr/2026-07-18-dcf-local-agent-dialogue-loop.md)

## 1. 目标

为 DCF 补全 OpenCode 桥接：Deep Link 一键唤起界面 + 官方 HTTP API/SSE 作为事实通道 + 标准化输出回读。这是 DCF 正式实施计划 v1.0 阶段 5 的交付物。

用户裁定（关键约束）：
- OpenCode 的 session、任务、权限、状态、中止和结果以官方 HTTP API/SSE 为事实通道。
- Deep Link 只负责一键唤起界面，不携参跳转。
- 若当前 OpenCode 版本不能携参跳转，由 DCF 自己的链接先通过 API 创建任务后打开 OpenCode，不退化成用户手工复制。
- 参考旧版 local-agent 实现的行为契约与坑点，但不照抄。

## 2. 旧版 local-agent 行为契约与已知坑点

### 2.1 行为契约（从旧版提炼）

| 环节 | 旧版行为 | 本版采纳 |
|------|---------|---------|
| 任务下发 | 在 ChatGPT 页面插件中直接 fetch 本机 OpenCode HTTP API，创建 session 后 `POST /session/:id/message`（同步）或 `POST /session/:id/prompt_async`（异步） | 由 companion 后端经 bridge 统一派发，使用 `prompt_async` 非阻塞入队 |
| 状态回报 | 轮询 `/session/status`、`/session/:id/message`、`/session/:id/todo`、`/session/:id/diff` | bridge.getStatus 查询 `/session/:id`，`/session/status` 作为补充证据 |
| 失败证据 | 收集 session 消息、状态、todo、diff、权限、提问；保留 HTTP 状态码和响应体 | bridge 在 dispatch/abort/getStatus 各环节保留 HTTP 状态码与截断响应体 |
| 结果回填 | 第一版只填入 ChatGPT 输入框；dialogue 版自动返回结构化结果 | 标准化输出契约：OpenCode 将结果 JSON 写入约定文件路径，bridge 回读入库 |

### 2.2 已知坑点清单

1. **`prompt_async` 返回 204 不等于任务已执行**
   - 旧版发现：`POST /session/:id/prompt_async` 返回成功，但新 session 在 `/session/status` 中缺失，无消息列表，所有观察端点超时。
   - 应对：204 只表示服务器接受了请求，不证明执行已开始或完成。只有标准化输出文件才是完成权威。

2. **`POST /session/:id/message` 同步端点可能返回 HTTP 500**
   - 旧版发现：同步 message 请求返回 500，session 无消息持久化。根因是独立 CLI 版本与桌面 App 版本不同步（`SQLiteError: no such column: replacement_seq`）。
   - 应对：HTTP 500 是 OpenCode 侧事件，不折叠为空泛错误。bridge 保留状态码、响应体和 session 侧证据。不因外部服务返回 500 而修改 DCF。

3. **Assistant 消息流式增量渲染**
   - 旧版发现：只检查一次 DOM 节点会漏掉已完成产物。
   - 应对：本版不依赖 DOM 检查，改为文件回读 + nonce 校验，避免流式渲染的竞态。

4. **`/session/status` 是补充证据，不是完成权威**
   - 旧版发现：status 中缺失条目时，任务可能仍在运行。
   - 应对：bridge.getStatus 查询 status 作为参考，但任务完成以标准化输出文件为准。

5. **CORS 与 Basic Auth 预检**
   - 旧版要求用户显式配置 ChatGPT 来源的 CORS。
   - 应对：本版 bridge 运行在 companion 后端（Node 进程），不受浏览器 CORS 限制。仍需 Basic Auth 密码。

6. **OpenCode 版本/数据库 schema 不匹配**
   - 旧版发现独立 CLI 1.17.8 与桌面 App 版本不同步导致 SQLite schema 错误。
   - 应对：bridge.healthCheck 可检测服务器可达性。版本不匹配是外部问题，DCF 不代为修复。

7. **密码不应进入持久存储**
   - 旧版：OpenCode 密码只保留在页面运行时内存，不写 plugin.data。
   - 应对：本版密码从 ai-config.json 的 `opencode_server.password` 字段或环境变量 `OPENCODE_SERVER_PASSWORD` 读取，仅在 companion 进程内存中使用。

## 3. OpenCode 官方 HTTP API/SSE 事实通道

参考文档：https://opencode.ai/docs/server/

### 3.1 使用的端点

| 环节 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 创建 session | POST | `/session` | body: `{ parentID?, title? }`，返回 Session（含 `id`） |
| 发送消息 | POST | `/session/:id/prompt_async` | body: `{ parts, agent?, model? }`，返回 204（非阻塞入队） |
| 中止任务 | POST | `/session/:id/abort` | 返回 boolean |
| 查询 session | GET | `/session/:id` | 返回 Session 详情 |
| 查询全部状态 | GET | `/session/status` | 返回 `{ [sessionID]: SessionStatus }`（补充证据） |
| 查询消息 | GET | `/session/:id/message` | 返回消息列表（补充证据） |
| 健康检查 | GET | `/global/health` | 返回 `{ healthy: true, version: string }` |
| SSE 事件流 | GET | `/event` | 全局 SSE 流，首事件为 `server.connected` |

### 3.2 认证

- Basic Auth：用户名默认 `opencode`，密码通过 `OPENCODE_SERVER_PASSWORD` 环境变量或 ai-config.json 设置。
- 默认地址：`http://127.0.0.1:4096`（loopback）。

### 3.3 SSE（可选增强）

`GET /event` 提供全局 SSE 流。bridge 当前使用轮询查询状态（`GET /session/:id`），SSE 作为未来实时增强预留。SSE 解析遵循标准 `text/event-stream` 格式。

## 4. Deep Link scheme

### 4.1 scheme

```
opencode://session/<session_id>
```

### 4.2 行为

- Deep Link 只负责将 OpenCode UI 带到前台，不携带任务参数。
- 派发流程：bridge 先通过 API 创建 session 并入队消息，然后尝试 Deep Link 唤起界面。
- Deep Link 失败不影响任务状态（best-effort）：即使 Deep Link 无法打开，任务仍已在 API 侧入队。
- 平台支持：macOS 使用 `open`，Linux 使用 `xdg-open`，通过 `spawn` + argv 数组调用（不经过 shell 拼接）。
- 测试中 Deep Link launcher 可替换为 mock。

### 4.3 不携参时的 fallback

若 OpenCode 版本不支持 Deep Link 携参跳转（当前版本即如此），DCF 的流程为：
1. 经 API 创建 session + 入队消息（API 是事实通道）
2. 打开 `opencode://session/<session_id>` 唤起界面（用户可看到对应 session）
3. 不退化成用户手工复制

## 5. 标准化输出契约（Better Loop 风格）

### 5.1 约定

任务提示词中嵌入输出契约，要求 OpenCode 将结果以 JSON 格式写入约定文件路径。

### 5.2 文件路径

```
<temp_dir>/dcf-opencode-<task_id>.json
```

`temp_dir` 默认为 `os.tmpdir()`，可由 companion 配置覆盖。

### 5.3 JSON Schema

```json
{
  "task_id": "dcf-oc-<ULID>",
  "nonce": "<32-char hex>",
  "status": "completed | failed",
  "products": [
    {
      "type": "card | maintenance_task",
      "title": "...",
      "summary": "...",
      "evidence": ["..."],
      "boundary_inherit": "OBSERVE_CURRENT_ONLY",
      "source_conversation": "..."
    }
  ],
  "evidence": {
    "session_id": "<OpenCode session id>",
    "messages_count": 0,
    "error": null
  }
}
```

### 5.4 校验规则

1. **JSON 可解析**：文件内容必须是合法 JSON。
2. **nonce 匹配**：`data.nonce` 必须等于派发时生成的 nonce。不匹配 → 硬拒绝（`rejected: true`），记录拒绝原因，不入库。
3. **task_id 匹配**：`data.task_id` 必须等于派发时的 task_id。
4. **status 合法**：`completed` 或 `failed`。
5. **products 是数组**：可为空数组，但字段必须存在。
6. **evidence 是对象**：必须包含 `session_id`、`error` 字段。

### 5.5 校验失败处理

- **nonce 不匹配**：硬拒绝，记录 `rejected: true` + 原因，不入库。可能是文件被其他任务写入或篡改。
- **Schema 不合法**：可能是文件部分写入（写了一半），继续等待。如果是最终状态仍不合法，记录失败原因。
- **超时**：watchResult 超时后标记任务失败，记录超时原因。

## 6. Fallback 策略

### 6.1 AI 材料代谢的降级链

```
API 优先 → 本地 Ollama 降级 → OpenCode 派发
```

当 API 和本地 Ollama 均不可用时，ai-digest.js 的 `_handleOpenCodeFallback` 通过 bridge 派发任务到 OpenCode。

### 6.2 OpenCode 不可达

- bridge.dispatchTask 在 API 不可达时返回 `{ status: 'failed', error: 'OpenCode API unreachable: ...' }`。
- 不伪造结果，不静默跳过。
- ai-digest.js 将 digest job 标记为 `failed`，记录错误原因。

### 6.3 任务超时

- watchResult 默认超时 5 分钟（可配置）。
- 超时后任务标记为 `failed`，digest job 标记为 `failed`。

### 6.4 结果文件不出现

- 如果 OpenCode 执行了任务但未按契约写入文件（例如模型未遵循指令），watchResult 会超时。
- bridge.getStatus 仍可查询 OpenCode session 状态作为补充证据。
- 用户可通过 Surface 面板手动查看 OpenCode session。

## 7. 已知问题（known issues）

1. **OpenCode 版本兼容性**：独立 CLI 与桌面 App 版本需保持同步，否则可能出现 SQLite schema 错误（旧版 1.17.8 → 1.18.3 修复案例）。
2. **prompt_async 非确定性**：204 响应不保证任务已启动，依赖标准化输出文件作为完成权威。
3. **fs.watch 平台差异**：某些平台 fs.watch 不可靠，bridge 同时使用 1s 轮询兜底。
4. **密码管理**：当前从 ai-config.json 或环境变量读取明文密码，未来可考虑 keychain 集成。
5. **SSE 未启用**：当前使用轮询查询状态，SSE 实时推送为未来增强。
6. **单 Profile 共享**：DCF 扩展状态整 Profile 共享，底座重载/插件源更新会波及所有标签的活 DCF。bridge 运行在 companion 进程中，不受此限制。

## 8. RPC 端点

### 8.1 POST /rpc/opencode/dispatch

入队 OpenCode 任务。

Request body:
```json
{
  "prompt": "任务提示词",
  "conversation_url": "https://chatgpt.com/...",
  "entity_id": "conv-xxx",
  "title": "可选 session 标题",
  "agent": "可选 agent ID",
  "model": "可选 model ID",
  "timeout_ms": 300000
}
```

Response:
```json
{
  "task_id": "dcf-oc-<ULID>",
  "status": "dispatched",
  "session_id": "ses_xxx",
  "deep_link": "opencode://session/ses_xxx",
  "deep_link_result": { "ok": true, "error": null },
  "output_path": "/tmp/dcf-opencode-dcf-oc-xxx.json",
  "nonce": "<32-char hex>"
}
```

### 8.2 GET /rpc/opencode/status/:task_id

查询任务状态。

Response:
```json
{
  "task_id": "dcf-oc-xxx",
  "status": "dispatched | running | completed | failed | aborted",
  "session_id": "ses_xxx",
  "output_path": "/tmp/...",
  "created_at": "2026-07-27T...",
  "error": null,
  "api_status": { "status": "idle", "title": "..." },
  "result": null
}
```

### 8.3 POST /rpc/opencode/abort/:task_id

中止任务。

Response:
```json
{
  "task_id": "dcf-oc-xxx",
  "status": "aborted",
  "session_id": "ses_xxx"
}
```

## 9. 文件清单

| 文件 | 职责 |
|------|------|
| `seed/adapters/opencode/bridge.mjs` | OpenCodeBridge 类：dispatchTask / watchResult / abortTask / getStatus |
| `seed/companion/index.js` | RPC 端点 + bridge 实例化 + ai-digest 降级通道对接 |
| `seed/companion/ai-digest.js` | `_handleOpenCodeFallback` 接通 bridge |
| `seed/surface/g4-task-status.html` | OpenCode 任务实时状态面板 |
| `seed/tests/g5-opencode-bridge.acceptance.mjs` | 离线验收测试（mock OpenCode API） |
| `seed/docs/opencode-bridge-contract.md` | 本文档 |
